const express = require("express");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");
const { XhuntVipTestUser } = require("../../../models/postgres-start");
const { loadVipLists, notifyRefresh } = require("../../constants/xhuntVip");
const { logAdminAction } = require("./shared");

const router = express.Router();

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function serializeVipUser(row) {
  return {
    id: row.id,
    username: row.username,
  };
}

async function refreshVipCache() {
  await loadVipLists();
  await notifyRefresh();
}

router.get(
  "/vip-lists",
  adminAuth,
  requirePermission(["vip-management", "feature_flags_config"]),
  async (req, res) => {
    try {
      const rows = await XhuntVipTestUser.findAll({
        attributes: ["id", "username", "listType"],
        order: [
          ["listType", "ASC"],
          ["username", "ASC"],
        ],
      });

      res.json({
        success: true,
        data: {
          vip: rows.filter((row) => row.listType === "vip").map(serializeVipUser),
          internalTest: rows
            .filter((row) => row.listType === "internal_test")
            .map(serializeVipUser),
        },
      });
    } catch (error) {
      console.error("[vip-lists] 获取失败:", error);
      res.status(500).json({ success: false, error: error.message || "获取 VIP 名单失败" });
    }
  }
);

router.post(
  "/vip-lists/add",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    const { listType, username } = req.body || {};
    try {
      if (!["vip", "internal_test"].includes(listType)) {
        return res.status(400).json({ success: false, error: "listType 必须是 vip 或 internal_test" });
      }

      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        return res.status(400).json({ success: false, error: "username 不能为空" });
      }

      const [row, created] = await XhuntVipTestUser.findOrCreate({
        where: {
          username: normalizedUsername,
          listType,
        },
        defaults: {
          username: normalizedUsername,
          listType,
        },
      });

      await refreshVipCache();
      await logAdminAction(req, {
        action: "vip-list-add",
        success: true,
        message: `listType=${listType} username=${normalizedUsername} created=${created}`,
      });

      res.json({
        success: true,
        data: serializeVipUser(row),
        created,
      });
    } catch (error) {
      console.error("[vip-lists/add] 添加失败:", error);
      await logAdminAction(req, {
        action: "vip-list-add",
        success: false,
        message: error.message || "添加失败",
      });
      res.status(500).json({ success: false, error: error.message || "添加失败" });
    }
  }
);

router.delete(
  "/vip-lists/:id",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "无效的名单 ID" });
      }

      const row = await XhuntVipTestUser.findByPk(id);
      if (!row) {
        return res.status(404).json({ success: false, error: "名单用户不存在" });
      }

      const message = `listType=${row.listType} username=${row.username}`;
      await row.destroy();
      await refreshVipCache();
      await logAdminAction(req, {
        action: "vip-list-delete",
        success: true,
        message,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("[vip-lists/delete] 删除失败:", error);
      await logAdminAction(req, {
        action: "vip-list-delete",
        success: false,
        message: error.message || "删除失败",
      });
      res.status(500).json({ success: false, error: error.message || "删除失败" });
    }
  }
);

module.exports = router;
