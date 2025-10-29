/**
 * 清理重复的项目记录
 *
 * 问题描述：
 * 由于 URL 编码不一致（如 "Amber Group" vs "Amber%20Group"），
 * 导致创建了重复的项目记录，并产生了重复的投资关系。
 *
 * 解决方案：
 * 1. 查找所有重复的项目（标准化 URL 后）
 * 2. 对每组重复项目，保留 ID 最小的（最早创建的）
 * 3. 将其他重复项目的投资关系转移到保留项目
 * 4. 删除重复的项目记录
 */

const { Fundraising } = require("../models/postgres-fundraising");

/**
 * 标准化 URL - 与 rootdata.js 中的逻辑一致
 */
function normalizeUrl(url) {
  if (!url) return url;

  try {
    // 分离基础 URL 和查询参数
    const questionMarkIndex = url.indexOf("?");
    if (questionMarkIndex === -1) {
      // 没有查询参数，只处理路径中的空格
      return url.replace(/ /g, "%20");
    }

    const baseUrl = url.substring(0, questionMarkIndex);
    const queryString = url.substring(questionMarkIndex + 1);

    // 对路径部分的空格进行编码
    const encodedBaseUrl = baseUrl.replace(/ /g, "%20");

    // 对查询参数进行处理
    const params = queryString.split("&");
    const encodedParams = params.map((param) => {
      const equalIndex = param.indexOf("=");
      if (equalIndex === -1) return param;

      const key = param.substring(0, equalIndex);
      const value = param.substring(equalIndex + 1);

      // 对参数值中的 = 进行编码（Base64 值中的 =）
      const encodedValue = value.replace(/=/g, "%3D");

      return `${key}=${encodedValue}`;
    });

    return `${encodedBaseUrl}?${encodedParams.join("&")}`;
  } catch (error) {
    console.warn("URL 标准化失败:", url, error);
    return url;
  }
}

/**
 * 查找所有重复的项目
 */
async function findDuplicateProjects() {
  console.log("🔍 正在查找所有项目...");

  // 获取所有项目
  const allProjects = await Fundraising.Project.findAll({
    attributes: ["id", "projectName", "projectLink", "createdAt"],
    order: [["id", "ASC"]],
    raw: true,
  });

  console.log(`📊 共找到 ${allProjects.length} 个项目`);

  // 按标准化后的 URL 分组
  const groupedProjects = {};

  for (const project of allProjects) {
    const normalizedLink = normalizeUrl(project.projectLink);

    if (!groupedProjects[normalizedLink]) {
      groupedProjects[normalizedLink] = [];
    }

    groupedProjects[normalizedLink].push(project);
  }

  // 筛选出有重复的项目组
  const duplicateGroups = Object.entries(groupedProjects).filter(
    ([_, projects]) => projects.length > 1
  );

  console.log(`🔍 找到 ${duplicateGroups.length} 组重复项目`);

  return duplicateGroups;
}

/**
 * 清理重复项目
 */
