const express = require("express");
const { Op } = require("sequelize");

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

    res.json(success(seeds));
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

  try {
    // 1. 调用API获取关注列表
    const result = await apiClient.fetchFollowingList(targetUsername);
    const { followers, total } = result;

    // 2. 对比数量，不一致标记为partial
    if (followers.length !== total) {
      status = "partial";
      console.warn(`[following/sync] ${targetUsername}: 抓取${followers.length}条, API返回total=${total}`);
    }

    // 3. 准备用户数据（upsert）
    const userRecords = followers.map((f) => ({
      username: f.username,
      displayName: f.displayName || null,
      squareUid: f.squareUid || null,
      avatar: f.avatar || null,
      biography: f.biography || null,
      role: f.role || null,
      verificationType: f.verificationType || null,
      verificationDescription: f.verificationDescription || null,
      totalFollowerCount: f.totalFollowerCount || null,
      totalFollowingCount: f.totalFollowCount || null,
      totalPostCount: f.totalPostCount || null,
      totalLikeCount: f.totalLikeCount || null,
      totalShareCount: f.totalShareCount || null,
      accountLang: f.accountLang || null,
      isKol: f.isKol || null,
      userStatus: f.userStatus || null,
      level: f.level || null,
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

    // 5. 批量写入（事务）
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

    // 6. 统计新增数量
    const existingUsers = await db.BinanceSquareUser.count({
      where: { username: { [Op.in]: followers.map((f) => f.username) } },
    });
    const newUsers = followers.length - existingUsers;

    const durationMs = Date.now() - startTime;

    return {
      username: targetUsername,
      total,
      fetched: followers.length,
      newUsers: Math.max(0, newUsers),
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

// 导出路由和初始化函数
module.exports = { router, initRoutes };
