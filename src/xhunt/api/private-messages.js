const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { XPrivateMessage, XHuntUser } = require("../../models/postgres-start");
const { Op } = require("sequelize");
const { getRedisClient } = require("../../lib/redisClient");

const router = express.Router();

/**
 * 查询用户的私信列表
 * GET /api/xhunt/private-messages
 * 需要验证token，返回当前用户的私信列表
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, isRead, type = "received" } = req.query;

    // 参数验证
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: "分页参数无效，page >= 1, limit >= 1 且 <= 100",
      });
    }

    if (!["received", "sent", "all"].includes(type)) {
      return res.status(400).json({
        error: "type参数无效，必须是 received、sent 或 all",
      });
    }

    // 构建查询条件
    let whereCondition = {};
    let includeCondition = [];

    if (type === "received") {
      whereCondition.receiverId = userId;
      includeCondition.push({
        model: XHuntUser,
        as: "sender",
        attributes: ["id", "username", "twitterId", "avatar"],
      });
    } else if (type === "sent") {
      whereCondition.senderId = userId;
      includeCondition.push({
        model: XHuntUser,
        as: "receiver",
        attributes: ["id", "username", "twitterId", "avatar"],
      });
    } else if (type === "all") {
      whereCondition = {
        [Op.or]: [{ receiverId: userId }, { senderId: userId }],
      };
      includeCondition = [
        {
          model: XHuntUser,
          as: "sender",
          attributes: ["id", "username", "twitterId", "avatar"],
        },
        {
          model: XHuntUser,
          as: "receiver",
          attributes: ["id", "username", "twitterId", "avatar"],
        },
      ];
    }

    // 添加已读状态过滤
    if (isRead !== undefined) {
      whereCondition.isRead = isRead === "true";
    }

    // 添加时间过滤：只显示当前时间可展示的消息
    whereCondition.displayAt = {
      [Op.lte]: new Date(),
    };

    // 查询私信列表
    const { count, rows: messages } = await XPrivateMessage.findAndCountAll({
      where: whereCondition,
      include: includeCondition,
      order: [["sentAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // 格式化返回数据
    const formattedMessages = messages.map((message) => {
      const baseMessage = {
        id: message.id,
        title: message.title,
        content: message.content,
        displayAt: message.displayAt,
        sentAt: message.sentAt,
        isRead: message.isRead,
        campaignId: message.campaignId,
      };

      if (type === "received") {
        baseMessage.sender = message.sender;
      } else if (type === "sent") {
        baseMessage.receiver = message.receiver;
      } else {
        // type === "all"
        baseMessage.sender = message.sender;
        baseMessage.receiver = message.receiver;
        baseMessage.isOutgoing = message.senderId === userId;
      }

      return baseMessage;
    });

    // 计算分页信息
    const totalPages = Math.ceil(count / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    // 设置前端缓存：私有缓存 20 分钟
    res.set("Cache-Control", "private, max-age=1200");

    return res.status(200).json({
      success: true,
      data: {
        messages: formattedMessages,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount: count,
          hasNext,
          hasPrev,
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    console.error("查询私信列表失败:", error);
    return res.status(500).json({
      error: "服务器内部错误",
      message: "查询私信列表时发生错误",
    });
  }
});

/**
 * 按类型批量发送私信（内部管理使用）
 * POST /api/xhunt/private-messages/send-batch-by-type
 * body: {
 *   // 私信类型（英文枚举值）：
 *   // - "creator_verification_success"（创作者认证成功）
 *   // - "creator_verification_failed"（创作者认证失败）
 *   // - "kol_tip_received"（收到KOL打赏奖励）
 *   // - "kol_tip_auto_refund"（KOL打赏奖励未领取自动退回）
 *   // - "kol_tip_refund_received"（KOL收到退回的奖励）
 *   type: string,
 *   // 传入 X（Twitter）侧的用户 ID 列表，对应 XHuntUser.twitterId 字段
 *   twitterIdList: string[],
 * }
 * displayAt 统一取当前时间；
 * campaignId 统一为：type + 当天日期（yyyyMMdd）
 * 根据 type 决定不同的内容（目前内容生成逻辑预留，先空着）
 */
