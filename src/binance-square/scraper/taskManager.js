/**
 * 币安广场任务管理器
 * 封装爬虫业务逻辑，供调度器和API路由调用
 */

const apiClient = require("./api-client");
const postParser = require("./parsers/postParser");
const { getRedisClient } = require("../../lib/redisClient");

class BinanceSquareTaskManager {
  constructor(db) {
    this.db = db;
    this.isRunning = false; // 并发锁：同一时间只能有一个爬取任务
  }

  /**
   * 获取 Redis 进度 key
   */
  _getProgressKey(snapshotId) {
    return `binance_square:task:progress:post:${snapshotId}`;
  }

  /**
   * 写入/更新 Redis 实时进度
   */
  async _updateProgress(snapshotId, update) {
    try {
      const redis = await getRedisClient();
      const key = this._getProgressKey(snapshotId);
      const existing = await redis.get(key);
      const current = existing ? JSON.parse(existing) : {};
      const merged = { ...current, ...update, updatedAt: new Date().toISOString() };
      await redis.set(key, JSON.stringify(merged), "EX", 7200); // 2小时过期
      console.log(`[taskManager] 进度更新 key=${key} processed=${merged.processedUsers}/${merged.totalUsers} success=${merged.successUsers} failed=${merged.failedUsers} posts=${(merged.totalPostsAll||0)+(merged.totalPostsReply||0)}`);
    } catch (e) {
      console.warn("[taskManager] Redis进度更新失败:", e.message);
    }
  }

  /**
   * 生成镜像批次ID
   */
  _generateSnapshotId() {
    const now = new Date();
    return (
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0")
    );
  }

  /**
   * 计算镜像差异
   */
  _computeSnapshotDiff(current, prev) {
    if (!prev) return null;

    const diff = {};
    const fields = [
      { key: "title", type: "text" },
      { key: "content", type: "text" },
      { key: "contentText", type: "text" },
      { key: "likeCount", type: "number" },
      { key: "shareCount", type: "number" },
      { key: "commentCount", type: "number" },
      { key: "viewCount", type: "number" },
      { key: "isDeleted", type: "boolean" },
    ];

    for (const { key, type } of fields) {
      const oldVal = prev[key];
      const newVal = current[key];

      if (oldVal !== newVal) {
        diff[key] = { old: oldVal, new: newVal };
        if (type === "number") {
          diff[key].delta = (newVal || 0) - (oldVal || 0);
        }
      }
    }

    return Object.keys(diff).length > 0 ? diff : null;
  }

  /**
   * 执行帖子抓取任务
   * @returns {Promise<Object>} 抓取结果统计
   */
  async runPostCrawl() {
    if (this.isRunning) {
      throw new Error("已有爬取任务正在运行，请等待完成后再试");
    }
    this.isRunning = true;

    try {
      return await this._doRunPostCrawl();
    } finally {
      this.isRunning = false;
    }
  }

