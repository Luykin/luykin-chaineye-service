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

const HTTPS_PROXY_IDS = [
  // 2026-05-21 新服务器 curl 测试结果：以下 7446 端口代理连接超时，暂时禁用。
  // "http://user81794:8ipjmd@185.232.47.106:7446",
  // "http://user81794:8ipjmd@216.10.9.111:7446",
  // "http://user81794:8ipjmd@185.232.47.101:7446",
  // "http://user81794:8ipjmd@216.10.9.234:7446",
  // "http://user81794:8ipjmd@185.232.47.233:7446",
  // 2026-05-21 新服务器 curl 测试结果：以下 6324 端口代理 CONNECT 可用，当前默认使用。
  "http://user81794:8ipjmd@163.5.88.220:6324",
  "http://user81794:8ipjmd@108.165.167.7:6324",
  "http://user81794:8ipjmd@108.165.167.11:6324",
  "http://user81794:8ipjmd@45.135.251.198:6324",
  "http://user81794:8ipjmd@45.135.251.37:6324",
];

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

function getProxyUrlsFromEnv() {
  const raw = process.env.BINANCE_SQUARE_PROXY_URLS || "";
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getDefaultProxyUrls() {
  const envProxyUrls = getProxyUrlsFromEnv();
  return envProxyUrls.length > 0 ? envProxyUrls : HTTPS_PROXY_IDS;
}

function maskProxyUrl(proxyUrl) {
  if (!proxyUrl) return "direct";
  try {
    const url = new URL(proxyUrl);
    return `${url.protocol}//***:***@${url.hostname}:${url.port}`;
  } catch (_) {
    return "proxy";
  }
}

function splitContiguousRanges(items, lineCount) {
  const count = Math.max(1, Math.min(lineCount, items.length));
  const chunkSize = Math.ceil(items.length / count);
  const ranges = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, items.length);
    if (start >= end) break;
    ranges.push({
      lineIndex: i,
      start,
      end: end - 1,
      users: items.slice(start, end),
    });
  }
  return ranges;
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
      targetLimit = parseInt(process.env.BINANCE_SQUARE_TARGET_LIMIT || "1000", 10),
      targetStart = parseInt(process.env.BINANCE_SQUARE_TARGET_START || "0", 10),
      targetEnd = process.env.BINANCE_SQUARE_TARGET_END !== undefined
        ? parseInt(process.env.BINANCE_SQUARE_TARGET_END, 10)
        : null,
      batchWriteUsers = parseInt(process.env.BINANCE_SQUARE_BATCH_WRITE_USERS || "25", 10),
      batchWriteMaxPosts = parseInt(process.env.BINANCE_SQUARE_BATCH_WRITE_MAX_POSTS || "800", 10),
      progressEveryUsers = parseInt(process.env.BINANCE_SQUARE_PROGRESS_EVERY_USERS || "5", 10),
      proxyUrls = getDefaultProxyUrls(),
      proxyLineCount = parseInt(process.env.BINANCE_SQUARE_PROXY_LINE_COUNT || String(concurrency || 1), 10),
      useProxyShards = process.env.BINANCE_SQUARE_USE_PROXY_SHARDS !== "false",
    } = options;
    const mode = onlyFirstPage ? "增量" : "近7天";
    const startTime = Date.now();
    if (!snapshotId) snapshotId = this._generateSnapshotId();

    const parsedTargetLimit = Number(targetLimit);
    const parsedTargetStart = Number(targetStart);
    const hasExplicitTargetEnd = targetEnd !== null && targetEnd !== undefined && String(targetEnd).trim() !== "";
    const parsedTargetEnd = hasExplicitTargetEnd ? Number(targetEnd) : NaN;

    const safeTargetLimit = Number.isFinite(parsedTargetLimit) && parsedTargetLimit > 0 ? parsedTargetLimit : 1000;
    const safeTargetStart = Number.isFinite(parsedTargetStart) && parsedTargetStart >= 0 ? parsedTargetStart : 0;
    const safeTargetEnd = Number.isFinite(parsedTargetEnd) && parsedTargetEnd >= safeTargetStart ? parsedTargetEnd : null;
    const queryLimit = safeTargetEnd !== null ? safeTargetEnd + 1 : safeTargetStart + safeTargetLimit;

    // 获取最终Top1000目标用户；独立爬虫默认只取前1000，支持按下标切片分片。
    const allTargetUsers = await this.db.BinanceSquareUser.findAll({
      where: { isTargetUser: true },
      attributes: ["username", "squareUid", "targetRank"],
      order: [["targetRank", "ASC"], ["updatedAt", "ASC"]],
      limit: queryLimit,
    });

    const targetUsers = allTargetUsers.slice(
      safeTargetStart,
      safeTargetEnd !== null ? safeTargetEnd + 1 : safeTargetStart + safeTargetLimit
    );

    console.log("[taskManager] target range debug", {
      targetLimit,
      targetStart,
      targetEnd,
      safeTargetLimit,
      safeTargetStart,
      safeTargetEnd,
      queryLimit,
      dbMatchedUsers: allTargetUsers.length,
      selectedUsers: targetUsers.length,
      envTargetLimit: process.env.BINANCE_SQUARE_TARGET_LIMIT || null,
      envTargetStart: process.env.BINANCE_SQUARE_TARGET_START || null,
      envTargetEnd: process.env.BINANCE_SQUARE_TARGET_END || null,
    });

    if (targetUsers.length === 0) {
      throw new Error("没有目标用户，请先计算Top1000");
    }

    const normalizedProxyUrls = Array.isArray(proxyUrls)
      ? proxyUrls.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const safeBatchWriteUsers = Math.max(1, Number(batchWriteUsers || 25));
    const safeBatchWriteMaxPosts = Math.max(1, Number(batchWriteMaxPosts || 800));
    const safeProgressEveryUsers = Math.max(1, Number(progressEveryUsers || 5));

    console.log(
      `[taskManager] 开始${mode}抓取 ${targetUsers.length} 个finalTop1000目标用户的帖子，` +
      `range=${safeTargetStart}-${safeTargetStart + targetUsers.length - 1}, daysBack=${daysBack}, ` +
      `filterTypes=${filterTypes.join(",")}, concurrency=${concurrency}, batchWriteUsers=${safeBatchWriteUsers}, proxies=${normalizedProxyUrls.length}`
    );

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
      targetStart: safeTargetStart,
      targetEnd: safeTargetStart + targetUsers.length - 1,
      batchWriteUsers: safeBatchWriteUsers,
      proxyLines: normalizedProxyUrls.length > 0 ? Math.min(Number(proxyLineCount || 1), normalizedProxyUrls.length) : 0,
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

    const redis = await getRedisClient();
    const checkForceStop = async () => {
      if (this.shouldStop) return true;
      const forceStop = await redis.get("binance_square:task:force_stop");
      if (forceStop === "true") {
        this.shouldStop = true;
        await redis.del("binance_square:task:force_stop");
        console.log("[taskManager] 收到 Redis 强制终止指令");
        return true;
      }
      return false;
    };

    const processOne = async (user, proxyUrl = null) => {
      if (!user.squareUid) {
        throw new Error("缺少squareUid");
      }

      const timeoutMs = onlyFirstPage ? 3 * 60 * 1000 : 20 * 60 * 1000;
      const result = await this._processUserWithTimeout(user, snapshotId, timeoutMs, {
        onlyFirstPage,
        daysBack,
        filterTypes,
        proxyUrl,
        deferWrite: true,
      });

      totalPostsAll += result.allPostsCount || 0;
      totalPostsReply += result.replyPostsCount || 0;

      return result;
    };

    const updateProgressIfNeeded = async (force = false) => {
      if (!force && processedUsers % safeProgressEveryUsers !== 0 && processedUsers < targetUsers.length) {
        return;
      }

      const successCount = processedUsers - failedUsers.length;
      await this._updateProgress(snapshotId, {
        processedUsers,
        successUsers: successCount,
        failedUsers: failedUsers.length,
        errorRate: processedUsers > 0 ? ((failedUsers.length / processedUsers) * 100).toFixed(2) + "%" : "0.00%",
        errors: failedUsers,
        totalPostsAll,
        totalPostsReply,
        totalUpsertedPosts,
        totalSnapshots: 0,
      });
    };

    const worker = async ({ lineIndex, users, start, end, proxyUrl = null }) => {
      const postBuffer = [];
      const crawledUsernames = [];
      let usersSinceFlush = 0;

      const flushBuffer = async (reason) => {
        if (postBuffer.length === 0 && crawledUsernames.length === 0) return;
        const posts = postBuffer.splice(0, postBuffer.length);
        const usernames = crawledUsernames.splice(0, crawledUsernames.length);
        usersSinceFlush = 0;

        const result = await this._flushPostBatch(posts, usernames, snapshotId);
        totalUpsertedPosts += result.upsertedPosts || 0;
        console.log(
          `[taskManager] line=${lineIndex + 1} 批量写入完成 reason=${reason} users=${usernames.length} posts=${posts.length} upsert=${result.upsertedPosts || 0}`
        );
      };

      console.log(
        `[taskManager] line=${lineIndex + 1} 启动，负责全局下标 ${safeTargetStart + start}-${safeTargetStart + end}，` +
        `用户数=${users.length}，proxy=${maskProxyUrl(proxyUrl)}`
      );

      for (const user of users) {
        if (await checkForceStop()) {
          console.log("[taskManager] 强制终止，中断worker循环");
          break;
        }

        try {
          const result = await processOne(user, proxyUrl);
          postBuffer.push(...(result.postRecords || []));
          crawledUsernames.push(user.username);
          usersSinceFlush++;

          if (usersSinceFlush >= safeBatchWriteUsers || postBuffer.length >= safeBatchWriteMaxPosts) {
            await flushBuffer("threshold");
          }
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
          failedUsers.push({ username: user.username, error: detail, time: new Date().toISOString(), line: lineIndex + 1 });
        } finally {
          delete user._tmpAllPosts;
          delete user._tmpReplyPosts;
          delete user._tmpUpsertedPosts;
          processedUsers++;
          await updateProgressIfNeeded(false);
        }
      }

      await flushBuffer("final");
      await updateProgressIfNeeded(true);
    };

    if (useProxyShards && normalizedProxyUrls.length > 0) {
      const lineCount = Math.max(
        1,
        Math.min(Number(proxyLineCount || concurrency || 1), Number(concurrency || proxyLineCount || 1), normalizedProxyUrls.length, targetUsers.length)
      );
      const ranges = splitContiguousRanges(targetUsers, lineCount).map((range, idx) => ({
        ...range,
        proxyUrl: normalizedProxyUrls[idx % normalizedProxyUrls.length],
      }));
      await Promise.all(ranges.map((range) => worker(range)));
    } else {
      const workerCount = Math.max(1, Math.min(Number(concurrency || 1), 10, targetUsers.length));
      const ranges = splitContiguousRanges(targetUsers, workerCount);
      await Promise.all(ranges.map((range) => worker(range)));
    }

    // 抓取完成后，对finalTop1000近N天帖子批量重算分
    const scoringResult = await this.recalculatePostScores({
      daysBack,
      targetUsernames: targetUsers.map((u) => u.username),
      scoreVersion,
    });

    const durationMs = Date.now() - startTime;
    const overallStatus = this.shouldStop || failedUsers.length > 0 ? "partial" : "success";

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
          ? { mode: onlyFirstPage ? "incremental" : "rolling_7d", stopped: this.shouldStop, errors: failedUsers, scoring: scoringResult }
          : { mode: onlyFirstPage ? "incremental" : "rolling_7d", stopped: this.shouldStop, scoring: scoringResult },
      });
    } catch (logError) {
      console.error("[taskManager] CrawlLog 写入失败:", logError.message);
    }

    // 最终进度更新：标记为已完成
    await this._updateProgress(snapshotId, {
      processedUsers,
      successUsers: processedUsers - failedUsers.length,
      failedUsers: failedUsers.length,
      errorRate: processedUsers > 0 ? ((failedUsers.length / processedUsers) * 100).toFixed(2) + "%" : "0.00%",
      errors: failedUsers,
      totalPostsAll,
      totalPostsReply,
      totalUpsertedPosts,
      totalSnapshots: 0,
      scoredPosts: scoringResult.scoredPosts,
      durationMs,
      completedAt: new Date().toISOString(),
      status: this.shouldStop ? "stopped" : "completed",
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
      const result = await Promise.race([userPromise, timeoutPromise]);
      const allCount = result?.allPostsCount ?? user._tmpAllPosts ?? 0;
      const replyCount = result?.replyPostsCount ?? user._tmpReplyPosts ?? 0;
      const upsertCount = result?.upsertedPosts ?? user._tmpUpsertedPosts ?? 0;
      console.log(`[taskManager] 完成用户 ${user.username}，耗时 ${Date.now() - start}ms，ALL=${allCount}，REPLY=${replyCount}，upsert=${upsertCount}`);
      return result;
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
      proxyUrl = null,
      deferWrite = false,
    } = crawlOptions;

    // 1. 请求阶段
    const reqStart = Date.now();
    const normalizedFilterTypes = Array.from(new Set(filterTypes.map((f) => String(f).trim().toUpperCase()).filter(Boolean)));
    const results = await Promise.all(
      normalizedFilterTypes.map(async (filterType) => {
        const result = await apiClient.fetchUserPosts(user.squareUid, filterType, daysBack, onlyFirstPage, {
          proxyUrl,
        });
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

    if (deferWrite) {
      return {
        username: user.username,
        allPostsCount: allPosts.length,
        replyPostsCount: replyPosts.length,
        upsertedPosts: combined.length,
        postRecords,
      };
    }

    const writeResult = await this._flushPostBatch(postRecords, [user.username], snapshotId);
    console.log(`[taskManager] ${user.username} 写入完成，耗时 ${Date.now() - writeStart}ms，帖子=${combined.length}，不写镜像`);

    // 暂存结果供外层累加
    user._tmpAllPosts = allPosts.length;
    user._tmpReplyPosts = replyPosts.length;
    user._tmpUpsertedPosts = writeResult.upsertedPosts || combined.length;
    return {
      username: user.username,
      allPostsCount: allPosts.length,
      replyPostsCount: replyPosts.length,
      upsertedPosts: writeResult.upsertedPosts || combined.length,
      postRecords: [],
    };
  }

  async _flushPostBatch(postRecords = [], usernames = [], snapshotId = null) {
    const sequelize = this.db.sequelize;
    const uniquePostMap = new Map();

    for (const record of postRecords) {
      if (record?.postId && !uniquePostMap.has(record.postId)) {
        uniquePostMap.set(record.postId, record);
      }
    }

    const uniquePosts = Array.from(uniquePostMap.values());
    const uniqueLowerUsernames = Array.from(
      new Set((usernames || []).map((u) => String(u || "").trim().toLowerCase()).filter(Boolean))
    );

    if (uniquePosts.length > 0) {
      for (const chunk of chunkArray(uniquePosts, 500)) {
        await this.db.BinanceSquarePost.bulkCreate(chunk, {
          updateOnDuplicate: [
            "title", "content", "contentText", "mediaUrls",
            "likeCount", "shareCount", "commentCount", "viewCount",
            "publishedAt", "sourceUrl", "postType", "rawData",
            "lastSnapshotId", "updatedAt",
          ],
        });
      }
    }

    if (uniqueLowerUsernames.length > 0) {
      for (const chunk of chunkArray(uniqueLowerUsernames, 200)) {
        await sequelize.query(
          `
            UPDATE "BinanceSquareUsers"
            SET "lastCrawledAt" = NOW(), "updatedAt" = NOW()
            WHERE LOWER("username") IN (:usernames)
          `,
          { replacements: { usernames: chunk } }
        );
      }
    }

    return {
      upsertedPosts: uniquePosts.length,
      updatedUsers: uniqueLowerUsernames.length,
      snapshotId,
    };
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