router.post("/send-batch-by-type", async (req, res) => {
  try {
    const senderId = "6666666d-cc11-8888-8888-034d3e9a8888";
    const { type, twitterIdList } = req.body || {};

    // 支持的英文类型枚举（value 即为前端需要传的 type 值）
    const ALLOWED_TYPES = new Set([
      "creator_verification_success", // 创作者认证成功
      "creator_verification_failed", // 创作者认证失败
      "kol_tip_received", // 收到KOL打赏奖励
      "kol_tip_auto_refund", // KOL打赏奖励未领取自动退回
      "kol_tip_refund_received", // KOL收到退回的奖励
    ]);

    // 基本参数校验
    if (!type || typeof type !== "string") {
      return res.status(400).json({
        success: false,
        error: "type 参数必填且必须为字符串",
      });
    }

    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        error:
          "type 无效，请使用英文枚举值: creator_verification_success / creator_verification_failed / kol_tip_received / kol_tip_auto_refund / kol_tip_refund_received",
      });
    }

    if (
      !Array.isArray(twitterIdList) ||
      twitterIdList.length === 0 ||
      !twitterIdList.every((id) => typeof id === "string")
    ) {
      return res.status(400).json({
        success: false,
        error: "twitterIdList 必须是非空字符串数组",
      });
    }

    // 展示时间：统一为当前时间
    const displayAtDate = new Date();

    // campaignId：type + 当天日期和小时（yyyyMMddHH）
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const HH = String(today.getHours()).padStart(2, "0");
    const campaignId = `${type}${yyyy}${mm}${dd}${HH}`;

    /**
     * 根据 type 生成不同的标题和内容
     * 文案风格参考 send-kol-reports，使用中英文结合 + Markdown 文本
     */
    function getMessageTemplateByType(messageType) {
      switch (messageType) {
        case "creator_verification_success":
          return {
            title: "创作者认证通过",
            content:
              "亲爱的创作者，\n\n" +
              "恭喜你！你的创作者认证 **已通过审核** 。🎉\n\n" +
              "从现在开始，你将享有：\n" +
              "• 💰 开通「互动赚钱」功能，真实互动将转化为实际收益\n" +
              "• 🪙 解锁 XHunt Earn 区域相关功能和后续激励玩法\n" +
              "请持续保持高质量创作，我们会根据你的长期表现，解锁更多玩法与权益。\n\n" +
              "感谢你对 XHunt 的支持！",
          };
        case "creator_verification_failed":
          return {
            title: "创作者认证未通过",
            content:
              "亲爱的创作者，\n\n" +
              "很抱歉，此次你的创作者认证 **未能通过审核** 。\n\n" +
              "主要原因是：\n" +
              "• 📉 最近 30 天内暂未检测到足够的高质量推文或内容表现。\n\n" +
              "建议你在接下来的 30 天内：\n" +
              "• 持续稳定地产出高质量内容\n" +
              "• 提升真实互动（评论、转发、点赞等）\n\n" +
              "当前申请通道已关闭，你可以在 **30 天后重新发起创作者认证申请**。\n" +
              "我们也非常期待看到你接下来的成长与表现。💪",
          };
        case "kol_tip_received":
          return {
            title: "你收到一笔 KOL 打赏奖励",
            content:
              "亲爱的创作者，\n\n" +
              "你刚刚 **收到一笔 KOL 打赏奖励**。🎁\n\n" +
              "你可以前往打赏页查看本次奖励的具体金额和来源详情：\n" +
              '<a href="#rewardPage">前往打赏页查看详情</a>\n\n' +
              "感谢你持续为社区贡献价值内容！",
          };
        case "kol_tip_auto_refund":
          return {
            title: "你的 KOL 打赏奖励已自动退回",
            content:
              "你好，\n\n" +
              "你之前发起的一笔 **KOL 打赏奖励已自动退回** ，相关金额已回到你的账户。\n\n" +
              "你可以在打赏页中查看本次退回的详细记录：\n" +
              '<a href="#rewardPage">前往打赏页查看详情</a>\n\n' +
              "感谢你对创作者生态的支持！",
          };
        case "kol_tip_refund_received":
          return {
            title: "你收到一笔退回的 KOL 奖励",
            content:
              "你好，\n\n" +
              "你已 **收到一笔退回的 KOL 奖励** ，相关金额已回到你的账户。\n\n" +
              "你可以在打赏页中查看本次退回奖励的来源和明细：\n" +
              '<a href="#rewardPage">前往打赏页查看详情</a>\n\n' +
              "如果你有任何疑问，欢迎通过支持渠道联系我们。🙏",
          };
        default:
          return {
            title: "",
            content: "",
          };
      }
    }

    const template = getMessageTemplateByType(type);

    // 去重后根据 twitterId 批量查询对应的 XHuntUser（拿到真正的 user.id）
    const uniqueTwitterIds = Array.from(new Set(twitterIdList));

    const targetUsers = await XHuntUser.findAll({
      where: {
        twitterId: uniqueTwitterIds,
      },
      attributes: ["id", "twitterId"],
    });

    const foundMap = new Map(
      targetUsers.map((u) => [u.twitterId, { id: u.id, twitterId: u.twitterId }])
    );

    const notFoundTwitterIds = uniqueTwitterIds.filter(
      (tid) => !foundMap.has(tid)
    );

    if (targetUsers.length === 0) {
      return res.status(404).json({
        success: false,
        error: "未找到任何匹配的用户，请确认 twitterIdList 是否正确",
        data: {
          notFoundTwitterIds,
        },
      });
    }

    /**
     * 限流规则：
     * - 同一用户 + 同一种 type，在 10 分钟（600 秒）内只允许触发一次
     * - 通过 Redis 记录一个带过期时间的 key，格式：
     *   xhunt:pm:send_limit:{type}:{userId}
     * - 如果 Redis 不可用，则降级为不做限流（保持原有行为）
     */
    const TEN_MINUTES = 10 * 60;
    let effectiveTargetUsers = targetUsers;
    let rateLimitedTwitterIds = [];

    try {
      const redisClient = await getRedisClient();
      const allowedUsers = [];

      for (const user of targetUsers) {
        const key = `xhunt:pm:send_limit:${type}:${user.id}`;
        // 只有在 10 分钟窗口内首次成功 SET NX 的用户才允许发送
        const setResult = await redisClient.set(key, "1", {
          EX: TEN_MINUTES,
          NX: true,
        });

        if (setResult === "OK") {
          allowedUsers.push(user);
        } else {
          rateLimitedTwitterIds.push(user.twitterId);
        }
      }

      effectiveTargetUsers = allowedUsers;
    } catch (redisError) {
      console.error("批量发送私信 Redis 限流失败，降级为全量发送:", redisError);
      // 保持 effectiveTargetUsers = targetUsers，不做限流
    }

    // 如果所有用户都被限流，则直接返回成功结果（但不真正发送）
    if (effectiveTargetUsers.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          success: [],
          notFoundTwitterIds,
          rateLimitedTwitterIds,
        },
      });
    }

    // 构造批量插入的数据（仅对未被限流的用户发送）
    const now = new Date();
    const messagesToCreate = effectiveTargetUsers.map((user) => ({
      senderId,
      receiverId: user.id,
      title: template.title,
      content: template.content,
      displayAt: displayAtDate,
      sentAt: now,
      isRead: false,
      campaignId,
    }));

    // 批量创建私信记录
    const createdMessages = await XPrivateMessage.bulkCreate(
      messagesToCreate,
      {
        returning: true,
      }
    );

    const results = {
      success: createdMessages.map((msg, index) => ({
        receiverId: msg.receiverId,
        messageId: msg.id,
        twitterId: effectiveTargetUsers[index]?.twitterId,
      })),
      notFoundTwitterIds,
      rateLimitedTwitterIds,
    };

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("批量发送私信失败:", error);
    return res.status(500).json({
      success: false,
      error: "服务器内部错误",
      message: "批量发送私信时发生错误",
    });
  }
});

