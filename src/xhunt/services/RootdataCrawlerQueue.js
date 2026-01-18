/**
 * RootData 爬虫更新队列
 *
 * 功能：
 * 1. 同一时间只执行一个爬虫任务（队列机制）
 * 2. 全局3分钟节流（距上次执行3分钟内的请求会被跳过）
 * 3. 记录最近500个已触发链接，避免重复触发（去重）
 * 4. 夜间休眠（每天1:00-7:00不执行）
 * 5. 避免冲突（其他爬虫running时不执行）
 */
class RootdataCrawlerQueue {
  constructor() {
    // 队列处理状态
    this.isProcessing = false;
    this.queue = [];

    // 去重机制
    this.recentUrls = []; // 最近触发的500个URL（按时间倒序）
    this.MAX_RECENT_URLS = 500;

    // 节流机制（全局）
    this.lastExecutionTime = null; // 最后一次执行爬虫的时间戳（全局）
    this.THROTTLE_TIME = 10 * 60 * 1000; // 3分钟

    // Redis 客户端（延迟加载，避免循环依赖）
    this._redisClient = null;

    // 统计信息
    this.stats = {
      totalRequests: 0,
      skippedByRecent: 0,
      skippedByThrottle: 0,
      skippedByNightTime: 0,
      successful: 0,
      failed: 0,
    };
  }

  /**
   * 获取 Redis 客户端（延迟初始化，独立连接）
   */
  async getRedisClient() {
    if (!this._redisClient || !this._redisClient.isReady) {
      try {
        const redis = require("redis");
        this._redisClient = redis.createClient({
          socket: {
            host: "127.0.0.1",
            port: 6379,
          },
        });
        await this._redisClient.connect();
        console.log("✅ [爬虫队列] Redis 连接成功");
      } catch (error) {
        console.error("❌ [爬虫队列] Redis 连接失败:", error.message);
        this._redisClient = null;
        throw error;
      }
    }
    return this._redisClient;
  }

  /**
   * 触发爬虫更新
   * @param {Object} project - 项目对象（必须包含 projectLink）
   * @param {string} cacheKey - 搜索缓存 key（可选）
   */
  async updateCrawl(project, cacheKey = null) {
    if (!project || !project.projectLink) {
      console.log(`⚠️ [爬虫队列] 无效项目，跳过`);
      return;
    }

    const url = project.projectLink;

    // 验证必须是 RootData 链接
    if (
      !url.startsWith("https://www.rootdata.com/") &&
      !url.startsWith("https://rootdata.com/")
    ) {
      console.log(`⚠️ [爬虫队列] 非 RootData 链接，跳过: ${url}`);
      return;
    }

    this.stats.totalRequests++;

    // 1. 检查是否在最近500个记录中
    if (this.recentUrls.includes(url)) {
      this.stats.skippedByRecent++;
      console.log(
        `⏭️ [爬虫队列] 跳过（已在最近${this.MAX_RECENT_URLS}条记录中）: ${url}`
      );
      return;
    }

    // 2. 检查时间窗口（每天1:00-7:00不执行）
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 1 && hour < 7) {
      this.stats.skippedByNightTime++;
      console.log(
        `⏭️ [爬虫队列] 跳过（夜间休眠时段 1:00-7:00，当前${hour}点）: ${url}`
      );
      return;
    }

    // 3. 检查全局节流
    const nowTimestamp = Date.now();
    if (
      this.lastExecutionTime &&
      nowTimestamp - this.lastExecutionTime < this.THROTTLE_TIME
    ) {
      this.stats.skippedByThrottle++;
      const remainingTime = Math.ceil(
        (this.THROTTLE_TIME - (nowTimestamp - this.lastExecutionTime)) /
          1000 /
          60
      );
      console.log(
        `⏭️ [爬虫队列] 跳过（距上次执行仅${
          3 - remainingTime
        }分钟，需等${remainingTime}分钟）: ${url}`
      );
      return;
    }

    // 4. 添加到队列（只保存必要信息，不保存 redisClient 避免内存泄露）
    this.queue.push({
      project,
      url,
      cacheKey, // 只保存 cacheKey，执行时通过全局 Redis 客户端删除
      addedAt: Date.now(),
    });
    console.log(
      `📝 [爬虫队列] 已加入队列 (队列长度: ${this.queue.length}): ${url}`
    );

