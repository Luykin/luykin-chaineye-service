/**
 * 修复 phyrex_ni 的投资项目数据
 * 将硬编码的投资项目写入数据库
 */

const { Sequelize } = require("sequelize");
const FundraisingModel = require("../models/fundraising");

// ============ 连接 PostgreSQL 数据库 ============
// 默认连接到生产数据库，也可通过环境变量覆盖
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10), // 生产端口: 5432, 开发端口: 5433
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: false,
  timezone: "+00:00",
});

// ============ 初始化模型 ============
const Fundraising = FundraisingModel(pgInstance);

// phyrex_ni 的投资项目列表
const PHYREX_INVESTMENTS = [
  {
    name: "Solayer Labs",
    twitter: "https://x.com/solayer_labs",
    avatar:
      "https://pbs.twimg.com/profile_images/1852368489174159360/htlVoJ1j_400x400.jpg",
  },
  {
    name: "Aster DEX",
    twitter: "https://x.com/aster_dex",
    avatar:
      "https://pbs.twimg.com/profile_images/1906615420939022336/j1PVcH8N_400x400.jpg",
  },
  {
    name: "Huma Finance",
    twitter: "https://x.com/humafinance",
    avatar:
      "https://pbs.twimg.com/profile_images/1624112902771703821/oSgPaG68_400x400.png",
  },
  {
    name: "Sahara Labs AI",
    twitter: "https://x.com/saharalabsai",
    avatar:
      "https://pbs.twimg.com/profile_images/1955663161928921088/nn_g5zL1_400x400.png",
  },
  {
    name: "GAIB AI",
    twitter: "https://x.com/gaib_ai",
    avatar:
      "https://pbs.twimg.com/profile_images/1963511865520373760/KaLCvZ5s_400x400.jpg",
  },
];

async function fixPhyrexInvestments() {
  try {
    // 测试数据库连接
    console.log("🔌 连接 PostgreSQL 数据库...");
    await pgInstance.authenticate();
    console.log("✅ PostgreSQL 连接成功\n");

    console.log("🚀 开始修复 phyrex_ni 的投资数据...\n");

    // 1. 查找或创建 phyrex_ni 的项目
    const [phyrexProject, phyrexCreated] =
      await Fundraising.Project.findOrCreate({
        where: {
          socialLinks: {
            x: "https://x.com/phyrex_ni",
          },
        },
        defaults: {
          projectName: "Phyrex",
          projectLink:
            "https://www.rootdata.com/member/Phyrex%20Ni?k=MjA0OTI%3D", // 必填字段
          socialLinks: { x: "https://x.com/phyrex_ni" },
          logo: "https://pbs.twimg.com/profile_images/1760613636918476800/OYd_SQc5_400x400.jpg",
          description: "Crypto Investor & KOL",
          isInitial: false, // 标记为投资者
        },
      });

    if (phyrexCreated) {
      console.log(
        `✨ 创建投资者项目: ${phyrexProject.projectName} (ID: ${phyrexProject.id})\n`
      );
    } else {
      console.log(
        `✅ 找到投资者项目: ${phyrexProject.projectName} (ID: ${phyrexProject.id})\n`
      );
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // 2. 遍历投资项目列表
    for (const investment of PHYREX_INVESTMENTS) {
      console.log(`📝 处理项目: ${investment.name}...`);

      // 2.1 查找或创建被投资项目
      let [fundedProject, created] = await Fundraising.Project.findOrCreate({
        where: {
          socialLinks: {
            x: investment.twitter,
          },
        },
        defaults: {
          projectName: investment.name,
          projectLink: `javascript:void(0)/${investment.name}`,
          logo: investment.avatar,
          socialLinks: { x: investment.twitter },
          isInitial: false,
        },
      });

      if (created) {
        console.log(`  ✨ 创建新项目: ${investment.name}`);
      } else {
        console.log(
          `  ℹ️  项目已存在: ${investment.name} (ID: ${fundedProject.id})`
        );

        // 更新 logo（如果为空或不同）
        if (!fundedProject.logo || fundedProject.logo !== investment.avatar) {
          await fundedProject.update({ logo: investment.avatar });
          console.log(`  🖼️  更新了项目 logo`);
        }
      }

      // 2.2 创建或更新投资关系
      const [relationship, relationshipCreated] =
        await Fundraising.InvestmentRelationships.findOrCreate({
          where: {
            investorProjectId: phyrexProject.id,
            fundedProjectId: fundedProject.id,
          },
          defaults: {
            investorProjectId: phyrexProject.id,
            fundedProjectId: fundedProject.id,
            round: "Angel",
            lead: false,
            amount: null,
            formattedAmount: null,
            date: Date.now(),
          },
        });

      if (relationshipCreated) {
        console.log(`  ✅ 创建投资关系: phyrex_ni -> ${investment.name}`);
        createdCount++;
      } else {
        console.log(`  ⚠️  投资关系已存在`);
        skippedCount++;
      }

      console.log("");
    }

    // 3. 总结
    console.log("=".repeat(50));
    console.log("✅ 数据修复完成！");
    console.log(`📊 统计:`);
    console.log(`   - 新建投资关系: ${createdCount}`);
    console.log(`   - 已存在（跳过）: ${skippedCount}`);
    console.log(`   - 总计处理: ${PHYREX_INVESTMENTS.length}`);
    console.log("=".repeat(50));
  } catch (error) {
    console.error("❌ 修复失败:", error);
    throw error;
  } finally {
    // 关闭数据库连接
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// ============ 执行脚本 ============
if (require.main === module) {
  fixPhyrexInvestments()
    .then(() => {
      console.log("\n✨ 所有操作完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 发生错误:", error);
      process.exit(1);
    });
}

module.exports = { fixPhyrexInvestments };