// /**
//  * 查询单条私信详情
//  * GET /api/xhunt/private-messages/:id
//  * 需要验证token，返回指定私信的详细信息
//  */
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const messageId = req.params.id;

//     if (!messageId) {
//       return res.status(400).json({ error: "私信ID不能为空" });
//     }

//     // 查询私信详情
//     const message = await XPrivateMessage.findOne({
//       where: {
//         id: messageId,
//         [Op.or]: [{ receiverId: userId }, { senderId: userId }],
//       },
//       include: [
//         {
//           model: XHuntUser,
//           as: "sender",
//           attributes: ["id", "username", "twitterId", "avatar"],
//         },
//         {
//           model: XHuntUser,
//           as: "receiver",
//           attributes: ["id", "username", "twitterId", "avatar"],
//         },
//       ],
//     });

//     if (!message) {
//       return res.status(404).json({ error: "私信不存在或无权限访问" });
//     }

//     // 检查消息是否可展示
//     if (new Date() < message.displayAt) {
//       return res.status(403).json({ error: "该私信尚未到展示时间" });
//     }

//     // 如果是收件人且未读，标记为已读
//     if (message.receiverId === userId && !message.isRead) {
//       try {
//         await message.update({ isRead: true });
//         message.isRead = true;
//       } catch (updateError) {
//         console.warn("标记私信已读失败:", updateError);
//         // 不影响返回结果
//       }
//     }