async function cleanupDuplicates(dryRun = true) {
  const duplicateGroups = await findDuplicateProjects();

  if (duplicateGroups.length === 0) {
    console.log("✅ 没有发现重复项目");
    return;
  }

  console.log("\n" + "=".repeat(80));
  console.log(`发现 ${duplicateGroups.length} 组重复项目`);
  console.log("=".repeat(80) + "\n");

  let totalToDelete = 0;
  let totalRelationshipsToUpdate = 0;

  for (const [normalizedLink, projects] of duplicateGroups) {
    console.log(`\n📦 重复组: ${projects[0].projectName}`);
    console.log(`   标准化 URL: ${normalizedLink}`);
    console.log(`   重复数量: ${projects.length}`);

    // 保留 ID 最小的（最早创建的）
    const keepProject = projects[0]; // 已经按 ID 排序
    const deleteProjects = projects.slice(1);

    console.log(
      `   ✅ 保留: ID=${keepProject.id}, Link=${keepProject.projectLink}`
    );
    console.log(`   🗑️  删除 ${deleteProjects.length} 个重复项:`);

    for (const deleteProject of deleteProjects) {
      console.log(
        `      - ID=${deleteProject.id}, Link=${deleteProject.projectLink}`
      );

      // 查找需要转移的投资关系
      const [asInvestorCount, asFundedCount] = await Promise.all([
        Fundraising.InvestmentRelationships.count({
          where: { investorProjectId: deleteProject.id },
        }),
        Fundraising.InvestmentRelationships.count({
          where: { fundedProjectId: deleteProject.id },
        }),
      ]);

      if (asInvestorCount > 0 || asFundedCount > 0) {
        console.log(
          `        关联关系: 作为投资方 ${asInvestorCount} 条, 作为被投方 ${asFundedCount} 条`
        );
      }

      totalRelationshipsToUpdate += asInvestorCount + asFundedCount;
    }

    totalToDelete += deleteProjects.length;

    // 如果不是 dry run，执行实际的清理操作
    if (!dryRun) {
      for (const deleteProject of deleteProjects) {
        await cleanupSingleProject(deleteProject.id, keepProject.id);
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 统计信息:");
  console.log(`   - 将删除 ${totalToDelete} 个重复项目`);
  console.log(`   - 需要更新 ${totalRelationshipsToUpdate} 条投资关系`);
  console.log("=".repeat(80) + "\n");

  if (dryRun) {
    console.log("⚠️  这是 DRY RUN 模式，未执行实际删除操作");
    console.log(
      "💡 要执行实际清理，请运行: node cleanup-duplicate-projects.js --execute"
    );
  } else {
    console.log("✅ 清理完成！");
  }
}

/**
 * 清理单个重复项目
 */
async function cleanupSingleProject(deleteProjectId, keepProjectId) {
  const transaction = await Fundraising.Project.sequelize.transaction();

  try {
    console.log(`\n🔧 开始处理项目 ID=${deleteProjectId}...`);

    // 策略：先删除会产生重复的关系，再转移不会重复的关系
    // 这样可以避免唯一约束冲突

    // 1. 删除作为投资方时会产生重复的关系
    const deleteInvestorDuplicatesQuery = `
      DELETE FROM "InvestmentRelationships" 
      WHERE id IN (
        SELECT r1.id
        FROM "InvestmentRelationships" r1
        WHERE r1."investorProjectId" = :deleteProjectId
          AND EXISTS (
            SELECT 1 
            FROM "InvestmentRelationships" r2
            WHERE r2."investorProjectId" = :keepProjectId
              AND r2."fundedProjectId" = r1."fundedProjectId"
              AND COALESCE(r2."round", '') = COALESCE(r1."round", '')
          )
      )
    `;

    const [deletedInvestorDuplicates] =
      await Fundraising.Project.sequelize.query(deleteInvestorDuplicatesQuery, {
        replacements: { deleteProjectId, keepProjectId },
        transaction,
      });

    if (deletedInvestorDuplicates > 0) {
      console.log(`   🗑️  删除投资方重复关系: ${deletedInvestorDuplicates} 条`);
    }

    // 2. 删除作为被投方时会产生重复的关系
    const deleteFundedDuplicatesQuery = `
      DELETE FROM "InvestmentRelationships" 
      WHERE id IN (
        SELECT r1.id
        FROM "InvestmentRelationships" r1
        WHERE r1."fundedProjectId" = :deleteProjectId
          AND EXISTS (
            SELECT 1 
            FROM "InvestmentRelationships" r2
            WHERE r2."fundedProjectId" = :keepProjectId
              AND r2."investorProjectId" = r1."investorProjectId"
              AND COALESCE(r2."round", '') = COALESCE(r1."round", '')
          )
      )
    `;

    const [deletedFundedDuplicates] = await Fundraising.Project.sequelize.query(
      deleteFundedDuplicatesQuery,
      {
        replacements: { deleteProjectId, keepProjectId },
        transaction,
      }
    );

    if (deletedFundedDuplicates > 0) {
      console.log(`   🗑️  删除被投方重复关系: ${deletedFundedDuplicates} 条`);
    }

    // 3. 转移剩余的不会重复的关系（作为投资方）
    const investorUpdateCount =
      await Fundraising.InvestmentRelationships.update(
        { investorProjectId: keepProjectId },
        {
          where: { investorProjectId: deleteProjectId },
          transaction,
        }
      );
    console.log(`   ✅ 转移投资方关系: ${investorUpdateCount[0]} 条`);

    // 4. 转移剩余的不会重复的关系（作为被投方）
    const fundedUpdateCount = await Fundraising.InvestmentRelationships.update(
      { fundedProjectId: keepProjectId },
      {
        where: { fundedProjectId: deleteProjectId },
        transaction,
      }
    );
    console.log(`   ✅ 转移被投方关系: ${fundedUpdateCount[0]} 条`);

    // 5. 删除项目
    await Fundraising.Project.destroy({
      where: { id: deleteProjectId },
      transaction,
    });
    console.log(`   ✅ 删除项目: ID=${deleteProjectId}`);

    // 提交事务
    await transaction.commit();
    console.log(`   ✅ 项目 ID=${deleteProjectId} 清理完成`);
  } catch (error) {
    await transaction.rollback();
    console.error(`   ❌ 清理失败: ${error.message}`);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  console.log("🚀 开始清理重复项目...\n");

  if (dryRun) {
    console.log("⚠️  DRY RUN 模式: 只分析，不执行实际删除");
    console.log(
      "💡 要执行实际清理，请运行: node cleanup-duplicate-projects.js --execute\n"
    );
  } else {
    console.log("⚠️  执行模式: 将执行实际的删除和更新操作！");
    console.log("⏳ 5 秒后开始...\n");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    await cleanupDuplicates(dryRun);
  } catch (error) {
    console.error("\n❌ 执行失败:", error);
    process.exit(1);
  }

  process.exit(0);
}

// 运行脚本
if (require.main === module) {
  main();
}

module.exports = { normalizeUrl, findDuplicateProjects, cleanupDuplicates };
