const express = require("express");
const { Op, QueryTypes } = require("sequelize");
const { scanKeys, getRedisClient } = require("../../lib/redisClient");

// 模型将在路由挂载时注入（通过initRoutes函数）
let db = null;

function initRoutes(sequelize) {
  // 延迟加载模型（确保sequelize实例已就绪）
  const initModels = require("../models");
  db = initModels(sequelize);

}

const router = express.Router();

// ==================== 统一响应格式 ====================
function success(data) {
  return { success: true, data };
}

function fail(error) {
  return { success: false, error };
}

function generateRunId(prefix = "run") {
  const now = new Date();
  return (
    `${prefix}-` +
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0") +
    "-" +
    Math.random().toString(36).substring(2, 8)
  );
}

function parsePositiveInt(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
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
    console.log(`[BS_CASE_DEBUG] /seed/list seeds.length=${seeds.length}, usernames=[${seeds.map(s=>s.username).join(", ")}]`);

    // 关联查询 BinanceSquareUser 获取 lastFollowingSyncedAt 等资料（大小写不敏感）。
    // “关注数”用于打开关注列表，应该以当前有效关注关系数为准，而不是 BinanceSquareUsers.totalFollowingCount。
    // 后者来自API个人统计字段，部分账号会返回0/不完整，容易和实际已入库关注关系不一致。
    const seedUsernames = seeds.map((s) => s.username);
    const lowerUsernames = seedUsernames.map((s) => s.toLowerCase());
    console.log(`[BS_CASE_DEBUG] /seed/list querying BinanceSquareUser with LOWER(username) IN [${lowerUsernames.join(", ")}]`);
    const users = await db.BinanceSquareUser.findAll({
      where: db.sequelize.where(
        db.sequelize.fn("LOWER", db.sequelize.col("username")),
        { [Op.in]: lowerUsernames }
      ),
      attributes: ["username", "totalFollowingCount", "lastCrawledAt", "lastFollowingSyncedAt"],
      raw: true,
    });
    console.log(`[BS_CASE_DEBUG] /seed/list users found=${users.length}, details=${JSON.stringify(users)}`);
    const userMap = new Map(users.map((u) => [u.username.toLowerCase(), u]));
    console.log(`[BS_CASE_DEBUG] /seed/list userMap keys=[${Array.from(userMap.keys()).join(", ")}]`);

    const relationCounts = lowerUsernames.length > 0
      ? await db.sequelize.query(
        `
          SELECT
            LOWER("followerUsername") AS "usernameLower",
            COUNT(*)::int AS "activeFollowingCount"
          FROM "BinanceSquareFollowings"
          WHERE LOWER("followerUsername") IN (:lowerUsernames)
            AND "isActive" = true
          GROUP BY LOWER("followerUsername")
        `,
        {
          replacements: { lowerUsernames },
          type: QueryTypes.SELECT,
        }
      )
      : [];
    const relationCountMap = new Map(
      relationCounts.map((row) => [row.usernameLower, Number(row.activeFollowingCount) || 0])
    );

    const enriched = seeds.map((s) => {
      const lowerUsername = s.username.toLowerCase();
      const user = userMap.get(lowerUsername);
      const activeFollowingCount = relationCountMap.get(lowerUsername);
      console.log(`[BS_CASE_DEBUG] /seed/list mapping seed=${s.username} => user=${JSON.stringify(user)}`);
      return {
        ...s.toJSON(),
        totalFollowingCount: activeFollowingCount ?? (user?.lastFollowingSyncedAt ? 0 : user?.totalFollowingCount ?? null),
        apiTotalFollowingCount: user?.totalFollowingCount ?? null,
        lastFollowingSyncedAt: user?.lastFollowingSyncedAt ?? null,
        lastCrawledAt: user?.lastCrawledAt ?? null,
      };
    });

    res.json(success(enriched));
  } catch (error) {
    console.error("[BS_CASE_DEBUG] /seed/list error:", error);
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
      // 注意：findOrCreate 内部会深拷贝 where，sequelize.where 深拷贝后状态丢失导致查不到
      // 改用 PostgreSQL 原生 Op.iLike，直接放在 where 对象中可被 findOrCreate 正确处理
      console.log(`[BS_CASE_DEBUG] /seed/add findOrCreate username=${username}, query={username: { [Op.iLike]: ${username} }}`);
      const [user, created] = await db.BinanceSquareUser.findOrCreate({
        where: { username: { [Op.iLike]: username } },
        defaults: {
          username,
          displayName: displayName || null,
          isSeedUser: true,
        },
        transaction,
      });
      console.log(`[BS_CASE_DEBUG] /seed/add findOrCreate result: found=${!created}, user.username=${user?.username}`);

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
    console.log(`[BS_CASE_DEBUG] /seed/remove username=${username}, LOWER(username)=${username.toLowerCase()}`);
    const [affectedCount] = await db.BinanceSquareSeedConfig.update(
      { isActive: false },
      { where: db.sequelize.where(
        db.sequelize.fn("LOWER", db.sequelize.col("username")),
        username.toLowerCase()
      ) }
    );
    console.log(`[BS_CASE_DEBUG] /seed/remove affectedCount=${affectedCount}`);

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
 * 同步单个用户的关注列表（Seed/Top50/Top100/Top300 都可用）
 * @param {string} targetUsername - 目标用户名
 * @param {Object} options
 * @returns {Promise<{username, total, fetched, newUsers, newRelations, deactivatedRelations, status}>}
 */
async function syncSingleUserFollowing(targetUsername, options = {}) {
  const startTime = Date.now();
  const now = new Date();
  const syncRunId = options.syncRunId || generateRunId("follow");
  let status = "success";
  let total = 0;
  let followers = [];
  let deactivatedRelations = 0;

  try {
    // 0. 查询关注者自身信息，补 followerSquareUid
    const sourceUser = await db.BinanceSquareUser.findOne({
      where: { username: { [Op.iLike]: targetUsername } },
      attributes: ["username", "squareUid"],
      raw: true,
    });
    // 关注关系中的 followerUsername 必须使用调用方传入的来源用户名，
    // 这样后续按 Seed/RankSet sourceUsernames 聚合时不会被大小写/别名打散。
    const normalizedTargetUsername = targetUsername;
    const followerSquareUid = sourceUser?.squareUid || null;

    // 1. 调用API获取关注列表
    const result = await apiClient.fetchFollowingList(normalizedTargetUsername);
    total = result.total || 0;
    followers = result.followers || [];

    // 2. 对比数量，不一致标记为partial
    if (followers.length !== total) {
      status = "partial";
      console.warn(`[following/sync] ${normalizedTargetUsername}: 抓取${followers.length}条, API返回total=${total}`);
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
      isSeedUser: false, // 被关注者默认不是种子用户；upsert时不会覆盖已有标记
      isTargetUser: false,
    }));

    // 4. 准备关注关系数据：本次看到的关系置为 active
    const followingRecords = followers.map((f) => ({
      followerUsername: normalizedTargetUsername,
      followerSquareUid,
      followingUsername: f.username,
      followingSquareUid: f.squareUid || null,
      isActive: true,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSyncRunId: syncRunId,
    }));

    // 5. 在写入前统计已存在的用户数量（大小写不敏感）
    const existingUsernames = followers.length > 0
      ? await db.BinanceSquareUser.findAll({
          where: db.sequelize.where(
            db.sequelize.fn("LOWER", db.sequelize.col("username")),
            { [Op.in]: followers.map((f) => f.username.toLowerCase()) }
          ),
          attributes: ["username"],
          raw: true,
        })
      : [];
    const existingUsernameSet = new Set(existingUsernames.map((u) => u.username.toLowerCase()));
    const newUsersCount = followers.filter((f) => !existingUsernameSet.has(f.username.toLowerCase())).length;

    // 6. 批量写入（事务）
    const transaction = await db.BinanceSquareUser.sequelize.transaction();

    try {
      if (userRecords.length > 0) {
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
            "totalFollowingCount",
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
      }

      if (followingRecords.length > 0) {
        // 写入/更新关注关系，重复关系也要刷新lastSeenAt/isActive
        await db.BinanceSquareFollowing.bulkCreate(followingRecords, {
          updateOnDuplicate: [
            "followerSquareUid",
            "followingSquareUid",
            "isActive",
            "lastSeenAt",
            "lastSyncRunId",
            "updatedAt",
          ],
          transaction,
        });
      }

      // 将本次没再出现的旧关系标记为 inactive，避免历史关系污染TopN
      const activeFollowingNames = followers.map((f) => f.username);
      const inactiveWhere = {
        followerUsername: normalizedTargetUsername,
        isActive: true,
      };
      if (activeFollowingNames.length > 0) {
        inactiveWhere.followingUsername = { [Op.notIn]: activeFollowingNames };
      }
      const [inactiveCount] = await db.BinanceSquareFollowing.update(
        { isActive: false, lastSyncRunId: syncRunId },
        { where: inactiveWhere, transaction }
      );
      deactivatedRelations = inactiveCount || 0;

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    // 7. 更新用户自身统计信息（关注同步时间单独记录，不占用帖子lastCrawledAt语义）
    try {
      const [updateCount] = await db.BinanceSquareUser.update(
        {
          totalFollowingCount: total,
          lastFollowingSyncedAt: now,
        },
        { where: db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("username")),
          normalizedTargetUsername.toLowerCase()
        ) }
      );
      console.log(`[following/sync] ${normalizedTargetUsername} 更新自身统计 rows=${updateCount}, totalFollowing=${total}`);
    } catch (e) {
      console.warn(`[following/sync] ${normalizedTargetUsername} 更新自身统计信息失败:`, e.message);
    }

    const durationMs = Date.now() - startTime;

    return {
      username: normalizedTargetUsername,
      total,
      fetched: followers.length,
      newUsers: newUsersCount,
      newRelations: followingRecords.length,
      deactivatedRelations,
      status,
      syncRunId,
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
      deactivatedRelations,
      status: "failed",
      errorMessage: error.message,
      syncRunId,
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
    let totalDeactivatedRelations = 0;
    let hasPartial = false;
    let hasFailed = false;

    for (const seed of seeds) {
      const result = await syncSingleUserFollowing(seed.username);
      results.push(result);
      totalNewUsers += result.newUsers;
      totalNewRelations += result.newRelations;
      totalDeactivatedRelations += result.deactivatedRelations || 0;
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
      deactivatedRelations: totalDeactivatedRelations,
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
    console.log(`[BS_CASE_DEBUG] /following/sync/:username username=${username}`);
    const seed = await db.BinanceSquareSeedConfig.findOne({
      where: {
        [Op.and]: [
          db.sequelize.where(
            db.sequelize.fn("LOWER", db.sequelize.col("username")),
            username.toLowerCase()
          ),
          { isActive: true },
        ],
      },
    });
    console.log(`[BS_CASE_DEBUG] /following/sync/:username seed found=${!!seed}, seed.username=${seed?.username}`);

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

// ==================== 分阶段目标用户计算（Top50/Top100/Top300/Top1000） ====================

const RANK_STAGE_CONFIG = {
  top50: { rankSet: "top50", sourceRankSet: "seed", limit: 50, previousRankSets: [] },
  top100: { rankSet: "top100", sourceRankSet: "top50", limit: 100, previousRankSets: ["top50"] },
  top300: { rankSet: "top300", sourceRankSet: "top100", limit: 300, previousRankSets: ["top50", "top100"] },
  top1000: { rankSet: "top1000", sourceRankSet: "top300", limit: 1000, previousRankSets: ["top50", "top100", "top300"] },
};

function getTargetProgressKey(runId) {
  return `binance_square:task:progress:target:${runId}`;
}

async function updateTargetProgress(runId, update) {
  try {
    const redis = await getRedisClient();
    const key = getTargetProgressKey(runId);
    const existing = await redis.get(key);
    const current = existing ? JSON.parse(existing) : {};
    const merged = { ...current, ...update, updatedAt: new Date().toISOString() };
    await redis.set(key, JSON.stringify(merged), "EX", 24 * 60 * 60);
    return merged;
  } catch (e) {
    console.warn("[target/progress] 更新Redis进度失败:", e.message);
    return null;
  }
}

async function getTargetProgressList() {
  const redis = await getRedisClient();
  const keys = await scanKeys(redis, "binance_square:task:progress:target:*", { maxKeys: 100 });
  const progressList = [];

  for (const key of keys) {
    try {
      const data = await redis.get(key);
      if (data) progressList.push(JSON.parse(data));
    } catch (e) {
      console.warn("[target/progress] 解析Redis进度失败:", e.message);
    }
  }

  progressList.sort((a, b) => new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0));
  return progressList;
}

function normalizeRankSet(rankSet) {
  return String(rankSet || "").toLowerCase();
}

async function getStageSourceUsers(config) {
  if (config.sourceRankSet === "seed") {
    const seeds = await db.BinanceSquareSeedConfig.findAll({
      where: { isActive: true },
      attributes: ["username", "displayName"],
      order: [["sortOrder", "ASC"], ["createdAt", "ASC"]],
      raw: true,
    });
    return seeds.map((s) => ({ username: s.username, displayName: s.displayName || null, sourceRank: null }));
  }

  const ranks = await db.BinanceSquareTargetRank.findAll({
    where: { rankSet: config.sourceRankSet },
    attributes: ["username", "rank"],
    order: [["rank", "ASC"]],
    raw: true,
  });

  if (ranks.length === 0) {
    throw new Error(`请先更新 ${config.sourceRankSet}，再更新 ${config.rankSet}（不允许跳步）`);
  }

  const users = await db.BinanceSquareUser.findAll({
    where: db.sequelize.where(
      db.sequelize.fn("LOWER", db.sequelize.col("username")),
      { [Op.in]: ranks.map((r) => r.username.toLowerCase()) }
    ),
    attributes: ["username", "displayName"],
    raw: true,
  });
  const userMap = new Map(users.map((u) => [u.username.toLowerCase(), u]));

  return ranks.map((r) => {
    const user = userMap.get(r.username.toLowerCase());
    return { username: user?.username || r.username, displayName: user?.displayName || null, sourceRank: r.rank };
  });
}

async function syncSourceUsersFollowings(sourceUsers, config, runId, onProgress = null) {
  const results = [];
  let hasFailed = false;
  let hasPartial = false;
  let totalNewUsers = 0;
  let totalRelations = 0;
  let totalDeactivated = 0;

  for (let i = 0; i < sourceUsers.length; i++) {
    const source = sourceUsers[i];
    console.log(`[target/${config.rankSet}] 同步来源用户关注列表 ${i + 1}/${sourceUsers.length}: ${source.username}`);
    const result = await syncSingleUserFollowing(source.username, {
      syncRunId: runId,
      sourceRankSet: config.sourceRankSet,
      targetRankSet: config.rankSet,
    });
    results.push(result);
    totalNewUsers += result.newUsers || 0;
    totalRelations += result.newRelations || 0;
    totalDeactivated += result.deactivatedRelations || 0;
    if (result.status === "failed") hasFailed = true;
    if (result.status === "partial") hasPartial = true;
    if (onProgress) {
      await onProgress({
        processedSourceUsers: i + 1,
        currentSourceUser: source.username,
        totalNewUsers,
        totalRelations,
        totalDeactivated,
        failedSourceUsers: results.filter((item) => item.status === "failed").length,
        partialSourceUsers: results.filter((item) => item.status === "partial").length,
        lastResult: result,
      });
    }
  }

  return {
    results,
    totalNewUsers,
    totalRelations,
    totalDeactivated,
    status: hasFailed ? "partial" : hasPartial ? "partial" : "success",
  };
}

function buildSourceMap(sourceUsers) {
  const map = new Map();
  for (const source of sourceUsers) {
    map.set(source.username.toLowerCase(), {
      username: source.username,
      displayName: source.displayName || null,
      rank: source.sourceRank || null,
    });
  }
  return map;
}

async function calculateCandidatesFromFollowings(sourceUsers) {
  const sourceUsernames = sourceUsers.map((s) => s.username);
  if (sourceUsernames.length === 0) return [];

  const sourceMap = buildSourceMap(sourceUsers);
  const relations = await db.BinanceSquareFollowing.findAll({
    where: {
      followerUsername: { [Op.in]: sourceUsernames },
      isActive: true,
    },
    attributes: ["followerUsername", "followingUsername", "followingSquareUid", "updatedAt"],
    raw: true,
  });

  const grouped = new Map();
  for (const relation of relations) {
    if (!relation.followingUsername) continue;
    const key = relation.followingUsername.toLowerCase();
    const followerKey = relation.followerUsername.toLowerCase();
    const source = sourceMap.get(followerKey) || { username: relation.followerUsername, displayName: null, rank: null };

    if (!grouped.has(key)) {
      grouped.set(key, {
        username: relation.followingUsername,
        followerSet: new Set(),
        followerCount: 0,
        sourceFollowers: [],
        squareUid: relation.followingSquareUid || null,
      });
    }

    const item = grouped.get(key);
    if (relation.followingSquareUid && !item.squareUid) {
      item.squareUid = relation.followingSquareUid;
    }
    if (!item.followerSet.has(followerKey)) {
      item.followerSet.add(followerKey);
      item.sourceFollowers.push(source);
    }
  }

  const candidates = Array.from(grouped.values()).map((item) => ({
    username: item.username,
    followerCount: item.followerSet.size,
    sourceFollowers: item.sourceFollowers,
    squareUid: item.squareUid,
  }));

  candidates.sort((a, b) => {
    if (b.followerCount !== a.followerCount) return b.followerCount - a.followerCount;
    return a.username.localeCompare(b.username);
  });

  return candidates;
}

async function loadPreviousRankEntries(previousRankSets) {
  if (!previousRankSets || previousRankSets.length === 0) return [];
  const previousRanks = await db.BinanceSquareTargetRank.findAll({
    where: { rankSet: { [Op.in]: previousRankSets } },
    order: [["rankSet", "ASC"], ["rank", "ASC"]],
    raw: true,
  });

  const orderWeight = new Map(previousRankSets.map((rankSet, index) => [rankSet, index]));
  previousRanks.sort((a, b) => {
    const weightDiff = (orderWeight.get(a.rankSet) ?? 999) - (orderWeight.get(b.rankSet) ?? 999);
    if (weightDiff !== 0) return weightDiff;
    return a.rank - b.rank;
  });

  const result = [];
  const seen = new Set();
  for (const rank of previousRanks) {
    const key = rank.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      username: rank.username,
      followerCount: rank.followerCount || 0,
      sourceFollowers: rank.sourceFollowers || rank.seedFollowers || [],
      squareUid: null,
      includedRankSets: Array.from(new Set([...(rank.includedRankSets || []), rank.rankSet])),
      previousRankSet: rank.rankSet,
      previousRank: rank.rank,
    });
  }
  return result;
}

