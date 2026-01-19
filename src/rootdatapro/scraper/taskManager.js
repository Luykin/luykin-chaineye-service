const { getRedisClient } = require("../../lib/redisClient");
const typemapManager = require("./typemap/manager");
const { scrapeProject, scrapeOrganization, scrapePerson } = require("./index");

const WORKER_COUNT = Math.max(1, parseInt(process.env.RDT_CRAWL_WORKERS || "1", 10) || 1);

const REDIS_KEYS = {
  STATUS: "rdt_crawl:status",
  PROGRESS: "rdt_crawl:progress",
  SCRAPED_IDS: "rdt_crawl:scraped_ids",
  QUEUE_PROJECT: "rdt_crawl:queue:1",
  QUEUE_ORG: "rdt_crawl:queue:2",
  QUEUE_PERSON: "rdt_crawl:queue:3",
  ERROR: "rdt_crawl:error",
  CONSECUTIVE_ERRORS: "rdt_crawl:consecutive_errors",
};

class CrawlTaskManager {
  constructor() {
    this.redis = null;
  }

  async _getRedis() {
    if (!this.redis || !this.redis.isOpen) {
      this.redis = await getRedisClient();
    }
    return this.redis;
  }

  async initialize(force = false) {
    console.log("[TaskManager] 初始化中...");
    const redis = await this._getRedis();

    if (force) {
        console.log("[TaskManager] 强制重置，正在清理旧的 Redis 数据...");
        const keysToClear = Object.values(REDIS_KEYS);
        await redis.del(keysToClear);
    }

    const isInitialized = await redis.exists(REDIS_KEYS.PROGRESS);
    if (isInitialized && !force) {
      console.log("[TaskManager] 任务已初始化，跳过设置。如需重置，请使用 force=true");
      return;
    }

    typemapManager.loadIdMaps();

    const allIds = {
      1: Array.from(typemapManager._idMapCache.byType[1]),
      2: Array.from(typemapManager._idMapCache.byType[2]),
      3: Array.from(typemapManager._idMapCache.byType[3]),
    };

    const queues = {
        1: allIds[1],
        2: allIds[2],
        3: allIds[3],
    };

    if (queues[1].length > 0) await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, queues[1]);
    if (queues[2].length > 0) await redis.rPush(REDIS_KEYS.QUEUE_ORG, queues[2]);
    if (queues[3].length > 0) await redis.rPush(REDIS_KEYS.QUEUE_PERSON, queues[3]);

    const progress = {
      'project:total': queues[1].length,
      'organization:total': queues[2].length,
      'person:total': queues[3].length,
      'total': queues[1].length + queues[2].length + queues[3].length,
      'completed': 0,
      'project:completed': 0,
      'organization:completed': 0,
      'person:completed': 0,
    };
    await redis.hSet(REDIS_KEYS.PROGRESS, progress);
    await redis.set(REDIS_KEYS.STATUS, "idle");

