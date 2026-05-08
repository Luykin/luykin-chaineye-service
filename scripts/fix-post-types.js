#!/usr/bin/env node
/**
 * 修正被错误分类为 quote 的帖子
 * 用法: node scripts/fix-post-types.js
 */

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { pgInstance } = require("../src/models/postgres-start");
const initBinanceSquareModels = require("../src/binance-square/models");
const { resolvePostType } = require("../src/binance-square/scraper/parsers/postParser");

async function main() {
  const db = initBinanceSquareModels(pgInstance);

  console.log("查询所有帖子，重新判断 postType...");
  const posts = await db.BinanceSquarePost.findAll({
    attributes: ["postId", "postType", "rawData"],
  });

  console.log(`共找到 ${posts.length} 条记录`);

  let fixed = 0;
  let unchanged = 0;
  const typeCount = { article: 0, quote: 0, reply: 0 };

  for (const post of posts) {
    const rawData = post.rawData;
    if (!rawData) {
      unchanged++;
      continue;
    }

    const newType = resolvePostType(rawData.contentType, rawData);
    typeCount[newType] = (typeCount[newType] || 0) + 1;

    if (newType !== post.postType) {
      await db.BinanceSquarePost.update(
        { postType: newType },
        { where: { postId: post.postId } }
      );
      console.log(`  [修正] ${post.postId}: ${post.postType} -> ${newType}`);
      fixed++;
    } else {
      unchanged++;
    }
  }

  console.log(`\n完成：修正 ${fixed} 条，无需修改 ${unchanged} 条`);
  console.log(`修正后分布: article=${typeCount.article}, quote=${typeCount.quote}, reply=${typeCount.reply}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("执行失败:", e);
  process.exit(1);
});
