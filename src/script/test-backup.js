/**
 * PostgreSQL 备份服务测试脚本
 * 用于测试备份功能是否正常工作
 * 
 * 使用方法：
 * node src/script/test-backup.js
 */

const pgBackupService = require("../services/pg-backup-service");

async function testBackup() {
  console.log("=== PostgreSQL 备份服务测试 ===\n");

  try {
    // 1. 执行手动备份
    console.log("📦 测试 1: 执行手动备份");
    await pgBackupService.manualBackup();

    // 2. 列出所有备份文件
    console.log("\n📋 测试 2: 列出所有备份文件");
    const backups = await pgBackupService.listBackups();
    
    if (backups.length === 0) {
      console.log("   暂无备份文件");
    } else {
      console.log(`   找到 ${backups.length} 个备份文件:\n`);
      backups.forEach((backup, index) => {
        console.log(`   ${index + 1}. ${backup.name}`);
        console.log(`      大小: ${backup.sizeMB} MB`);
        console.log(`      时间: ${backup.mtimeStr}`);
        console.log(`      路径: ${backup.path}\n`);
      });
    }

    console.log("✅ 测试完成！");
    console.log("\n提示：");
    console.log("  - 备份服务已集成到 API 服务器中，启动 API 服务器即可自动运行");
    console.log("  - 每 4 小时自动执行一次备份");
    console.log("  - 自动保留最近 10 个备份文件");
    console.log("  - 备份文件位置: backups/postgres/\n");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ 测试失败:", error.message);
    console.error("\n可能的原因：");
    console.error("  1. PostgreSQL 客户端工具 (pg_dump) 未安装");
    console.error("     解决：brew install postgresql (macOS) 或 apt-get install postgresql-client (Linux)");
    console.error("  2. 数据库连接信息不正确");
    console.error("     检查：config/config-pg.json 中的配置");
    console.error("  3. 数据库服务器无法连接");
    console.error("     检查：数据库服务器是否正常运行\n");
    
    process.exit(1);
  }
}

// 执行测试
testBackup();
