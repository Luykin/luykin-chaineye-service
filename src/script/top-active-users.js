const fs = require("fs");
const path = require("path");
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

    // 保存到项目根目录下的 data/ 目录
    const projectRoot = path.resolve(__dirname, "..", "..");
    const dataDir = path.join(projectRoot, "data");
    const outFile = path.join(dataDir, "top-active-users.json");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf8");
      console.log(`\n💾 已保存到: ${outFile}`);
    } catch (e) {
      console.warn("⚠️ 保存文件失败:", e.message);
    }
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