async function buildRankEntries(config, candidates) {
  const previousEntries = await loadPreviousRankEntries(config.previousRankSets);
  const entryMap = new Map();
  const ordered = [];

  function addOrMerge(entry, includedRankSet) {
    const key = entry.username.toLowerCase();
    if (!entryMap.has(key)) {
      const merged = {
        username: entry.username,
        followerCount: entry.followerCount || 0,
        sourceFollowers: entry.sourceFollowers || [],
        squareUid: entry.squareUid || null,
        includedRankSets: Array.from(new Set([...(entry.includedRankSets || []), includedRankSet].filter(Boolean))),
        previousRankSet: entry.previousRankSet || null,
        previousRank: entry.previousRank || null,
      };
      entryMap.set(key, merged);
      ordered.push(merged);
      return;
    }

    const existing = entryMap.get(key);
    if ((entry.followerCount || 0) > (existing.followerCount || 0)) {
      existing.followerCount = entry.followerCount || 0;
      existing.sourceFollowers = entry.sourceFollowers || existing.sourceFollowers;
    }
    if (entry.squareUid && !existing.squareUid) existing.squareUid = entry.squareUid;
    existing.includedRankSets = Array.from(new Set([...(existing.includedRankSets || []), includedRankSet].filter(Boolean)));
  }

  // 先写入上一层/中间层，确保 finalTop1000 包含 Top50/100/300。
  for (const entry of previousEntries) {
    addOrMerge(entry, entry.previousRankSet);
  }
  for (const candidate of candidates) {
    addOrMerge(candidate, config.rankSet);
    if (ordered.length >= config.limit && entryMap.size >= config.limit) {
      // candidates 已按分数排序；超过limit后仍可能只是merge旧人，简单提前减少无谓循环。
      // 不直接break，避免前limit中重复太多时数量不足；这里entryMap.size判断即可。
    }
  }

  return ordered.slice(0, config.limit).map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

async function writeRankSet(config, rankEntries, sourceUsers, runId, syncSummary) {
  const now = new Date();
  const transaction = await db.BinanceSquareTargetRank.sequelize.transaction();

  try {
    await db.BinanceSquareTargetRank.destroy({
      where: { rankSet: config.rankSet },
      transaction,
    });

    const rankRecords = rankEntries.map((entry) => ({
      username: entry.username,
      rankSet: config.rankSet,
      rank: entry.rank,
      followerCount: entry.followerCount || 0,
      sourceRankSet: config.sourceRankSet,
      sourceUserCount: sourceUsers.length,
      seedFollowers: entry.sourceFollowers || [], // 兼容旧字段
      sourceFollowers: entry.sourceFollowers || [],
      includedRankSets: entry.includedRankSets || [config.rankSet],
      calculationRunId: runId,
      lastCalculatedAt: now,
    }));

    if (rankRecords.length > 0) {
      await db.BinanceSquareTargetRank.bulkCreate(rankRecords, { transaction });
    }

    // 补全用户表squareUid；最终top1000才更新isTargetUser标记
    for (const entry of rankEntries) {
      const updateData = { followScore: entry.followerCount || 0 };
      if (entry.squareUid) updateData.squareUid = entry.squareUid;
      if (config.rankSet === "top1000") {
        updateData.isTargetUser = true;
        updateData.targetRank = entry.rank;
        updateData.targetRankSet = "top1000";
      }
      await db.BinanceSquareUser.update(updateData, {
        where: db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("username")),
          entry.username.toLowerCase()
        ),
        transaction,
      });
    }

    if (config.rankSet === "top1000") {
      const finalNamesLower = rankEntries.map((entry) => entry.username.toLowerCase());
      await db.BinanceSquareUser.update(
        { isTargetUser: false, targetRank: null, targetRankSet: null },
        {
          where: {
            [Op.and]: [
              { isTargetUser: true },
              db.sequelize.where(db.sequelize.fn("LOWER", db.sequelize.col("username")), { [Op.notIn]: finalNamesLower }),
            ],
          },
          transaction,
        }
      );
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return {
    rankSet: config.rankSet,
    sourceRankSet: config.sourceRankSet,
    sourceUserCount: sourceUsers.length,
    total: rankEntries.length,
    updatedAt: now,
    runId,
    syncSummary,
  };
}

async function runRankStage(rankSet) {
  const config = RANK_STAGE_CONFIG[normalizeRankSet(rankSet)];
  if (!config) {
    throw new Error("rankSet 必须是 top50/top100/top300/top1000");
  }

  const startTime = Date.now();
  const runId = generateRunId(`target-${config.rankSet}`);
  const sourceUsers = await getStageSourceUsers(config);

  if (sourceUsers.length === 0) {
    throw new Error(`没有可用来源用户，无法更新 ${config.rankSet}`);
  }

  console.log(`[target/${config.rankSet}] 开始更新，source=${config.sourceRankSet}, sourceUsers=${sourceUsers.length}, runId=${runId}`);
  await updateTargetProgress(runId, {
    taskType: "target_calculate",
    runId,
    rankSet: config.rankSet,
    sourceRankSet: config.sourceRankSet,
    status: "running",
    stage: "sync_followings",
    totalSourceUsers: sourceUsers.length,
    processedSourceUsers: 0,
    failedSourceUsers: 0,
    partialSourceUsers: 0,
    totalNewUsers: 0,
    totalRelations: 0,
    totalDeactivated: 0,
    candidateCount: 0,
    rankedCount: 0,
    startedAt: new Date().toISOString(),
  });

  try {
    const syncSummary = await syncSourceUsersFollowings(sourceUsers, config, runId, async (progress) => {
      await updateTargetProgress(runId, {
        stage: "sync_followings",
        ...progress,
      });
    });

    await updateTargetProgress(runId, { stage: "calculate_candidates" });
    const candidates = await calculateCandidatesFromFollowings(sourceUsers);

    await updateTargetProgress(runId, {
      stage: "build_rank",
      candidateCount: candidates.length,
    });
    const rankEntries = await buildRankEntries(config, candidates);

    await updateTargetProgress(runId, {
      stage: "write_rank",
      rankedCount: rankEntries.length,
    });
    const writeResult = await writeRankSet(config, rankEntries, sourceUsers, runId, syncSummary);

    const durationMs = Date.now() - startTime;
    await db.BinanceSquareCrawlLog.create({
      taskType: "target_calculate",
      status: syncSummary.status,
      targetId: config.rankSet,
      itemsCount: rankEntries.length,
      durationMs,
      failedDetails: {
        rankSet: config.rankSet,
        sourceRankSet: config.sourceRankSet,
        runId,
        syncSummary,
      },
    });

    const finalProgress = await updateTargetProgress(runId, {
      status: "completed",
      stage: "completed",
      candidateCount: candidates.length,
      rankedCount: rankEntries.length,
      durationMs,
      completedAt: new Date().toISOString(),
    });

    return {
      ...writeResult,
      candidateCount: candidates.length,
      durationMs,
      progress: finalProgress,
      preview: rankEntries.slice(0, 20).map((entry) => ({
        rank: entry.rank,
        username: entry.username,
        followerCount: entry.followerCount,
        includedRankSets: entry.includedRankSets,
        sourceFollowers: (entry.sourceFollowers || []).slice(0, 10).map((s) => s.username),
      })),
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await updateTargetProgress(runId, {
      status: "failed",
      stage: "failed",
      errorMessage: error.message,
      durationMs,
      completedAt: new Date().toISOString(),
    });
    await db.BinanceSquareCrawlLog.create({
      taskType: "target_calculate",
      status: "failed",
      targetId: config.rankSet,
      errorMessage: error.message,
      durationMs,
      failedDetails: {
        action: "target_calculate",
        rankSet: config.rankSet,
        sourceRankSet: config.sourceRankSet,
        runId,
      },
    }).catch(() => {});
    throw error;
  }
}

/**
 * POST /target/calculate
 * 兼容旧接口：默认手动更新Top50
 */
router.post("/target/calculate", async (req, res) => {
  try {
    const result = await runRankStage("top50");
    res.json(success(result));
  } catch (error) {
    console.error("[target/calculate] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /target/calculate/:rankSet
 * 手动分阶段更新：top50/top100/top300/top1000，不允许跳步
 */
router.post("/target/calculate/:rankSet", async (req, res) => {
  const { rankSet } = req.params;
  try {
    const result = await runRankStage(rankSet);
    res.json(success(result));
  } catch (error) {
    console.error(`[target/calculate/${rankSet}] error:`, error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /target/list
 * 获取目标用户列表，支持 ?rankSet=top50/top100/top300/top1000
 */
router.get("/target/list", async (req, res) => {
  try {
    const rankSet = normalizeRankSet(req.query.rankSet || "top1000");
    const where = RANK_STAGE_CONFIG[rankSet] ? { rankSet } : {};
    const ranks = await db.BinanceSquareTargetRank.findAll({
      where,
      order: [["rankSet", "ASC"], ["rank", "ASC"]],
    });

    res.json(success(ranks));
  } catch (error) {
    console.error("[target/list] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /target/progress
 * 查询当前/最近一次目标用户分阶段更新进度
 */
router.get("/target/progress", async (req, res) => {
  try {
    const progressList = await getTargetProgressList();

    if (progressList.length === 0) {
      return res.json(success({ running: false, message: "当前没有目标用户更新任务" }));
    }

    const latest = progressList[0];

    res.json(success({
      running: latest?.status === "running",
      latest,
      list: progressList.slice(0, 10),
    }));
  } catch (error) {
    console.error("[target/progress] error:", error);
    res.status(500).json(fail(error.message));
  }
});

// ==================== 帖子抓取与镜像管理 ====================


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
 * 手动触发：抓取finalTop1000目标用户近N天帖子（ALL + REPLY），并重算分
 * @body {string} mode - "incremental" | "full"，默认 "full"；incremental仅兼容旧调试
 * @body {number} daysBack - 默认7
 * @body {number} concurrency - 默认2
 */
router.post("/crawl/posts", async (req, res) => {
  try {
    const mode = req.body?.mode || "full";
    const onlyFirstPage = mode === "incremental";
    const label = onlyFirstPage ? "增量" : "近7天";
    const daysBack = parseInt(req.body?.daysBack || 7, 10);
    const concurrency = Math.max(parsePositiveInt(req.body?.concurrency, 5), 5);
    const filterTypes = Array.isArray(req.body?.filterTypes)
      ? req.body.filterTypes
      : String(req.body?.filterTypes || "ALL,REPLY").split(",");
    const requestId = generateRunId("post-crawl");

    const command = {
      requestId,
      requestedBy: req.adminUser?.email || req.user?.username || "admin",
      createdAt: new Date().toISOString(),
      options: {
        onlyFirstPage,
        daysBack,
        concurrency,
        // 注意：这里不读取 API 服务器的 BINANCE_SQUARE_TARGET_* 环境变量，
        // 避免主服务历史调试变量把独立爬虫限制成只抓 1 个用户。
        proxyLineCount: parsePositiveInt(req.body?.proxyLineCount, concurrency),
        targetLimit: parsePositiveInt(req.body?.targetLimit, 1000),
        batchWriteUsers: parsePositiveInt(req.body?.batchWriteUsers, 25),
        batchWriteMaxPosts: parsePositiveInt(req.body?.batchWriteMaxPosts, 800),
        progressEveryUsers: parsePositiveInt(req.body?.progressEveryUsers, 5),
        filterTypes: filterTypes.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
      },
    };

    console.log(`[crawl/posts] 手动触发${label}抓取命令已入队, requestId=${requestId}, mode=${mode}, daysBack=${daysBack}, concurrency=${concurrency}`);
    await req.redisClient.set("binance_square:task:command:post", JSON.stringify(command), { EX: 24 * 60 * 60 });

    res.json(success({
      requestId,
      mode,
      status: "queued",
      message: "帖子抓取命令已发送至独立爬虫服务",
      note: "实际执行进度请查看 /crawl/progress；API 服务不再直接执行爬取",
      options: command.options,
    }));
  } catch (error) {
    console.error("[crawl/posts] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /crawl/force-stop
 * 强制终止当前爬取任务
 */
router.post("/crawl/force-stop", async (req, res) => {
  try {
    // 爬取任务在独立爬虫服务中执行；这里仅写 Redis 指令，避免 API 进程误删远端任务锁。
    await req.redisClient.set("binance_square:task:force_stop", "true", { EX: 2 * 60 * 60 });

    res.json(success({ message: "已发送强制终止指令" }));
  } catch (error) {
    console.error("[crawl/force-stop] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /posts/recalculate-scores
 * 手动补评分：重算 Top1000 目标用户近N天帖子热度分。
 * 用于爬虫中途崩溃、已入库但未走到最终评分阶段时补算。
 * @body {number} daysBack - 默认7
 * @body {string} scoreVersion - 默认当前版本
 * @body {boolean} targetOnly - 默认true，仅重算最终目标用户
 */
router.post("/posts/recalculate-scores", async (req, res) => {
  const startTime = Date.now();
  try {
    const daysBack = parsePositiveInt(req.body?.daysBack, 7);
    const scoreVersion = String(req.body?.scoreVersion || "bs_post_v1");
    const targetOnly = req.body?.targetOnly !== false;

    let targetUsernames = null;
    if (targetOnly) {
      const targetUsers = await db.BinanceSquareUser.findAll({
        where: { isTargetUser: true },
        attributes: ["username"],
        raw: true,
      });
      targetUsernames = targetUsers.map((u) => u.username).filter(Boolean);
      if (targetUsernames.length === 0) {
        return res.status(400).json(fail("没有目标用户，请先计算Top1000"));
      }
    }

    const { BinanceSquareTaskManager } = require("../scraper/taskManager");
    const manager = new BinanceSquareTaskManager(db);
    const result = await manager.recalculatePostScores({
      daysBack,
      targetUsernames,
      scoreVersion,
    });

    const durationMs = Date.now() - startTime;
    await db.BinanceSquareCrawlLog.create({
      taskType: "post",
      status: "success",
      targetId: "recalculate_scores",
      itemsCount: result.scoredPosts || 0,
      durationMs,
      failedDetails: {
        action: "recalculate_scores",
        daysBack,
        targetOnly,
        targetUsers: targetUsernames?.length || null,
        scoreVersion,
        result,
      },
    }).catch((e) => {
      console.warn("[posts/recalculate-scores] 写入日志失败:", e.message);
    });

    res.json(success({
      message: `已重算近${daysBack}天帖子评分`,
      ...result,
      targetOnly,
      targetUsers: targetUsernames?.length || null,
      durationMs,
    }));
  } catch (error) {
    console.error("[posts/recalculate-scores] error:", error);
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
      orderBy = "score",
      minScore,
    } = req.query;

    const where = {};
    if (username) {
      where.username = { [Op.iLike]: username };
      console.log(`[BS_CASE_DEBUG] /posts username filter: { [Op.iLike]: ${username} }`);
    }
    if (postType) where.postType = postType;
    if (startDate || endDate) {
      where.publishedAt = {};
      if (startDate) where.publishedAt[Op.gte] = new Date(startDate);
      if (endDate) where.publishedAt[Op.lte] = new Date(endDate);
    }
    if (minScore !== undefined) {
      where.score = { [Op.gte]: parseFloat(minScore) };
    }
    console.log(`[BS_CASE_DEBUG] /posts where keys=${Object.keys(where).join(", ")}`);

    const descNullsLast = (field) => [
      db.sequelize.literal(`"${field}" DESC NULLS LAST`),
    ];
    const orderMap = {
      score: [...descNullsLast("score"), ["publishedAt", "DESC"]],
      publishedAt: [["publishedAt", "DESC"]],
      viewCount: [...descNullsLast("viewCount"), ["publishedAt", "DESC"]],
      shareCount: [...descNullsLast("shareCount"), ["publishedAt", "DESC"]],
      commentCount: [...descNullsLast("commentCount"), ["publishedAt", "DESC"]],
      likeCount: [...descNullsLast("likeCount"), ["publishedAt", "DESC"]],
    };
    const order = orderMap[orderBy] || orderMap.score;

    const { count, rows } = await db.BinanceSquarePost.findAndCountAll({
      where,
      order,
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });
    console.log(`[BS_CASE_DEBUG] /posts count=${count}, rows=${rows.length}`);

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      orderBy,
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
    const keys = await scanKeys(redis, "binance_square:task:progress:post:*");

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
      totalUpsertedPosts: latest.totalUpsertedPosts || 0,
      totalSnapshots: latest.totalSnapshots,
      scoredPosts: latest.scoredPosts || 0,
      daysBack: latest.daysBack || null,
      filterTypes: latest.filterTypes || null,
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
 * POST /maintenance/purge-snapshots
 * 清空旧帖子镜像数据。新版本不再写完整镜像，此接口用于释放历史数据空间。
 */
router.post("/maintenance/purge-snapshots", async (req, res) => {
  const startTime = Date.now();
  try {
    const beforeCount = await db.BinanceSquarePostSnapshot.count();
    let beforeStorageBytes = 0;
    try {
      const [result] = await db.BinanceSquarePostSnapshot.sequelize.query(
        `SELECT pg_total_relation_size('"BinanceSquarePostSnapshots"') AS size_bytes`,
        { type: require("sequelize").QueryTypes.SELECT }
      );
      beforeStorageBytes = result?.size_bytes ? parseInt(result.size_bytes, 10) : 0;
    } catch (e) {
      console.warn("[maintenance/purge-snapshots] 查询清理前存储大小失败:", e.message);
    }

    await db.BinanceSquarePostSnapshot.destroy({
      where: {},
      truncate: true,
      cascade: false,
    });

    let afterStorageBytes = 0;
    try {
      const [result] = await db.BinanceSquarePostSnapshot.sequelize.query(
        `SELECT pg_total_relation_size('"BinanceSquarePostSnapshots"') AS size_bytes`,
        { type: require("sequelize").QueryTypes.SELECT }
      );
      afterStorageBytes = result?.size_bytes ? parseInt(result.size_bytes, 10) : 0;
    } catch (e) {
      console.warn("[maintenance/purge-snapshots] 查询清理后存储大小失败:", e.message);
    }

    await db.BinanceSquareCrawlLog.create({
      taskType: "post",
      status: "success",
      targetId: "purge_snapshots",
      itemsCount: beforeCount,
      durationMs: Date.now() - startTime,
      failedDetails: {
        action: "purge_snapshots",
        beforeCount,
        beforeStorageBytes,
        afterStorageBytes,
      },
    }).catch((e) => {
      console.warn("[maintenance/purge-snapshots] 写入清理日志失败:", e.message);
    });

    res.json(success({
      message: "旧镜像数据已清空",
      deletedSnapshots: beforeCount,
      beforeStorageBytes,
      afterStorageBytes,
      durationMs: Date.now() - startTime,
    }));
  } catch (error) {
    console.error("[maintenance/purge-snapshots] error:", error);
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
    const { page = 1, pageSize = 20, includeInactive = "false" } = req.query;

    console.log(`[BS_CASE_DEBUG] /following/list/:username username=${username}`);
    const where = {
      [Op.and]: [
        db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("followerUsername")),
          username.toLowerCase()
        ),
      ],
    };
    if (includeInactive !== "true") {
      where.isActive = true;
    }
    const { count, rows } = await db.BinanceSquareFollowing.findAndCountAll({
      where,
      order: [["lastSeenAt", "DESC"], ["createdAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });
    console.log(`[BS_CASE_DEBUG] /following/list/:username count=${count}, rows=${rows.length}`);

    // 关联查询被关注者的用户信息（大小写不敏感）
    const followingUsernames = rows.map((r) => r.followingUsername);
    console.log(`[BS_CASE_DEBUG] /following/list/:username followingUsernames=[${followingUsernames.join(", ")}]`);
    const users = await db.BinanceSquareUser.findAll({
      where: db.sequelize.where(
        db.sequelize.fn("LOWER", db.sequelize.col("username")),
        { [Op.in]: followingUsernames.map((s) => s.toLowerCase()) }
      ),
      attributes: ["username", "displayName", "avatar", "totalFollowerCount", "totalPostCount"],
      raw: true,
    });
    console.log(`[BS_CASE_DEBUG] /following/list/:username users found=${users.length}, details=${JSON.stringify(users)}`);
    const userMap = new Map(users.map((u) => [u.username.toLowerCase(), u]));

    const enriched = rows.map((r) => {
      const user = userMap.get(r.followingUsername.toLowerCase());
      return {
        followingUsername: r.followingUsername,
        followingSquareUid: r.followingSquareUid,
        isActive: r.isActive,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
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
    const { filterType = "ALL", page = 1, pageSize = 20, orderBy = "publishedAt" } = req.query;

    const where = { username: { [Op.iLike]: username } };
    if (filterType === "REPLY") {
      where.postType = "reply";
    } else if (filterType === "QUOTE") {
      where.postType = "quote";
    } else if (filterType === "ARTICLE") {
      where.postType = "article";
    }
    console.log(`[BS_CASE_DEBUG] /posts/user/:username username=${username}, filterType=${filterType}, where=${JSON.stringify(where)}`);

    const { count, rows } = await db.BinanceSquarePost.findAndCountAll({
      where,
      order: orderBy === "score" ? [["score", "DESC"], ["publishedAt", "DESC"]] : [["publishedAt", "DESC"]],
      limit: parseInt(pageSize, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
    });
    console.log(`[BS_CASE_DEBUG] /posts/user/:username count=${count}, rows=${rows.length}`);

    res.json(success({
      total: count,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      orderBy,
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
 * 启动定时爬虫任务（通过 Redis 通知独立爬虫服务）
 */
router.post("/crawl/start", async (req, res) => {
  try {
    await req.redisClient.set("binance_square:scheduler:control", "start");
    res.json(success({
      message: "启动命令已发送至独立爬虫服务",
      note: "独立爬虫服务将在30秒内启动调度器",
      control: "start",
    }));
  } catch (error) {
    console.error("[crawl/start] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * POST /crawl/pause
 * 暂停定时爬虫任务（通过 Redis 通知独立爬虫服务）
 */
router.post("/crawl/pause", async (req, res) => {
  try {
    await req.redisClient.set("binance_square:scheduler:control", "stop");
    res.json(success({
      message: "暂停命令已发送至独立爬虫服务",
      control: "stop",
    }));
  } catch (error) {
    console.error("[crawl/pause] error:", error);
    res.status(500).json(fail(error.message));
  }
});

/**
 * GET /crawl/status
 * 获取爬虫运行状态（从 Redis 读取独立爬虫服务状态）
 */
router.get("/crawl/status", async (req, res) => {
  try {
    const control = await req.redisClient.get("binance_square:scheduler:control");
    const isRunning = control === "start";

    // 检查是否有正在执行的爬取任务（从 Redis 进度中查询）
    let isCrawling = false;
    let currentTask = null;
    try {
      const keys = await scanKeys(req.redisClient, "binance_square:task:progress:post:*");
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
            totalPostsAll: latest.totalPostsAll || 0,
            totalPostsReply: latest.totalPostsReply || 0,
            totalUpsertedPosts: latest.totalUpsertedPosts || 0,
            daysBack: latest.daysBack || null,
            filterTypes: latest.filterTypes || null,
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
    if (status && status !== "running") where.status = status;

    const logResult = status === "running"
      ? { count: 0, rows: [] }
      : await db.BinanceSquareCrawlLog.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: parseInt(pageSize, 10),
        offset: (parseInt(page, 10) - 1) * parseInt(pageSize, 10),
      });
    const { count, rows } = logResult;

    const data = rows.map((row) => row.toJSON());
    let virtualRunningLogs = [];

    // 目标用户分阶段更新是长任务：DB日志在完成/失败后写入；运行中状态从Redis进度合并展示，刷新页面也不会丢。
    if (parseInt(page, 10) === 1 && (!taskType || taskType === "target_calculate") && (!status || status === "running")) {
      try {
        const targetProgressList = await getTargetProgressList();
        virtualRunningLogs = targetProgressList
          .filter((progress) => progress.status === "running")
          .map((progress) => {
            const startedAt = progress.startedAt || progress.updatedAt || new Date().toISOString();
            const durationMs = progress.startedAt ? Date.now() - new Date(progress.startedAt).getTime() : null;
            return {
              id: `target-running-${progress.runId}`,
              taskType: "target_calculate",
              status: "running",
              targetId: progress.rankSet || null,
              itemsCount: progress.rankedCount || progress.candidateCount || null,
              durationMs,
              snapshotId: progress.runId || null,
              errorMessage: null,
              failedDetails: {
                stage: progress.stage,
                sourceRankSet: progress.sourceRankSet,
                processedSourceUsers: progress.processedSourceUsers,
                totalSourceUsers: progress.totalSourceUsers,
              },
              createdAt: startedAt,
              updatedAt: progress.updatedAt || startedAt,
            };
          });
      } catch (e) {
        console.warn("[crawl/logs] 合并目标用户运行进度失败:", e.message);
      }
    }

    const mergedData = [...virtualRunningLogs, ...data].slice(0, parseInt(pageSize, 10));

    res.json(success({
      total: count + virtualRunningLogs.length,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      data: mergedData,
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
        where: { taskType: "post" },
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

    // 通知独立爬虫服务清除缓存（通过 Redis）
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