//     // 格式化返回数据
//     const formattedMessage = {
//       id: message.id,
//       title: message.title,
//       content: message.content,
//       displayAt: message.displayAt,
//       sentAt: message.sentAt,
//       isRead: message.isRead,
//       campaignId: message.campaignId,
//       sender: message.sender,
//       receiver: message.receiver,
//       isOutgoing: message.senderId === userId,
//     };

//     return res.status(200).json({
//       success: true,
//       data: formattedMessage,
//     });
//   } catch (error) {
//     console.error("查询私信详情失败:", error);
//     return res.status(500).json({
//       error: "服务器内部错误",
//       message: "查询私信详情时发生错误",
//     });
//   }
// });

// /**
//  * 标记私信为已读
//  * PUT /api/xhunt/private-messages/:id/read
//  * 需要验证token，将指定私信标记为已读
//  */
// router.put("/:id/read", authenticateToken, async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const messageId = req.params.id;

//     if (!messageId) {
//       return res.status(400).json({ error: "私信ID不能为空" });
//     }

//     // 查询私信
//     const message = await XPrivateMessage.findOne({
//       where: {
//         id: messageId,
//         receiverId: userId,
//       },
//     });

//     if (!message) {
//       return res.status(404).json({ error: "私信不存在或无权限操作" });
//     }

//     // 检查消息是否可展示
//     if (new Date() < message.displayAt) {
//       return res.status(403).json({ error: "该私信尚未到展示时间" });
//     }

//     // 标记为已读
//     await message.update({ isRead: true });

//     return res.status(200).json({
//       success: true,
//       message: "私信已标记为已读",
//     });
//   } catch (error) {
//     console.error("标记私信已读失败:", error);
//     return res.status(500).json({
//       error: "服务器内部错误",
//       message: "标记私信已读时发生错误",
//     });
//   }
// });

// /**
//  * 获取用户私信统计信息
//  * GET /api/xhunt/private-messages/stats/overview
//  * 需要验证token，返回当前用户的私信统计信息
//  */
// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     const userId = req.user.id;

//     // 查询统计信息
//     const [totalReceived, unreadCount, totalSent] = await Promise.all([
//       // 收到的私信总数
//       XPrivateMessage.count({
//         where: {
//           receiverId: userId,
//           displayAt: { [Op.lte]: new Date() },
//         },
//       }),
//       // 未读私信数量
//       XPrivateMessage.count({
//         where: {
//           receiverId: userId,
//           isRead: false,
//           displayAt: { [Op.lte]: new Date() },
//         },
//       }),
//       // 发送的私信总数
//       XPrivateMessage.count({
//         where: {
//           senderId: userId,
//         },
//       }),
//     ]);

//     return res.status(200).json({
//       success: true,
//       data: {
//         totalReceived,
//         unreadCount,
//         totalSent,
//         totalMessages: totalReceived + totalSent,
//       },
//     });
//   } catch (error) {
//     console.error("获取私信统计信息失败:", error);
//     return res.status(500).json({
//       error: "服务器内部错误",
//       message: "获取私信统计信息时发生错误",
//     });
//   }
// });

module.exports = router;
