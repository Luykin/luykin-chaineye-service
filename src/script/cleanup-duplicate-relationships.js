/**
 * 清理 InvestmentRelationships 表中的重复数据
 *
 * 问题：当 round 为 null 时，唯一索引不生效，导致重复数据
 * 解决：
 * 1. 将所有 round=null 改为 round='--'
 * 2. 删除重复的关系（保留 ID 最小的那条）
 */

const { Fundraising } = require("../models/postgres-fundraising");
const { Op } = require("sequelize");

async function cleanupDuplicateRelationships() {
  console.log("🚀 开始清理重复的投资关系...\n");

  const sequelize = Fundraising.Project.sequelize;
  let transaction;

  try {
    transaction = await sequelize.transaction();

    // ========== 步骤1：统计当前状况 ==========
    console.log("📊 步骤1：统计当前数据...");
    const totalCount = await Fundraising.InvestmentRelationships.count({
      transaction,
    });
    const nullRoundCount = await Fundraising.InvestmentRelationships.count({
      where: { round: null },
      transaction,
    });
    console.log(`   总记录数: ${totalCount}`);
    console.log(`   round=null 的记录数: ${nullRoundCount}\n`);

    // ========== 步骤2：将所有 round=null 改为 '--' ==========
    console.log("🔧 步骤2：将 round=null 改为 '--'...");
    const [updatedCount] = await Fundraising.InvestmentRelationships.update(
      { round: "--" },
      {
        where: { round: null },
        transaction,
      }
    );
    console.log(`   ✅ 更新了 ${updatedCount} 条记录\n`);

    // ========== 步骤3：查找重复的关系 ==========
    console.log("🔍 步骤3：查找重复的投资关系...");

    // 使用原生 SQL 查找重复
    const duplicates = await sequelize.query(
      `
      SELECT 
        "investorProjectId", 
        "fundedProjectId", 
        "round",
        COUNT(*) as count,
        MIN(id) as keep_id,
        ARRAY_AGG(id ORDER BY id) as all_ids
      FROM "InvestmentRelationships"
      GROUP BY "investorProjectId", "fundedProjectId", "round"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      `,
      {
        type: sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    console.log(`   发现 ${duplicates.length} 组重复数据\n`);

    if (duplicates.length === 0) {
      console.log("✅ 没有发现重复数据！");
      await transaction.commit();
      return;
    }

    // ========== 步骤4：显示重复详情 ==========
    console.log("📋 重复数据详情（前10组）：");
    for (let i = 0; i < Math.min(10, duplicates.length); i++) {
      const dup = duplicates[i];
      console.log(`\n   组 ${i + 1}:`);
      console.log(`   - 投资方ID: ${dup.investorProjectId}`);
      console.log(`   - 被投方ID: ${dup.fundedProjectId}`);
      console.log(`   - 轮次: ${dup.round || "(空)"}`);
      console.log(`   - 重复次数: ${dup.count}`);
      console.log(`   - 保留ID: ${dup.keep_id}`);
      console.log(
        `   - 删除ID: ${dup.all_ids
          .filter((id) => id !== dup.keep_id)
          .join(", ")}`
      );
    }

    // ========== 步骤5：删除重复记录 ==========
    console.log("\n🗑️  步骤5：删除重复记录（保留ID最小的）...");

    let totalDeleted = 0;
    for (const dup of duplicates) {
      // 删除除了最小 ID 之外的所有记录
      const idsToDelete = dup.all_ids.filter((id) => id !== dup.keep_id);

      const deletedCount = await Fundraising.InvestmentRelationships.destroy({
        where: {
          id: { [Op.in]: idsToDelete },
        },
        transaction,
      });

      totalDeleted += deletedCount;
    }

    console.log(`   ✅ 删除了 ${totalDeleted} 条重复记录\n`);

    // ========== 步骤6：验证结果 ==========
    console.log("✅ 步骤6：验证清理结果...");
    const finalCount = await Fundraising.InvestmentRelationships.count({
      transaction,
    });
    const finalNullCount = await Fundraising.InvestmentRelationships.count({
      where: { round: null },
      transaction,
    });

    console.log(`   最终记录数: ${finalCount}`);
    console.log(`   round=null 的记录数: ${finalNullCount}`);
    console.log(
      `   删除前后对比: ${totalCount} → ${finalCount} (删除 ${
        totalCount - finalCount
      } 条)\n`
    );

    // 提交事务
    await transaction.commit();
    console.log("✅ 清理完成！事务已提交。\n");

    // 最终统计
    console.log("=".repeat(60));
    console.log("📊 清理汇总：");
    console.log(`   - 将 ${updatedCount} 条记录的 round 从 null 改为 '--'`);
    console.log(`   - 删除了 ${totalDeleted} 条重复记录`);
    console.log(`   - 数据总量：${totalCount} → ${finalCount}`);
    console.log("=".repeat(60));
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
      console.error("\n❌ 错误：事务已回滚");
    }
    console.error("错误详情：", error);
    throw error;
  }
}

// 执行清理
if (require.main === module) {
  cleanupDuplicateRelationships()
    .then(() => {
      console.log("\n✅ 脚本执行完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ 脚本执行失败：", error);
      process.exit(1);
    });
}

module.exports = cleanupDuplicateRelationships;
