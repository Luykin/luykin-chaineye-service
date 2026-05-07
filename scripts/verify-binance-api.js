/**
 * Step 2 验证脚本：测试币安API调用
 */

import { fetchFollowingList, fetchUserPosts } from "../src/binance-square/scraper/api-client.js";

console.log("=== Step 2: 验证币安API调用 ===\n");

async function testFollowingList() {
  console.log("--- 测试1: 获取CZ的关注列表 ---");
  try {
    const result = await fetchFollowingList("CZ");
    console.log(`✓ 请求成功`);
    console.log(`  总数: ${result.total}`);
    console.log(`  实际获取: ${result.followers.length} 条`);

    if (result.followers.length === 0) {
      throw new Error("关注列表为空");
    }

    // 检查第一条数据的关键字段
    const first = result.followers[0];
    console.log(`  第一条: username=${first.username}, displayName=${first.displayName}`);
    console.log(`  关键字段检查:`);
    console.log(`    - squareUid: ${first.squareUid || "null"}`);
    console.log(`    - totalFollowerCount: ${first.totalFollowerCount || "null"}`);
    console.log(`    - totalPostCount: ${first.totalPostCount || "null"}`);

    // 校验数量是否一致
    if (result.followers.length !== result.total) {
      console.warn(`⚠️ 数量不一致: 获取${result.followers.length}条, API返回total=${result.total}`);
    } else {
      console.log(`✓ 获取数量与API返回一致`);
    }

    return true;
  } catch (error) {
    console.error(`✗ 失败: ${error.message}`);
    if (error.response) {
      console.error(`  状态码: ${error.response.status}`);
      console.error(`  响应: ${JSON.stringify(error.response.data).substring(0, 200)}`);
    }
    return false;
  }
}

async function testUserPostsAll() {
  console.log("\n--- 测试2: 获取CZ的帖子（ALL） ---");
  try {
    // 从关注列表中取第一个用户的squareUid来测试帖子接口
    const followingResult = await fetchFollowingList("CZ");
    const testUser = followingResult.followers[0];

    if (!testUser || !testUser.squareUid) {
      console.log("⚠️ 无法获取测试用户的squareUid，跳过帖子测试");
      return false;
    }

    console.log(`  测试用户: ${testUser.username}, squareUid: ${testUser.squareUid}`);

    const result = await fetchUserPosts(testUser.squareUid, "ALL", 7);
    console.log(`✓ 请求成功`);
    console.log(`  获取帖子数: ${result.contents.length}`);

    if (result.contents.length > 0) {
      const first = result.contents[0];
      console.log(`  第一条帖子:`);
      console.log(`    - id: ${first.id}`);
      console.log(`    - contentType: ${first.contentType}`);
      console.log(`    - latestReleaseTime: ${first.latestReleaseTime}`);
      console.log(`    - title: ${first.title || "null"}`);
      console.log(`    - isReplyPost: ${first.isReplyPost}`);
    }

    return true;
  } catch (error) {
    console.error(`✗ 失败: ${error.message}`);
    if (error.response) {
      console.error(`  状态码: ${error.response.status}`);
    }
    return false;
  }
}

async function testUserPostsReply() {
  console.log("\n--- 测试3: 获取CZ的回复（REPLY） ---");
  try {
    const followingResult = await fetchFollowingList("CZ");
    const testUser = followingResult.followers[0];

    if (!testUser || !testUser.squareUid) {
      console.log("⚠️ 无法获取测试用户的squareUid，跳过回复测试");
      return false;
    }

    const result = await fetchUserPosts(testUser.squareUid, "REPLY", 7);
    console.log(`✓ 请求成功`);
    console.log(`  获取回复数: ${result.contents.length}`);

    if (result.contents.length > 0) {
      const first = result.contents[0];
      console.log(`  第一条回复:`);
      console.log(`    - id: ${first.id}`);
      console.log(`    - isReplyPost: ${first.isReplyPost}`);
      console.log(`    - parentContentId: ${first.parentContentId || "null"}`);
    } else {
      console.log(`  该用户7天内无回复`);
    }

    return true;
  } catch (error) {
    console.error(`✗ 失败: ${error.message}`);
    if (error.response) {
      console.error(`  状态码: ${error.response.status}`);
    }
    return false;
  }
}

async function main() {
  const results = [];

  results.push(await testFollowingList());
  results.push(await testUserPostsAll());
  results.push(await testUserPostsReply());

  console.log("\n========================================");
  if (results.every((r) => r)) {
    console.log("  ✅ Step 2 验证通过：API调用正常");
  } else {
    console.log("  ⚠️ Step 2 部分验证通过");
    console.log(`     通过: ${results.filter((r) => r).length}/${results.length}`);
  }
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n========================================");
  console.error("  ❌ Step 2 验证失败");
  console.error("========================================");
  console.error(err);
  process.exit(1);
});