    // 5. 触发队列处理（异步，不阻塞）
    this.processQueue().catch((error) => {
      console.error(`❌ [爬虫队列] 处理队列时出错:`, error.message);
    });
  }

  /**
   * 检查其他爬虫是否正在运行
   */
  async checkOtherCrawlerStatus() {
    try {
      // 从 SQLite 引入 NewCrawlState
      const { NewCrawlState } = require("../../models/sqlite-start");

      // 检查 quickUpdate (type='quick'), detailsCrawl (type='detail'), subDetailsCrawl (type='detail2')
      const runningCrawlers = await NewCrawlState.findAll({
        where: {
          type: ["quick", "detail", "detail2"],
          status: "running",
        },
      });

      if (runningCrawlers.length > 0) {
        const types = runningCrawlers.map((c) => c.type).join(", ");
        console.log(`⚠️ [爬虫队列] 检测到其他爬虫正在运行: ${types}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`⚠️ [爬虫队列] 检查爬虫状态失败: ${error.message}`);
      // 出错时保守处理，不执行
      return true;
    }
  }

  /**
   * 处理队列（串行执行）
   */
  async processQueue() {
    // 如果正在处理或队列为空，直接返回
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    // 检查其他爬虫是否正在运行
    const isOtherCrawlerRunning = await this.checkOtherCrawlerStatus();
    if (isOtherCrawlerRunning) {
      console.log(
        `⏭️ [爬虫队列] 跳过处理（其他爬虫正在运行），队列长度: ${this.queue.length}`
      );
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const { project, url, cacheKey, addedAt } = this.queue.shift();
        const waitTime = ((Date.now() - addedAt) / 1000).toFixed(2);

        console.log(
          `🔄 [爬虫队列] 开始处理 (等待${waitTime}秒, 剩余${this.queue.length}个): ${url}`
        );

        // 【关键】在执行前立即记录全局时间，防止5分钟内重复触发
        this.lastExecutionTime = Date.now();

        const startTime = Date.now();

        try {
          // 执行爬虫更新，只传递 cacheKey
          await this.executeCrawl(project, cacheKey);

          // 成功后记录到去重列表
          this.addToRecentUrls(url);
          this.stats.successful++;

          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`✅ [爬虫队列] 完成 (耗时${duration}秒): ${url}`);
        } catch (error) {
          // 失败也记录到去重列表，避免反复重试失败的URL
          this.addToRecentUrls(url);
          this.stats.failed++;

          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          console.error(
            `❌ [爬虫队列] 失败 (耗时${duration}秒): ${url}`,
            error.message
          );
        }
      }
    } finally {
      this.isProcessing = false;

      // 如果处理过程中又有新任务加入，继续处理
      if (this.queue.length > 0) {
        console.log(
          `🔄 [爬虫队列] 检测到新任务，继续处理 (队列长度: ${this.queue.length})`
        );
        this.processQueue().catch((error) => {
          console.error(`❌ [爬虫队列] 处理队列时出错:`, error.message);
        });
      }
    }
  }

  /**
   * 添加到最近URL列表（保持最多500个）
   */
  addToRecentUrls(url) {
    // 添加到列表开头
    this.recentUrls.unshift(url);

    // 保持最多500个
    if (this.recentUrls.length > this.MAX_RECENT_URLS) {
      this.recentUrls = this.recentUrls.slice(0, this.MAX_RECENT_URLS);
    }
  }

  /**
   * 执行实际的爬虫更新
   * @param {Object} project - 项目对象
   * @param {string} cacheKey - 搜索缓存 key（可选）
   */
  async executeCrawl(project, cacheKey = null) {
    const crawler = require("../../services/rootdata-crawler");
    const { Fundraising } = require("../../models/postgres-fundraising");

    let browser = null;
    let page = null;

    try {
      // 从数据库重新查询完整的项目对象（确保有 Sequelize 方法）
      const fullProject = await Fundraising.Project.findOne({
        where: { projectLink: project.projectLink },
      });

      if (!fullProject) {
        throw new Error(`项目未找到: ${project.projectLink}`);
      }

      const result = await crawler.initBrowserAndPage();
      browser = result.browser;
      page = result.page;

      // 执行爬取（队列触发，标记为自动爬虫修复）
      await crawler.scrapeAndUpdateProjectDetails(fullProject, page, false, 'auto_crawler_fix');

      // 爬取成功后，清除搜索缓存（使用独立的 Redis 连接）
      if (cacheKey) {
        try {
          const redisClient = await this.getRedisClient();
          await redisClient.del(cacheKey);
          console.log(`✅ [爬虫队列] 已清除搜索缓存: ${cacheKey}`);
        } catch (cacheError) {
          console.error(`⚠️ [爬虫队列] 清除缓存失败:`, cacheError.message);
        }
      }
    } finally {
      // 确保浏览器被关闭
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error(`⚠️ [爬虫队列] 关闭浏览器失败:`, closeError.message);
        }
      }
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    const now = Date.now();
    const timeSinceLastExecution = this.lastExecutionTime
      ? Math.floor((now - this.lastExecutionTime) / 1000)
      : null;

    return {
      isProcessing: this.isProcessing,
      queueLength: this.queue.length,
      recentUrlsCount: this.recentUrls.length,
      lastExecutionTime: this.lastExecutionTime,
      timeSinceLastExecution: timeSinceLastExecution
        ? `${timeSinceLastExecution}秒前`
        : "从未执行",
      stats: { ...this.stats },
    };
  }

  /**
   * 打印统计信息
   */
  printStats() {
    const status = this.getStatus();
    console.log(`
📊 [爬虫队列] 统计信息:
   总请求数: ${this.stats.totalRequests}
   成功执行: ${this.stats.successful}
   执行失败: ${this.stats.failed}
   去重跳过: ${this.stats.skippedByRecent}
   节流跳过: ${this.stats.skippedByThrottle}
   夜间跳过: ${this.stats.skippedByNightTime}
   当前队列: ${this.queue.length}
   最近记录: ${this.recentUrls.length}/${this.MAX_RECENT_URLS}
   上次执行: ${status.timeSinceLastExecution}
    `);
  }
}

// 导出单例
module.exports = new RootdataCrawlerQueue();
