const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { XPrivateMessage, XHuntUser } = require("../../models/postgres-start");
const { Op } = require("sequelize");

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
