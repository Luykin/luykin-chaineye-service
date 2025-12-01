require("dotenv").config({ path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}` });

const bcrypt = require("bcryptjs");
const { XhuntAdminManager, setupPostgres } = require("../src/models/postgres-start");

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL || "";
  const password = process.env.ADMIN_SEED_PASSWORD || "";
  if (!email || !password) {
    console.error("[Admin Seed] 缺少环境变量: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD");
    process.exit(1);
  }

  try {
    await setupPostgres();
    await XhuntAdminManager.sync({ alter: true });

    let admin = await XhuntAdminManager.findOne({ where: { email } });
    if (admin) {
      console.log(`[Admin Seed] 已存在管理员: ${email}，跳过创建`);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    admin = await XhuntAdminManager.create({
      email,
      passwordHash,
      role: "super",
      isActive: true,
      canLogin: true,
      receivesDailyReport: true,
    });

    console.log(`[Admin Seed] 超级管理员已创建: ${email} 密码: ${password}`);
    console.log(`[Admin Seed] 出于安全，请立即删除 ADMIN_SEED_PASSWORD 或修改密码`);
    process.exit(0);
  } catch (e) {
    console.error("[Admin Seed] 初始化失败:", e);
    process.exit(2);
  }
}

main();
