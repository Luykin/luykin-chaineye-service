const express = require("express");
const { Op } = require("sequelize");

// 模型将在路由挂载时注入（通过initRoutes函数）
let db = null;
let taskManager = null;

function initRoutes(sequelize) {
  // 延迟加载模型（确保sequelize实例已就绪）
  const initModels = require("../models");
  db = initModels(sequelize);

  // 初始化任务管理器（供手动触发和调度器共用）
  const { BinanceSquareTaskManager } = require("../scraper/taskManager");
  taskManager = new BinanceSquareTaskManager(db);
}

const router = express.Router();

// ==================== 统一响应格式 ====================
function success(data) {
  return { success: true, data };
}

function fail(error) {
  return { success: false, error };
}

// ==================== 种子用户管理 ====================

/**
 * POST /seed/init
 * 初始化种子用户（批量导入）
 */
router.post("/seed/init", async (req, res) => {
  try {
    const { seeds } = req.body;
    if (!Array.isArray(seeds) || seeds.length === 0) {
      return res.status(400).json(fail("seeds必须是数组且不为空"));
    }

    const transaction = await db.BinanceSquareSeedConfig.sequelize.transaction();

    try {
      // 1. 写入种子配置（忽略重复）
      await db.BinanceSquareSeedConfig.bulkCreate(seeds, {
        updateOnDuplicate: ["displayName", "sortOrder", "isActive", "description", "updatedAt"],
        transaction,
      });

      // 2. 同步写入Users表（isSeedUser=true）
      const userRecords = seeds.map((s) => ({
        username: s.username,
        displayName: s.displayName || null,
        isSeedUser: true,
      }));

      await db.BinanceSquareUser.bulkCreate(userRecords, {
        updateOnDuplicate: [
          "displayName",
          // 注意：不更新 isSeedUser / isTargetUser / followScore，保护已有标记
        ],
        transaction,
      });

      await transaction.commit();

      res.json(success({
        total: seeds.length,
        imported: seeds.length,
      }));
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error("[seed/init] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /seed/list
 * 获取种子用户列表
 */
router.get("/seed/list", async (req, res) => {
  try {
    const seeds = await db.BinanceSquareSeedConfig.findAll({
      order: [["sortOrder", "ASC"], ["createdAt", "ASC"]],
    });

    // 关联查询 BinanceSquareUser 获取 totalFollowingCount / lastCrawledAt
    const seedUsernames = seeds.map((s) => s.username);
    const users = await db.BinanceSquareUser.findAll({
      where: { username: { [Op.in]: seedUsernames } },
      attributes: ["username", "totalFollowingCount", "lastCrawledAt"],
      raw: true,
    });
    const userMap = new Map(users.map((u) => [u.username, u]));

    const enriched = seeds.map((s) => {
      const user = userMap.get(s.username);
      return {
        ...s.toJSON(),
        totalFollowingCount: user?.totalFollowingCount ?? null,
        lastCrawledAt: user?.lastCrawledAt ?? null,
      };
    });

    res.json(success(enriched));
  } catch (error) {
    console.error("[seed/list] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /seed/add
 * 添加单个种子用户
 */
router.post("/seed/add", async (req, res) => {
  try {
    const { username, displayName, sortOrder, isActive, description } = req.body;

    if (!username) {
      return res.status(400).json(fail("username必填"));
    }

    const transaction = await db.BinanceSquareSeedConfig.sequelize.transaction();

    try {
      // 1. 写入配置
      const seed = await db.BinanceSquareSeedConfig.create(
        {
          username,
          displayName: displayName || null,
          sortOrder: sortOrder || 0,
          isActive: isActive !== undefined ? isActive : true,
          description: description || null,
        },
        { transaction }
      );

      // 2. 同步写入Users（或更新isSeedUser）
      await db.BinanceSquareUser.findOrCreate({
        where: { username },
        defaults: {
          username,
          displayName: displayName || null,
          isSeedUser: true,
        },
        transaction,
      });

      await transaction.commit();

      res.json(success(seed));
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error("[seed/add] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /seed/remove
 * 移除种子用户（软删除：标记isActive=false）
 */
router.post("/seed/remove", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json(fail("username必填"));
    }

    // 标记为inactive（不删除，保留历史记录）
    const [affectedCount] = await db.BinanceSquareSeedConfig.update(
      { isActive: false },
      { where: { username } }
    );

    if (affectedCount === 0) {
      return res.status(404).json(fail("种子用户不存在"));
    }

    res.json(success({ username, removed: true }));
  } catch (error) {
    console.error("[seed/remove] error:", error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== 关注列表同步 ====================

const apiClient = require("../scraper/api-client");

/**
 * 同步单个种子用户的关注列表
 * @param {string} targetUsername - 种子用户名
 * @returns {Promise<{username, total, fetched, newUsers, newRelations, status}>}
 */
async function syncSingleUserFollowing(targetUsername) {
  const startTime = Date.now();
  let status = "success";
  let errorMessage = null;
  let total = 0;
  let followers = [];

  try {
    // 1. 调用API获取关注列表
    const result = await apiClient.fetchFollowingList(targetUsername);
    total = result.total || 0;
    followers = result.followers || [];

    // 2. 对比数量，不一致标记为partial
    if (followers.length !== total) {
      status = "partial";
      console.warn(`[following/sync] ${targetUsername}: 抓取${followers.length}条, API返回total=${total}`);
    }

    // 3. 准备用户数据（upsert）
    const userRecords = followers.map((f) => ({
      username: f.username,
      displayName: f.displayName ?? null,
      squareUid: f.squareUid ?? null,
      avatar: f.avatar ?? null,
      biography: f.biography ?? null,
      role: f.role ?? null,
      verificationType: f.verificationType ?? null,
      verificationDescription: f.verificationDescription ?? null,
      totalFollowerCount: f.totalFollowerCount ?? null,
      totalFollowingCount: f.totalFollowCount ?? null,
      totalPostCount: f.totalPostCount ?? null,
      totalLikeCount: f.totalLikeCount ?? null,
      totalShareCount: f.totalShareCount ?? null,
      accountLang: f.accountLang ?? null,
      isKol: f.isKol ?? null,
      userStatus: f.userStatus ?? null,
      level: f.level ?? null,
      rawData: f,
      isSeedUser: false, // 被关注者默认不是种子用户
      isTargetUser: false,
    }));

    // 4. 准备关注关系数据
    const followingRecords = followers.map((f) => ({
      followerUsername: targetUsername,
      followingUsername: f.username,
      followingSquareUid: f.squareUid || null,
    }));

    // 5. 在写入前统计已存在的用户数量（否则事务提交后统计永远等于 followers.length）
    const existingUsernames = await db.BinanceSquareUser.findAll({
      where: { username: { [Op.in]: followers.map((f) => f.username) } },
      attributes: ["username"],
      raw: true,
    });
    const existingUsernameSet = new Set(existingUsernames.map((u) => u.username));
    const newUsersCount = followers.filter((f) => !existingUsernameSet.has(f.username)).length;

    // 6. 批量写入（事务）
    const transaction = await db.BinanceSquareUser.sequelize.transaction();

    try {
      // 写入/更新用户（不覆盖isSeedUser/isTargetUser/followScore）
      await db.BinanceSquareUser.bulkCreate(userRecords, {
        updateOnDuplicate: [
          "displayName",
          "squareUid",
          "avatar",
          "biography",
          "role",
          "verificationType",
          "verificationDescription",
          "totalFollowerCount",
          "totalPostCount",
          "totalLikeCount",
          "totalShareCount",
          "accountLang",
          "isKol",
          "userStatus",
          "level",
          "rawData",
          "updatedAt",
        ],
        transaction,
      });

      // 写入关注关系（忽略重复）
      await db.BinanceSquareFollowing.bulkCreate(followingRecords, {
        ignoreDuplicates: true,
        transaction,
      });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    // 7. 更新种子用户自身的统计信息（totalFollowingCount / lastCrawledAt）
    try {
      await db.BinanceSquareUser.update(
        {
          totalFollowingCount: total,
          lastCrawledAt: new Date(),
        },
        { where: { username: targetUsername } }
      );
    } catch (e) {
      console.warn(`[following/sync] ${targetUsername} 更新自身统计信息失败:`, e.message);
    }

    const durationMs = Date.now() - startTime;

    return {
      username: targetUsername,
      total,
      fetched: followers.length,
      newUsers: newUsersCount,
      newRelations: followingRecords.length,
      status,
      durationMs,
    };
  } catch (error) {
    console.error(`[following/sync] ${targetUsername} 失败:`, error.message);
    return {
      username: targetUsername,
      total: 0,
      fetched: 0,
      newUsers: 0,
      newRelations: 0,
      status: "failed",
      errorMessage: error.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * POST /following/sync
 * 同步所有活跃种子用户的关注列表
 */
router.post("/following/sync", async (req, res) => {
  try {
    // 1. 获取活跃种子用户
    const seeds = await db.BinanceSquareSeedConfig.findAll({
      where: { isActive: true },
      order: [["sortOrder", "ASC"]],
    });

    if (seeds.length === 0) {
      return res.status(400).json(fail("没有活跃的种子用户"));
    }

    console.log(`[following/sync] 开始同步 ${seeds.length} 个种子用户的关注列表`);

    // 2. 逐个同步（串行执行，避免被封）
    const results = [];
    let totalNewUsers = 0;
    let totalNewRelations = 0;
    let hasPartial = false;
    let hasFailed = false;

    for (const seed of seeds) {
      const result = await syncSingleUserFollowing(seed.username);
      results.push(result);
      totalNewUsers += result.newUsers;
      totalNewRelations += result.newRelations;
      if (result.status === "partial") hasPartial = true;
      if (result.status === "failed") hasFailed = true;

      // 请求间隔：500-1200ms（api-client内部已处理，这里不需要额外延迟）
    }

    // 3. 记录 CrawlLog
    const overallStatus = hasFailed ? "partial" : hasPartial ? "partial" : "success";
    await db.BinanceSquareCrawlLog.create({
      taskType: "following",
      status: overallStatus,
      itemsCount: totalNewRelations,
      durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    });

    res.json(success({
      totalSeeds: seeds.length,
      processed: results.length,
      newUsers: totalNewUsers,
      newRelations: totalNewRelations,
      details: results,
      status: overallStatus,
    }));
  } catch (error) {
    console.error("[following/sync] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /following/sync/:username
 * 同步单个种子用户的关注列表
 */
router.post("/following/sync/:username", async (req, res) => {
  try {
    const { username } = req.params;

    // 验证是活跃种子用户
    const seed = await db.BinanceSquareSeedConfig.findOne({
      where: { username, isActive: true },
    });

    if (!seed) {
      return res.status(404).json(fail("种子用户不存在或未激活"));
    }

    const result = await syncSingleUserFollowing(username);

    // 记录 CrawlLog
    await db.BinanceSquareCrawlLog.create({
      taskType: "following",
      status: result.status,
      targetId: username,
      itemsCount: result.newRelations,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage || null,
    });

    res.json(success(result));
  } catch (error) {
    console.error(`[following/sync/${req.params.username}] error:`, error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== Top50目标用户计算 ====================

/**
 * POST /target/calculate
 * 手动触发：计算Top50目标用户
 */
router.post("/target/calculate", async (req, res) => {
  const startTime = Date.now();

  try {
    // 1. 获取活跃种子用户名单
    const activeSeeds = await db.BinanceSquareSeedConfig.findAll({
      where: { isActive: true },
      attributes: ["username", "displayName"],
    });

    if (activeSeeds.length === 0) {
      return res.status(400).json(fail("没有活跃的种子用户"));
    }

    const seedUsernames = activeSeeds.map((s) => s.username);
    console.log(`[target/calculate] 活跃种子用户: ${seedUsernames.join(", ")}`);

    // 2. 聚合查询：被关注次数最多的前50人
    const topCandidates = await db.BinanceSquareFollowing.findAll({
      attributes: [
        "followingUsername",
        [db.BinanceSquareFollowing.sequelize.fn("COUNT", "*"), "followerCount"],
      ],
      where: {
        followerUsername: { [Op.in]: seedUsernames },
      },
      group: ["followingUsername"],
      order: [[db.BinanceSquareFollowing.sequelize.literal("\"followerCount\""), "DESC"]],
      limit: 50,
      raw: true,
    });

    console.log(`[target/calculate] 候选用户: ${topCandidates.length} 人`);

    // 3. 获取每个候选用户的种子关注者详情
    const enrichedCandidates = [];
    for (const candidate of topCandidates) {
      const seedFollowers = await db.BinanceSquareFollowing.findAll({
        attributes: ["followerUsername"],
        where: {
          followerUsername: { [Op.in]: seedUsernames },
          followingUsername: candidate.followingUsername,
        },
        raw: true,
      });

      // 获取种子关注者的displayName
      const seedFollowerNames = seedFollowers.map((f) => f.followerUsername);
      const seedConfigs = await db.BinanceSquareSeedConfig.findAll({
        where: { username: { [Op.in]: seedFollowerNames } },
        attributes: ["username", "displayName"],
        raw: true,
      });

      enrichedCandidates.push({
        username: candidate.followingUsername,
        followerCount: parseInt(candidate.followerCount, 10),
        seedFollowers: seedConfigs.map((s) => ({
          username: s.username,
          displayName: s.displayName,
        })),
      });
    }

    // 4. 事务：清空旧排名 + 写入新排名 + 更新Users表
    const now = new Date();
    const transaction = await db.BinanceSquareTargetRank.sequelize.transaction();

    try {
      // 4.1 清空旧排名（覆盖式更新）
      await db.BinanceSquareTargetRank.destroy({
        where: {},
        truncate: true,
        transaction,
      });

      // 4.2 重置所有用户的isTargetUser标记
      await db.BinanceSquareUser.update(
        { isTargetUser: false },
        { where: { isTargetUser: true }, transaction }
      );

      // 4.3 批量写入新排名
      const rankRecords = enrichedCandidates.map((c, index) => ({
        username: c.username,
        rank: index + 1,
        followerCount: c.followerCount,
        seedFollowers: c.seedFollowers,
        lastCalculatedAt: now,
      }));

      await db.BinanceSquareTargetRank.bulkCreate(rankRecords, { transaction });

      // 4.4 更新Top50用户的isTargetUser标记
      await db.BinanceSquareUser.update(
        { isTargetUser: true },
        { where: { username: { [Op.in]: enrichedCandidates.map((c) => c.username) } }, transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    // 5. 记录CrawlLog
    const durationMs = Date.now() - startTime;
    await db.BinanceSquareCrawlLog.create({
      taskType: "target_calculate",
      status: "success",
      itemsCount: enrichedCandidates.length,
      durationMs,
    });

    res.json(success({
      totalCandidates: enrichedCandidates.length,
      top50: enrichedCandidates.slice(0, 10).map((c) => ({
        rank: enrichedCandidates.indexOf(c) + 1,
        username: c.username,
        followerCount: c.followerCount,
        seedFollowers: c.seedFollowers.map((s) => s.username),
      })),
      updatedAt: now,
      durationMs,
    }));
  } catch (error) {
    console.error("[target/calculate] error:", error);

    // 记录失败日志
    await db.BinanceSquareCrawlLog.create({
      taskType: "target_calculate",
      status: "failed",
      errorMessage: error.message,
      durationMs: Date.now() - startTime,
    });

    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /target/list
 * 获取当前Top50目标用户列表
 */
router.get("/target/list", async (req, res) => {
  try {
    const ranks = await db.BinanceSquareTargetRank.findAll({
      order: [["rank", "ASC"]],
    });

    res.json(success(ranks));
  } catch (error) {
    console.error("[target/list] error:", error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== 帖子抓取与镜像管理 ====================

const postParser = require("../scraper/parsers/postParser");
const { BinanceSquareScheduler } = require("../services/scheduler");
const { BinanceSquareTaskManager } = require("../scraper/taskManager");

// 调度器实例（单例）
let scheduler = null;

function getScheduler() {
  if (!scheduler) {
    const taskManager = new BinanceSquareTaskManager(db);
    scheduler = new BinanceSquareScheduler(db, taskManager);
  }
  return scheduler;
}

/**
 * 生成镜像批次ID
 * @returns {string} YYYYMMDDHHmmss
 */
function generateSnapshotId() {
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
 * @param {Object} current - 当前镜像数据
 * @param {Object} prev - 上一个镜像数据
 * @returns {Object|null} diff对象或null
 */
function computeSnapshotDiff(current, prev) {
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
 * POST /crawl/posts
 * 手动触发：抓取目标用户的帖子（ALL + REPLY）
 */
router.post("/crawl/posts", async (req, res) => {
  try {
    if (!taskManager) {
      return res.status(500).json(fail("任务管理器未初始化"));
    }

    const result = await taskManager.runPostCrawl();

    res.json(success(result));
  } catch (error) {
    console.error("[crawl/posts] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /posts
 * 查询帖子列表
 */
router.get("/posts", async (req, res) => {
  try {
    const {
      username,
      postType,
      page = 1,
      pageSize = 20,
      startDate,
      endDate,
    } = req.query;

    const where = {};
    if (username) where.username = username;
    if (postType) where.postType = postType;
    if (startDate || endDate) {
      where.publishedAt = {};
      if (startDate) where.publishedAt[Op.gte] = new Date(startDate);
      if (endDate) where.publishedAt[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await db.BinanceSquarePost.findAndCountAll({
      where,
      order: [["publishedAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      data: rows,
    }));
  } catch (error) {
    console.error("[posts/list] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /crawl/progress
 * 查询当前/最近一次帖子抓取任务的实时进度
 */
router.get("/crawl/progress", async (req, res) => {
  try {
    const { getRedisClient } = require("../../lib/redisClient");
    const redis = await getRedisClient();

    // 扫描所有帖子抓取进度 key
    const keys = await redis.keys("binance_square:task:progress:post:*");

    if (keys.length === 0) {
      return res.json(success({ running: false, message: "当前没有正在执行或近期的抓取任务" }));
    }

    // 按 updatedAt 倒序，取最新的一条
    const progressList = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        progressList.push(parsed);
      }
    }

    progressList.sort((a, b) => new Date(b.updatedAt || b.startedAt) - new Date(a.updatedAt || a.startedAt));

    const latest = progressList[0];

    res.json(success({
      running: latest.status === "running",
      taskType: latest.taskType,
      snapshotId: latest.snapshotId,
      totalUsers: latest.totalUsers,
      processedUsers: latest.processedUsers,
      successUsers: latest.successUsers,
      failedUsers: latest.failedUsers,
      errorRate: latest.errorRate,
      errors: latest.errors || [],
      totalPostsAll: latest.totalPostsAll,
      totalPostsReply: latest.totalPostsReply,
      totalSnapshots: latest.totalSnapshots,
      startedAt: latest.startedAt,
      completedAt: latest.completedAt || null,
      durationMs: latest.durationMs || null,
      status: latest.status,
    }));
  } catch (error) {
    console.error("[crawl/progress] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /posts/:postId/snapshots
 * 查询某帖子的历史镜像
 */
router.get("/posts/:postId/snapshots", async (req, res) => {
  try {
    const { postId } = req.params;

    const snapshots = await db.BinanceSquarePostSnapshot.findAll({
      where: { postId },
      order: [["snapshotTime", "DESC"]],
    });

    res.json(success(snapshots));
  } catch (error) {
    console.error("[posts/snapshots] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /posts/snapshot-compare
 * 对比两个镜像批次
 */
router.get("/posts/snapshot-compare", async (req, res) => {
  try {
    const { postId, snapshotId1, snapshotId2 } = req.query;

    if (!postId || !snapshotId1 || !snapshotId2) {
      return res.status(400).json(fail("postId, snapshotId1, snapshotId2 必填"));
    }

    const [s1, s2] = await Promise.all([
      db.BinanceSquarePostSnapshot.findOne({
        where: { postId, snapshotId: snapshotId1 },
      }),
      db.BinanceSquarePostSnapshot.findOne({
        where: { postId, snapshotId: snapshotId2 },
      }),
    ]);

    if (!s1 || !s2) {
      return res.status(404).json(fail("镜像不存在"));
    }

    res.json(success({
      postId,
      snapshot1: {
        snapshotId: s1.snapshotId,
        snapshotTime: s1.snapshotTime,
        data: s1,
      },
      snapshot2: {
        snapshotId: s2.snapshotId,
        snapshotTime: s2.snapshotTime,
        data: s2,
      },
      // 如果snapshot2是更新的，使用其diffFromPrev
      diff: s2.diffFromPrev,
    }));
  } catch (error) {
    console.error("[posts/snapshot-compare] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /following/list/:username
 * 查询某用户的关注列表（分页）
 */
router.get("/following/list/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, pageSize = 20 } = req.query;

    const { count, rows } = await db.BinanceSquareFollowing.findAndCountAll({
      where: { followerUsername: username },
      order: [["createdAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });

    // 关联查询被关注者的用户信息
    const followingUsernames = rows.map((r) => r.followingUsername);
    const users = await db.BinanceSquareUser.findAll({
      where: { username: { [Op.in]: followingUsernames } },
      attributes: ["username", "displayName", "avatar", "totalFollowerCount", "totalPostCount"],
      raw: true,
    });
    const userMap = new Map(users.map((u) => [u.username, u]));

    const enriched = rows.map((r) => {
      const user = userMap.get(r.followingUsername);
      return {
        followingUsername: r.followingUsername,
        followingSquareUid: r.followingSquareUid,
        createdAt: r.createdAt,
        displayName: user?.displayName || null,
        avatar: user?.avatar || null,
        totalFollowerCount: user?.totalFollowerCount || null,
        totalPostCount: user?.totalPostCount || null,
      };
    });

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      data: enriched,
    }));
  } catch (error) {
    console.error(`[following/list/${req.params.username}] error:`, error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /posts/user/:username
 * 查询某用户的帖子列表（支持 filterType 筛选，分页）
 */
router.get("/posts/user/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { filterType = "ALL", page = 1, pageSize = 20 } = req.query;

    const where = { username };
    if (filterType === "REPLY") {
      where.postType = "reply";
    } else if (filterType === "QUOTE") {
      where.postType = "quote";
    } else if (filterType === "ARTICLE") {
      where.postType = "article";
    }
    // ALL 时不加 postType 条件

    const { count, rows } = await db.BinanceSquarePost.findAndCountAll({
      where,
      order: [["publishedAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      data: rows,
    }));
  } catch (error) {
    console.error(`[posts/user/${req.params.username}] error:`, error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== 调度器管理 ====================

/**
 * POST /crawl/start
 * 启动定时爬虫任务（通过 Redis 通知单例服务）
 */
router.post("/crawl/start", async (req, res) => {
  try {
    await req.redisClient.set("binance_square:scheduler:control", "start");
    res.json(success({
      message: "启动命令已发送至单例任务服务",
      note: "调度器将在30秒内启动",
      control: "start",
    }));
  } catch (error) {
    console.error("[crawl/start] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /crawl/pause
 * 暂停定时爬虫任务（通过 Redis 通知单例服务）
 */
router.post("/crawl/pause", async (req, res) => {
  try {
    await req.redisClient.set("binance_square:scheduler:control", "stop");
    res.json(success({
      message: "暂停命令已发送至单例任务服务",
      control: "stop",
    }));
  } catch (error) {
    console.error("[crawl/pause] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /crawl/status
 * 获取爬虫运行状态（从 Redis 读取单例服务状态）
 */
router.get("/crawl/status", async (req, res) => {
  try {
    const control = await req.redisClient.get("binance_square:scheduler:control");
    const isRunning = control === "start";

    // 检查是否有正在执行的爬取任务（从 Redis 进度中查询）
    let isCrawling = false;
    let currentTask = null;
    try {
      const keys = await req.redisClient.keys("binance_square:task:progress:post:*");
      if (keys.length > 0) {
        const progressList = [];
        for (const key of keys) {
          const data = await req.redisClient.get(key);
          if (data) progressList.push(JSON.parse(data));
        }
        progressList.sort((a, b) => new Date(b.updatedAt || b.startedAt) - new Date(a.updatedAt || a.startedAt));
        const latest = progressList[0];
        if (latest && latest.status === "running") {
          isCrawling = true;
          currentTask = {
            taskType: latest.taskType,
            snapshotId: latest.snapshotId,
            processedUsers: latest.processedUsers,
            totalUsers: latest.totalUsers,
            successUsers: latest.successUsers,
            failedUsers: latest.failedUsers,
            errorRate: latest.errorRate,
            startedAt: latest.startedAt,
          };
        }
      }
    } catch (e) {
      console.warn("[crawl/status] 查询任务进度失败:", e.message);
    }

    // 从数据库查询最近一次抓取日志
    const lastLog = await db.BinanceSquareCrawlLog.findOne({
      order: [["createdAt", "DESC"]],
    });

    res.json(success({
      control: control || "none",
      isRunning,
      isCrawling,
      currentTask,
      lastCrawl: lastLog ? {
        taskType: lastLog.taskType,
        status: lastLog.status,
        itemsCount: lastLog.itemsCount,
        snapshotId: lastLog.snapshotId,
        durationMs: lastLog.durationMs,
        createdAt: lastLog.createdAt,
      } : null,
    }));
  } catch (error) {
    console.error("[crawl/status] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /crawl/logs
 * 查询爬取日志列表（支持分页和筛选）
 */
router.get("/crawl/logs", async (req, res) => {
  try {
    const {
      taskType,
      status,
      page = 1,
      pageSize = 20,
    } = req.query;

    const where = {};
    if (taskType) where.taskType = taskType;
    if (status) where.status = status;

    const { count, rows } = await db.BinanceSquareCrawlLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      data: rows,
    }));
  } catch (error) {
    console.error("[crawl/logs] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /stats
 * 获取币安广场统计数据（供管理后台顶部卡片）
 */
router.get("/stats", async (req, res) => {
  try {
    const [
      seedCount,
      targetCount,
      postCount,
      snapshotCount,
      lastCrawlLog,
    ] = await Promise.all([
      db.BinanceSquareSeedConfig.count({ where: { isActive: true } }),
      db.BinanceSquareUser.count({ where: { isTargetUser: true } }),
      db.BinanceSquarePost.count(),
      db.BinanceSquarePostSnapshot.count(),
      db.BinanceSquareCrawlLog.findOne({
        order: [["createdAt", "DESC"]],
      }),
    ]);

    // 查询镜像表存储大小（PostgreSQL）
    let snapshotStorageBytes = 0;
    try {
      const [result] = await db.BinanceSquarePostSnapshot.sequelize.query(
        `SELECT pg_total_relation_size('"BinanceSquarePostSnapshots"') AS size_bytes`,
        { type: require("sequelize").QueryTypes.SELECT }
      );
      snapshotStorageBytes = result?.size_bytes ? parseInt(result.size_bytes, 10) : 0;
    } catch (e) {
      console.warn("[stats] 查询镜像表大小失败:", e.message);
    }

    res.json(success({
      seedCount,
      targetCount,
      postCount,
      snapshotCount,
      snapshotStorageBytes,
      lastCrawlAt: lastCrawlLog?.createdAt || null,
      lastCrawlStatus: lastCrawlLog?.status || null,
    }));
  } catch (error) {
    console.error("[stats] error:", error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== 配置管理（动态调控） ====================

/**
 * GET /config
 * 获取爬虫配置列表
 */
router.get("/config", async (req, res) => {
  try {
    const configs = await db.BinanceSquareConfig.findAll({
      order: [["configKey", "ASC"]],
    });
    res.json(success(configs));
  } catch (error) {
    console.error("[config/list] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /config
 * 更新爬虫配置（管理后台动态调控）
 */
router.post("/config", async (req, res) => {
  try {
    const { configKey, configValue } = req.body;

    if (!configKey || configValue === undefined) {
      return res.status(400).json(fail("configKey和configValue必填"));
    }

    // 查找配置
    const config = await db.BinanceSquareConfig.findOne({
      where: { configKey },
    });

    if (!config) {
      return res.status(404).json(fail("配置项不存在"));
    }

    // 校验范围
    if (config.minValue !== null && parseFloat(configValue) < parseFloat(config.minValue)) {
      return res.status(400).json(fail(`configValue不能小于${config.minValue}`));
    }
    if (config.maxValue !== null && parseFloat(configValue) > parseFloat(config.maxValue)) {
      return res.status(400).json(fail(`configValue不能大于${config.maxValue}`));
    }

    // 更新配置
    await db.BinanceSquareConfig.update(
      {
        configValue: String(configValue),
        updatedBy: req.adminUser?.email || req.user?.username || "unknown",
      },
      { where: { configKey } }
    );

    // 清除本地调度器缓存（API 层）
    const sched = getScheduler();
    sched.configService?.clearCache(configKey);

    // 通知单例服务清除缓存（通过 Redis）
    try {
      await req.redisClient.set("binance_square:config:changed", configKey, { EX: 60 });
    } catch (e) {
      console.warn("[config/update] Redis 通知失败:", e.message);
    }

    res.json(success({ configKey, configValue, updated: true }));
  } catch (error) {
    console.error("[config/update] error:", error);
    res.status(500).json(fail(error.message));
  }
});

// 导出路由和初始化函数
module.exports = { router, initRoutes };
