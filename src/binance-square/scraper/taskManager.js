/**
 * 币安广场任务管理器
 * 封装爬虫业务逻辑，供调度器和API路由调用
 */

const apiClient = require("./api-client");
const postParser = require("./parsers/postParser");
const { getRedisClient, scanKeys, deleteKeysInChunks } = require("../../lib/redisClient");

const POST_SCORE_VERSION = "bs_post_v1";
const POST_SCORE_WEIGHTS = {
  view: 0.35,
  share: 0.25,
  comment: 0.20,
  like: 0.10,
  freshness: 0.10,
};

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function safeNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function normLog(value, maxValue) {
  const max = safeNumber(maxValue);
  if (max <= 0) return 0;
  const score = Math.log1p(safeNumber(value)) / Math.log1p(max);
  return Number.isFinite(score) ? score : 0;
}

function normPow(value, maxValue, power = 0.7) {
  const max = safeNumber(maxValue);
  if (max <= 0) return 0;
  const score = Math.pow(safeNumber(value), power) / Math.pow(max, power);
  return Number.isFinite(score) ? score : 0;
}

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

    // 释放分布式锁（不管谁持有的，强制终止都要释放）
    try {
      const redis = await getRedisClient();
      await redis.del("binance_square:task:lock");
      console.log("[taskManager] 已释放 Redis 任务锁");
    } catch (e) {
      console.warn("[taskManager] 释放 Redis 锁失败:", e.message);
    }

    // 清理 Redis 中所有进度 key
    try {
      const redis = await getRedisClient();
      const keys = await scanKeys(redis, "binance_square:task:progress:post:*");
      if (keys.length > 0) {
        await deleteKeysInChunks(redis, keys);
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
      console.log(`[taskManager] 进度更新 key=${key} processed=${merged.processedUsers}/${merged.totalUsers} success=${merged.successUsers} failed=${merged.failedUsers} posts=${(merged.totalPostsAll || 0) + (merged.totalPostsReply || 0)} scored=${merged.scoredPosts || 0}`);
    } catch (e) {
      console.warn("[taskManager] Redis进度更新失败:", e.message);
    }
  }

  /**
   * 生成任务批次ID（历史上叫snapshotId；现在作为crawlRunId使用）
   */
  _generateSnapshotId() {
    const now = new Date();
    return (
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0") +
      "-" +
      String(now.getMilliseconds()).padStart(3, "0") +
      "-" +
      Math.random().toString(36).substring(2, 6)
    );
  }

  async _getLastCompletedPostCrawlLog() {
    const { Op } = require("sequelize");
    return this.db.BinanceSquareCrawlLog.findOne({
      where: {
        taskType: "post",
        status: { [Op.in]: ["success", "partial"] },
      },
      order: [["createdAt", "DESC"]],
    });
  }

  /**
   * 执行帖子抓取任务
   * @param {Object} options - 抓取选项
   * @param {boolean} options.onlyFirstPage - 是否只查第一页（兼容旧增量模式），默认false
   * @param {number} options.daysBack - 回溯天数，默认7
   * @param {number} options.concurrency - 用户并发，默认1
   * @param {string[]} options.filterTypes - 抓取类型，默认["ALL", "REPLY"]
   * @param {boolean} options.skipIfRunning - 已有任务运行时返回skipped而非抛错
   * @param {boolean} options.enforceCooldown - 是否检查完成后冷却
   * @param {number} options.cooldownMinutes - 冷却分钟数，默认30
   * @returns {Promise<Object>} 抓取结果统计
   */
  async runPostCrawl(options = {}) {
    const redis = await getRedisClient();
    const LOCK_KEY = "binance_square:task:lock";
    const LOCK_TTL = 6 * 60 * 60; // 6小时，允许Top1000慢慢抓；异常时可用force-stop释放

    const {
      skipIfRunning = false,
      enforceCooldown = false,
      cooldownMinutes = 30,
    } = options;

    // 分布式锁：防止多个实例并发执行
    const lockValue = this._generateSnapshotId();
    const lockResult = await redis.set(LOCK_KEY, lockValue, { NX: true, EX: LOCK_TTL });
    if (!lockResult) {
      const existing = await redis.get(LOCK_KEY);
      const message = `已有爬取任务正在运行（锁: ${existing}）`;
      if (skipIfRunning) {
        console.log(`[taskManager] ${message}，本次调度跳过`);
        return { status: "skipped", reason: "running", lock: existing };
      }
      throw new Error(`${message}，请等待完成后再试`);
    }

    let shouldReleaseLock = true;
    this.isRunning = true;
    this.shouldStop = false;

    try {
      if (enforceCooldown) {
        const lastLog = await this._getLastCompletedPostCrawlLog();
        const lastCompletedAt = lastLog ? new Date(lastLog.createdAt).getTime() : 0;
        const elapsedMs = Date.now() - lastCompletedAt;
        const cooldownMs = Math.max(0, Number(cooldownMinutes || 0)) * 60 * 1000;
        if (lastLog && elapsedMs < cooldownMs) {
          console.log(`[taskManager] 上次抓取完成于 ${lastLog.createdAt.toISOString()}，未满冷却 ${cooldownMinutes} 分钟，本次跳过`);
          return {
            status: "skipped",
            reason: "cooldown",
            lastCompletedAt: lastLog.createdAt,
            cooldownMinutes,
            remainingMs: cooldownMs - elapsedMs,
          };
        }
      }

      return await this._doRunPostCrawl(options, lockValue);
    } finally {
      this.isRunning = false;
      this.shouldStop = false;
      if (shouldReleaseLock) {
        // 安全释放锁：只有持有者才能释放
        const current = await redis.get(LOCK_KEY);
        if (current === lockValue) {
          await redis.del(LOCK_KEY);
        }
      }
    }
  }

  async _doRunPostCrawl(options = {}, snapshotId = null) {
    const {
      onlyFirstPage = false,
      daysBack = 7,
      concurrency = 1,
      filterTypes = ["ALL", "REPLY"],
      scoreVersion = POST_SCORE_VERSION,
    } = options;
    const mode = onlyFirstPage ? "增量" : "近7天";
    const startTime = Date.now();
    if (!snapshotId) snapshotId = this._generateSnapshotId();

    // 获取最终Top1000目标用户
    const targetUsers = await this.db.BinanceSquareUser.findAll({
      where: { isTargetUser: true },
      attributes: ["username", "squareUid", "targetRank"],
      order: [["targetRank", "ASC"], ["updatedAt", "ASC"]],
    });

    if (targetUsers.length === 0) {
      throw new Error("没有目标用户，请先计算Top1000");
    }

    console.log(`[taskManager] 开始${mode}抓取 ${targetUsers.length} 个finalTop1000目标用户的帖子，daysBack=${daysBack}, filterTypes=${filterTypes.join(",")}, concurrency=${concurrency}`);

    let totalPostsAll = 0;
    let totalPostsReply = 0;
    let totalUpsertedPosts = 0;
    const failedUsers = [];
    let processedUsers = 0;

    // 初始化 Redis 实时进度
    await this._updateProgress(snapshotId, {
      taskType: "post",
      snapshotId,
      onlyFirstPage,
      daysBack,
      filterTypes,
      totalUsers: targetUsers.length,
      processedUsers: 0,
      successUsers: 0,
      failedUsers: 0,
      errorRate: "0.00%",
      errors: [],
      totalPostsAll: 0,
      totalPostsReply: 0,
      totalUpsertedPosts: 0,
      totalSnapshots: 0,
      scoredPosts: 0,
      startedAt: new Date().toISOString(),
      status: "running",
    });

    const workerCount = Math.max(1, Math.min(Number(concurrency || 1), 10, targetUsers.length));
    let nextIndex = 0;

    const processOne = async (user) => {
      if (!user.squareUid) {
        throw new Error("缺少squareUid");
      }

      const timeoutMs = onlyFirstPage ? 3 * 60 * 1000 : 20 * 60 * 1000;
      await this._processUserWithTimeout(user, snapshotId, timeoutMs, {
        onlyFirstPage,
        daysBack,
        filterTypes,
      });

      totalPostsAll += user._tmpAllPosts || 0;
      totalPostsReply += user._tmpReplyPosts || 0;
      totalUpsertedPosts += user._tmpUpsertedPosts || 0;

      // 更新lastCrawledAt
      await this.db.BinanceSquareUser.update(
        { lastCrawledAt: new Date() },
        { where: this.db.sequelize.where(this.db.sequelize.fn("LOWER", this.db.sequelize.col("username")), user.username.toLowerCase()) }
      );
    };

    const worker = async () => {
      while (nextIndex < targetUsers.length) {
        if (this.shouldStop) {
          console.log("[taskManager] 强制终止，中断worker循环");
          throw new Error("任务被强制终止");
        }

        const currentIndex = nextIndex++;
        const user = targetUsers[currentIndex];

        try {
          await processOne(user);
        } catch (error) {
          let detail = error.message;
          if (error.name === "SequelizeValidationError" && error.errors) {
            detail = error.errors.map((e) => `${e.path}=${e.value} (${e.message})`).join("; ");
            console.error(`[BS_CRAWL_FAIL] ${user.username} ValidationError:`, detail);
          } else if (error.name === "SequelizeUniqueConstraintError" && error.errors) {
            detail = error.errors.map((e) => `${e.path}=${e.value} (unique)`).join("; ");
            console.error(`[BS_CRAWL_FAIL] ${user.username} UniqueConstraintError:`, detail);
          } else {
            console.error(`[BS_CRAWL_FAIL] ${user.username} 抓取失败:`, error.message);
          }
          failedUsers.push({ username: user.username, error: detail, time: new Date().toISOString() });
        } finally {
          delete user._tmpAllPosts;
          delete user._tmpReplyPosts;
          delete user._tmpUpsertedPosts;
          processedUsers++;

          const successCount = processedUsers - failedUsers.length;
          await this._updateProgress(snapshotId, {
            processedUsers,
            successUsers: successCount,
            failedUsers: failedUsers.length,
            errorRate: ((failedUsers.length / processedUsers) * 100).toFixed(2) + "%",
            errors: failedUsers,
            totalPostsAll,
            totalPostsReply,
            totalUpsertedPosts,
            totalSnapshots: 0,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // 抓取完成后，对finalTop1000近N天帖子批量重算分
    const scoringResult = await this.recalculatePostScores({
      daysBack,
      targetUsernames: targetUsers.map((u) => u.username),
      scoreVersion,
    });

    const durationMs = Date.now() - startTime;
    const overallStatus = failedUsers.length > 0 ? "partial" : "success";

    // 记录CrawlLog（包含失败详情）
    try {
      await this.db.BinanceSquareCrawlLog.create({
        taskType: "post",
        status: overallStatus,
        filterType: "ALL",
        itemsCount: totalPostsAll + totalPostsReply,
        snapshotId,
        durationMs,
        failedDetails: failedUsers.length > 0
          ? { mode: onlyFirstPage ? "incremental" : "rolling_7d", errors: failedUsers, scoring: scoringResult }
          : { mode: onlyFirstPage ? "incremental" : "rolling_7d", scoring: scoringResult },
      });
    } catch (logError) {
      console.error("[taskManager] CrawlLog 写入失败:", logError.message);
    }

    // 最终进度更新：标记为已完成
    await this._updateProgress(snapshotId, {
      processedUsers: targetUsers.length,
      successUsers: targetUsers.length - failedUsers.length,
      failedUsers: failedUsers.length,
      errorRate: ((failedUsers.length / targetUsers.length) * 100).toFixed(2) + "%",
      errors: failedUsers,
      totalPostsAll,
      totalPostsReply,
      totalUpsertedPosts,
      totalSnapshots: 0,
      scoredPosts: scoringResult.scoredPosts,
      durationMs,
      completedAt: new Date().toISOString(),
      status: "completed",
      mode: onlyFirstPage ? "incremental" : "rolling_7d",
    });

    return {
      snapshotId,
      targetUsers: targetUsers.length,
      totalPostsAll,
      totalPostsReply,
      totalUpsertedPosts,
      totalSnapshots: 0,
      scoredPosts: scoringResult.scoredPosts,
      failedUsers: failedUsers.length,
      failedDetails: failedUsers,
      durationMs,
      status: overallStatus,
      mode: onlyFirstPage ? "incremental" : "rolling_7d",
      scoring: scoringResult,
    };
  }

  /**
   * 处理单个用户（带超时保护）
   */
  async _processUserWithTimeout(user, snapshotId, timeoutMs, crawlOptions = {}) {
    const start = Date.now();
    const mode = crawlOptions.onlyFirstPage ? "增量" : "近7天";
    console.log(`[taskManager] [${mode}] 开始处理用户 ${user.username} (${user.squareUid})`);

    const userPromise = this._processUser(user, snapshotId, crawlOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`处理超时（>${timeoutMs / 1000}秒）`)), timeoutMs);
    });

    try {
      await Promise.race([userPromise, timeoutPromise]);
      console.log(`[taskManager] 完成用户 ${user.username}，耗时 ${Date.now() - start}ms，ALL=${user._tmpAllPosts || 0}，REPLY=${user._tmpReplyPosts || 0}，upsert=${user._tmpUpsertedPosts || 0}`);
    } catch (error) {
      console.error(`[taskManager] 用户 ${user.username} 处理异常/超时，耗时 ${Date.now() - start}ms:`, error.message);
      throw error;
    }
  }

  /**
   * 处理单个用户的核心逻辑
   */
  async _processUser(user, snapshotId, crawlOptions = {}) {
    const {
      onlyFirstPage = false,
      daysBack = 7,
      filterTypes = ["ALL", "REPLY"],
    } = crawlOptions;

    // 1. 请求阶段
    const reqStart = Date.now();
    const normalizedFilterTypes = Array.from(new Set(filterTypes.map((f) => String(f).trim().toUpperCase()).filter(Boolean)));
    const results = await Promise.all(
      normalizedFilterTypes.map(async (filterType) => {
        const result = await apiClient.fetchUserPosts(user.squareUid, filterType, daysBack, onlyFirstPage);
        return { filterType, result };
      })
    );
    console.log(`[taskManager] ${user.username} 请求完成，耗时 ${Date.now() - reqStart}ms`);

    // 2. 解析阶段
    const parseStart = Date.now();
    const parsedByType = new Map();
    for (const { filterType, result } of results) {
      parsedByType.set(filterType, postParser.parsePostContents(result.contents));
    }
    const allPosts = parsedByType.get("ALL") || [];
    const replyPosts = parsedByType.get("REPLY") || [];
    console.log(`[taskManager] ${user.username} 解析完成，耗时 ${Date.now() - parseStart}ms，ALL=${allPosts.length}，REPLY=${replyPosts.length}`);

    // 3. 写入阶段（只写帖子主表最新状态，不再写完整镜像）
    const writeStart = Date.now();
    const allParsed = allPosts.map((p) => ({ ...p, username: user.username }));
    const replyParsed = replyPosts.map((p) => ({ ...p, username: user.username }));
    const otherParsed = Array.from(parsedByType.entries())
      .filter(([filterType]) => !["ALL", "REPLY"].includes(filterType))
      .flatMap(([, posts]) => posts.map((p) => ({ ...p, username: user.username })));

    // ALL 和 REPLY 中可能有重复帖子，用 Map 去重避免唯一索引冲突
    const postMap = new Map();
    [...allParsed, ...replyParsed, ...otherParsed].forEach((p) => {
      if (!postMap.has(p.postId)) {
        postMap.set(p.postId, p);
      }
    });
    const combined = Array.from(postMap.values());

    const postRecords = combined.map((p) => ({
      ...p,
      lastSnapshotId: snapshotId, // 兼容旧字段：现在记录最近抓取批次ID
    }));

    if (postRecords.length > 0) {
      await this.db.BinanceSquarePost.bulkCreate(postRecords, {
        updateOnDuplicate: [
          "title", "content", "contentText", "mediaUrls",
          "likeCount", "shareCount", "commentCount", "viewCount",
          "publishedAt", "sourceUrl", "postType", "rawData",
          "lastSnapshotId", "updatedAt",
        ],
      });
    }

    console.log(`[taskManager] ${user.username} 写入完成，耗时 ${Date.now() - writeStart}ms，帖子=${combined.length}，不写镜像`);

    // 暂存结果供外层累加
    user._tmpAllPosts = allPosts.length;
    user._tmpReplyPosts = replyPosts.length;
    user._tmpUpsertedPosts = combined.length;
  }

  async recalculatePostScores(options = {}) {
    const { Op } = require("sequelize");
    const {
      daysBack = 7,
      targetUsernames = null,
      scoreVersion = POST_SCORE_VERSION,
    } = options;

    const cutoffDate = new Date(Date.now() - Number(daysBack || 7) * 24 * 60 * 60 * 1000);
    const where = {
      isDeleted: false,
      publishedAt: { [Op.gte]: cutoffDate },
    };
    if (Array.isArray(targetUsernames) && targetUsernames.length > 0) {
      where.username = { [Op.in]: targetUsernames };
    }

    const posts = await this.db.BinanceSquarePost.findAll({
      where,
      attributes: [
        "postId",
        "username",
        "likeCount",
        "shareCount",
        "commentCount",
        "viewCount",
        "publishedAt",
      ],
      raw: true,
    });

    if (posts.length === 0) {
      return { scoredPosts: 0, daysBack, scoreVersion };
    }

    const max = {
      viewCount: Math.max(...posts.map((p) => safeNumber(p.viewCount))),
      shareCount: Math.max(...posts.map((p) => safeNumber(p.shareCount))),
      commentCount: Math.max(...posts.map((p) => safeNumber(p.commentCount))),
      likeCount: Math.max(...posts.map((p) => safeNumber(p.likeCount))),
    };
    const now = new Date();
    const scoredAt = now;

    const scored = posts.map((post) => {
      const viewCount = safeNumber(post.viewCount);
      const shareCount = safeNumber(post.shareCount);
      const commentCount = safeNumber(post.commentCount);
      const likeCount = safeNumber(post.likeCount);
      const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null;
      const ageHours = publishedAt && !Number.isNaN(publishedAt.getTime())
        ? Math.max(0, (now.getTime() - publishedAt.getTime()) / 3600000)
        : null;

      const viewScore = round(normPow(viewCount, max.viewCount, 0.7));
      const shareScore = round(normLog(shareCount, max.shareCount));
      const commentScore = round(normLog(commentCount, max.commentCount));
      const likeScore = round(normLog(likeCount, max.likeCount));
      const freshnessScore = ageHours === null ? 0 : round(Math.exp(-ageHours / 72));
      const score = round(
        POST_SCORE_WEIGHTS.view * viewScore +
        POST_SCORE_WEIGHTS.share * shareScore +
        POST_SCORE_WEIGHTS.comment * commentScore +
        POST_SCORE_WEIGHTS.like * likeScore +
        POST_SCORE_WEIGHTS.freshness * freshnessScore
      );

      return {
        postId: post.postId,
        score,
        viewScore,
        shareScore,
        commentScore,
        likeScore,
        freshnessScore,
        scoreVersion,
        lastScoredAt: scoredAt,
        scoreDetails: {
          version: scoreVersion,
          weights: POST_SCORE_WEIGHTS,
          raw: {
            viewCount,
            shareCount,
            commentCount,
            likeCount,
            ageHours: ageHours === null ? null : round(ageHours, 2),
          },
          normalized: {
            viewScore,
            shareScore,
            commentScore,
            likeScore,
            freshnessScore,
          },
          max,
          daysBack,
        },
      };
    });

    await this._bulkUpdatePostScores(scored);
    console.log(`[taskManager] 帖子评分完成: ${scored.length} 条，version=${scoreVersion}`);

    return {
      scoredPosts: scored.length,
      daysBack,
      scoreVersion,
      max,
      scoredAt,
    };
  }

  async _bulkUpdatePostScores(scoredRows) {
    if (!scoredRows.length) return;
    const sequelize = this.db.sequelize;

    for (const chunk of chunkArray(scoredRows, 500)) {
      const values = chunk.map((row) => {
        return `(${[
          sequelize.escape(row.postId),
          row.score,
          row.viewScore,
          row.shareScore,
          row.commentScore,
          row.likeScore,
          row.freshnessScore,
          sequelize.escape(JSON.stringify(row.scoreDetails)),
          sequelize.escape(row.scoreVersion),
          sequelize.escape(row.lastScoredAt),
        ].join(",")})`;
      }).join(",\n");

      await sequelize.query(`
        UPDATE "BinanceSquarePosts" AS p
        SET
          "score" = v."score",
          "viewScore" = v."viewScore",
          "shareScore" = v."shareScore",
          "commentScore" = v."commentScore",
          "likeScore" = v."likeScore",
          "freshnessScore" = v."freshnessScore",
          "scoreDetails" = v."scoreDetails"::jsonb,
          "scoreVersion" = v."scoreVersion",
          "lastScoredAt" = v."lastScoredAt"::timestamptz,
          "updatedAt" = NOW()
        FROM (VALUES
          ${values}
        ) AS v(
          "postId",
          "score",
          "viewScore",
          "shareScore",
          "commentScore",
          "likeScore",
          "freshnessScore",
          "scoreDetails",
          "scoreVersion",
          "lastScoredAt"
        )
        WHERE p."postId" = v."postId";
      `);
    }
  }

  /**
   * 执行数据清理任务
   * @param {number} retentionDays - 保留天数
   */
  async cleanupOldSnapshots(retentionDays = 3) {
    const { Op } = require("sequelize");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[taskManager] 清理${retentionDays}天前的历史镜像/日志`);

    // 镜像表已不再写入；这里保留清理逻辑用于历史数据回收。
    const deletedSnapshots = await this.db.BinanceSquarePostSnapshot.destroy({
      where: { snapshotTime: { [Op.lt]: cutoffDate } },
    });

    const deletedLogs = await this.db.BinanceSquareCrawlLog.destroy({
      where: { createdAt: { [Op.lt]: cutoffDate } },
    });

    return { deletedSnapshots, deletedLogs };
  }
}

module.exports = { BinanceSquareTaskManager, POST_SCORE_VERSION, POST_SCORE_WEIGHTS };
