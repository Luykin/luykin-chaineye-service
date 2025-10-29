const { Sequelize } = require("sequelize");
const FundraisingModel = require("../models/fundraising");

// ============ 连接 SQLite 数据库 ============
const sqliteInstance = new Sequelize({
  dialect: "sqlite",
  storage: "./database.sqlite",
  logging: false,
});

// ============ 连接 PostgreSQL 数据库 ============
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10), // 默认使用 5432 端口
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: false,
  timezone: "+00:00",
});

// ============ 初始化模型 ============
const { Project: SQLiteProject, InvestmentRelationships: SQLiteRelations } =
  FundraisingModel(sqliteInstance);
const { Project: PGProject, InvestmentRelationships: PGRelations } =
  FundraisingModel(pgInstance);

// ============ 迁移函数 ============
async function migrateFundraisingData() {
  try {
    // 1. 测试数据库连接
    console.log("🔌 连接 SQLite 数据库...");
    await sqliteInstance.authenticate();
    console.log("✅ SQLite 连接成功");

    console.log("🔌 连接 PostgreSQL 数据库...");
    await pgInstance.authenticate();
    console.log("✅ PostgreSQL 连接成功");

    // 2. 同步 PostgreSQL 表结构
    console.log("\n📋 同步 PostgreSQL 表结构...");
    await pgInstance.sync({ alter: true });
    console.log("✅ 表结构同步完成");

    // 3. 迁移 Project 数据
    console.log("\n📦 开始迁移 Project 数据...");
    const sqliteProjects = await SQLiteProject.findAll({
      raw: true, // 返回纯对象，提高性能
    });

    console.log(`   找到 ${sqliteProjects.length} 条 Project 记录`);

    // 用于存储 ID 映射关系 (sqliteId -> pgId)
    const projectIdMap = new Map();
    const projectLinkMap = new Map(); // 用于快速查找

    // 使用 projectLink 作为唯一标识进行匹配
    for (let i = 0; i < sqliteProjects.length; i++) {
      const sqliteProject = sqliteProjects[i];

      if ((i + 1) % 100 === 0) {
        console.log(`   已处理 ${i + 1}/${sqliteProjects.length} 条记录`);
      }

      try {
        // 查找 PostgreSQL 中是否已存在
        const existingPGProject = await PGProject.findOne({
          where: { projectLink: sqliteProject.projectLink },
          raw: true,
        });

        if (existingPGProject) {
          // 如果已存在，记录映射关系
          projectIdMap.set(sqliteProject.id, existingPGProject.id);
          projectLinkMap.set(sqliteProject.projectLink, existingPGProject.id);
        } else {
          // 如果不存在，创建新记录
          const pgProject = await PGProject.create({
            projectName: sqliteProject.projectName,
            projectLink: sqliteProject.projectLink,
            description: sqliteProject.description,
            logo: sqliteProject.logo,
            round: sqliteProject.round,
            amount: sqliteProject.amount,
            formattedAmount: sqliteProject.formattedAmount,
            valuation: sqliteProject.valuation,
            formattedValuation: sqliteProject.formattedValuation,
            date: sqliteProject.date,
            fundedAt: sqliteProject.fundedAt,
            detailFetchedAt: sqliteProject.detailFetchedAt,
            detailFailuresNumber: sqliteProject.detailFailuresNumber,
            isInitial: sqliteProject.isInitial,
            socialLinks: sqliteProject.socialLinks,
            teamMembers: sqliteProject.teamMembers,
            originalPageNumber: sqliteProject.originalPageNumber,
            isVcListed: sqliteProject.isVcListed,
            vcListPage: sqliteProject.vcListPage,
            createdAt: sqliteProject.createdAt,
            updatedAt: sqliteProject.updatedAt,
          });

          // 记录映射关系
          projectIdMap.set(sqliteProject.id, pgProject.id);
          projectLinkMap.set(sqliteProject.projectLink, pgProject.id);
        }
      } catch (error) {
        console.error(
          `   ❌ 迁移 Project 失败 (${sqliteProject.projectLink}):`,
          error.message
        );
        // 继续迁移其他记录
      }
    }

    console.log(`✅ Project 数据迁移完成，共迁移 ${projectIdMap.size} 条记录`);

    // 4. 迁移 InvestmentRelationships 数据
    console.log("\n📦 开始迁移 InvestmentRelationships 数据...");
    const sqliteRelations = await SQLiteRelations.findAll({
      raw: true,
    });

    console.log(
      `   找到 ${sqliteRelations.length} 条 InvestmentRelationships 记录`
    );

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < sqliteRelations.length; i++) {
      const sqliteRelation = sqliteRelations[i];

      if ((i + 1) % 100 === 0) {
        console.log(`   已处理 ${i + 1}/${sqliteRelations.length} 条记录`);
      }

      try {
        // 获取对应的 PostgreSQL ID
        const pgInvestorProjectId = projectIdMap.get(
          sqliteRelation.investorProjectId
        );
        const pgFundedProjectId = projectIdMap.get(
          sqliteRelation.fundedProjectId
        );

        if (!pgInvestorProjectId || !pgFundedProjectId) {
          console.warn(
            `   ⚠️ 跳过关系 (无法找到对应的 Project ID): investorId=${sqliteRelation.investorProjectId}, fundedId=${sqliteRelation.fundedProjectId}`
          );
          failedCount++;
          continue;
        }

        // 检查是否已存在
        const existingRelation = await PGRelations.findOne({
          where: {
            investorProjectId: pgInvestorProjectId,
            fundedProjectId: pgFundedProjectId,
            round: sqliteRelation.round,
          },
        });

        if (!existingRelation) {
          // 创建新关系
          await PGRelations.create({
            investorProjectId: pgInvestorProjectId,
            fundedProjectId: pgFundedProjectId,
            round: sqliteRelation.round,
            amount: sqliteRelation.amount,
            formattedAmount: sqliteRelation.formattedAmount,
            valuation: sqliteRelation.valuation,
            formattedValuation: sqliteRelation.formattedValuation,
            date: sqliteRelation.date,
            lead: sqliteRelation.lead,
            createdAt: sqliteRelation.createdAt,
            updatedAt: sqliteRelation.updatedAt,
          });
        }

        successCount++;
      } catch (error) {
        console.error(
          `   ❌ 迁移关系失败 (investorId=${sqliteRelation.investorProjectId}, fundedId=${sqliteRelation.fundedProjectId}):`,
          error.message
        );
        failedCount++;
      }
    }

    console.log(
      `✅ InvestmentRelationships 数据迁移完成，成功 ${successCount} 条，失败 ${failedCount} 条`
    );

    // 5. 数据验证
    console.log("\n🔍 验证迁移结果...");
    const sqliteProjectCount = await SQLiteProject.count();
    const pgProjectCount = await PGProject.count();
    const sqliteRelationCount = await SQLiteRelations.count();
    const pgRelationCount = await PGRelations.count();

    console.log(`   SQLite Project: ${sqliteProjectCount}`);
    console.log(`   PostgreSQL Project: ${pgProjectCount}`);
    console.log(`   SQLite InvestmentRelationships: ${sqliteRelationCount}`);
    console.log(`   PostgreSQL InvestmentRelationships: ${pgRelationCount}`);

    if (
      sqliteProjectCount === pgProjectCount &&
      sqliteRelationCount === pgRelationCount
    ) {
      console.log("✅ 数据迁移验证通过！");
    } else {
      console.warn("⚠️ 数据迁移验证失败，记录数不一致");
    }

    console.log("\n🎉 迁移完成！");
  } catch (error) {
    console.error("\n❌ 迁移失败:", error);
    throw error;
  } finally {
    // 关闭数据库连接
    await sqliteInstance.close();
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// ============ 执行迁移 ============
if (require.main === module) {
  migrateFundraisingData()
    .then(() => {
      console.log("\n✨ 所有操作完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 发生错误:", error);
      process.exit(1);
    });
}

module.exports = { migrateFundraisingData };
