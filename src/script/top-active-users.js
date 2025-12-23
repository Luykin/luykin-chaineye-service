const { getTopActiveUsers, close } = require("./DailyActiveUser");

async function main() {
  const days = process.env.DAYS ? parseInt(process.env.DAYS, 10) : 30;
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 500;

  try {
    console.log(`🔍 统计最近 ${days} 天活跃次数 Top ${limit} 用户...`);
    const data = await getTopActiveUsers(days, limit);
    // 输出形如 {'xxx1': 30, 'xxx2': 29}
    // 为保持与示例一致，使用单引号包裹 key（打印时构造字符串）
    const jsonLike = `{${Object.entries(data)
      .map(([k, v]) => `'${k}': ${v}`)
      .join(", ")}}`;
    console.log(jsonLike);

    // 同时输出标准 JSON 便于脚本管道使用
    console.log("\nJSON:");
    console.log(JSON.stringify(data));
  } catch (err) {
    console.error("❌ 统计失败:", err);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  main();
}
