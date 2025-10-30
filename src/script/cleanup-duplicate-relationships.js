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
  let mixedDuplicates = [];
  let mixedDeleted = 0;
  let dashDuplicatesDeleted = 0;
  let updatedCount = 0;
  let totalDeleted = 0;

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
    const dashRoundCount = await Fundraising.InvestmentRelationships.count({
      where: { round: "--" },
      transaction,
    });
    console.log(`   总记录数: ${totalCount}`);
    console.log(`   round=null 的记录数: ${nullRoundCount}`);
    console.log(`   round='--' 的记录数: ${dashRoundCount}\n`);

    // ========== 步骤2：查找跨 null 和 '--' 的重复（需要先处理这些）==========
    console.log("🔍 步骤2：查找需要合并的重复组合（null 和 '--' 混合）...");

    // 找出 (investorProjectId, fundedProjectId) 相同，但 round 有 null 也有 '--' 的情况
    mixedDuplicates = await sequelize.query(
      `
      SELECT 
        "investorProjectId", 
        "fundedProjectId",
        COUNT(*) as total_count,
        COUNT(CASE WHEN round IS NULL THEN 1 END) as null_count,
        COUNT(CASE WHEN round = '--' THEN 1 END) as dash_count,
        ARRAY_AGG(id ORDER BY id) as all_ids,
        MIN(id) as keep_id
      FROM "InvestmentRelationships"
      WHERE round IS NULL OR round = '--'
      GROUP BY "investorProjectId", "fundedProjectId"
      HAVING COUNT(CASE WHEN round IS NULL THEN 1 END) > 0 
         AND COUNT(CASE WHEN round = '--' THEN 1 END) > 0
      ORDER BY total_count DESC
      `,
      {
        type: sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    console.log(
      `   发现 ${mixedDuplicates.length} 组混合重复（null + '--'）\n`
    );

    // ========== 步骤3：删除混合重复中的 null 记录（保留 '--' 记录）==========
    if (mixedDuplicates.length > 0) {
      console.log("🗑️  步骤3：删除混合重复中的 null 记录（优先保留 '--'）...");
      for (const dup of mixedDuplicates) {
        // 删除这个组合中所有的 null 记录
        const deletedCount = await Fundraising.InvestmentRelationships.destroy({
          where: {
            investorProjectId: dup.investorProjectId,
            fundedProjectId: dup.fundedProjectId,
            round: null,
          },
          transaction,
        });
        mixedDeleted += deletedCount;
      }
      console.log(
        `   ✅ 删除了 ${mixedDeleted} 条 null 记录（已有对应的 '--' 记录）\n`
      );

      // 步骤3.5：清理混合组中可能重复的 '--' 记录
      console.log("🔍 步骤3.5：清理混合组中可能重复的 '--' 记录...");
      for (const dup of mixedDuplicates) {
        // 查找这个组合中的所有 '--' 记录
        const dashRecords = await Fundraising.InvestmentRelationships.findAll({
          where: {
            investorProjectId: dup.investorProjectId,
            fundedProjectId: dup.fundedProjectId,
            round: "--",
          },
          attributes: ["id"],
          order: [["id", "ASC"]],
          transaction,
        });

        if (dashRecords.length > 1) {
          // 保留第一条，删除其他
          const keepId = dashRecords[0].id;
          const deleteIds = dashRecords.slice(1).map((r) => r.id);
          const deleted = await Fundraising.InvestmentRelationships.destroy({
            where: {
              id: { [Op.in]: deleteIds },
            },
            transaction,
          });
          dashDuplicatesDeleted += deleted;
        }
      }
      if (dashDuplicatesDeleted > 0) {
        console.log(
          `   ✅ 额外删除了 ${dashDuplicatesDeleted} 条重复的 '--' 记录\n`
        );
      } else {
        console.log(`   ✅ 没有发现重复的 '--' 记录\n`);
      }
    }

    // ========== 步骤4：将所有剩余的 round=null 改为 '--' ==========
    console.log("🔧 步骤4：将剩余的 round=null 改为 '--'...");
    [updatedCount] = await Fundraising.InvestmentRelationships.update(
      { round: "--" },
      {
        where: { round: null },
        transaction,
      }
    );
    console.log(`   ✅ 更新了 ${updatedCount} 条记录\n`);

    // ========== 步骤5：查找剩余的重复关系（同一 round 值的重复）==========
    console.log("🔍 步骤5：查找剩余的重复投资关系...");

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

    // ========== 步骤6：删除剩余的重复记录 ==========
    if (duplicates.length > 0) {
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

      console.log("\n🗑️  步骤6：删除剩余的重复记录（保留ID最小的）...");

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

      console.log(`   ✅ 删除了 ${totalDeleted} 条剩余重复记录\n`);
    }

    // ========== 步骤7：验证结果 ==========
    console.log("✅ 步骤7：验证清理结果...");
    const finalCount = await Fundraising.InvestmentRelationships.count({
      transaction,
    });
    const finalNullCount = await Fundraising.InvestmentRelationships.count({
      where: { round: null },
      transaction,
    });
    const finalDashCount = await Fundraising.InvestmentRelationships.count({
      where: { round: "--" },
      transaction,
    });

    console.log(`   最终记录数: ${finalCount}`);
    console.log(`   round=null 的记录数: ${finalNullCount}`);
    console.log(`   round='--' 的记录数: ${finalDashCount}`);
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
    console.log(`   - 删除了 ${mixedDeleted} 条冲突的 null 记录`);
    console.log(`   - 删除了 ${dashDuplicatesDeleted} 条重复的 '--' 记录`);
    console.log(`   - 将 ${updatedCount} 条记录的 round 从 null 改为 '--'`);
    console.log(`   - 删除了 ${totalDeleted} 条其他重复记录`);
    console.log(
      `   - 总计删除: ${
        mixedDeleted + dashDuplicatesDeleted + totalDeleted
      } 条重复记录`
    );
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
