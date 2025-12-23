const { getTopActiveUsers, close } = require("./DailyActiveUser");

async function main() {
  const days = process.env.DAYS ? parseInt(process.env.DAYS, 10) : 30;
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 500;

  try {
    console.log(`🔍 统计最近 ${days} 天活跃次数 Top ${limit} 用户...`);
    const data = await getTopActiveUsers(days, limit);
    // 输出形如 {'handler': {activedays: 30, twid:'xx', handler: 'xxx', displayName: 'dada', avatar:'', createdtime:'', evmAddresses:[...]}}
    // 使用 JSON 序列化后替换双引号为单引号，便于符合示例展示格式
    const primaryOut = JSON.stringify(data);
    console.log(primaryOut.replace(/"/g, "'"));

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
