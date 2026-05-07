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

    // 帖子抓取（配置驱动，支持动态调控）
    await this._schedulePostCrawl();

    // 数据清理（固定每天凌晨4点）
    this.jobs.cleanup = schedule.scheduleJob("0 4 * * *", async () => {
      console.log("[scheduler] 执行定时清理任务");
      await this._runCleanup();
    });

    console.log("[scheduler] 调度器启动完成");
  }

  stop() {
    console.log("[scheduler] 停止调度器");
    this.isRunning = false;
    Object.values(this.jobs).forEach((job) => job?.cancel());
    this.jobs = {};
  }

  async _schedulePostCrawl() {
    if (!this.isRunning) return;

    try {
      // 从数据库读取配置（支持动态调控）
      const hours = await this.configService.getFloat("post_crawl_interval_hours", 2);
      const cron = this._hoursToCron(hours);

      console.log(`[scheduler] 帖子抓取间隔: ${hours}小时, cron: ${cron}`);

      this.jobs.postCrawl = schedule.scheduleJob(cron, async () => {
        if (!this.isRunning) return;

        console.log(`[scheduler] 触发帖子抓取任务`);
        try {
          await this.taskManager.runPostCrawl();
        } catch (error) {
          console.error("[scheduler] 帖子抓取失败:", error.message);
        }

        // 任务完成后重新调度（支持间隔动态变化）
        this.jobs.postCrawl?.cancel();
        await this._schedulePostCrawl();
      });
    } catch (error) {
      console.error("[scheduler] 调度帖子抓取失败:", error.message);
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
    if (hours === 0.5) return "*/30 * * * *";
    if (hours === 1) return "0 * * * *";
    return `0 */${Math.floor(hours)} * * *`;
  }

  // 获取当前状态
  async getStatus() {
    const nextPostCrawl = this.jobs.postCrawl?.nextInvocation();
    const nextCleanup = this.jobs.cleanup?.nextInvocation();

    return {
      isRunning: this.isRunning,
      nextPostCrawl: nextPostCrawl ? nextPostCrawl.toISOString() : null,
      nextCleanup: nextCleanup ? nextCleanup.toISOString() : null,
      postCrawlInterval: await this.configService.getFloat("post_crawl_interval_hours", 2),
      retentionDays: await this.configService.getInt("snapshot_retention_days", 3),
    };
  }
}

module.exports = { BinanceSquareScheduler, ConfigService };
