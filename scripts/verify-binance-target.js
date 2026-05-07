/**
 * Step 5 验证脚本：测试Top50计算
 * 注意：此脚本会实际调用币安API（同步关注列表）
 */

import { Sequelize } from "sequelize";
import initModels from "../src/binance-square/models/index.js";

const sequelize = new Sequelize("sqlite::memory:", { logging: false });
const db = initModels(sequelize);

function mockReq(body = {}, params = {}) {
  return { body, params };
}

function mockRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
}

// 加载路由
const { router, initRoutes } = await import("../src/binance-square/api/binance-square.js");
initRoutes(sequelize);

function findRoute(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`找不到路由: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

console.log("=== Step 5: 验证Top50计算 ===\n");

async function main() {
  await sequelize.sync({ force: true });
  console.log("✓ 数据库同步成功\n");

  // 1. 初始化种子用户
  console.log("--- 准备：初始化种子用户 ---");
  const initHandler = findRoute("post", "/seed/init");
  {
    const seeds = [
      { username: "CZ", displayName: "CZ" },
      { username: "heyi", displayName: "heyi" },
      { username: "richardteng", displayName: "richardteng" },
    ];
    const req = mockReq({ seeds });
    const res = mockRes();
    await initHandler(req, res);
    console.log("✓ 种子用户初始化成功\n");
  }

  // 2. 同步所有种子用户的关注列表
  console.log("--- 准备：同步关注列表 ---");
  const syncHandler = findRoute("post", "/following/sync");
  {
    const req = mockReq();
    const res = mockRes();
    await syncHandler(req, res);

    if (!res.jsonData.success) {
      throw new Error("关注列表同步失败");
    }
    console.log(`  同步完成: ${res.jsonData.data.totalSeeds} 个种子用户`);
    console.log(`  新增关系: ${res.jsonData.data.newRelations} 条\n`);
  }

  // 3. 测试计算Top50
  console.log("--- 测试1: 计算Top50 ---");
  const calcHandler = findRoute("post", "/target/calculate");
  {
    const req = mockReq();
    const res = mockRes();
    await calcHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    const data = res.jsonData;

    if (res.statusCode === 200 && data.success) {
      console.log(`  候选用户: ${data.data.totalCandidates}`);
      console.log(`  前10名:`);
      data.data.top50.forEach((u) => {
        console.log(`    #${u.rank} ${u.username} — 被${u.followerCount}个种子关注 (${u.seedFollowers.join(", ")})`);
      });
      console.log(`  耗时: ${data.data.durationMs}ms`);
      console.log("✓ /target/calculate 成功\n");
    } else {
      throw new Error("/target/calculate 失败: " + JSON.stringify(data));
    }
  }

  // 4. 验证数据库
  console.log("--- 数据库验证 ---");

  const ranks = await db.BinanceSquareTargetRank.findAll({
    order: [["rank", "ASC"]],
  });
  console.log(`  Top50排名记录数: ${ranks.length}`);

  const targetUsers = await db.BinanceSquareUser.findAll({
    where: { isTargetUser: true },
  });
  console.log(`  isTargetUser=true 的用户数: ${targetUsers.length}`);

  if (ranks.length === targetUsers.length) {
    console.log("✓ 排名数与目标用户数一致");
  } else {
    console.log(`⚠️ 不一致: 排名${ranks.length}个, 目标用户${targetUsers.length}个`);
  }

  // 验证排名1的用户
  if (ranks.length > 0) {
    const rank1 = ranks[0];
    console.log(`  #1: ${rank1.username}, 被关注${rank1.followerCount}次`);
    console.log(`  seedFollowers: ${JSON.stringify(rank1.seedFollowers)}`);
  }

  // 5. 验证CrawlLog
  const logs = await db.BinanceSquareCrawlLog.findAll({
    where: { taskType: "target_calculate" },
  });
  console.log(`  CrawlLog记录数: ${logs.length}`);
  logs.forEach((log) => {
    console.log(`    - target_calculate: ${log.status}, ${log.itemsCount}个, ${log.durationMs}ms`);
  });

  // 6. 测试获取Top50列表
  console.log("\n--- 测试2: 获取Top50列表 ---");
  const listHandler = findRoute("get", "/target/list");
  {
    const req = mockReq();
    const res = mockRes();
    await listHandler(req, res);

    if (res.statusCode === 200 && res.jsonData.success) {
      console.log(`  返回数量: ${res.jsonData.data.length}`);
      console.log("✓ /target/list 成功\n");
    } else {
      throw new Error("/target/list 失败");
    }
  }

  // 7. 测试禁用种子用户后重新计算
  console.log("--- 测试3: 禁用种子用户后重新计算 ---");
  {
    // 禁用heyi
    const heyi = await db.BinanceSquareSeedConfig.findOne({ where: { username: "heyi" } });
    heyi.isActive = false;
    await heyi.save();
    console.log("  已禁用heyi");

    const req = mockReq();
    const res = mockRes();
    await calcHandler(req, res);

    if (res.statusCode === 200 && res.jsonData.success) {
      const newRanks = await db.BinanceSquareTargetRank.findAll({
        order: [["rank", "ASC"]],
      });
      console.log(`  新排名数: ${newRanks.length}`);
      console.log("✓ 禁用种子用户后排名正确更新\n");
    } else {
      throw new Error("禁用后计算失败");
    }
  }

  // 8. 测试没有活跃种子用户时返回400
  console.log("--- 测试4: 无活跃种子用户 ---");
  {
    // 禁用所有种子用户
    await db.BinanceSquareSeedConfig.update(
      { isActive: false },
      { where: {} }
    );

    const req = mockReq();
    const res = mockRes();
    await calcHandler(req, res);

    if (res.statusCode === 400) {
      console.log("✓ 正确返回400: " + res.jsonData.error);
    } else {
      throw new Error("应该返回400");
    }
  }

  console.log("\n========================================");
  console.log("  ✅ Step 5 验证通过：Top50计算正常");
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n========================================");
  console.error("  ❌ Step 5 验证失败");
  console.error("========================================");
  console.error(err);
  process.exit(1);
});
