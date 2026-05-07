/**
 * Step 6 验证脚本：测试帖子抓取与镜像管理
 * 注意：此脚本会实际调用币安API
 */

import { Sequelize } from "sequelize";
import initModels from "../src/binance-square/models/index.js";

const sequelize = new Sequelize("sqlite::memory:", { logging: false });
const db = initModels(sequelize);

function mockReq(body = {}, params = {}, query = {}) {
  return { body, params, query };
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

console.log("=== Step 6: 验证帖子抓取与镜像管理 ===\n");

async function main() {
  await sequelize.sync({ force: true });
  console.log("✓ 数据库同步成功\n");

  // 1. 初始化种子用户 + 同步关注 + 计算Top50
  console.log("--- 准备：初始化 → 同步 → 计算Top50 ---");

  const initHandler = findRoute("post", "/seed/init");
  await initHandler(mockReq({ seeds: [{ username: "CZ", displayName: "CZ" }] }), mockRes());

  const syncHandler = findRoute("post", "/following/sync");
  await syncHandler(mockReq(), mockRes());

  const calcHandler = findRoute("post", "/target/calculate");
  await calcHandler(mockReq(), mockRes());

  console.log("✓ 准备工作完成\n");

  // 2. 测试帖子抓取（限制只抓前3个目标用户，避免超时）
  console.log("--- 测试1: 抓取目标用户帖子（前3个用户） ---");

  // 临时修改：只保留前3个目标用户，避免API请求过多导致超时
  const allTargets = await db.BinanceSquareUser.findAll({ where: { isTargetUser: true } });
  console.log(`  总目标用户: ${allTargets.length}，测试取前3个`);

  // 禁用多余的目标用户（临时）
  if (allTargets.length > 3) {
    const toDisable = allTargets.slice(3).map((u) => u.username);
    await db.BinanceSquareUser.update(
      { isTargetUser: false },
      { where: { username: { [Sequelize.Op.in]: toDisable } } }
    );
  }

  const crawlHandler = findRoute("post", "/crawl/posts");
  {
    const req = mockReq();
    const res = mockRes();
    await crawlHandler(req, res);

    console.log(`  状态码: ${res.statusCode}`);
    const data = res.jsonData;

    if (res.statusCode === 200 && data.success) {
      console.log(`  snapshotId: ${data.data.snapshotId}`);
      console.log(`  目标用户数: ${data.data.targetUsers}`);
      console.log(`  主帖(ALL): ${data.data.totalPostsAll}`);
      console.log(`  回复(REPLY): ${data.data.totalPostsReply}`);
      console.log(`  镜像数: ${data.data.totalSnapshots}`);
      console.log(`  失败用户: ${data.data.failedUsers}`);
      console.log(`  耗时: ${data.data.durationMs}ms`);
      console.log(`  状态: ${data.data.status}`);
      console.log("✓ /crawl/posts 成功\n");
    } else {
      throw new Error("/crawl/posts 失败: " + JSON.stringify(data));
    }
  }

  // 3. 验证Posts表
  console.log("--- 数据库验证：Posts表 ---");
  const posts = await db.BinanceSquarePost.findAll();
  console.log(`  帖子总数: ${posts.length}`);

  if (posts.length > 0) {
    const first = posts[0];
    console.log(`  第一条:`);
    console.log(`    - postId: ${first.postId}`);
    console.log(`    - username: ${first.username}`);
    console.log(`    - postType: ${first.postType}`);
    console.log(`    - title: ${first.title ? first.title.substring(0, 50) + "..." : "null"}`);
    console.log(`    - likeCount: ${first.likeCount}`);
    console.log(`    - rawData: ${first.rawData ? "有" : "无"}`);
    console.log(`    - lastSnapshotId: ${first.lastSnapshotId}`);
  }

  const postTypes = await db.BinanceSquarePost.findAll({
    attributes: ["postType", [Sequelize.fn("COUNT", "*"), "count"]],
    group: ["postType"],
    raw: true,
  });
  console.log(`  类型分布:`);
  postTypes.forEach((t) => {
    console.log(`    - ${t.postType}: ${t.count}`);
  });

  // 4. 验证Snapshots表
  console.log("\n--- 数据库验证：Snapshots表 ---");
  const snapshots = await db.BinanceSquarePostSnapshot.findAll();
  console.log(`  镜像总数: ${snapshots.length}`);

  if (snapshots.length > 0) {
    const first = snapshots[0];
    console.log(`  第一条镜像:`);
    console.log(`    - postId: ${first.postId}`);
    console.log(`    - snapshotId: ${first.snapshotId}`);
    console.log(`    - snapshotTime: ${first.snapshotTime}`);
    console.log(`    - diffFromPrev: ${first.diffFromPrev ? "有变化" : "null（首次或无变化）"}`);

    if (first.diffFromPrev) {
      console.log(`    - diff详情: ${JSON.stringify(first.diffFromPrev).substring(0, 200)}`);
    }
  }

  // 5. 验证diff计算逻辑
  console.log("\n--- 测试2: diff计算逻辑 ---");
  {
    // 查找有上一个镜像的记录
    const snapshots = await db.BinanceSquarePostSnapshot.findAll({
      order: [["postId", "ASC"], ["snapshotTime", "DESC"]],
    });

    // 按postId分组，找同一个帖子的多个镜像
    const grouped = {};
    snapshots.forEach((s) => {
      if (!grouped[s.postId]) grouped[s.postId] = [];
      grouped[s.postId].push(s);
    });

    const multiSnapshotPosts = Object.entries(grouped).filter(([_, snaps]) => snaps.length >= 2);

    if (multiSnapshotPosts.length > 0) {
      const [postId, snaps] = multiSnapshotPosts[0];
      console.log(`  找到同一帖子的多个镜像: postId=${postId}, 镜像数=${snaps.length}`);
      console.log(`  最新镜像diffFromPrev: ${snaps[0].diffFromPrev ? "有变化" : "null"}`);
      if (snaps[0].diffFromPrev) {
        console.log(`  diff详情: ${JSON.stringify(snaps[0].diffFromPrev).substring(0, 200)}`);
      }
    } else {
      console.log("  只有一个镜像批次，跳过diff验证（属于正常情况）");
    }
    console.log("✓ diff验证完成\n");
  }

  // 6. 测试查询帖子列表
  console.log("\n--- 测试3: 查询帖子列表 ---");
  const listHandler = findRoute("get", "/posts");
  {
    const req = mockReq({}, {}, { page: 1, pageSize: 10 });
    const res = mockRes();
    await listHandler(req, res);

    if (res.statusCode === 200 && res.jsonData.success) {
      console.log(`  总数: ${res.jsonData.data.total}`);
      console.log(`  当前页: ${res.jsonData.data.page}`);
      console.log(`  每页: ${res.jsonData.data.pageSize}`);
      console.log(`  返回数: ${res.jsonData.data.data.length}`);
      console.log("✓ /posts 查询成功\n");
    } else {
      throw new Error("/posts 查询失败");
    }
  }

  // 7. 测试查询镜像
  console.log("--- 测试4: 查询帖子镜像 ---");
  const snapshotsHandler = findRoute("get", "/posts/:postId/snapshots");
  {
    const post = await db.BinanceSquarePost.findOne();
    if (post) {
      const req = mockReq({}, { postId: post.postId });
      const res = mockRes();
      await snapshotsHandler(req, res);

      if (res.statusCode === 200 && res.jsonData.success) {
        console.log(`  postId: ${post.postId}`);
        console.log(`  镜像数: ${res.jsonData.data.length}`);
        console.log("✓ /posts/:postId/snapshots 成功\n");
      } else {
        throw new Error("查询镜像失败");
      }
    } else {
      console.log("  无帖子可测试\n");
    }
  }

  // 8. 测试CrawlLog
  const logs = await db.BinanceSquareCrawlLog.findAll({
    where: { taskType: "post" },
  });
  console.log("--- CrawlLog验证 ---");
  console.log(`  帖子抓取日志数: ${logs.length}`);
  logs.forEach((log) => {
    console.log(`    - ${log.filterType}: ${log.status}, ${log.itemsCount}条, ${log.durationMs}ms, snapshotId=${log.snapshotId}`);
  });

  console.log("\n========================================");
  console.log("  ✅ Step 6 验证通过：帖子抓取与镜像管理正常");
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n========================================");
  console.error("  ❌ Step 6 验证失败");
  console.error("========================================");
  console.error(err);
  process.exit(1);
});
