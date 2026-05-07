/**
 * Step 3 验证脚本：测试种子用户管理API
 */

import { Sequelize } from "sequelize";
import initModels from "../src/binance-square/models/index.js";

const sequelize = new Sequelize("sqlite::memory:", { logging: false });
const db = initModels(sequelize);

// 模拟Express req/res对象
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

// 找到对应路由的处理函数
function findRoute(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`找不到路由: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

console.log("=== Step 3: 验证种子用户管理API ===\n");

async function main() {
  // 先同步数据库
  await sequelize.sync({ force: true });
  console.log("✓ 数据库同步成功\n");

  // 测试1: POST /seed/init
  console.log("--- 测试1: 初始化种子用户 ---");
  const initHandler = findRoute("post", "/seed/init");
  const seeds = [
    { username: "CZ", displayName: "CZ" },
    { username: "heyi", displayName: "heyi" },
    { username: "richardteng", displayName: "richardteng" },
  ];

  {
    const req = mockReq({ seeds });
    const res = mockRes();
    await initHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    console.log(`  响应: ${JSON.stringify(res.jsonData)}`);

    if (res.statusCode === 200 && res.jsonData.success) {
      console.log("✓ /seed/init 成功");
    } else {
      throw new Error("/seed/init 失败");
    }
  }

  // 验证数据库
  const configs = await db.BinanceSquareSeedConfig.findAll();
  console.log(`  SeedConfig记录数: ${configs.length}`);

  const users = await db.BinanceSquareUser.findAll({ where: { isSeedUser: true } });
  console.log(`  Users种子记录数: ${users.length}`);

  if (configs.length !== 3 || users.length !== 3) {
    throw new Error("数据写入不完整");
  }
  console.log("✓ 数据写入正确\n");

  // 测试2: GET /seed/list
  console.log("--- 测试2: 获取种子用户列表 ---");
  const listHandler = findRoute("get", "/seed/list");
  {
    const req = mockReq();
    const res = mockRes();
    await listHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    if (res.statusCode === 200 && res.jsonData.success) {
      console.log(`  列表数量: ${res.jsonData.data.length}`);
      console.log("✓ /seed/list 成功");
    } else {
      throw new Error("/seed/list 失败");
    }
  }

  // 测试3: POST /seed/add
  console.log("\n--- 测试3: 添加种子用户 ---");
  const addHandler = findRoute("post", "/seed/add");
  {
    const req = mockReq({ username: "justinsun", displayName: "justinsun" });
    const res = mockRes();
    await addHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    console.log(`  响应: ${JSON.stringify(res.jsonData)}`);

    if (res.statusCode === 200 && res.jsonData.success) {
      console.log("✓ /seed/add 成功");
    } else {
      throw new Error("/seed/add 失败");
    }
  }

  // 验证新增
  const configsAfterAdd = await db.BinanceSquareSeedConfig.findAll();
  console.log(`  SeedConfig记录数: ${configsAfterAdd.length}`);
  if (configsAfterAdd.length !== 4) {
    throw new Error("添加后数量不对");
  }

  // 测试4: 重复添加（唯一索引冲突）
  console.log("\n--- 测试4: 重复添加（幂等性） ---");
  {
    const req = mockReq({ username: "CZ", displayName: "CZ_updated" });
    const res = mockRes();
    await addHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    if (res.statusCode === 500) {
      console.log("✓ 重复添加被正确拦截（唯一索引生效）");
    } else {
      // Sequelize的bulkCreate updateOnDuplicate不会报错，但findOrCreate会
      console.log(`  注意: 响应状态 ${res.statusCode}`);
    }
  }

  // 测试5: POST /seed/remove
  console.log("\n--- 测试5: 移除种子用户 ---");
  const removeHandler = findRoute("post", "/seed/remove");
  {
    const req = mockReq({ username: "heyi" });
    const res = mockRes();
    await removeHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    console.log(`  响应: ${JSON.stringify(res.jsonData)}`);

    if (res.statusCode === 200 && res.jsonData.success) {
      console.log("✓ /seed/remove 成功");
    } else {
      throw new Error("/seed/remove 失败");
    }
  }

  // 验证移除后状态
  const removedSeed = await db.BinanceSquareSeedConfig.findOne({ where: { username: "heyi" } });
  if (removedSeed && !removedSeed.isActive) {
    console.log("✓ heyi已标记为inactive");
  } else {
    throw new Error("移除后isActive未变更");
  }

  // 测试6: 移除不存在的用户
  console.log("\n--- 测试6: 移除不存在的用户 ---");
  {
    const req = mockReq({ username: "not_exist" });
    const res = mockRes();
    await removeHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    if (res.statusCode === 404) {
      console.log("✓ 不存在的用户返回404");
    } else {
      throw new Error("应该返回404");
    }
  }

  console.log("\n========================================");
  console.log("  ✅ Step 3 验证通过：种子用户管理API正常");
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n========================================");
  console.error("  ❌ Step 3 验证失败");
  console.error("========================================");
  console.error(err);
  process.exit(1);
});
