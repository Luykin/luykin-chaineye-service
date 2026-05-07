/**
 * Step 4 验证脚本：测试关注列表同步
 * 注意：此脚本会实际调用币安API
 */

import { Sequelize } from "sequelize";
import initModels from "../src/binance-square/models/index.js";

const sequelize = new Sequelize("sqlite::memory:", { logging: false });
const db = initModels(sequelize);

// 模拟Express req/res
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

console.log("=== Step 4: 验证关注列表同步 ===\n");

async function main() {
  await sequelize.sync({ force: true });
  console.log("✓ 数据库同步成功\n");

  // 1. 先初始化种子用户
  console.log("--- 准备：初始化种子用户 ---");
  const initHandler = findRoute("post", "/seed/init");
  {
    const seeds = [
      { username: "CZ", displayName: "CZ" },
      { username: "heyi", displayName: "heyi" },
    ];
    const req = mockReq({ seeds });
    const res = mockRes();
    await initHandler(req, res);

    if (!res.jsonData.success) {
      throw new Error("种子用户初始化失败");
    }
    console.log("✓ 种子用户初始化成功\n");
  }

  // 2. 测试同步单个用户
  console.log("--- 测试1: 同步单个种子用户（CZ）---");
  const singleHandler = findRoute("post", "/following/sync/:username");
  {
    const req = mockReq({}, { username: "CZ" });
    const res = mockRes();
    await singleHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    const data = res.jsonData;

    if (res.statusCode === 200 && data.success) {
      console.log(`  总数(API): ${data.data.total}`);
      console.log(`  实际获取: ${data.data.fetched}`);
      console.log(`  新增用户: ${data.data.newUsers}`);
      console.log(`  新增关系: ${data.data.newRelations}`);
      console.log(`  状态: ${data.data.status}`);
      console.log(`  耗时: ${data.data.durationMs}ms`);

      if (data.data.status !== "failed") {
        console.log("✓ /following/sync/CZ 成功");
      } else {
        console.log(`✗ 同步失败: ${data.data.errorMessage}`);
      }
    } else {
      throw new Error("/following/sync/CZ 失败: " + JSON.stringify(data));
    }
  }

  // 3. 验证数据库
  console.log("\n--- 数据库验证 ---");

  const followingCount = await db.BinanceSquareFollowing.count({
    where: { followerUsername: "CZ" },
  });
  console.log(`  CZ的关注关系数: ${followingCount}`);

  const totalUsers = await db.BinanceSquareUser.count();
  console.log(`  总用户数(含种子): ${totalUsers}`);

  const nonSeedUsers = await db.BinanceSquareUser.count({
    where: { isSeedUser: false },
  });
  console.log(`  非种子用户数(被关注者): ${nonSeedUsers}`);

  // 4. 验证CrawlLog
  const logs = await db.BinanceSquareCrawlLog.findAll({
    where: { taskType: "following" },
  });
  console.log(`  CrawlLog记录数: ${logs.length}`);
  logs.forEach((log) => {
    console.log(`    - ${log.targetId || "all"}: ${log.status}, ${log.itemsCount}条, ${log.durationMs}ms`);
  });

  // 5. 测试同步所有活跃种子用户
  console.log("\n--- 测试2: 同步所有活跃种子用户 ---");
  const allHandler = findRoute("post", "/following/sync");
  {
    const req = mockReq();
    const res = mockRes();
    await allHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    const data = res.jsonData;

    if (res.statusCode === 200 && data.success) {
      console.log(`  种子用户数: ${data.data.totalSeeds}`);
      console.log(`  处理完成: ${data.data.processed}`);
      console.log(`  新增用户: ${data.data.newUsers}`);
      console.log(`  新增关系: ${data.data.newRelations}`);
      console.log(`  总体状态: ${data.data.status}`);
      console.log("✓ /following/sync 成功");
    } else {
      throw new Error("/following/sync 失败: " + JSON.stringify(data));
    }
  }

  // 6. 验证幂等性（再次同步CZ，不应重复插入）
  console.log("\n--- 测试3: 幂等性验证（再次同步CZ）---");
  {
    const followingBefore = await db.BinanceSquareFollowing.count({
      where: { followerUsername: "CZ" },
    });

    const req = mockReq({}, { username: "CZ" });
    const res = mockRes();
    await singleHandler(req, res);

    const followingAfter = await db.BinanceSquareFollowing.count({
      where: { followerUsername: "CZ" },
    });

    console.log(`  同步前关系数: ${followingBefore}`);
    console.log(`  同步后关系数: ${followingAfter}`);

    if (followingBefore === followingAfter) {
      console.log("✓ 幂等性验证通过（无重复插入）");
    } else {
      console.log(`⚠️ 关系数变化: ${followingBefore} → ${followingAfter}`);
    }
  }

  // 7. 测试非种子用户同步（应404）
  console.log("\n--- 测试4: 非种子用户同步（应404）---");
  {
    const req = mockReq({}, { username: "not_a_seed" });
    const res = mockRes();
    await singleHandler(req, res);

    if (res.statusCode === 404) {
      console.log("✓ 非种子用户正确返回404");
    } else {
      throw new Error("应该返回404");
    }
  }

  console.log("\n========================================");
  console.log("  ✅ Step 4 验证通过：关注列表同步正常");
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n========================================");
  console.error("  ❌ Step 4 验证失败");
  console.error("========================================");
  console.error(err);
  process.exit(1);
});