  async _doRunPostCrawl() {
    const startTime = Date.now();
    const snapshotId = this._generateSnapshotId();
    const snapshotTime = new Date();
    const { Op } = require("sequelize");

    // 获取目标用户
    const targetUsers = await this.db.BinanceSquareUser.findAll({
      where: { isTargetUser: true },
      attributes: ["username", "squareUid"],
    });

    if (targetUsers.length === 0) {
      throw new Error("没有目标用户，请先计算Top50");
    }

    console.log(`[taskManager] 开始抓取 ${targetUsers.length} 个目标用户的帖子`);

    let totalPostsAll = 0;
    let totalPostsReply = 0;
    let totalSnapshots = 0;
    let failedUsers = [];

    // 初始化 Redis 实时进度
    await this._updateProgress(snapshotId, {
      taskType: "post",
      snapshotId,
      totalUsers: targetUsers.length,
      processedUsers: 0,
      successUsers: 0,
      failedUsers: 0,
      errorRate: "0.00%",
      errors: [],
      totalPostsAll: 0,
      totalPostsReply: 0,
      totalSnapshots: 0,
      startedAt: new Date().toISOString(),
      status: "running",
    });

    for (let i = 0; i < targetUsers.length; i++) {
      const user = targetUsers[i];
      const processedCount = i + 1;

      if (!user.squareUid) {
        console.warn(`[taskManager] ${user.username} 缺少squareUid，跳过`);
        failedUsers.push({ username: user.username, error: "缺少squareUid", time: new Date().toISOString() });
        await this._updateProgress(snapshotId, {
          processedUsers: processedCount,
          failedUsers: failedUsers.length,
          errors: failedUsers,
          errorRate: ((failedUsers.length / targetUsers.length) * 100).toFixed(2) + "%",
        });
        continue;
      }

      try {
        // 抓取主帖和回复
        const [allResult, replyResult] = await Promise.all([
          apiClient.fetchUserPosts(user.squareUid, "ALL", 7),
          apiClient.fetchUserPosts(user.squareUid, "REPLY", 7),
        ]);

        const allPosts = postParser.parsePostContents(allResult.contents);
        const replyPosts = postParser.parsePostContents(replyResult.contents);

        totalPostsAll += allPosts.length;
        totalPostsReply += replyPosts.length;

        // 合并并写入
        const allParsed = allPosts.map((p) => ({ ...p, username: user.username }));
        const replyParsed = replyPosts.map((p) => ({ ...p, username: user.username }));
        const combined = [...allParsed, ...replyParsed];

        // upsert Posts
        for (const post of combined) {
          await this.db.BinanceSquarePost.upsert({
            ...post,
            lastSnapshotId: snapshotId,
          });
        }

        // 生成镜像
        for (const post of combined) {
          const prevSnapshot = await this.db.BinanceSquarePostSnapshot.findOne({
            where: { postId: post.postId },
            order: [["snapshotTime", "DESC"]],
          });

          const diff = this._computeSnapshotDiff(post, prevSnapshot);

          await this.db.BinanceSquarePostSnapshot.create({
            postId: post.postId,
            snapshotId,
            snapshotTime,
            ...post,
            diffFromPrev: diff,
          });

          totalSnapshots++;
        }

        // 更新lastCrawledAt
        await this.db.BinanceSquareUser.update(
          { lastCrawledAt: new Date() },
          { where: { username: user.username } }
        );
      } catch (error) {
        console.error(`[taskManager] ${user.username} 抓取失败:`, error.message);
        failedUsers.push({ username: user.username, error: error.message, time: new Date().toISOString() });
      }

      // 更新 Redis 实时进度（每个用户处理完后）
      const successCount = processedCount - failedUsers.length;
      await this._updateProgress(snapshotId, {
        processedUsers: processedCount,
        successUsers: successCount,
        failedUsers: failedUsers.length,
        errorRate: ((failedUsers.length / processedCount) * 100).toFixed(2) + "%",
        errors: failedUsers,
        totalPostsAll,
        totalPostsReply,
        totalSnapshots,
      });
    }

    const durationMs = Date.now() - startTime;
    const overallStatus = failedUsers.length > 0 ? "partial" : "success";

    // 记录CrawlLog（包含失败详情）
    await this.db.BinanceSquareCrawlLog.create({
      taskType: "post",
      status: overallStatus,
      filterType: "ALL",
      itemsCount: totalPostsAll + totalPostsReply,
      snapshotId,
      durationMs,
      failedDetails: failedUsers.length > 0 ? failedUsers : null,
    });

    // 最终进度更新
    await this._updateProgress(snapshotId, {
      processedUsers: targetUsers.length,
      successUsers: targetUsers.length - failedUsers.length,
      failedUsers: failedUsers.length,
      errorRate: ((failedUsers.length / targetUsers.length) * 100).toFixed(2) + "%",
      errors: failedUsers,
      totalPostsAll,
      totalPostsReply,
      totalSnapshots,
      durationMs,
      completedAt: new Date().toISOString(),
      status: overallStatus,
    });

    return {
      snapshotId,
      targetUsers: targetUsers.length,
      totalPostsAll,
      totalPostsReply,
      totalSnapshots,
      failedUsers: failedUsers.length,
      failedDetails: failedUsers,
      durationMs,
      status: overallStatus,
    };
  }

  /**
   * 执行数据清理任务
   * @param {number} retentionDays - 保留天数
   */
  async cleanupOldSnapshots(retentionDays = 3) {
    const { Op } = require("sequelize");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[taskManager] 清理${retentionDays}天前的数据`);

    const deletedSnapshots = await this.db.BinanceSquarePostSnapshot.destroy({
      where: { snapshotTime: { [Op.lt]: cutoffDate } },
    });

    const deletedLogs = await this.db.BinanceSquareCrawlLog.destroy({
      where: { createdAt: { [Op.lt]: cutoffDate } },
    });

    return { deletedSnapshots, deletedLogs };
  }
}

module.exports = { BinanceSquareTaskManager };
