const express = require("express");
const { Op } = require("sequelize");
const { adminAuth, requirePermission } = require("../middleware/adminAuth");
const {
  XReviewForAccount,
  XHuntUser,
  XAccount,
  XhuntAdminAuditLog,
} = require("../../models/postgres-start");

const router = express.Router();

// 虚拟账号 ID（软删除目标）
const VIRTUAL_ACCOUNT_ID = "00000000-0000-0000-0000-000000000000";

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "");
}

function comparableHandle(value) {
  return normalizeHandle(value).toLowerCase();
}

function sortAccountCandidates(inputHandle, accounts) {
  const keyword = comparableHandle(inputHandle);
  return accounts.sort((a, b) => {
    const aHandle = comparableHandle(a.handle);
    const bHandle = comparableHandle(b.handle);
    const score = (handle) => {
      if (handle === keyword) return 0;
      if (handle.startsWith(keyword)) return 1;
      if (handle.includes(keyword)) return 2;
      return 3;
    };
    const scoreDiff = score(aHandle) - score(bHandle);
    if (scoreDiff !== 0) return scoreDiff;
    return aHandle.length - bHandle.length;
  });
}

/**
 * GET /api/admin/reviews
 * 通过 handle 搜索评论
 * 权限: reviews-management
 */
router.get(
  "/",
  adminAuth,
  requirePermission("reviews-management"),
  async (req, res) => {
    try {
      const { handle } = req.query;

      if (!handle || typeof handle !== "string") {
        return res.status(400).json({
          success: false,
          error: "缺少 handle 参数",
        });
      }

      const normalizedHandle = normalizeHandle(handle);
      if (!normalizedHandle) {
        return res.status(400).json({
          success: false,
          error: "handle 不能为空",
        });
      }

      // 1. 查找被评论人账号（大小写不敏感）
      // 先精确匹配；如果运营输入的是片段（例如 teddy），再按 handle 做 startsWith / contains 候选。
      let targetAccount = await XAccount.findOne({
        where: {
          [Op.or]: [
            { handle: { [Op.iLike]: normalizedHandle } },
            { handle: { [Op.iLike]: `@${normalizedHandle}` } },
          ],
        },
        attributes: ["id", "handle", "displayName", "avatar"],
      });

      if (!targetAccount) {
        const candidates = await XAccount.findAll({
          where: {
            [Op.or]: [
              { handle: { [Op.iLike]: `${normalizedHandle}%` } },
              { handle: { [Op.iLike]: `@${normalizedHandle}%` } },
              { handle: { [Op.iLike]: `%${normalizedHandle}%` } },
            ],
          },
          attributes: ["id", "handle", "displayName", "avatar"],
          limit: 30,
        });
        targetAccount = sortAccountCandidates(normalizedHandle, candidates)[0] || null;
      }

      if (!targetAccount) {
        return res.json({
          success: true,
          data: {
            targetAccount: {
              handle: normalizedHandle,
              displayName: null,
              avatar: null,
            },
            reviews: [],
            total: 0,
          },
        });
      }

      // 2. 查询所有评论（关联评论人信息）
      const reviews = await XReviewForAccount.findAll({
        where: { xAccountId: targetAccount.id },
        include: [
          {
            model: XHuntUser,
            as: "xHuntUser",
            attributes: ["username", "displayName", "avatar"],
          },
        ],
        order: [["createdAt", "DESC"]],
      });

      // 3. 格式化返回数据
      const formatDateTime = (date) => {
        if (!date) return "";
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      };

      const formattedReviews = reviews.map((review) => ({
        id: review.id,
        reviewer: {
          username: review.xHuntUser?.username || "",
          displayName: review.xHuntUser?.displayName || review.userName || "",
          avatar: review.xHuntUser?.avatar || review.userAvatar || "",
        },
        targetHandle: targetAccount.handle,
        rating: parseFloat(review.rating || 0),
        tags: review.tags || [],
        comment: review.comment || "",
        createdAt: formatDateTime(review.createdAt),
      }));

      return res.json({
        success: true,
        data: {
          targetAccount: {
            handle: targetAccount.handle,
            displayName: targetAccount.displayName,
            avatar: targetAccount.avatar,
          },
          reviews: formattedReviews,
          total: formattedReviews.length,
        },
      });
    } catch (error) {
      console.error("[admin/reviews] 搜索评论失败:", error);
      return res.status(500).json({
        success: false,
        error: "搜索评论失败",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/reviews/delete
 * 软删除评论（将 xAccountId 指向虚拟账号）
 * 权限: reviews-management
 */
router.post(
  "/delete",
  adminAuth,
  requirePermission("reviews-management"),
  express.json(),
  async (req, res) => {
    try {
      const { reviewId } = req.body;
      const admin = req.adminUser;

      if (!reviewId || typeof reviewId !== "string") {
        return res.status(400).json({
          success: false,
          error: "缺少 reviewId 参数",
        });
      }

      // 1. 查找评论
      const review = await XReviewForAccount.findByPk(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          error: "评论不存在",
        });
      }

      // 2. 检查是否已经是软删除状态
      if (review.xAccountId === VIRTUAL_ACCOUNT_ID) {
        return res.status(400).json({
          success: false,
          error: "该评论已被删除",
        });
      }

      // 3. 检查/创建虚拟账号
      let virtualAccount = await XAccount.findByPk(VIRTUAL_ACCOUNT_ID);
      if (!virtualAccount) {
        try {
          virtualAccount = await XAccount.create({
            id: VIRTUAL_ACCOUNT_ID,
            handle: "_deleted_",
            displayName: "已删除账号",
            avatar: "",
            xId: "0",
            xLink: "",
            followers: 0,
            following: 0,
          });
        } catch (createError) {
          // 如果创建失败（如并发时其他请求已创建），再次查找
          virtualAccount = await XAccount.findByPk(VIRTUAL_ACCOUNT_ID);
          if (!virtualAccount) {
            throw createError;
          }
        }
      }

      // 4. 记录原 xAccountId（用于审计日志）
      const originalXAccountId = review.xAccountId;

      // 5. 更新评论指向虚拟账号
      await review.update({ xAccountId: VIRTUAL_ACCOUNT_ID });

      // 6. 记录审计日志
      try {
        await XhuntAdminAuditLog.create({
          adminId: admin.id,
          email: admin.email,
          action: "review-delete",
          route: "/api/admin/reviews/delete",
          method: "POST",
          ip: req.ip || "",
          userAgent: req.headers["user-agent"] || "",
          success: true,
          message: JSON.stringify({
            reviewId: review.id,
            originalXAccountId,
            virtualAccountId: VIRTUAL_ACCOUNT_ID,
            reviewerId: review.xHuntUserId,
          }),
        });
      } catch (auditError) {
        console.error("[admin/reviews] 审计日志记录失败:", auditError);
        // 不影响主流程，继续返回成功
      }

      return res.json({
        success: true,
        message: "评论已删除",
        data: {
          reviewId: review.id,
        },
      });
    } catch (error) {
      console.error("[admin/reviews] 删除评论失败:", error);
      return res.status(500).json({
        success: false,
        error: "删除评论失败",
        message: error.message,
      });
    }
  }
);

module.exports = router;
