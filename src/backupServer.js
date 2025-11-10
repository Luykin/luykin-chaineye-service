require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const pgBackupService = require("./services/pg-backup-service");

(async () => {
  try {
    await pgBackupService.start();
    console.log("备份服务运行中...（单实例进程）");
  } catch (err) {
    console.error("备份进程启动失败:", err);
    process.exit(1);
  }
})();
