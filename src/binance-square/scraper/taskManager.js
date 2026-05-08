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
    this.shouldStop = false; // 强制终止标志
  }

  /**
   * 强制终止当前爬取任务
   */
  async forceStop() {
    console.log("[taskManager] 收到强制终止指令");
    this.shouldStop = true;
    this.isRunning = false;

    // 清理 Redis 中所有进度 key
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys("binance_square:task:progress:post:*");
      if (keys.length > 0) {
        await redis.del(keys);
        console.log(`[taskManager] 已清理 ${keys.length} 个 Redis 进度 key`);
      }
    } catch (e) {
      console.warn("[taskManager] 清理 Redis 进度失败:", e.message);
    }
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
      // 检查强制终止标志
      if (this.shouldStop) {
        console.log("[taskManager] 强制终止，中断循环");
        throw new Error("任务被强制终止");
      }

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
        // 单个用户处理加5分钟超时，防止永久卡住
        await this._processUserWithTimeout(user, snapshotTime, snapshotId, 15 * 60 * 1000);

        totalPostsAll += user._tmpAllPosts || 0;
        totalPostsReply += user._tmpReplyPosts || 0;
        totalSnapshots += user._tmpSnapshots || 0;

        // 更新lastCrawledAt
        await this.db.BinanceSquareUser.update(
          { lastCrawledAt: new Date() },
          { where: this.db.sequelize.where(this.db.sequelize.fn("LOWER", this.db.sequelize.col("username")), user.username.toLowerCase()) }
        );
      } catch (error) {
        let detail = error.message;
        if (error.name === 'SequelizeValidationError' && error.errors) {
          detail = error.errors.map(e => `${e.path}=${e.value} (${e.message})`).join('; ');
          console.error(`[BS_CRAWL_FAIL] ${user.username} ValidationError:`, detail);
        } else if (error.name === 'SequelizeUniqueConstraintError' && error.errors) {
          detail = error.errors.map(e => `${e.path}=${e.value} (unique)`).join('; ');
          console.error(`[BS_CRAWL_FAIL] ${user.username} UniqueConstraintError:`, detail);
        } else {
          console.error(`[BS_CRAWL_FAIL] ${user.username} 抓取失败:`, error.message);
        }
        failedUsers.push({ username: user.username, error: detail, time: new Date().toISOString() });
      } finally {
        delete user._tmpAllPosts;
        delete user._tmpReplyPosts;
        delete user._tmpSnapshots;
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
   * 处理单个用户（带超时保护）
   */
  async _processUserWithTimeout(user, snapshotTime, snapshotId, timeoutMs) {
    const start = Date.now();
    console.log(`[taskManager] 开始处理用户 ${user.username} (${user.squareUid})`);

    const userPromise = this._processUser(user, snapshotTime, snapshotId);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`处理超时（>${timeoutMs / 1000}秒）`)), timeoutMs);
    });

    try {
      await Promise.race([userPromise, timeoutPromise]);
      console.log(`[taskManager] 完成用户 ${user.username}，耗时 ${Date.now() - start}ms，帖子=${user._tmpAllPosts + user._tmpReplyPosts}，镜像=${user._tmpSnapshots}`);
    } catch (error) {
      console.error(`[taskManager] 用户 ${user.username} 处理异常/超时，耗时 ${Date.now() - start}ms:`, error.message);
      throw error;
    }
  }

  /**
   * 处理单个用户的核心逻辑
   */
  async _processUser(user, snapshotTime, snapshotId) {
    // 1. 请求阶段
    const reqStart = Date.now();
    const [allResult, replyResult] = await Promise.all([
      apiClient.fetchUserPosts(user.squareUid, "ALL", 7),
      apiClient.fetchUserPosts(user.squareUid, "REPLY", 7),
    ]);
    console.log(`[taskManager] ${user.username} 请求完成，耗时 ${Date.now() - reqStart}ms`);

    // 2. 解析阶段
    const parseStart = Date.now();
    let allPosts = postParser.parsePostContents(allResult.contents);
    let replyPosts = postParser.parsePostContents(replyResult.contents);
    console.log(`[taskManager] ${user.username} 解析完成，耗时 ${Date.now() - parseStart}ms，ALL=${allPosts.length}，REPLY=${replyPosts.length}`);

    // 2.5 回复帖详情补全：币安API的REPLY接口不返回内容和计数，需要单独调详情接口
    const replyIds = replyPosts.map((p) => p.postId);
    if (replyIds.length > 0) {
      const detailStart = Date.now();
      console.log(`[taskManager] ${user.username} 开始补全 ${replyIds.length} 条回复帖详情...`);
      const detailMap = new Map();
      for (let i = 0; i < replyIds.length; i++) {
        const postId = replyIds[i];
        const detail = await apiClient.fetchPostDetail(postId);
        if (detail) {
          detailMap.set(String(postId), detail);
        }
        // 请求间隔：最后一个不需要等
        if (i < replyIds.length - 1) {
          await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 500)));
        }
      }
      // 用详情数据覆盖回复帖的字段
      replyPosts = replyPosts.map((p) => {
        const detail = detailMap.get(p.postId);
        if (!detail) return p;
        return {
          ...p,
          content: detail.body || p.content,
          contentText: detail.bodyTextOnly || postParser.extractBodyText(detail.body) || p.contentText,
          likeCount: detail.likeCount != null ? detail.likeCount : p.likeCount,
          commentCount: detail.commentCount != null ? detail.commentCount : p.commentCount,
          shareCount: detail.shareCount != null ? detail.shareCount : p.shareCount,
          viewCount: detail.viewCount != null ? detail.viewCount : p.viewCount,
          // 合并 rawData：保留原有数据，叠加详情数据
          rawData: { ...p.rawData, _detail: detail },
        };
      });
      console.log(`[taskManager] ${user.username} 详情补全完成，耗时 ${Date.now() - detailStart}ms，成功 ${detailMap.size}/${replyIds.length}`);
    }

    // 3. 写入阶段（批量操作，减少数据库往返）
    const writeStart = Date.now();
    const allParsed = allPosts.map((p) => ({ ...p, username: user.username }));
    const replyParsed = replyPosts.map((p) => ({ ...p, username: user.username }));
    // ALL 和 REPLY 中可能有重复帖子，用 Map 去重避免唯一索引冲突
    const postMap = new Map();
    [...allParsed, ...replyParsed].forEach((p) => {
      if (!postMap.has(p.postId)) {
        postMap.set(p.postId, p);
      }
    });
    const combined = Array.from(postMap.values());

    // 3.1 批量 upsert Posts（1次数据库操作替代 N 次）
    const postRecords = combined.map((p) => ({
      ...p,
      lastSnapshotId: snapshotId,
    }));
    await this.db.BinanceSquarePost.bulkCreate(postRecords, {
      updateOnDuplicate: [
        "title", "content", "contentText", "mediaUrls",
        "likeCount", "shareCount", "commentCount", "viewCount",
        "publishedAt", "sourceUrl", "postType", "rawData",
        "lastSnapshotId", "updatedAt",
      ],
    });

    // 3.2 批量查询所有帖子的最新镜像（1次数据库操作替代 N 次）
    const { Op } = require("sequelize");
    const postIds = combined.map((p) => p.postId);
    const allPrevSnapshots = await this.db.BinanceSquarePostSnapshot.findAll({
      where: { postId: { [Op.in]: postIds } },
      order: [["snapshotTime", "DESC"]],
    });
    const prevMap = new Map();
    for (const s of allPrevSnapshots) {
      if (!prevMap.has(s.postId)) {
        prevMap.set(s.postId, s);
      }
    }

    // 3.3 批量生成镜像（1次数据库操作替代 N 次）
    const snapshotRecords = combined.map((post) => ({
      postId: post.postId,
      snapshotId,
      snapshotTime,
      ...post,
      diffFromPrev: this._computeSnapshotDiff(post, prevMap.get(post.postId)),
    }));
    await this.db.BinanceSquarePostSnapshot.bulkCreate(snapshotRecords);

    const snapshots = snapshotRecords.length;
    console.log(`[taskManager] ${user.username} 写入完成，耗时 ${Date.now() - writeStart}ms，帖子=${combined.length}，镜像=${snapshots}`);

    // 暂存结果供外层累加
    user._tmpAllPosts = allPosts.length;
    user._tmpReplyPosts = replyPosts.length;
    user._tmpSnapshots = snapshots;
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
