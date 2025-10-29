/**
 * 调试脚本：验证 Polychain 数据
 * 问题1: 检查为什么 API 调用返回空数据
 * 问题2: 验证数据库中的 total_funding 数据
 */

const { Fundraising, pgInstance } = require("../models/postgres-fundraising");
const axios = require("axios");

// Rootdata API 配置
const ROOTDATA_API_BASE = "https://api.rootdata.com/open";
const ROOTDATA_API_KEY = "0TpF08MLXdb50VCGx1H8buExoMwgADbR";

/**
 * 从 URL 中提取 project_id
 */
function extractProjectId(projectLink) {
  if (!projectLink) return null;

  const match = projectLink.match(/[?&]k=([^&]+)/);
  if (!match) return null;

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    return decoded;
  } catch (error) {
    console.error("Failed to decode project_id:", error);
    return null;
  }
}

/**
 * 调用 Rootdata API 获取融资信息
 */
async function getFundingInfo(projectId) {
  try {
    console.log(`\n📡 调用 Rootdata API...`);
    console.log(`   Project ID: ${projectId}`);

    const response = await axios.post(
      `${ROOTDATA_API_BASE}/get_fac`,
      { project_id: projectId },
      {
        headers: {
          apikey: ROOTDATA_API_KEY,
          language: "en",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    console.log(`\n📥 API 响应:`);
    console.log(`   状态码: ${response.status}`);
    console.log(`   result: ${response.data?.result}`);
    console.log(`   items 数量: ${response.data?.data?.items?.length || 0}`);

    if (response.data?.data?.items?.length > 0) {
      console.log(`\n📊 融资轮次详情:`);
      response.data.data.items.forEach((item, index) => {
        console.log(`\n   轮次 ${index + 1}:`);
        console.log(`      Round: ${item.rounds || "N/A"}`);
        console.log(`      Amount: ${item.amount || "N/A"}`);
        console.log(`      Date: ${item.published_time || "N/A"}`);
        console.log(`      Investors: ${item.invests?.length || 0}`);

        if (item.invests && item.invests.length > 0) {
          console.log(`\n      投资者列表 (前5个):`);
          item.invests.slice(0, 5).forEach((inv, idx) => {
            console.log(
              `         ${idx + 1}. ${inv.name} (Lead: ${
                inv.lead_investor === 1
              })`
            );
          });
        }
      });
    }

    return response.data;
  } catch (error) {
    console.error("\n❌ API 调用失败:");
    console.error(`   错误信息: ${error.message}`);
    if (error.response) {
      console.error(`   响应状态: ${error.response.status}`);
      console.error(`   响应数据:`, error.response.data);
    }
    throw error;
  }
}

/**
 * 查询数据库中的数据
 */
async function queryDatabaseData(keyword) {
  console.log(`\n🔍 查询数据库中的数据...`);
  console.log(`   关键词: ${keyword}`);

  const targetTwitterUrl = `https://x.com/${keyword}`;

  // 方式1: 通过 twitterUrl 查找
  let project = await Fundraising.Project.findOne({
    where: {
      twitterUrl: targetTwitterUrl,
    },
    raw: true,
  });

  if (!project) {
    console.log(`\n⚠️ 未通过 twitterUrl 找到项目，尝试其他方式...`);

    // 方式2: 通过项目名称查找（模糊匹配）
    const { Op } = require("sequelize");
    project = await Fundraising.Project.findOne({
      where: {
        projectName: {
          [Op.iLike]: `%${keyword}%`,
        },
      },
      raw: true,
    });

    if (project) {
      console.log(`✅ 通过项目名称找到匹配项目`);
    }
  } else {
    console.log(`✅ 通过 twitterUrl 找到项目`);
  }

  // 方式3: 通过 projectLink 查找
  if (!project) {
    project = await Fundraising.Project.findOne({
      where: {
        projectLink:
          "https://www.rootdata.com/Investors/detail/Polychain?k=MTQ2",
      },
      raw: true,
    });

    if (project) {
      console.log(`✅ 通过 projectLink 找到项目`);
    }
  }

  if (!project) {
    console.log(`\n❌ 所有查询方式都未找到匹配的项目`);

    // 显示一些可能匹配的项目
    const { Op } = require("sequelize");
    const similarProjects = await Fundraising.Project.findAll({
      where: {
        [Op.or]: [
          { projectName: { [Op.iLike]: "%poly%" } },
          { projectName: { [Op.iLike]: "%chain%" } },
        ],
      },
      limit: 5,
      raw: true,
    });

    if (similarProjects.length > 0) {
      console.log(`\n💡 找到 ${similarProjects.length} 个可能相关的项目:`);
      similarProjects.forEach((p, idx) => {
        console.log(`\n   ${idx + 1}. ${p.projectName}`);
        console.log(`      ID: ${p.id}`);
        console.log(`      Link: ${p.projectLink}`);
        console.log(`      Twitter: ${p.twitterUrl || "N/A"}`);
      });
    }

    return null;
  }

  console.log(`\n✅ 找到项目:`);
  console.log(`   ID: ${project.id}`);
  console.log(`   名称: ${project.projectName}`);
  console.log(`   链接: ${project.projectLink}`);
  console.log(`   Twitter: ${project.twitterUrl}`);

  // 查询收到的投资（作为被投项目）
  const investmentsReceived = await Fundraising.InvestmentRelationships.findAll(
    {
      where: { fundedProjectId: project.id },
      include: [
        {
          model: Fundraising.Project,
          as: "investorProject",
          attributes: ["projectName", "logo"],
        },
      ],
      raw: true,
      nest: true,
    }
  );

  console.log(`\n📊 收到的投资 (investmentsReceived):`);
  console.log(`   数量: ${investmentsReceived.length}`);

  if (investmentsReceived.length > 0) {
    console.log(`\n   前5条记录:`);
    investmentsReceived.slice(0, 5).forEach((inv, idx) => {
      console.log(
        `\n   ${idx + 1}. ${inv.investorProject?.projectName || "N/A"}`
      );
      console.log(`      Round: ${inv.round || "N/A"}`);
      console.log(`      Amount: ${inv.amount || "N/A"}`);
      console.log(`      Formatted Amount: ${inv.formattedAmount || "N/A"}`);
      console.log(`      Date: ${inv.date || "N/A"}`);
      console.log(`      Lead: ${inv.lead || false}`);
    });

    // 计算 total_funding
    const totalFunding = investmentsReceived.reduce(
      (sum, inv) => sum + (inv.formattedAmount || 0),
      0
    );
    console.log(`\n   💰 Total Funding (收到): ${totalFunding}`);
  }

  // 查询投出的项目（作为投资者）
  const investmentsGiven = await Fundraising.InvestmentRelationships.findAll({
    where: { investorProjectId: project.id },
    include: [
      {
        model: Fundraising.Project,
        as: "fundedProject",
        attributes: ["projectName", "logo"],
      },
    ],
    raw: true,
    nest: true,
  });

  console.log(`\n📊 投出的项目 (investmentsGiven):`);
  console.log(`   数量: ${investmentsGiven.length}`);

  if (investmentsGiven.length > 0) {
    console.log(`\n   前10条记录:`);
    investmentsGiven.slice(0, 10).forEach((inv, idx) => {
      console.log(
        `\n   ${idx + 1}. ${inv.fundedProject?.projectName || "N/A"}`
      );
      console.log(`      Round: ${inv.round || "N/A"}`);
      console.log(`      Amount: ${inv.amount || "N/A"}`);
      console.log(`      Formatted Amount: ${inv.formattedAmount || "N/A"}`);
      console.log(`      Date: ${inv.date || "N/A"}`);
      console.log(`      Lead: ${inv.lead || false}`);
    });

    // 计算 total_funding
    const totalInvestment = investmentsGiven.reduce(
      (sum, inv) => sum + (inv.formattedAmount || 0),
      0
    );
    console.log(`\n   💰 Total Investment (投出): ${totalInvestment}`);
  }

  return { project, investmentsReceived, investmentsGiven };
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log("=".repeat(80));
    console.log("🔍 Polychain 数据调试脚本");
    console.log("=".repeat(80));

    // 连接数据库
    console.log("\n🔌 连接 PostgreSQL 数据库...");
    await pgInstance.authenticate();
    console.log("✅ 数据库连接成功");

    // ============ 问题1: 检查 API 调用 ============
    console.log("\n" + "=".repeat(80));
    console.log("问题1: 检查 Rootdata API 调用");
    console.log("=".repeat(80));

    const projectLink =
      "https://www.rootdata.com/Investors/detail/Polychain?k=MTQ2";
    const projectId = extractProjectId(projectLink);

    if (projectId) {
      try {
        const apiData = await getFundingInfo(projectId);
        if (apiData?.data?.items?.length > 0) {
          console.log(
            `\n✅ API 调用成功，返回了 ${apiData.data.items.length} 条融资记录`
          );
        } else {
          console.log(`\n⚠️ API 调用成功，但返回数据为空`);
          console.log(`   说明: Rootdata 的 get_fac 接口只返回"项目融资"数据`);
          console.log(`   对于投资机构(Investors)，该接口不返回其投资组合`);
          console.log(`   这是正常的，投资组合数据需要通过爬虫获取`);
        }
      } catch (error) {
        console.log(`\n❌ API 调用失败`);
      }
    } else {
      console.log(`\n❌ 无法从 URL 提取 project_id`);
    }

    // ============ 问题2: 检查数据库数据 ============
    console.log("\n" + "=".repeat(80));
    console.log("问题2: 检查数据库中的数据");
    console.log("=".repeat(80));

    const dbData = await queryDatabaseData("Polychain");

    // ============ 总结 ============
    console.log("\n" + "=".repeat(80));
    console.log("📝 总结");
    console.log("=".repeat(80));

    if (dbData) {
      console.log(`\n✅ 数据库中找到 Polychain 项目`);
      console.log(`   - 收到的投资: ${dbData.investmentsReceived.length} 条`);
      console.log(`   - 投出的项目: ${dbData.investmentsGiven.length} 条`);

      if (dbData.investmentsReceived.length === 0) {
        console.log(
          `\n💡 说明: Polychain 是投资机构，通常不会收到投资（invested 为空是正常的）`
        );
      }

      if (dbData.investmentsGiven.length > 0) {
        const hasAmount = dbData.investmentsGiven.some(
          (inv) => inv.formattedAmount && inv.formattedAmount > 0
        );
        if (!hasAmount) {
          console.log(
            `\n⚠️ 警告: 投资记录中没有金额数据，这可能导致 total_funding 为 0`
          );
          console.log(`   建议: 检查爬虫是否正确抓取了投资金额`);
        }
      }
    } else {
      console.log(`\n⚠️ 数据库中未找到 Polychain 项目`);
      console.log(`   建议: 检查 twitterUrl 字段是否正确设置`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✨ 调试完成");
    console.log("=".repeat(80));
  } catch (error) {
    console.error("\n💥 发生错误:", error);
    throw error;
  } finally {
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// 执行脚本
if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ 所有操作完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 脚本执行失败:", error);
      process.exit(1);
    });
}

module.exports = { main, queryDatabaseData, getFundingInfo };
