/**
 * Step 1 验证脚本：检查币安广场模型定义
 * 不依赖真实数据库连接，仅验证模型文件语法和结构
 */

import { Sequelize } from "sequelize";
import initModels from "../src/binance-square/models/index.js";

// 使用 SQLite 内存模式验证模型定义（不依赖远程PG）
const sequelize = new Sequelize("sqlite::memory:", { logging: false });

console.log("=== Step 1: 验证币安广场模型定义 ===\n");

try {
  // 1. 加载所有模型
  const db = initModels(sequelize);

  const expectedModels = [
    "BinanceSquareUser",
    "BinanceSquareFollowing",
    "BinanceSquareSeedConfig",
    "BinanceSquareTargetRank",
    "BinanceSquarePost",
    "BinanceSquarePostSnapshot",
    "BinanceSquareCrawlLog",
    "BinanceSquareConfig",
  ];

  console.log("✅ 模型加载成功");
  console.log(`   共 ${Object.keys(db).length} 个模型`);

  // 2. 检查每个模型是否存在
  let allModelsExist = true;
  for (const name of expectedModels) {
    if (db[name]) {
      console.log(`   ✓ ${name}`);
    } else {
      console.log(`   ✗ ${name} —— 缺失!`);
      allModelsExist = false;
    }
  }

  if (!allModelsExist) {
    throw new Error("部分模型缺失");
  }

  // 3. 检查关键字段
  console.log("\n--- 字段约束检查 ---");

  // Users表：username必须not null
  const userAttrs = db.BinanceSquareUser.rawAttributes;
  if (userAttrs.username.allowNull === false) {
    console.log("✓ BinanceSquareUser.username: allowNull=false");
  } else {
    throw new Error("BinanceSquareUser.username 应该 allowNull=false");
  }

  // Users表：squareUid允许null（API字段）
  if (userAttrs.squareUid.allowNull !== false) {
    console.log("✓ BinanceSquareUser.squareUid: 允许null（符合API字段原则）");
  } else {
    throw new Error("BinanceSquareUser.squareUid 不应该 allowNull=false");
  }

  // Users表：totalFollowerCount没有defaultValue
  if (userAttrs.totalFollowerCount.defaultValue === undefined) {
    console.log("✓ BinanceSquareUser.totalFollowerCount: 无defaultValue（符合设计原则）");
  } else {
    throw new Error("BinanceSquareUser.totalFollowerCount 不应该有defaultValue");
  }

  // Following表：联合唯一索引
  const followingAttrs = db.BinanceSquareFollowing.rawAttributes;
  if (followingAttrs.followerUsername.allowNull === false && followingAttrs.followingUsername.allowNull === false) {
    console.log("✓ BinanceSquareFollowing: followerUsername + followingUsername = not null");
  }

  // Post表：postId必须not null
  const postAttrs = db.BinanceSquarePost.rawAttributes;
  if (postAttrs.postId.allowNull === false) {
    console.log("✓ BinanceSquarePost.postId: allowNull=false");
  } else {
    throw new Error("BinanceSquarePost.postId 应该 allowNull=false");
  }

  // PostSnapshot表：diffFromPrev允许null
  const snapshotAttrs = db.BinanceSquarePostSnapshot.rawAttributes;
  if (snapshotAttrs.diffFromPrev.allowNull !== false) {
    console.log("✓ BinanceSquarePostSnapshot.diffFromPrev: 允许null（无变化时）");
  }

  // CrawlLog表：filterType存在
  if (db.BinanceSquareCrawlLog.rawAttributes.filterType) {
    console.log("✓ BinanceSquareCrawlLog.filterType: 存在（ENUM: ALL/REPLY/QUOTE）");
  } else {
    throw new Error("BinanceSquareCrawlLog 缺少 filterType 字段");
  }

  // Config表：configKey必须not null
  const configAttrs = db.BinanceSquareConfig.rawAttributes;
  if (configAttrs.configKey.allowNull === false && configAttrs.configValue.allowNull === false) {
    console.log("✓ BinanceSquareConfig: configKey + configValue = not null");
  }

  // 4. 检查关联关系
  console.log("\n--- 关联关系检查 ---");

  const userAssoc = db.BinanceSquareUser.associations;
  if (userAssoc.Followings && userAssoc.Followings.associationType === "HasMany") {
    console.log("✓ BinanceSquareUser.hasMany(Followings, as: 'Followings')");
  } else {
    throw new Error("User -> Followings 关联缺失");
  }

  if (userAssoc.Posts && userAssoc.Posts.associationType === "HasMany") {
    console.log("✓ BinanceSquareUser.hasMany(Posts, as: 'Posts')");
  } else {
    throw new Error("User -> Posts 关联缺失");
  }

  const postAssoc = db.BinanceSquarePost.associations;
  if (postAssoc.Snapshots && postAssoc.Snapshots.associationType === "HasMany") {
    console.log("✓ BinanceSquarePost.hasMany(Snapshots, as: 'Snapshots')");
  } else {
    throw new Error("Post -> Snapshots 关联缺失");
  }

  // 5. 同步到内存数据库（验证DDL语法）
  console.log("\n--- DDL 语法检查 ---");
  await sequelize.sync({ force: true });
  console.log("✓ sequelize.sync() 成功（所有表结构语法正确）");

  // 6. 基础CRUD测试
  console.log("\n--- 基础CRUD测试 ---");

  // 测试User创建（not null字段）
  const user = await db.BinanceSquareUser.create({ username: "test_user" });
  console.log(`✓ 创建User成功: id=${user.id}, username=${user.username}`);

  // 测试User创建（null字段允许）
  const user2 = await db.BinanceSquareUser.create({
    username: "test_user_2",
    squareUid: null,
    totalFollowerCount: null,
  });
  console.log("✓ 创建User（null字段）成功");

  // 测试User创建（缺少not null字段应失败）
  try {
    await db.BinanceSquareUser.create({});
    throw new Error("应该抛出not null错误");
  } catch (e) {
    if (e.name === "SequelizeValidationError") {
      console.log("✓ username not null 约束生效");
    } else {
      throw e;
    }
  }

  // 测试Following唯一索引（先创建关联的User）
  await db.BinanceSquareUser.create({ username: "CZ" });
  await db.BinanceSquareUser.create({ username: "xxx" });
  await db.BinanceSquareFollowing.create({ followerUsername: "CZ", followingUsername: "xxx" });
  try {
    await db.BinanceSquareFollowing.create({ followerUsername: "CZ", followingUsername: "xxx" });
    throw new Error("应该抛出unique错误");
  } catch (e) {
    if (e.name === "SequelizeUniqueConstraintError") {
      console.log("✓ Following联合唯一索引生效");
    } else {
      throw e;
    }
  }

  // 测试SeedConfig唯一索引
  await db.BinanceSquareSeedConfig.create({ username: "CZ" });
  try {
    await db.BinanceSquareSeedConfig.create({ username: "CZ" });
    throw new Error("应该抛出unique错误");
  } catch (e) {
    if (e.name === "SequelizeUniqueConstraintError") {
      console.log("✓ SeedConfig username唯一索引生效");
    } else {
      throw e;
    }
  }

  // 测试Post upsert
  await db.BinanceSquarePost.create({ postId: "12345", username: "CZ", postType: "article" });
  const [post, created] = await db.BinanceSquarePost.upsert({
    postId: "12345",
    username: "CZ",
    postType: "article",
    likeCount: 100,
  });
  console.log(`✓ Post upsert成功: created=${created}`);

  // 测试Snapshot唯一索引
  await db.BinanceSquarePostSnapshot.create({
    postId: "12345",
    snapshotId: "20260507090000",
    snapshotTime: new Date(),
  });
  try {
    await db.BinanceSquarePostSnapshot.create({
      postId: "12345",
      snapshotId: "20260507090000",
      snapshotTime: new Date(),
    });
    throw new Error("应该抛出unique错误");
  } catch (e) {
    if (e.name === "SequelizeUniqueConstraintError") {
      console.log("✓ Snapshot (postId, snapshotId) 唯一索引生效");
    } else {
      throw e;
    }
  }

  // 测试Config插入默认值
  const config = await db.BinanceSquareConfig.create({
    configKey: "post_crawl_interval_hours",
    configValue: "2",
    minValue: "0.5",
    maxValue: "4",
  });
  console.log(`✓ Config创建成功: ${config.configKey}=${config.configValue}`);

  console.log("\n========================================");
  console.log("  ✅ Step 1 验证通过：模型定义正确");
  console.log("========================================");

} catch (error) {
  console.error("\n========================================");
  console.error("  ❌ Step 1 验证失败");
  console.error("========================================");
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  await sequelize.close();
}
