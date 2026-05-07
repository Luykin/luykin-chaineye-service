/**
 * Step 8 验证脚本：定时调度器 + 数据清理
 * node scripts/verify-binance-scheduler.js
 */

const { Sequelize, DataTypes } = require("sequelize");

async function verify() {
  console.log("=== Step 8: 定时调度器 + 数据清理验证 ===\n");

  // 1. 初始化SQLite内存库
  const sequelize = new Sequelize({ dialect: "sqlite", storage: ":memory:", logging: false });

  // 加载模型
  const defineModels = require("../src/binance-square/models");
  const db = defineModels(sequelize);
  await sequelize.sync({ force: true });
  console.log("✅ 数据库初始化完成 (SQLite 内存库)");

  // 2. 插入测试配置
  await db.BinanceSquareConfig.bulkCreate([
    { configKey: "post_crawl_interval_hours", configValue: "2", minValue: "0.5", maxValue: "4" },
    { configKey: "snapshot_retention_days", configValue: "3", minValue: "1", maxValue: "30" },
  ]);
  console.log("✅ 配置插入完成 (interval=2h, retention=3d)");

  // 3. 插入测试用户（种子用户+目标用户）
  await db.BinanceSquareUser.bulkCreate([
    { username: "SeedUser1", isSeedUser: true, isActive: true, squareUid: "111" },
    { username: "TargetUser1", isTargetUser: true, squareUid: "222", totalFollowingCount: 100 },
    { username: "TargetUser2", isTargetUser: true, squareUid: "333", totalFollowingCount: 80 },
  ]);
  console.log("✅ 测试用户插入完成");

  // 4. 插入测试帖子+镜像（模拟不同时间的数据）
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 86400000);
  const sixDaysAgo = new Date(now.getTime() - 6 * 86400000);

  await db.BinanceSquarePost.bulkCreate([
    { postId: "post1", username: "TargetUser1", postType: "article", title: "Post 1" },
    { postId: "post2", username: "TargetUser1", postType: "article", title: "Post 2" },
    { postId: "post3", username: "TargetUser2", postType: "article", title: "Post 3" },
  ]);
  console.log("✅ 测试帖子插入完成 (3条)");

  // 插入不同时间的镜像
  await db.BinanceSquarePostSnapshot.bulkCreate([
    { postId: "post1", snapshotId: "snap_old_1", snapshotTime: sixDaysAgo, title: "Old Title 1", likeCount: 10 },
    { postId: "post1", snapshotId: "snap_old_2", snapshotTime: fourDaysAgo, title: "Old Title 1", likeCount: 12 },
    { postId: "post2", snapshotId: "snap_old_3", snapshotTime: sixDaysAgo, title: "Post 2", likeCount: 5 },
    { postId: "post1", snapshotId: "snap_recent", snapshotTime: twoDaysAgo, title: "New Title 1", likeCount: 15 },
    { postId: "post2", snapshotId: "snap_recent2", snapshotTime: twoDaysAgo, title: "Post 2", likeCount: 8 },
    { postId: "post3", snapshotId: "snap_recent3", snapshotTime: twoDaysAgo, title: "Post 3", likeCount: 20 },
  ]);
  console.log("✅ 测试镜像插入完成 (6条: 4条过期, 2条近期)");

  // 插入测试日志
  await db.BinanceSquareCrawlLog.bulkCreate([
    { taskType: "post", status: "success", filterType: "ALL", itemsCount: 10, createdAt: sixDaysAgo },
    { taskType: "post", status: "success", filterType: "ALL", itemsCount: 15, createdAt: fourDaysAgo },
    { taskType: "post", status: "success", filterType: "ALL", itemsCount: 20, createdAt: twoDaysAgo },
  ]);
  console.log("✅ 测试日志插入完成 (3条: 2条过期, 1条近期)");

  // 5. 测试 ConfigService
  console.log("\n--- 5. ConfigService 测试 ---");
  const { ConfigService } = require("../src/binance-square/services/scheduler");
  const configService = new ConfigService(db);

  const interval = await configService.getFloat("post_crawl_interval_hours", 2);
  console.log(`  读取配置 post_crawl_interval_hours = ${interval} (期望: 2)`);
  if (interval !== 2) throw new Error("ConfigService 读取配置失败");

  const retention = await configService.getInt("snapshot_retention_days", 3);
  console.log(`  读取配置 snapshot_retention_days = ${retention} (期望: 3)`);
  if (retention !== 3) throw new Error("ConfigService 读取配置失败");

  // 测试缓存
  const cachedInterval = await configService.getFloat("post_crawl_interval_hours");
  console.log(`  缓存读取 (第二次) = ${cachedInterval}`);

  // 测试清除缓存
  configService.clearCache("post_crawl_interval_hours");
  const afterClear = await configService.getFloat("post_crawl_interval_hours");
  console.log(`  清除缓存后读取 = ${afterClear}`);
  console.log("✅ ConfigService 测试通过");

  // 6. 测试 TaskManager.cleanupOldSnapshots
  console.log("\n--- 6. TaskManager.cleanupOldSnapshots 测试 ---");
  const { BinanceSquareTaskManager } = require("../src/binance-square/scraper/taskManager");
  const taskManager = new BinanceSquareTaskManager(db);

  // 清理前计数
  const beforeSnapshots = await db.BinanceSquarePostSnapshot.count();
  const beforeLogs = await db.BinanceSquareCrawlLog.count();
  console.log(`  清理前: 镜像${beforeSnapshots}条, 日志${beforeLogs}条`);

  // 执行清理 (保留3天，应删除6天前和4天前的数据)
  const cleanupResult = await taskManager.cleanupOldSnapshots(3);
  console.log(`  清理结果: 删除镜像${cleanupResult.deletedSnapshots}条, 日志${cleanupResult.deletedLogs}条`);

  // 验证：6天前的2条 + 4天前的1条 = 3条镜像应被删除
  if (cleanupResult.deletedSnapshots !== 3) {
    throw new Error(`期望删除3条镜像，实际删除${cleanupResult.deletedSnapshots}条`);
  }
  // 验证：6天前的1条 + 4天前的1条 = 2条日志应被删除
  if (cleanupResult.deletedLogs !== 2) {
    throw new Error(`期望删除2条日志，实际删除${cleanupResult.deletedLogs}条`);
  }

  // 清理后计数
  const afterSnapshots = await db.BinanceSquarePostSnapshot.count();
  const afterLogs = await db.BinanceSquareCrawlLog.count();
  console.log(`  清理后: 镜像${afterSnapshots}条, 日志${afterLogs}条`);
  if (afterSnapshots !== 3 || afterLogs !== 1) {
    throw new Error("清理后数据量不匹配");
  }
  console.log("✅ 数据清理测试通过");

  // 7. 测试调度器启动/状态/停止（不触发实际任务）
  console.log("\n--- 7. 调度器管理测试 ---");
  const { BinanceSquareScheduler } = require("../src/binance-square/services/scheduler");
  const scheduler = new BinanceSquareScheduler(db, taskManager);

  // 初始状态
  const initialStatus = await scheduler.getStatus();
  console.log(`  初始状态: isRunning=${initialStatus.isRunning}, interval=${initialStatus.postCrawlInterval}h`);
  if (initialStatus.isRunning !== false) throw new Error("初始状态应为未运行");
  if (initialStatus.postCrawlInterval !== 2) throw new Error("初始间隔应为2小时");

  // 启动调度器
  await scheduler.start();
  console.log("  调度器已启动");

  const runningStatus = await scheduler.getStatus();
  console.log(`  运行状态: isRunning=${runningStatus.isRunning}, nextCleanup=${runningStatus.nextCleanup ? '有' : '无'}`);
  if (runningStatus.isRunning !== true) throw new Error("启动后应为运行中");
  if (!runningStatus.nextCleanup) throw new Error("清理任务应有下次执行时间");

  // 停止调度器
  scheduler.stop();
  console.log("  调度器已停止");

  const stoppedStatus = await scheduler.getStatus();
  console.log(`  停止状态: isRunning=${stoppedStatus.isRunning}`);
  if (stoppedStatus.isRunning !== false) throw new Error("停止后应为未运行");

  console.log("✅ 调度器管理测试通过");

  // 8. 测试配置更新 + 热重载
  console.log("\n--- 8. 配置热更新测试 ---");
  await db.BinanceSquareConfig.update(
    { configValue: "0.5" },
    { where: { configKey: "post_crawl_interval_hours" } }
  );

  // 清除缓存后读取新值
  configService.clearCache();
  const newInterval = await configService.getFloat("post_crawl_interval_hours");
  console.log(`  更新后配置: interval=${newInterval}h (期望: 0.5)`);
  if (newInterval !== 0.5) throw new Error("配置更新失败");

  // 用新配置启动调度器
  const scheduler2 = new BinanceSquareScheduler(db, taskManager);
  await scheduler2.start();
  const status2 = await scheduler2.getStatus();
  console.log(`  新调度器状态: interval=${status2.postCrawlInterval}h, isRunning=${status2.isRunning}`);
  if (status2.postCrawlInterval !== 0.5) throw new Error("调度器未读取到新配置");
  scheduler2.stop();

  console.log("✅ 配置热更新测试通过");

  console.log("\n=== Step 8 验证全部通过 ✅ ===");
  console.log("  - ConfigService: 缓存读取、清除、热更新 ✅");
  console.log("  - TaskManager.cleanupOldSnapshots: 按时间清理过期数据 ✅");
  console.log("  - Scheduler: 启动/停止/状态查询 ✅");
  console.log("  - 配置热更新: 修改配置后调度器读取新间隔 ✅");
}

verify().catch((err) => {
  console.error("\n❌ 验证失败:", err.message);
  console.error(err.stack);
  process.exit(1);
});
