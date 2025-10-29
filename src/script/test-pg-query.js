/**
 * 测试 PostgreSQL 查询
 * 检查 socialLinks 字段的实际存储格式
 */

const { Sequelize, Op, literal } = require("sequelize");
const FundraisingModel = require("../models/fundraising");

// 连接 PostgreSQL 数据库
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: console.log, // 开启日志，查看实际 SQL
  timezone: "+00:00",
});

const Fundraising = FundraisingModel(pgInstance);

async function testQuery() {
  try {
    console.log("🔌 连接 PostgreSQL 数据库...");
    await pgInstance.authenticate();
    console.log("✅ PostgreSQL 连接成功\n");

    // 测试关键词
    const keyword = "polychain"; // 可以修改为其他关键词
    const targetTwitterUrl = `https://x.com/${keyword}`;
    const targetTwitterUrlWithSlash = `https://x.com/${keyword}/`;

    console.log("🔍 测试查询条件:");
    console.log(`   keyword: ${keyword}`);
    console.log(`   targetTwitterUrl: ${targetTwitterUrl}`);
    console.log(`   targetTwitterUrlWithSlash: ${targetTwitterUrlWithSlash}\n`);

    // 方法 1: 查看包含特定 keyword 的项目（JSON 字段模糊匹配）
    console.log("=".repeat(60));
    console.log(`方法 1: 查找 socialLinks 中包含 "${keyword}" 的项目`);
    console.log("=".repeat(60));
    const allProjects = await pgInstance.query(
      `SELECT id, "projectName", "projectLink", "socialLinks" 
       FROM "Projects" 
       WHERE "socialLinks" IS NOT NULL 
       AND "socialLinks"::text ILIKE '%${keyword}%'
       LIMIT 10`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`找到 ${allProjects.length} 个项目:\n`);
    allProjects.forEach((p) => {
      console.log(`ID: ${p.id}`);
      console.log(`Name: ${p.projectName}`);
      console.log(`Link: ${p.projectLink}`);
      console.log(`socialLinks: ${JSON.stringify(p.socialLinks)}`);
      console.log("-".repeat(60));
    });

    // 方法 2: 原始查询（当前使用的）
    console.log("\n" + "=".repeat(60));
    console.log("方法 2: 使用当前的查询逻辑（literal）");
    console.log("=".repeat(60));
    try {
      const project1 = await Fundraising.Project.findOne({
        where: {
          [Op.or]: [
            literal(
              `LOWER("socialLinks"->>'x') = LOWER('${targetTwitterUrl}')`
            ),
            literal(
              `LOWER("socialLinks"->>'x') = LOWER('${targetTwitterUrlWithSlash}')`
            ),
          ],
        },
        order: [["id", "DESC"]],
        attributes: [
          "id",
          "projectName",
          "projectLink",
          "socialLinks",
          "logo",
          "amount",
        ],
        raw: true,
      });

      if (project1) {
        console.log("✅ 找到项目:");
        console.log(JSON.stringify(project1, null, 2));
      } else {
        console.log("❌ 未找到项目");
      }
    } catch (error) {
      console.error("❌ 查询失败:", error.message);
    }

    // 方法 3: 直接 SQL 查询
    console.log("\n" + "=".repeat(60));
    console.log("方法 3: 使用原生 SQL 查询");
    console.log("=".repeat(60));
    const project2 = await pgInstance.query(
      `SELECT id, "projectName", "projectLink", "socialLinks", logo, amount 
       FROM "Projects" 
       WHERE (
         LOWER("socialLinks"->>'x') = LOWER('${targetTwitterUrl}') OR
         LOWER("socialLinks"->>'x') = LOWER('${targetTwitterUrlWithSlash}')
       )
       ORDER BY id DESC 
       LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (project2 && project2.length > 0) {
      console.log("✅ 找到项目:");
      console.log(JSON.stringify(project2[0], null, 2));
    } else {
      console.log("❌ 未找到项目");
    }

    // 方法 4: 模糊匹配（容错）
    console.log("\n" + "=".repeat(60));
    console.log("方法 4: 使用模糊匹配（容错查询）");
    console.log("=".repeat(60));
    const project3 = await pgInstance.query(
      `SELECT id, "projectName", "projectLink", "socialLinks", logo, amount 
       FROM "Projects" 
       WHERE "socialLinks"->>'x' ILIKE '%${keyword}%'
       ORDER BY id DESC 
       LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (project3 && project3.length > 0) {
      console.log("✅ 找到项目:");
      console.log(JSON.stringify(project3[0], null, 2));
    } else {
      console.log("❌ 未找到项目");
    }

    // 方法 5: 检查特定项目（按项目名或链接模糊搜索）
    console.log("\n" + "=".repeat(60));
    console.log(`方法 5: 查找包含 "${keyword}" 的项目`);
    console.log("=".repeat(60));
    const keywordProject = await pgInstance.query(
      `SELECT id, "projectName", "projectLink", "socialLinks" 
       FROM "Projects" 
       WHERE "projectName" ILIKE '%${keyword}%' OR "projectLink" ILIKE '%${keyword}%'
       LIMIT 10`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (keywordProject && keywordProject.length > 0) {
      console.log(`✅ 找到 ${keywordProject.length} 个相关项目:`);
      keywordProject.forEach((p) => {
        console.log(`\nID: ${p.id}`);
        console.log(`Name: ${p.projectName}`);
        console.log(`Link: ${p.projectLink}`);
        console.log(`socialLinks: ${JSON.stringify(p.socialLinks)}`);
      });
    } else {
      console.log(`❌ 未找到包含 "${keyword}" 的项目`);
    }
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    throw error;
  } finally {
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// 执行测试
if (require.main === module) {
  testQuery()
    .then(() => {
      console.log("\n✨ 测试完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 发生错误:", error);
      process.exit(1);
    });
}

module.exports = { testQuery };
