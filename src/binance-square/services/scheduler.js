const schedule = require("node-schedule");

/**
 * 配置读取服务
 */
class ConfigService {
  constructor(db) {
    this.db = db;
    this.cache = {};
  }

  async get(key, defaultValue = null) {
    // 优先读缓存
    if (this.cache[key] !== undefined) {
      return this.cache[key];
    }

    const config = await this.db.BinanceSquareConfig.findOne({
      where: { configKey: key },
    });

    const value = config ? config.configValue : defaultValue;
    this.cache[key] = value;
    return value;
  }

  async getFloat(key, defaultValue = 0) {
    const value = await this.get(key, String(defaultValue));
    return parseFloat(value);
  }

  async getInt(key, defaultValue = 0) {
    const value = await this.get(key, String(defaultValue));
    return parseInt(value, 10);
  }

  // 清除缓存（配置更新时调用）
  clearCache(key) {
    if (key) {
      delete this.cache[key];
    } else {
      this.cache = {};
    }
  }
}

/**
 * 币安广场定时调度器
 */
class BinanceSquareScheduler {
  constructor(db, taskManager) {
    this.db = db;
    this.taskManager = taskManager;
    this.configService = new ConfigService(db);
    this.jobs = {};
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      console.log("[scheduler] 调度器已在运行");
      return;
    }

    console.log("[scheduler] 启动币安广场定时调度器");
    this.isRunning = true;

    // 增量抓取：每2小时一次，只查最新一页
    await this._checkAndRunImmediatePostCrawl();
    await this._scheduleIncrementalCrawl();

    // 全量抓取：每天凌晨3点一次，翻页查7天
    this.jobs.fullCrawl = schedule.scheduleJob("0 3 * * *", async () => {
      if (!this.isRunning) return;
      console.log("[scheduler] 触发全量帖子抓取任务（翻页7天）");
      try {
        await this.taskManager.runPostCrawl({ onlyFirstPage: false });
      } catch (error) {
        console.error("[scheduler] 全量抓取失败:", error.message);
      }
    });

    // 数据清理（固定每天凌晨4点）
    this.jobs.cleanup = schedule.scheduleJob("0 4 * * *", async () => {
      console.log("[scheduler] 执行定时清理任务");
      await this._runCleanup();
    });

