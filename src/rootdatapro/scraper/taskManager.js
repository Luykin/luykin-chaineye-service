const { getRedisClient } = require("../../lib/redisClient");
const typemapManager = require("./typemap/manager");
const { scrapeProject, scrapeOrganization, scrapePerson } = require("./index");
const db = require("../models");

const WORKER_COUNT = Math.max(1, parseInt(process.env.RDT_CRAWL_WORKERS || "1", 10) || 1);

const REDIS_KEYS = {
  STATUS: "rdt_crawl:status",
  QUEUE_PROJECT: "rdt_crawl:queue:1",
  QUEUE_ORG: "rdt_crawl:queue:2",
  QUEUE_PERSON: "rdt_crawl:queue:3",
  ERROR: "rdt_crawl:error",
  CONSECUTIVE_ERRORS: "rdt_crawl:consecutive_errors",
  CURRENT_TASKS: "rdt_crawl:current_tasks",
  MAINTENANCE_REPORT: "rdt_crawl:maintenance_report",
  MAINTENANCE_STAGE: "rdt_crawl:maintenance_stage", // 当前执行阶段
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

  /**
   * 构建「从未爬取过」任务的队列
   * 逻辑：从 typemap 中找出在 CrawlLog 表里「完全没有任何记录」的 ID
   *（既没有 success，也没有 failure）—— 即真正的首爬任务。
   * 失败过但尚未成功的任务由 _buildRetryQueue 单独处理。
   * @returns {Promise<Object>} 返回 { project: [ids], organization: [ids], person: [ids] }
   */
  async _buildQueueFromDb() {
    try {
      typemapManager.loadIdMaps();
      
      const allIds = {
        Project: Array.from(typemapManager._idMapCache.byType[1]).map(id => String(id)),
        Organization: Array.from(typemapManager._idMapCache.byType[2]).map(id => String(id)),
        Person: Array.from(typemapManager._idMapCache.byType[3]).map(id => String(id)),
      };

      const unscrapedIds = {
        Project: [],
        Organization: [],
        Person: [],
      };

      const BATCH_SIZE = 1000; // 每次检查 1000 个 ID

      for (const entityType of ['Project', 'Organization', 'Person']) {
        const idsToCheck = allIds[entityType];
        console.log(`[TaskManager] 检查 ${entityType} 类型，总共 ${idsToCheck.length} 个 ID...`);

        for (let i = 0; i < idsToCheck.length; i += BATCH_SIZE) {
          const batch = idsToCheck.slice(i, i + BATCH_SIZE);
          if (batch.length === 0) continue;

          // 查询这批 ID 在 CrawlLog 中的所有记录（成功或失败）
          const records = await db.CrawlLog.findAll({
            where: {
              entity_type: entityType,
              entity_id: batch, // 使用 IN 查询
            },
            attributes: ['entity_id', 'status'],
            raw: true,
          });

          const anyRecordIds = new Set();
          const successIdsInBatch = new Set();

          for (const r of records) {
            const eid = String(r.entity_id);
            anyRecordIds.add(eid);
            if (r.status === 'success') {
              successIdsInBatch.add(eid);
            }
          }

          // 「从未爬取过」的定义：这批 ID 中，在 CrawlLog 里完全没有任何记录
          const unscrapedInBatch = batch.filter(id => !anyRecordIds.has(id));
          
          if (unscrapedInBatch.length > 0) {
            unscrapedIds[entityType].push(...unscrapedInBatch);
          }
        }
        console.log(`[TaskManager] 发现 ${unscrapedIds[entityType].length} 个未爬取的 ${entityType} ID`);
      }

      return unscrapedIds;
    } catch (error) {
      console.error("[TaskManager] 构建队列失败:", error);
      return { Project: [], Organization: [], Person: [] };
    }
  }

  /**
   * 增量发现新 ID（从 typemap 最大 ID 开始探测）
   * @param {number} maxConsecutiveFailures 连续失败 N 次后停止（默认 20）
   * @param {Object} options - { redis: RedisClient, updateStage: boolean } 用于更新执行阶段信息
   * @returns {Promise<Object>} 返回 { project: [newIds], organization: [newIds], person: [newIds], discovered: number }
   */
  async _discoverNewIds(maxConsecutiveFailures = 5, options = {}) {
    const { redis = null, updateStage = false } = options;
    try {
      typemapManager.loadIdMaps();
      
      // 从 CrawlLog 表动态获取每种类型的最大 ID
      console.log('[taskManager] discoverNewIds: Fetching max IDs from CrawlLog...');
      const [maxProject, maxOrg, maxPerson] = await Promise.all([
        db.CrawlLog.max('entity_id', { where: { entity_type: 'Project', status: 'success' } }),
        db.CrawlLog.max('entity_id', { where: { entity_type: 'Organization', status: 'success' } }),
        db.CrawlLog.max('entity_id', { where: { entity_type: 'Person', status: 'success' } }),
      ]);

      const maxIds = {
        Project: parseInt(maxProject, 10) || 0,
        Organization: parseInt(maxOrg, 10) || 0,
        Person: parseInt(maxPerson, 10) || 0,
      };
      console.log('[taskManager] discoverNewIds: Found max IDs:', maxIds);

      const newIds = {
        Project: [],
        Organization: [],
        Person: [],
      };

      const entityTypeMap = {
        Project: { type: 1, scrapeFn: scrapeProject, typeName: 'Project' },
        Organization: { type: 2, scrapeFn: scrapeOrganization, typeName: 'Organization' },
        Person: { type: 3, scrapeFn: scrapePerson, typeName: 'Person' },
      };

      let totalDiscovered = 0;

      // 对每种类型进行增量发现
      for (const [entityType, config] of Object.entries(entityTypeMap)) {
        const maxId = maxIds[entityType];
        let currentId = maxId + 1;
        let consecutiveFailures = 0;
        const discoveredForType = [];

        console.log(`[TaskManager] 开始增量发现 ${entityType}，从 ID ${currentId} 开始...`);
        
        // 更新执行阶段信息
        if (updateStage && redis) {
          await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
            step: "discovering", 
            message: `正在增量发现 ${entityType}，从 ID ${currentId} 开始...`,
            currentType: entityType,
            currentId: currentId,
            consecutiveFailures: 0,
            discovered: totalDiscovered
          }));
        }

        while (consecutiveFailures < maxConsecutiveFailures) {
          // 更新执行阶段信息（实时显示当前尝试的 ID）
          if (updateStage && redis) {
            await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
              step: "discovering", 
              message: `正在尝试 ${entityType} #${currentId} (连续失败 ${consecutiveFailures}/${maxConsecutiveFailures})`,
              currentType: entityType,
              currentId: currentId,
              consecutiveFailures: consecutiveFailures,
              discovered: totalDiscovered
            }));
          }
          try {
            // 构建 URL
            const url = this._buildUrl(currentId, config.type);
            if (!url) {
              consecutiveFailures++;
              currentId++;
              continue;
            }

            // 尝试爬取并入库（如果成功）
            let testResult = null;
            try {
              testResult = await Promise.race([
                config.scrapeFn(url, { updateDb: true, fetchOptions: {} }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), 30 * 1000))
              ]);
            } catch (error) {
              // 爬取失败，可能是 ID 不存在
              consecutiveFailures++;
              currentId++;
              await new Promise(resolve => setTimeout(resolve, 500));
              continue;
            }

            // 如果能成功解析到数据，说明这个 ID 有效
            if (testResult) {
              // 检查是否获取到了关键字段（name 或类似字段）
              let hasKeyFields = false;
              let name = null;
              
              if (entityType === 'Project' && testResult.project_name) {
                hasKeyFields = true;
                name = testResult.project_name;
              } else if (entityType === 'Organization' && testResult.org_name) {
                hasKeyFields = true;
                name = testResult.org_name;
              } else if (entityType === 'Person' && testResult.people_name) {
                hasKeyFields = true;
                name = testResult.people_name;
              }

              if (hasKeyFields) {
                // 成功发现新 ID 并已入库
                totalDiscovered++;
                consecutiveFailures = 0; // 重置连续失败计数
                console.log(`[TaskManager] 发现新的 ${entityType} ID: ${currentId}, 名称: ${name}，已入库`);
                
                // 更新执行阶段信息（显示成功发现）
                if (updateStage && redis) {
                  await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
                    step: "discovering", 
                    message: `✓ 发现新的 ${entityType} #${currentId}: ${name} (已发现 ${totalDiscovered} 个)`,
                    currentType: entityType,
                    currentId: currentId,
                    consecutiveFailures: 0,
                    discovered: totalDiscovered
                  }));
                }
                
                // 将新 ID 添加到 typemap 缓存中
                typemapManager._idMapCache.byType[config.type].add(String(currentId));
                if (name) {
                  typemapManager._idMapCache.nameByTypeId[config.type].set(String(currentId), name);
                }
                // 注意：数据已经通过 scrapeFn 入库，CrawlLog 也已经写入
                // 不需要加入队列，因为已经成功爬取了
              } else {
                consecutiveFailures++;
              }
            } else {
              consecutiveFailures++;
            }
          } catch (error) {
            // 爬取失败，可能是 ID 不存在
            consecutiveFailures++;
          }

          currentId++;
          
          // 添加延迟，避免请求过快
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        newIds[entityType] = discoveredForType;
        console.log(`[TaskManager] ${entityType} 增量发现完成，发现 ${discoveredForType.length} 个新 ID`);
        
        // 更新执行阶段信息（类型完成）
        if (updateStage && redis) {
          await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
            step: "discovering", 
            message: `✓ ${entityType} 增量发现完成，发现 ${discoveredForType.length} 个新 ID (总计 ${totalDiscovered} 个)`,
            currentType: null,
            currentId: null,
            consecutiveFailures: 0,
            discovered: totalDiscovered
          }));
        }
      }

      return {
        project: newIds.Project,
        organization: newIds.Organization,
        person: newIds.Person,
        discovered: totalDiscovered,
      };
    } catch (error) {
      console.error("[TaskManager] 增量发现失败:", error);
      return { project: [], organization: [], person: [], discovered: 0 };
    }
  }

  /**
   * 构建失败任务的重试队列
   * @returns {Promise<Object>} 返回 { project: [ids], organization: [ids], person: [ids] }
   */
  async _buildRetryQueue() {
    try {
      // 使用聚合查询直接从数据库找出需要重试的 ID
      // 条件：失败过 1 次，且从未成功过
      const { Op, fn, literal } = db.Sequelize;

      const retryRecords = await db.CrawlLog.findAll({
        attributes: ['entity_id', 'entity_type'],
        group: ['entity_id', 'entity_type'],
        // 失败次数为 1，且成功次数为 0
        having: literal(
          "SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) = 1 " +
          "AND SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) = 0"
        ),
        raw: true,
      });

      const retryIds = {
        Project: [],
        Organization: [],
        Person: [],
      };

      for (const record of retryRecords) {
        if (retryIds[record.entity_type]) {
          retryIds[record.entity_type].push(String(record.entity_id));
        }
      }

      return retryIds;
    } catch (error) {
      console.error("[TaskManager] 构建重试队列失败:", error);
      return { Project: [], Organization: [], Person: [] };
    }
  }

  /**
   * 获取失败次数 <= 2 的任务（用于每日维护）
   * @returns {Promise<Object>} 返回 { Project: [ids], Organization: [ids], Person: [ids] }
   */
  async _getRetryableFailures(limitPerType = 300) {
    try {
      const { literal, fn } = db.Sequelize;

      // 先按 entity_type 分组获取候选，再在内存里按类型截断
      const retryRecords = await db.CrawlLog.findAll({
        attributes: [
          'entity_id',
          'entity_type',
          [fn('MAX', literal('crawled_at')), 'last_crawled_at'],
        ],
        group: ['entity_id', 'entity_type'],
        having: literal(
          "SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) <= 2 " +
          "AND SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) > 0 " +
          "AND SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) = 0"
        ),
        order: [[literal('last_crawled_at'), 'ASC']],
        raw: true,
      });

      const retryIds = {
        Project: [],
        Organization: [],
        Person: [],
      };

      const counts = { Project: 0, Organization: 0, Person: 0 };

      for (const record of retryRecords) {
        const type = record.entity_type;
        if (retryIds[type] && counts[type] < limitPerType) {
          retryIds[type].push(String(record.entity_id));
          counts[type]++;
        }
      }

      return retryIds;
    } catch (error) {
      console.error("[TaskManager] 获取可重试失败任务失败:", error);
      return { Project: [], Organization: [], Person: [] };
    }
  }

  /**
   * 获取需要重爬的旧数据（10天前成功过）
   * 每种类型每天最多1000条
   * @returns {Promise<Object>} 返回 { Project: [ids], Organization: [ids], Person: [ids] }
   */
  async _getStaleEntitiesToRecrawl(limitPerType = 1000) {
    try {
      const { literal, fn, Op } = db.Sequelize;
      const tenDaysAgo = new Date();
      tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
      tenDaysAgo.setUTCHours(0, 0, 0, 0);

      // 使用原始 SQL 查询，更高效
      const tableName = db.CrawlLog.tableName || 'RootdataCrawlLogs';
      const query = `
        SELECT
          entity_id,
          entity_type,
          MAX(CASE WHEN status = 'success' THEN crawled_at END) AS last_success_at
        FROM
          "${tableName}"
        GROUP BY
          entity_id,
          entity_type
        HAVING
          MAX(CASE WHEN status = 'success' THEN crawled_at END) < :tenDaysAgo
          AND MAX(CASE WHEN status = 'success' THEN crawled_at END) IS NOT NULL
        ORDER BY
          MAX(CASE WHEN status = 'success' THEN crawled_at END) ASC
      `;

      const staleRecords = await db.CrawlLog.sequelize.query(query, {
        replacements: { tenDaysAgo: tenDaysAgo.toISOString() },
        type: db.CrawlLog.sequelize.QueryTypes.SELECT,
      });

      const staleIds = {
        Project: [],
        Organization: [],
        Person: [],
      };

      const counts = { Project: 0, Organization: 0, Person: 0 };

      for (const record of staleRecords) {
        const type = record.entity_type;
        if (staleIds[type] && counts[type] < limitPerType) {
          staleIds[type].push(String(record.entity_id));
          counts[type]++;
        }
      }

      return staleIds;
    } catch (error) {
      console.error("[TaskManager] 获取旧数据重爬任务失败:", error);
      return { Project: [], Organization: [], Person: [] };
    }
  }

  /**
   * Maintenance 任务的专用 worker 循环
   * 顺序处理队列，不重建队列，不执行增量发现
   * @returns {Promise<void>}
   */
  async _maintenanceWorkerLoop() {
    const redis = await this._getRedis();
    const WORKER_ID = 0; // maintenance 任务使用固定的 worker ID 0

    console.log("[TaskManager] maintenance worker 开始执行队列任务...");

    while (true) {
      // 检查状态，如果不是 maintenance_running 则退出
      const status = await redis.get(REDIS_KEYS.STATUS);
      if (status !== "maintenance_running") {
        console.log(`[TaskManager] maintenance worker 检测到状态变为 ${status}，退出`);
        break;
      }

      // 从队列获取任务
      const nextTask = await this._getNextTask();

      if (!nextTask) {
        // 队列为空，检查是否真的完成
        await new Promise((r) => setTimeout(r, 2000)); // 等待2秒再确认
        
        const again = await this._getNextTask();
        if (!again) {
          // 队列确实为空，maintenance 任务完成
          console.log("[TaskManager] maintenance worker 检测到队列已清空，任务完成");
          break;
        }
        // 有新任务，继续处理
        continue;
      }

      const { id, type } = nextTask;
      const url = this._buildUrl(id, type);

      try {
        const typeName = ({ 1: 'Project', 2: 'Organization', 3: 'Person' }[type]) || String(type);
        const taskInfo = {
          workerId: WORKER_ID,
          id,
          type,
          typeName,
          url,
          startedAt: new Date().toISOString(),
        };
        // 写入 Redis，供 /crawl/status 查询当前任务
        await redis.hSet(REDIS_KEYS.CURRENT_TASKS, String(WORKER_ID), JSON.stringify(taskInfo));

        // 更新执行阶段信息（包含当前处理的任务信息）
        // 注意：任务已经从队列中取出（lPop），所以队列长度已经是剩余任务数
        const queueLengths = await Promise.all([
          redis.lLen(REDIS_KEYS.QUEUE_PROJECT),
          redis.lLen(REDIS_KEYS.QUEUE_ORG),
          redis.lLen(REDIS_KEYS.QUEUE_PERSON),
        ]);
        const remainingTasks = queueLengths[0] + queueLengths[1] + queueLengths[2];
        const stageInfo = await redis.get(REDIS_KEYS.MAINTENANCE_STAGE);
        let stageData = { step: "processing_queue", message: "正在处理队列任务...", totalTasks: 0, processedTasks: 0, remainingTasks: 0 };
        if (stageInfo) {
          try {
            stageData = JSON.parse(stageInfo);
          } catch {}
        }
        
        // 计算已处理的任务数
        const totalTasks = stageData.totalTasks || (remainingTasks + 1); // 如果 totalTasks 未设置，用剩余任务数+1（当前任务）估算
        const processedTasks = totalTasks - remainingTasks - 1; // 剩余任务数 + 当前任务 = 总任务数 - 已处理任务数
        
        await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({
          step: "processing_queue",
          message: `正在处理: ${typeName} #${id} (第 ${processedTasks + 1}/${totalTasks} 个任务，剩余 ${remainingTasks} 个)`,
          totalTasks,
          processedTasks: processedTasks + 1, // 当前任务正在处理
          remainingTasks,
          currentTask: { type: typeName, id },
        }));

        console.log(`[TaskManager] maintenance worker 正在爬取: [Type: ${type}, ID: ${id}] URL: ${url}`);
        const scrapeFn = { 1: scrapeProject, 2: scrapeOrganization, 3: scrapePerson }[type];
        const userDataDirSuffix = "001"; // maintenance 任务使用固定的 userDataDir

        await Promise.race([
          scrapeFn(url, { updateDb: true, fetchOptions: { userDataDirSuffix } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), 2 * 60 * 1000))
        ]);
        console.log(`[TaskManager] maintenance worker 爬取成功: [ID: ${id}]`);

        // 重置连续错误计数
        await redis.set(REDIS_KEYS.CONSECUTIVE_ERRORS, 0);
      } catch (error) {
        const errorMessage = `ID ${id} 爬取失败: ${error.message}`;
        console.error(`[TaskManager] maintenance worker 爬取失败: [ID: ${id}]. 错误: ${error.message}`);

        const consecutive = await redis.incr(REDIS_KEYS.CONSECUTIVE_ERRORS);
        await redis.set(REDIS_KEYS.ERROR, `${errorMessage}（连续失败 ${consecutive} 次）`);

        // maintenance 任务期间不自动暂停，继续执行
        if (consecutive >= 10) {
          console.warn(`[TaskManager] maintenance 任务期间连续失败 ${consecutive} 次，但继续执行（维护任务不自动暂停）`);
        }
      } finally {
        // 清理当前任务的 Redis 记录
        await redis.hDel(REDIS_KEYS.CURRENT_TASKS, String(WORKER_ID));
      }

      // 添加延迟，避免请求过快
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1200));
    }

    console.log(`[TaskManager] maintenance worker 运行循环结束`);
  }

  /**
   * 等待队列跑完（所有 worker 完成）
   * @returns {Promise<void>}
   */
  async _waitForQueueToComplete() {
    const redis = await this._getRedis();
    const maxWaitTime = 24 * 60 * 60 * 1000; // 最多等待24小时
    const startTime = Date.now();
    const checkInterval = 5000; // 每5秒检查一次

    while (Date.now() - startTime < maxWaitTime) {
      const status = await redis.get(REDIS_KEYS.STATUS);
      
      // 如果状态不是 maintenance_running，说明任务已完成或被中断
      if (status !== "maintenance_running") {
        console.log(`[TaskManager] 队列执行完成，最终状态: ${status}`);
        return;
      }

      // 检查队列是否为空
      const queueLengths = await Promise.all([
        redis.lLen(REDIS_KEYS.QUEUE_PROJECT),
        redis.lLen(REDIS_KEYS.QUEUE_ORG),
        redis.lLen(REDIS_KEYS.QUEUE_PERSON),
      ]);

      const totalQueueLength = queueLengths[0] + queueLengths[1] + queueLengths[2];

      if (totalQueueLength === 0) {
        // 队列为空，再等待一段时间确保所有 worker 都完成
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 再次确认队列仍为空且没有正在执行的任务
        const currentTasks = await redis.hGetAll(REDIS_KEYS.CURRENT_TASKS);
        if (Object.keys(currentTasks).length === 0) {
          console.log("[TaskManager] 队列已清空，所有任务完成");
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.warn("[TaskManager] 等待队列完成超时（24小时）");
  }

  /**
   * 每日维护任务主函数
   * 1. 失败任务重试（失败次数 <= 2）
   * 2. 增量发现新 ID
   * 3. 旧数据重爬（10天前成功过的，每种类型最多1000条）
   * 4. 跑完所有队列
   * @param {Object} options - { trigger: 'scheduled' | 'manual' }
   * @returns {Promise<Object>} 返回执行报告
   */
  async runDailyMaintenanceTask(options = {}) {
    const trigger = options.trigger || 'scheduled';
    const redis = await this._getRedis();
    const startTime = Date.now();

    // 串行锁：检查是否已有任务在运行（无论是手动任务还是 maintenance 任务）
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);
    if (currentStatus === "maintenance_running") {
      console.log("[TaskManager] maintenance 任务已在运行中，拒绝重复执行");
      return { 
        success: false, 
        error: "MAINTENANCE_RUNNING",
        message: "每日维护任务正在执行中，请等待上一轮完成"
      };
    }
    if (currentStatus === "running") {
      console.log("[TaskManager] 手动任务正在运行中，拒绝执行 maintenance 任务");
      return { 
        success: false, 
        error: "MANUAL_TASK_RUNNING",
        message: "手动爬取任务正在执行中，请先暂停或等待其完成后再执行每日维护任务"
      };
    }

    // 设置状态为 maintenance_running
    await redis.set(REDIS_KEYS.STATUS, "maintenance_running");
    console.log(`[TaskManager] 开始执行每日维护任务 (触发方式: ${trigger})`);

    const report = {
      trigger,
      startedAt: new Date().toISOString(),
      retryFailures: { Project: 0, Organization: 0, Person: 0 },
      discovered: 0,
      staleRecrawl: { Project: 0, Organization: 0, Person: 0 },
      error: null,
    };

    try {
      // 步骤1: 失败任务重试（失败次数 <= 2）
      await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
        step: "retry_failures", 
        message: "正在获取失败任务重试列表..." 
      }));
      console.log("[TaskManager] 步骤1: 获取失败任务重试列表...");
      const retryIds = await this._getRetryableFailures(300);
      report.retryFailures = {
        Project: retryIds.Project.length,
        Organization: retryIds.Organization.length,
        Person: retryIds.Person.length,
      };
      console.log(`[TaskManager] 找到可重试失败任务: Project=${retryIds.Project.length}, Organization=${retryIds.Organization.length}, Person=${retryIds.Person.length}`);

      // 步骤2: 增量发现新 ID
      await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
        step: "discovering", 
        message: "正在增量发现新 ID..." 
      }));
      console.log("[TaskManager] 步骤2: 开始增量发现新 ID...");
      const discoveryResult = await this._discoverNewIds(5, { redis, updateStage: true });
      report.discovered = discoveryResult.discovered || 0;
      console.log(`[TaskManager] 增量发现完成，发现 ${report.discovered} 个新 ID`);

      // 步骤3: 获取旧数据重爬列表
      await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
        step: "stale_recrawl", 
        message: "正在获取旧数据重爬列表..." 
      }));
      console.log("[TaskManager] 步骤3: 获取旧数据重爬列表...");
      const staleIds = await this._getStaleEntitiesToRecrawl(1000);
      report.staleRecrawl = {
        Project: staleIds.Project.length,
        Organization: staleIds.Organization.length,
        Person: staleIds.Person.length,
      };
      console.log(`[TaskManager] 找到旧数据重爬任务: Project=${staleIds.Project.length}, Organization=${staleIds.Organization.length}, Person=${staleIds.Person.length}`);

      // 合并所有任务到队列（按 type+id 去重）
      const uniqMerge = (a, b) => {
        const s = new Set();
        const out = [];
        for (const id of [...a, ...b]) {
          const key = String(id);
          if (s.has(key)) continue;
          s.add(key);
          out.push(key);
        }
        return out;
      };

      const allTaskIds = {
        Project: uniqMerge(retryIds.Project, staleIds.Project),
        Organization: uniqMerge(retryIds.Organization, staleIds.Organization),
        Person: uniqMerge(retryIds.Person, staleIds.Person),
      };

      const totalTasks = allTaskIds.Project.length + allTaskIds.Organization.length + allTaskIds.Person.length;
      console.log(`[TaskManager] 总共 ${totalTasks} 个任务需要执行`);

      if (totalTasks > 0) {
        // 清空旧队列
        await redis.del([REDIS_KEYS.QUEUE_PROJECT, REDIS_KEYS.QUEUE_ORG, REDIS_KEYS.QUEUE_PERSON]);

        // 将任务推入队列
        if (allTaskIds.Project.length > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, allTaskIds.Project);
        }
        if (allTaskIds.Organization.length > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_ORG, allTaskIds.Organization);
        }
        if (allTaskIds.Person.length > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_PERSON, allTaskIds.Person);
        }

        // 启动 maintenance worker 顺序执行队列（不需要多个 worker）
        await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
          step: "processing_queue", 
          message: `正在处理队列任务 (共 ${totalTasks} 个任务)...`,
          totalTasks,
          processedTasks: 0,
          remainingTasks: totalTasks
        }));
        console.log(`[TaskManager] 启动 maintenance worker 顺序执行队列任务...`);
        await this._maintenanceWorkerLoop();
      } else {
        await redis.set(REDIS_KEYS.MAINTENANCE_STAGE, JSON.stringify({ 
          step: "completed", 
          message: "没有需要执行的任务" 
        }));
        console.log("[TaskManager] 没有需要执行的任务");
      }

      report.completedAt = new Date().toISOString();
      report.duration = Date.now() - startTime;
      report.success = true;

      console.log(`[TaskManager] 每日维护任务完成，耗时 ${report.duration}ms`);

    } catch (error) {
      console.error("[TaskManager] 每日维护任务执行失败:", error);
      report.error = error.message || String(error);
      report.success = false;
      report.completedAt = new Date().toISOString();
      report.duration = Date.now() - startTime;
    } finally {
      // 保存执行报告到 Redis
      await redis.set(REDIS_KEYS.MAINTENANCE_REPORT, JSON.stringify(report));

      // 清除执行阶段信息
      await redis.del(REDIS_KEYS.MAINTENANCE_STAGE);

      // 恢复状态为 idle
      await redis.set(REDIS_KEYS.STATUS, "idle");
      console.log("[TaskManager] 每日维护任务结束，状态已恢复为 idle");
    }

    return report;
  }

  /**
   * 从数据库 CrawlLog 表获取进度信息
   * @returns {Promise<Object>} 进度信息对象
   */
  async _getProgressFromDb() {
    try {
      typemapManager.loadIdMaps();
      const { fn, col, literal } = db.Sequelize;

      const allIds = {
        Project: typemapManager._idMapCache.byType[1].size,
        Organization: typemapManager._idMapCache.byType[2].size,
        Person: typemapManager._idMapCache.byType[3].size,
      };

      const totals = {
        project: allIds.Project,
        organization: allIds.Organization,
        person: allIds.Person,
      };
      totals.total = totals.project + totals.organization + totals.person;

      // 使用聚合查询直接从数据库获取统计信息
      const stats = await db.CrawlLog.findAll({
        attributes: [
          'entity_type',
          [fn('COUNT', fn('DISTINCT', col('entity_id'))), 'completed'],
          [fn('COUNT', fn('DISTINCT', literal(`CASE WHEN status = 'success' THEN entity_id END`))), 'success'],
          [fn('COUNT', fn('DISTINCT', literal(`CASE WHEN status = 'failure' THEN entity_id END`))), 'failure'],
        ],
        group: ['entity_type'],
        raw: true,
      });

      const progress = {
        project: { total: totals.project, completed: 0, success: 0, failure: 0 },
        organization: { total: totals.organization, completed: 0, success: 0, failure: 0 },
        person: { total: totals.person, completed: 0, success: 0, failure: 0 },
      };

      for (const row of stats) {
        const typeKey = row.entity_type.toLowerCase();
        if (progress[typeKey]) {
          progress[typeKey].completed = parseInt(row.completed, 10) || 0;
          progress[typeKey].success = parseInt(row.success, 10) || 0;
          progress[typeKey].failure = parseInt(row.failure, 10) || 0;
        }
      }

      progress.total = totals.total;
      progress.completed = progress.project.completed + progress.organization.completed + progress.person.completed;
      progress.success = progress.project.success + progress.organization.success + progress.person.success;
      progress.failure = progress.project.failure + progress.organization.failure + progress.person.failure;

      return progress;
    } catch (error) {
      console.error("[TaskManager] 获取数据库进度失败:", error);
      // 返回空进度，避免前端报错
      return {
        project: { total: 0, completed: 0, success: 0, failure: 0 },
        organization: { total: 0, completed: 0, success: 0, failure: 0 },
        person: { total: 0, completed: 0, success: 0, failure: 0 },
        total: 0,
        completed: 0,
        success: 0,
        failure: 0,
      };
    }
  }

  /**
   * 检查并恢复异常状态（例如服务器重启导致的状态不一致）
   * @returns {Promise<void>}
   */
  async _recoverAbnormalState() {
    const redis = await this._getRedis();
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);
    
    // 如果状态是 running 或 maintenance_running，但没有任何 worker 在运行
    // 说明可能是服务器重启导致的状态不一致
    if (currentStatus === "running" || currentStatus === "maintenance_running") {
      const currentTasks = await redis.hGetAll(REDIS_KEYS.CURRENT_TASKS);
      const hasActiveWorkers = Object.keys(currentTasks).length > 0;
      
      if (!hasActiveWorkers) {
        console.warn(`[TaskManager] 检测到异常状态: ${currentStatus}，但没有活跃的 worker。可能是服务器重启导致的状态不一致，正在恢复...`);
        
        // 检查队列是否还有任务
        const queueLengths = await Promise.all([
          redis.lLen(REDIS_KEYS.QUEUE_PROJECT),
          redis.lLen(REDIS_KEYS.QUEUE_ORG),
          redis.lLen(REDIS_KEYS.QUEUE_PERSON),
        ]);
        const totalQueueLength = queueLengths[0] + queueLengths[1] + queueLengths[2];
        
        if (totalQueueLength > 0) {
          console.warn(`[TaskManager] 队列中还有 ${totalQueueLength} 个未完成的任务，这些任务将在下次运行时继续处理。`);
        }
        
        // 如果是 maintenance_running，清除 maintenance stage 信息
        if (currentStatus === "maintenance_running") {
          await redis.del(REDIS_KEYS.MAINTENANCE_STAGE);
          console.warn(`[TaskManager] 清除 maintenance 执行阶段信息。`);
        }
        
        // 恢复状态为 idle
        await redis.set(REDIS_KEYS.STATUS, "idle");
        console.log(`[TaskManager] 状态已恢复为 idle。`);
      }
    }
  }

  async initialize() {
    console.log("[TaskManager] 初始化中...");
    const redis = await this._getRedis();

    // 首先检查并恢复异常状态（例如服务器重启导致的状态不一致）
    await this._recoverAbnormalState();

    // 保护：运行中禁止初始化，避免中途清空队列
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);
    if (currentStatus === "running" || currentStatus === "maintenance_running") {
      console.log(`[TaskManager] 当前状态为 ${currentStatus}，跳过初始化以避免中断正在执行的任务。`);
      return { success: false, error: currentStatus === "maintenance_running" ? "MAINTENANCE_RUNNING" : "RUNNING" };
    }

    console.log("[TaskManager] 清理旧的 Redis 队列数据...");
    // 只清理队列相关的键，保留 STATUS、ERROR、CONSECUTIVE_ERRORS（运行时状态）
    const queueKeys = [
      REDIS_KEYS.QUEUE_PROJECT,
      REDIS_KEYS.QUEUE_ORG,
      REDIS_KEYS.QUEUE_PERSON,
    ];
    await redis.del(queueKeys);

    // 步骤1: 构建未爬取任务的队列
    console.log("[TaskManager] 正在从数据库构建未爬取任务队列...");
    const unscrapedIds = await this._buildQueueFromDb();
    
    const queueCounts = {
      project: unscrapedIds.Project.length,
      organization: unscrapedIds.Organization.length,
      person: unscrapedIds.Person.length,
    };
    const totalUnscraped = queueCounts.project + queueCounts.organization + queueCounts.person;

    if (totalUnscraped > 0) {
      // 将未爬取的任务推入队列
      if (queueCounts.project > 0) {
        await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, unscrapedIds.Project);
      }
      if (queueCounts.organization > 0) {
        await redis.rPush(REDIS_KEYS.QUEUE_ORG, unscrapedIds.Organization);
      }
      if (queueCounts.person > 0) {
        await redis.rPush(REDIS_KEYS.QUEUE_PERSON, unscrapedIds.Person);
      }
      console.log(`[TaskManager] 已构建未爬取任务队列: Project=${queueCounts.project}, Organization=${queueCounts.organization}, Person=${queueCounts.person}`);
    } else {
      // 步骤2: 如果没有未爬取的任务，构建重试队列
      console.log("[TaskManager] 所有 typemap ID 都已爬取过，正在构建失败任务重试队列...");
      const retryIds = await this._buildRetryQueue();
      
      const retryCounts = {
        project: retryIds.Project.length,
        organization: retryIds.Organization.length,
        person: retryIds.Person.length,
      };
      const totalRetry = retryCounts.project + retryCounts.organization + retryCounts.person;

      if (totalRetry > 0) {
        if (retryCounts.project > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, retryIds.Project);
        }
        if (retryCounts.organization > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_ORG, retryIds.Organization);
        }
        if (retryCounts.person > 0) {
          await redis.rPush(REDIS_KEYS.QUEUE_PERSON, retryIds.Person);
        }
        console.log(`[TaskManager] 已构建重试队列: Project=${retryCounts.project}, Organization=${retryCounts.organization}, Person=${retryCounts.person}`);
      } else {
        // 没有重试任务，尝试增量发现
        console.log("[TaskManager] 没有需要重试的任务，开始增量发现新 ID...");
        const discoveryResult = await this._discoverNewIds(5);
        
        if (discoveryResult.discovered > 0) {
          // 增量发现成功爬取了新 ID 并已入库
          // 这些 ID 不需要加入队列，因为它们已经爬取完成了
          console.log(`[TaskManager] 增量发现完成，发现并爬取了 ${discoveryResult.discovered} 个新 ID`);
          // 重新构建队列，检查是否有其他未爬取的任务
          const unscrapedIds = await this._buildQueueFromDb();
          const totalUnscraped = unscrapedIds.Project.length + unscrapedIds.Organization.length + unscrapedIds.Person.length;
          if (totalUnscraped > 0) {
            if (unscrapedIds.Project.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, unscrapedIds.Project);
            }
            if (unscrapedIds.Organization.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_ORG, unscrapedIds.Organization);
            }
            if (unscrapedIds.Person.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PERSON, unscrapedIds.Person);
            }
            console.log(`[TaskManager] 已重新构建队列，包含 ${totalUnscraped} 个未爬取任务`);
          }
        } else {
          console.log("[TaskManager] 增量发现未发现新 ID，队列为空。");
        }
      }
    }

    // 设置状态为 idle
    await redis.set(REDIS_KEYS.STATUS, "idle");

    console.log(`[TaskManager] 初始化完成。`);
    return { success: true };
  }

  async start() {
    const redis = await this._getRedis();
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);

    if (currentStatus === "maintenance_running") {
      console.log("[TaskManager] maintenance 任务运行中，拒绝手动启动。");
      return { success: false, error: "MAINTENANCE_RUNNING" };
    }

    if (currentStatus === "finished") {
      console.log("[TaskManager] 所有任务已完成，如需重新开始请先重置。");
      return { success: false, error: "ALREADY_FINISHED" };
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

    return { success: true };
  }

  async forceResetStatus() {
    const redis = await this._getRedis();
    console.warn("[TaskManager] 强制重置状态...");
    await redis.set(REDIS_KEYS.STATUS, "idle");
    await redis.del(REDIS_KEYS.MAINTENANCE_STAGE);
    console.warn("[TaskManager] 状态已强制重置为 'idle'");
    return { success: true };
  }

  async pause() {
    const redis = await this._getRedis();
    const currentStatus = await redis.get(REDIS_KEYS.STATUS);
    if (currentStatus === "maintenance_running") {
      console.log("[TaskManager] maintenance 任务运行中，拒绝手动暂停。");
      return { success: false, error: "MAINTENANCE_RUNNING" };
    }
    if (currentStatus !== "running") return { success: false, error: "NOT_RUNNING" };
    await redis.set(REDIS_KEYS.STATUS, "paused");
    console.log("[TaskManager] 任务暂停。");
    return { success: true };
  }

  /**
   * 检测当前执行阶段
   * @returns {Promise<string>} 阶段名称
   */
  async _detectCurrentPhase() {
    try {
      const redis = await this._getRedis();
      const currentStatus = await redis.get(REDIS_KEYS.STATUS);
      
      if (!currentStatus || currentStatus === 'uninitialized' || currentStatus === 'idle') {
        return 'idle';
      }
      
      if (currentStatus === 'maintenance_running') {
        return 'maintenance_running';
      }
      
      if (currentStatus === 'finished') {
        return 'finished';
      }
      
      if (currentStatus === 'paused') {
        return 'paused';
      }
      
      // 检查队列中是否有任务
      const queueLengths = await Promise.all([
        redis.lLen(REDIS_KEYS.QUEUE_PROJECT),
        redis.lLen(REDIS_KEYS.QUEUE_ORG),
        redis.lLen(REDIS_KEYS.QUEUE_PERSON),
      ]);
      
      const totalQueueLength = queueLengths[0] + queueLengths[1] + queueLengths[2];
      
      if (totalQueueLength > 0) {
        // 队列中有任务，检查是新的还是重试的
        // 随机查看队列中的一个任务来判断
        let sampleId = null;
        let sampleType = null;
        
        for (let i = 0; i < 3; i++) {
          if (queueLengths[i] > 0) {
            const queueKey = [REDIS_KEYS.QUEUE_PROJECT, REDIS_KEYS.QUEUE_ORG, REDIS_KEYS.QUEUE_PERSON][i];
            sampleId = await redis.lIndex(queueKey, 0); // 查看队列第一个元素
            sampleType = ['Project', 'Organization', 'Person'][i];
            break;
          }
        }
        
        if (sampleId) {
          // 检查这个 ID 在 CrawlLog 中是否存在失败记录
          const failureRecord = await db.CrawlLog.findOne({
            where: {
              entity_id: sampleId,
              entity_type: sampleType,
              status: 'failure',
            },
            raw: true,
          });
          
          // 检查是否有成功记录
          const successRecord = await db.CrawlLog.findOne({
            where: {
              entity_id: sampleId,
              entity_type: sampleType,
              status: 'success',
            },
            raw: true,
          });
          
          // 如果有失败记录但没有成功记录，说明是重试阶段
          if (failureRecord && !successRecord) {
            return 'retrying_failures';
          }
          
          // 如果没有记录，说明是新任务
          return 'crawling_new';
        }
        
        // 默认返回爬取新任务
        return 'crawling_new';
      } else {
        // 队列为空，但状态是 running，说明可能正在重新构建队列或准备进入下一阶段
        // 检查是否有失败任务需要重试
        const retryIds = await this._buildRetryQueue();
        const totalRetry = retryIds.Project.length + retryIds.Organization.length + retryIds.Person.length;
        
        // 检查是否所有 typemap ID 都已爬取过
        const unscrapedIds = await this._buildQueueFromDb();
        const totalUnscraped = unscrapedIds.Project.length + unscrapedIds.Organization.length + unscrapedIds.Person.length;
        
        if (totalUnscraped > 0) {
          // 还有未爬取的任务，但队列为空，可能是正在重新构建队列
          return 'crawling_new';
        } else if (totalRetry > 0) {
          // 没有未爬取的任务，但有失败任务需要重试
          return 'retrying_failures';
        } else {
          // 所有任务都已完成，可能是增量发现阶段
          return 'discovering_new_ids';
        }
      }
    } catch (error) {
      console.error("[TaskManager] 检测阶段失败:", error);
      return 'unknown';
    }
  }

  async getStatus() {
    const redis = await this._getRedis();
    const [status, error, maintenanceReportRaw, maintenanceStageRaw] = await Promise.all([
        redis.get(REDIS_KEYS.STATUS),
        redis.get(REDIS_KEYS.ERROR),
        redis.get(REDIS_KEYS.MAINTENANCE_REPORT),
        redis.get(REDIS_KEYS.MAINTENANCE_STAGE),
    ]);

    // 从数据库获取进度信息
    const progress = await this._getProgressFromDb();
    
    // 检测当前执行阶段
    const phase = await this._detectCurrentPhase();

    // 当前正在处理的任务（按 worker），从 Redis 中读取，兼容多进程
    const currentTasks = [];
    try {
      const raw = await redis.hGetAll(REDIS_KEYS.CURRENT_TASKS);
      if (raw && typeof raw === 'object') {
        for (const [workerId, json] of Object.entries(raw)) {
          try {
            const info = JSON.parse(json);
            currentTasks.push({
              workerId: Number(workerId),
              id: info.id,
              type: info.type,
              typeName: info.typeName,
              url: info.url,
              startedAt: info.startedAt,
            });
          } catch {
            // 忽略解析失败的记录
          }
        }
      }
    } catch (e) {
      console.error("[TaskManager] 读取当前任务信息失败:", e);
    }

    // 解析 maintenance 相关信息
    let maintenance = null;

    // 先解析 stage/report
    let parsedStage = null;
    if (maintenanceStageRaw) {
      try {
        parsedStage = JSON.parse(maintenanceStageRaw);
      } catch (e) {
        console.error("[TaskManager] 解析 maintenance stage 失败:", e);
      }
    }

    let parsedReport = null;
    if (maintenanceReportRaw) {
      try {
        parsedReport = JSON.parse(maintenanceReportRaw);
      } catch (e) {
        console.error("[TaskManager] 解析 maintenance report 失败:", e);
      }
    }



    if (status === "maintenance_running") {
      maintenance = {
        running: true,
        stage: parsedStage,
        lastReport: null,
      };
    } else {
      maintenance = {
        running: false,
        stage: null,
        lastReport: parsedReport,
      };
    }

    return {
      status: status || 'uninitialized',
      progress: progress,
      error: error || null,
      phase: phase, // 当前执行阶段
      currentTasks, // 当前正在处理的任务列表
      maintenance, // maintenance 任务信息
    };
  }

  _buildUrl(id, type) {
    const encodedId = Buffer.from(String(id)).toString("base64");
    const k = encodeURIComponent(encodedId);

    const name = typemapManager.getNameById(id, type);
    // 如果没有 name（例如增量发现时），使用 ID 作为占位符 slug
    // name 不正确不影响跳转，因为 URL 中的 k 参数才是真正的路由依据
    const slug = name ? encodeURIComponent(name) : encodeURIComponent(String(id));

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
        // 队列暂时为空，等待一会再确认
        await new Promise((r) => setTimeout(r, 1000));

        const again = await this._getNextTask();
        if (!again) {
          // 队列确实为空，尝试重新构建队列
          console.log(`[TaskManager] worker ${workerId} 检测到队列为空，尝试重新构建队列...`);
          
          // 检查是否有未爬取的任务
          const unscrapedIds = await this._buildQueueFromDb();
          const totalUnscraped = unscrapedIds.Project.length + unscrapedIds.Organization.length + unscrapedIds.Person.length;
          
          if (totalUnscraped > 0) {
            // 有未爬取的任务，重新构建队列
            if (unscrapedIds.Project.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, unscrapedIds.Project);
            }
            if (unscrapedIds.Organization.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_ORG, unscrapedIds.Organization);
            }
            if (unscrapedIds.Person.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PERSON, unscrapedIds.Person);
            }
            console.log(`[TaskManager] 已重新构建队列，继续处理...`);
            continue; // 继续循环，尝试获取新任务
          }

          // 没有未爬取的任务，检查是否有失败任务需要重试
          const retryIds = await this._buildRetryQueue();
          const totalRetry = retryIds.Project.length + retryIds.Organization.length + retryIds.Person.length;
          
          if (totalRetry > 0) {
            // 有重试任务，构建重试队列
            if (retryIds.Project.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PROJECT, retryIds.Project);
            }
            if (retryIds.Organization.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_ORG, retryIds.Organization);
            }
            if (retryIds.Person.length > 0) {
              await redis.rPush(REDIS_KEYS.QUEUE_PERSON, retryIds.Person);
            }
            console.log(`[TaskManager] 已构建重试队列，继续处理...`);
            continue; // 继续循环，尝试获取新任务
          }

          // 既没有未爬取的任务，也没有重试任务，尝试增量发现
          console.log(`[TaskManager] 开始增量发现新 ID...`);
          const discoveryResult = await this._discoverNewIds(20);
          
          if (discoveryResult.discovered > 0) {
            // 增量发现成功爬取了新 ID 并已入库
            // 这些 ID 不需要加入队列，因为它们已经爬取完成了
            console.log(`[TaskManager] 增量发现完成，发现并爬取了 ${discoveryResult.discovered} 个新 ID`);
            // 重新检查是否有未爬取的任务（可能 typemap 已更新）
            continue; // 继续循环，重新检查队列
          } else {
            // 没有发现新 ID，所有任务完成
            await redis.set(REDIS_KEYS.STATUS, "finished");
            console.log(`[TaskManager] worker ${workerId} 检测到所有任务已完成，任务结束。`);
            break;
          }
        }

        // 抢到了任务就继续处理
        nextTask = again;
      }

      const { id, type } = nextTask;
      const url = this._buildUrl(id, type);

      try {
        const typeName = ({ 1: 'Project', 2: 'Organization', 3: 'Person' }[type]) || String(type);
        const taskInfo = {
          workerId,
          id,
          type,
          typeName,
          url,
          startedAt: new Date().toISOString(),
        };
        // 写入 Redis，供 /crawl/status 查询当前任务（支持多进程）
        await redis.hSet(REDIS_KEYS.CURRENT_TASKS, String(workerId), JSON.stringify(taskInfo));

        console.log(`[TaskManager] worker ${workerId} 正在爬取: [Type: ${type}, ID: ${id}] URL: ${url}`);
        const scrapeFn = { 1: scrapeProject, 2: scrapeOrganization, 3: scrapePerson }[type];
        const userDataDirSuffix = String(workerId + 1).padStart(3, "0");

        await Promise.race([
          scrapeFn(url, { updateDb: true, fetchOptions: { userDataDirSuffix } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), 2 * 60 * 1000))
        ]);
        console.log(`[TaskManager] worker ${workerId} 爬取成功: [ID: ${id}]`);

        // 进度信息现在从数据库 CrawlLog 表获取，不需要更新 Redis
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
      } finally {
        // 清理当前任务的 Redis 记录（任务完成后）
        await redis.hDel(REDIS_KEYS.CURRENT_TASKS, String(workerId));
      }

      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1200));
    }

    console.log(`[TaskManager] worker ${workerId} 运行循环结束。状态: ${await redis.get(REDIS_KEYS.STATUS)}`);
  }

  async _getNextTask() {
    const redis = await this._getRedis();
    const queues = [REDIS_KEYS.QUEUE_PROJECT, REDIS_KEYS.QUEUE_ORG, REDIS_KEYS.QUEUE_PERSON];
    
    // 依次从三个队列中取任务
    // 注意：队列中的 ID 已经在 _buildQueueFromDb() 中过滤过了（只包含未成功爬取的），
    // 所以这里不需要再查数据库，直接返回即可
    for (let i = 0; i < queues.length; i++) {
        const type = i + 1;
        const id = await redis.lPop(queues[i]);
        if (id) {
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
