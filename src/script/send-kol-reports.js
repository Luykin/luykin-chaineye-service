// 加载环境变量
require("dotenv").config({ path: ".env-dev" });

const { Op } = require("sequelize");
const { XHuntUser, XPrivateMessage } = require("../models/postgres-start");

/**
 * 给KOL发送专属报告私信
 * @param {string} campaignId - 活动标识
 * @param {string} senderId - 发信人ID
 * @param {Array<string>} usernames - 推特用户名数组
 * @param {Date} displayAt - 展示时间
 */
async function sendKolReports(
  campaignId,
  senderId,
  usernames,
  displayAt = new Date()
) {
  console.log(`开始执行KOL报告活动 ${campaignId} 的私信发送...`);
  console.log(`目标用户: ${usernames.join(", ")}\n`);

  const results = {
    success: [],
    notFound: [],
    alreadySent: [],
    errors: [],
  };

  for (const username of usernames) {
    try {
      console.log(`处理用户: ${username}`);

      // 查找用户（大小写不敏感）
      const user = await XHuntUser.findOne({
        where: {
          username: {
            [Op.iLike]: username,
          },
        },
      });

      if (!user) {
        console.log(`用户 ${username} 未找到`);
        results.notFound.push(username);
        continue;
      }

      // 检查是否已经发送过相同活动的消息
      const existingMessage = await XPrivateMessage.findOne({
        where: {
          receiverId: user.id,
          campaignId: campaignId,
        },
      });

      if (existingMessage) {
        console.log(`用户 ${username} 已经收到过活动 ${campaignId} 的消息`);
        results.alreadySent.push(username);
        continue;
      }

      // 生成专属报告链接（使用用户名和随机字符串）
      const reportId = `${username}-${generateRandomString(8)}`;
      const reportUrl = `https://xhunt.ai/kolreport/${reportId}`;

      // 创建私信内容
      const title = "🎉 您的专属KOL分析报告已生成！";
      const content = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>亲爱的 <strong>${username}</strong>，</p>
          
          <p>我们很高兴地通知您，您的专属KOL影响力分析报告已经生成完成！</p>
          
          <p>这份报告包含了：</p>
          <ul>
            <li>📊 您的粉丝增长趋势分析</li>
            <li>🎯 内容影响力评估</li>
            <li>📈 互动率数据统计</li>
            <li>🌟 在加密货币领域的专业度评分</li>
            <li>💡 个性化发展建议</li>
          </ul>
          
          <p style="margin: 20px 0;">
            <a href="${reportUrl}" 
               style="background-color: #1DA1F2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              🔍 查看我的专属报告
            </a>
          </p>
          
          <p>这份报告将帮助您更好地了解自己在加密货币社区中的影响力，并为未来的内容创作提供数据支持。</p>
          
          <p>感谢您对CryptoHunt社区的支持！</p>
          
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            CryptoHunt团队<br>
            <small>报告链接: ${reportUrl}</small>
          </p>
        </div>
      `;

      // 创建私信记录
      const message = await XPrivateMessage.create({
        senderId: senderId,
        receiverId: user.id,
        title: title,
        content: content,
        displayAt: displayAt,
        sentAt: new Date(),
        isRead: false,
        campaignId: campaignId,
      });

      console.log(`✅ 成功发送报告给用户 ${username} (ID: ${user.id})`);
      console.log(`   报告链接: ${reportUrl}`);
      results.success.push({
        username: username,
        userId: user.id,
        messageId: message.id,
        reportUrl: reportUrl,
      });
    } catch (error) {
      console.error(`❌ 处理用户 ${username} 时出错:`, error.message);
      results.errors.push({
        username: username,
        error: error.message,
      });
    }
  }

  // 输出结果统计
  console.log("\n=== 发送结果统计 ===");
  console.log(`✅ 成功发送: ${results.success.length} 条`);
  console.log(`❓ 用户未找到: ${results.notFound.length} 个`);
  console.log(`🔄 已发送过: ${results.alreadySent.length} 个`);
  console.log(`❌ 发送失败: ${results.errors.length} 个`);

  if (results.success.length > 0) {
    console.log("\n📋 成功发送的用户及报告链接:");
    results.success.forEach((item) => {
      console.log(`   ${item.username}: ${item.reportUrl}`);
    });
  }

  if (results.notFound.length > 0) {
    console.log("\n❓ 未找到的用户:");
    results.notFound.forEach((username) => console.log(`   - ${username}`));
  }

  if (results.alreadySent.length > 0) {
    console.log("\n🔄 已发送过的用户:");
    results.alreadySent.forEach((username) => console.log(`   - ${username}`));
  }

  if (results.errors.length > 0) {
    console.log("\n❌ 发送失败的用户:");
    results.errors.forEach((item) =>
      console.log(`   - ${item.username}: ${item.error}`)
    );
  }

  return results;
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string}
 */
function generateRandomString(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 如果直接运行此脚本
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(`
使用方法: node send-kol-reports.js <campaignId> <senderId> <usernames>

参数:
  campaignId  - 活动标识 (如: kol_report_20250127)
  senderId    - 发信人ID (UUID)
  usernames   - 推特用户名，用逗号分隔 (如: FloriaT96249,luoyukun4)

示例:
  node send-kol-reports.js kol_report_20250127 your-sender-uuid "FloriaT96249,luoyukun4"
    `);
    process.exit(1);
  }

  const [campaignId, senderId, usernamesStr] = args;
  const usernames = usernamesStr
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u);

  console.log(`活动ID: ${campaignId}`);
  console.log(`发信人ID: ${senderId}`);
  console.log(`目标用户: ${usernames.join(", ")}\n`);

  sendKolReports(campaignId, senderId, usernames)
    .then(() => {
      console.log("\n🎉 脚本执行完成！");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ 脚本执行失败:", error);
      process.exit(1);
    });
}

module.exports = {
  sendKolReports,
};