    console.log("[scheduler] 调度器启动完成");
  }

  /**
   * 检查是否需要立即执行帖子抓取（重启补偿）
   */
  async _checkAndRunImmediatePostCrawl() {
    try {
      const hours = await this.configService.getFloat("post_crawl_interval_hours", 2);
      const intervalMs = hours * 60 * 60 * 1000;

      // 只检查帖子抓取日志（taskType=post），不区分增量/全量
      const lastLog = await this.db.BinanceSquareCrawlLog.findOne({
        where: { taskType: "post" },
        order: [["createdAt", "DESC"]],
      });

      const now = Date.now();
      const lastTime = lastLog ? new Date(lastLog.createdAt).getTime() : 0;
      const elapsed = now - lastTime;

      console.log(`[scheduler] 上次增量抓取: ${lastLog ? lastLog.createdAt.toISOString() : '无'}，已过去 ${(elapsed / 3600000).toFixed(2)} 小时，间隔 ${hours} 小时`);

      if (!lastLog || elapsed >= intervalMs) {
        console.log(`[scheduler] 距离上次增量抓取已超过 ${hours} 小时，立即执行一次补偿增量抓取`);
        try {
          await this.taskManager.runPostCrawl({ onlyFirstPage: true });
        } catch (error) {
          console.error("[scheduler] 补偿增量抓取失败:", error.message);
        }
      } else {
        console.log(`[scheduler] 距离上次增量抓取未满 ${hours} 小时，跳过补偿`);
      }
    } catch (error) {
      console.error("[scheduler] 检查补偿增量抓取失败:", error.message);
    }
  }

  stop() {
    console.log("[scheduler] 停止调度器");
    this.isRunning = false;
    Object.values(this.jobs).forEach((job) => {
      if (job && typeof job.cancel === 'function') {
        job.cancel();
      }
    });
    this.jobs = {};
  }

  async _scheduleIncrementalCrawl() {
    if (!this.isRunning) return;

    try {
      // 从数据库读取配置（支持动态调控）
      const hours = await this.configService.getFloat("post_crawl_interval_hours", 2);
      const cron = this._hoursToCron(hours);

      console.log(`[scheduler] 增量抓取间隔: ${hours}小时, cron: ${cron}`);

      // 如果已有 Job，先取消（防止重复调度）
      if (this.jobs.incrementalCrawl) {
        this.jobs.incrementalCrawl.cancel();
        this.jobs.incrementalCrawl = null;
      }

      this.jobs.incrementalCrawl = schedule.scheduleJob(cron, async () => {
        if (!this.isRunning) return;

        console.log(`[scheduler] 触发增量帖子抓取任务（只查最新一页）`);
        try {
          await this.taskManager.runPostCrawl({ onlyFirstPage: true });
        } catch (error) {
          console.error("[scheduler] 增量抓取失败:", error.message);
        }

        // 任务完成后重新调度（支持间隔动态变化）
        await this._scheduleIncrementalCrawl();
      });

      const next = this.jobs.incrementalCrawl?.nextInvocation();
      console.log(`[scheduler] 下次增量抓取时间: ${next ? next.toISOString() : '未设置'}`);
    } catch (error) {
      console.error("[scheduler] 调度增量抓取失败:", error.message);
      // 5秒后重试，防止一次性失败导致永久丢失
      setTimeout(() => this._scheduleIncrementalCrawl(), 5000);
    }
  }

  async _runCleanup() {
    try {
      const days = await this.configService.getInt("snapshot_retention_days", 3);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      console.log(`[scheduler] 清理${days}天前的镜像数据（截止: ${cutoffDate.toISOString()}）`);

      // 删除过期镜像
      const deletedSnapshots = await this.db.BinanceSquarePostSnapshot.destroy({
        where: {
          snapshotTime: { [this.db.Sequelize?.Op?.lt || require("sequelize").Op.lt]: cutoffDate },
        },
      });

      // 删除过期日志
      const deletedLogs = await this.db.BinanceSquareCrawlLog.destroy({
        where: {
          createdAt: { [this.db.Sequelize?.Op?.lt || require("sequelize").Op.lt]: cutoffDate },
        },
      });

      console.log(`[scheduler] 清理完成: 镜像${deletedSnapshots}条, 日志${deletedLogs}条`);
    } catch (error) {
      console.error("[scheduler] 清理失败:", error.message);
    }
  }

  _hoursToCron(hours) {
    // 支持 0.5→*/30, 1→0, 2→0 */2, 4→0 */4
    // 防御 NaN 或非法值
    if (!hours || isNaN(hours) || hours <= 0) {
      console.warn(`[scheduler] 无效间隔 ${hours}，使用默认2小时`);
      hours = 2;
    }
    if (hours === 0.5) return "*/30 * * * *";
    if (hours === 1) return "0 * * * *";
    return `0 */${Math.floor(hours)} * * *`;
  }

  // 获取当前状态
  async getStatus() {
    const nextIncremental = this.jobs.incrementalCrawl?.nextInvocation();
    const nextFull = this.jobs.fullCrawl?.nextInvocation();
    const nextCleanup = this.jobs.cleanup?.nextInvocation();

    return {
      isRunning: this.isRunning,
      nextIncrementalCrawl: nextIncremental ? nextIncremental.toISOString() : null,
      nextFullCrawl: nextFull ? nextFull.toISOString() : null,
      nextCleanup: nextCleanup ? nextCleanup.toISOString() : null,
      incrementalCrawlInterval: await this.configService.getFloat("post_crawl_interval_hours", 2),
      fullCrawlSchedule: "每天凌晨3点",
      retentionDays: await this.configService.getInt("snapshot_retention_days", 3),
    };
  }
}

module.exports = { BinanceSquareScheduler, ConfigService };