    console.log(`[TaskManager] 初始化完成。待处理任务总数: ${progress.total}`);
  }

  async start() {
    const redis = await this._getRedis();
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);

    if (currentStatus === "finished") {
      console.log("[TaskManager] 所有任务已完成，如需重新开始请先重置。");
      return;
    }

    await redis.set(REDIS_KEYS.STATUS, "running");
    await redis.del(REDIS_KEYS.ERROR);
    await redis.set(REDIS_KEYS.CONSECUTIVE_ERRORS, 0);

    console.log(`[TaskManager] 任务开始/接管运行。worker 数: ${WORKER_COUNT}`);

    for (let i = 0; i < WORKER_COUNT; i++) {
      this._workerLoop(i).catch((e) => {
        console.error(`[TaskManager] worker ${i} 异常退出:`, e);
      });
    }
  }

  async pause() {
    const redis = await this._getRedis();
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);
    if (currentStatus !== "running") return;
    await redis.set(REDIS_KEYS.STATUS, "paused");
    console.log("[TaskManager] 任务暂停。");
  }

  async getStatus() {
    const redis = await this._getRedis();
    const [status, progress, error] = await Promise.all([
        redis.get(REDIS_KEYS.STATUS),
        redis.hGetAll(REDIS_KEYS.PROGRESS),
        redis.get(REDIS_KEYS.ERROR),
    ]);

    const parseProgress = (p) => {
        const parsed = {};
        for (const key in p) {
            const value = parseInt(p[key], 10);
            const [main, sub] = key.split(':');
            if (sub) {
                if (!parsed[main]) parsed[main] = {};
                parsed[main][sub] = value;
            } else {
                parsed[main] = value;
            }
        }
        return parsed;
    }

    return {
      status: status || 'uninitialized',
      progress: parseProgress(progress),
      error: error || null,
    };
  }

  _buildUrl(id, type) {
    const encodedId = Buffer.from(String(id)).toString("base64");
    const k = encodeURIComponent(encodedId);

    const name = typemapManager.getNameById(id, type);
    const slug = name ? encodeURIComponent(name) : '0';

    if (slug === '0') {
      console.warn(`[TaskManager] 未找到 ID: ${id} (类型: ${type}) 的名称，将使用 '0' 作为备用 slug。`);
    }

    switch (type) {
      case 1: return `https://www.rootdata.com/Projects/detail/${slug}?k=${k}`;
      case 2: return `https://www.rootdata.com/Investors/detail/${slug}?k=${k}`;
      case 3: return `https://www.rootdata.com/member/${slug}?k=${k}`;
      default: return null;
    }
  }

  async _workerLoop(workerId) {
    const redis = await this._getRedis();

    while ((await redis.get(REDIS_KEYS.STATUS)) === "running") {
      let nextTask = await this._getNextTask();

      if (!nextTask) {
        // 可能是暂时被其他 worker 抢空了；稍等后再确认
        await new Promise((r) => setTimeout(r, 500));

        const again = await this._getNextTask();
        if (!again) {
          await redis.set(REDIS_KEYS.STATUS, "finished");
          console.log(`[TaskManager] worker ${workerId} 检测到队列为空，任务结束。`);
          break;
        }

        // 抢到了任务就继续处理
        nextTask = again;
      }

      const { id, type } = nextTask;
      const url = this._buildUrl(id, type);

      try {
        console.log(`[TaskManager] worker ${workerId} 正在爬取: [Type: ${type}, ID: ${id}] URL: ${url}`);
        const scrapeFn = { 1: scrapeProject, 2: scrapeOrganization, 3: scrapePerson }[type];
        const userDataDirSuffix = String(workerId + 1).padStart(3, "0");

        await Promise.race([
          scrapeFn(url, { updateDb: true, fetchOptions: { userDataDirSuffix } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), 2 * 60 * 1000))
        ]);
        console.log(`[TaskManager] worker ${workerId} 爬取成功: [ID: ${id}]`);

        await redis.sAdd(REDIS_KEYS.SCRAPED_IDS, id);
        const progressUpdates = [redis.hIncrBy(REDIS_KEYS.PROGRESS, "completed", 1)];
        if (type === 1) progressUpdates.push(redis.hIncrBy(REDIS_KEYS.PROGRESS, "project:completed", 1));
        if (type === 2) progressUpdates.push(redis.hIncrBy(REDIS_KEYS.PROGRESS, "organization:completed", 1));
        if (type === 3) progressUpdates.push(redis.hIncrBy(REDIS_KEYS.PROGRESS, "person:completed", 1));
        await Promise.all(progressUpdates);
        await redis.set(REDIS_KEYS.CONSECUTIVE_ERRORS, 0);
      } catch (error) {
        const errorMessage = `ID ${id} 爬取失败: ${error.message}`;
        console.error(`[TaskManager] worker ${workerId} 爬取失败: [ID: ${id}]. 错误: ${error.message}`);

        const consecutive = await redis.incr(REDIS_KEYS.CONSECUTIVE_ERRORS);
        await redis.set(REDIS_KEYS.ERROR, `${errorMessage}（连续失败 ${consecutive} 次）`);

        if (consecutive >= 10) {
          await redis.set(REDIS_KEYS.STATUS, "paused");
          await redis.set(
            REDIS_KEYS.ERROR,
            `连续失败 ${consecutive} 个任务，已自动暂停。请检查网络/目标站点/代理/解析逻辑后手动点击启动继续。最后错误：${error.message}`
          );
          console.error(`[TaskManager] 连续失败 ${consecutive} 次，已自动暂停任务。`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1200));
    }

    console.log(`[TaskManager] worker ${workerId} 运行循环结束。状态: ${await redis.get(REDIS_KEYS.STATUS)}`);
  }

  async _getNextTask() {
    const redis = await this._getRedis();
    const queues = [REDIS_KEYS.QUEUE_PROJECT, REDIS_KEYS.QUEUE_ORG, REDIS_KEYS.QUEUE_PERSON];
    
    for (let i = 0; i < queues.length; i++) {
        const type = i + 1;
        const id = await redis.lPop(queues[i]);
        if (id) {
            const isScraped = await redis.sIsMember(REDIS_KEYS.SCRAPED_IDS, id);
            if (isScraped) {
                console.log(`[TaskManager] ID: ${id} 已被爬取，跳过。`);
                // If already scraped, try to get next one immediately
                return this._getNextTask(); 
            }
            return { id, type };
        }
    }
    return null;
  }
}

const taskManager = new CrawlTaskManager();
// Auto-initialize on start, but don't force it.
taskManager.initialize();

module.exports = taskManager;
