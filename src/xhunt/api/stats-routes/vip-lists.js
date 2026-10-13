const express = require("express");
const axios = require("axios");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");
const { XhuntVipTestUser } = require("../../../models/postgres-start");
const { loadVipLists, notifyRefresh } = require("../../constants/xhuntVip");
const { logAdminAction } = require("./shared");
const { DATA_SERVICE_BASE_URL } = require("../../constants/dataService");
const { nacosRequest } = require("../../services/nacosConfigClient");

const router = express.Router();
const TWITTER_USER_LOOKUP_URL = `${DATA_SERVICE_BASE_URL}/fetch/twitter/user`;
const TWITTER_RANK_LOOKUP_URL = `${DATA_SERVICE_BASE_URL}/fetch/twitter/rank`;
const CREATOR_AUTH_URL = `${DATA_SERVICE_BASE_URL}/front/auth/creator`;
const CREATOR_SUBMIT_URL = `${DATA_SERVICE_BASE_URL}/front/auth/creator_submit`;
const CREATOR_SUBMIT_AUTH = process.env.XHUNT_CREATOR_SUBMIT_AUTH || "cd3c59e6-451d-44a8-9355-f4ead498b712";
const CREATOR_STATUS_LABELS = {
  0: "未认证",
  1: "认证中",
  2: "已认证",
  3: "认证失败",
  4: "认证撤销",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    twitterId: row.twitterId || null,
  };
}

function extractTwitterId(payload) {
  return String(
    payload?.data?.data?.id ||
      payload?.data?.id ||
      payload?.id ||
      ""
  ).trim();
}

async function fetchTwitterIdByUsername(username) {
  const response = await axios.get(TWITTER_USER_LOOKUP_URL, {
    params: { username },
    timeout: 8000,
  });
  return extractTwitterId(response.data);
}

function normalizeCreatorAuthRecord(item, requestedUsername) {
  const authCreator = item?.auth_creator || null;
  const status = authCreator?.status == null ? null : Number(authCreator.status);

  return {
    requestedUsername,
    username: item?.username || requestedUsername,
    found: !!item,
    twitterId: authCreator?.twitter_id || item?.user_id || null,
    authCreator: authCreator
      ? {
          recordTime: authCreator.record_time || null,
          status: Number.isFinite(status) ? status : null,
          statusLabel: CREATOR_STATUS_LABELS[status] || "未知状态",
          twitterId: authCreator.twitter_id || null,
        }
      : null,
  };
}

async function fetchCreatorAuthByUsername(username) {
  const response = await axios.get(TWITTER_RANK_LOOKUP_URL, {
    params: { usernames: username },
    timeout: 10000,
  });
  const list = response.data?.data?.data;
  const rows = Array.isArray(list) ? list : [];
  const matched = rows.find((item) => normalizeUsername(item?.username) === username) || rows[0] || null;
  return normalizeCreatorAuthRecord(matched, username);
}

async function refreshVipCache() {
  await loadVipLists();
  await notifyRefresh();
}

async function syncVipListsToFeatureFlags() {
  // Keep this operation scoped to list membership so VIP managers never receive
  // the general feature_flags_config permission or arbitrary config write access.
  const dataId = "xhunt_config";
  const group = "DEFAULT_GROUP";
  const readResp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
    params: { dataId, group },
  });

  if (readResp.status !== 200) {
    throw new Error("读取 Nacos xhunt_config 失败");
  }

  let config;
  try {
    const content = typeof readResp.data === "string" ? readResp.data : JSON.stringify(readResp.data);
    config = JSON.parse(content || "{}");
  } catch (error) {
    throw new Error("xhunt_config 不是合法 JSON");
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("xhunt_config 格式不正确");
  }

  const rows = await XhuntVipTestUser.findAll({
    attributes: ["username", "listType"],
  });
  const vipNames = rows.filter((row) => row.listType === "vip").map((row) => row.username);
  const internalTestNames = rows
    .filter((row) => row.listType === "internal_test")
    .map((row) => row.username);

  const canaryConfig =
    config.canaryConfig && typeof config.canaryConfig === "object" && !Array.isArray(config.canaryConfig)
      ? config.canaryConfig
      : {};
  const testConfig =
    config.testConfig && typeof config.testConfig === "object" && !Array.isArray(config.testConfig)
      ? config.testConfig
      : {};

  const existingCanaries = Array.isArray(canaryConfig.canaries) ? canaryConfig.canaries : [];
  const existingTesters = Array.isArray(testConfig.testers) ? testConfig.testers : [];
  canaryConfig.canaries = Array.from(new Set([...existingCanaries, ...vipNames]));
  testConfig.testers = Array.from(new Set([...existingTesters, ...internalTestNames]));
  config.canaryConfig = canaryConfig;
  config.testConfig = testConfig;

  const form = new URLSearchParams({
    dataId,
    group,
    content: JSON.stringify(config, null, 2),
    type: "json",
  });
  const publishResp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
    data: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (publishResp.status !== 200 || (publishResp.data !== true && publishResp.data !== "true")) {
    throw new Error("发布 Nacos xhunt_config 失败");
  }
}

async function syncMissingTwitterId(row) {
  if (row.twitterId) {
    return { updated: 0, skipped: 1, failed: 0 };
  }

  try {
    const twitterId = await fetchTwitterIdByUsername(row.username);
    if (!twitterId) {
      return { updated: 0, skipped: 0, failed: 1 };
    }

    row.twitterId = twitterId;
    await row.save();
    return { updated: 1, skipped: 0, failed: 0 };
  } catch (error) {
    return { updated: 0, skipped: 0, failed: 1 };
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.adminUser?.role === "super") return next();
  return res.status(403).json({ success: false, error: "仅超级管理员可操作" });
}

router.get(
  "/vip-lists",
  adminAuth,
  requirePermission(["vip-management", "feature_flags_config"]),
  async (req, res) => {
    try {
      const rows = await XhuntVipTestUser.findAll({
        attributes: ["id", "username", "twitterId", "listType"],
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
  "/vip-lists/sync-twitter-ids",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    const { force = true } = req.body || {};
    try {
      const rows = await XhuntVipTestUser.findAll({
        order: [
          ["listType", "ASC"],
          ["username", "ASC"],
        ],
      });

      const results = [];
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const row of rows) {
        if (!force && row.twitterId) {
          skipped += 1;
          results.push({ id: row.id, username: row.username, status: "skipped", twitterId: row.twitterId });
          continue;
        }

        try {
          const twitterId = await fetchTwitterIdByUsername(row.username);
          if (!twitterId) {
            failed += 1;
            results.push({ id: row.id, username: row.username, status: "failed", error: "未获取到 twitter id" });
            continue;
          }

          if (row.twitterId !== twitterId) {
            row.twitterId = twitterId;
            await row.save();
            updated += 1;
          } else {
            skipped += 1;
          }

          results.push({ id: row.id, username: row.username, status: "success", twitterId });
        } catch (error) {
          failed += 1;
          results.push({
            id: row.id,
            username: row.username,
            status: "failed",
            error: error.message || "同步失败",
          });
        }
      }

      await refreshVipCache();
      await logAdminAction(req, {
        action: "vip-list-sync-twitter-ids",
        success: true,
        message: `total=${rows.length} updated=${updated} skipped=${skipped} failed=${failed}`,
      });

      res.json({
        success: true,
        data: {
          total: rows.length,
          updated,
          skipped,
          failed,
          results,
        },
      });
    } catch (error) {
      console.error("[vip-lists/sync-twitter-ids] 同步失败:", error);
      await logAdminAction(req, {
        action: "vip-list-sync-twitter-ids",
        success: false,
        message: error.message || "同步失败",
      });
      res.status(500).json({ success: false, error: error.message || "同步失败" });
    }
  }
);

router.get(
  "/vip-lists/creator-auth",
  adminAuth,
  requirePermission(["vip-management", "messages"]),
  async (req, res) => {
    try {
      const username = normalizeUsername(req.query.username);
      if (!username) {
        return res.status(400).json({ success: false, error: "username 不能为空" });
      }

      const data = await fetchCreatorAuthByUsername(username);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      const upstreamStatus = error.response?.status;
      const upstreamData = error.response?.data;
      const message =
        upstreamData?.message ||
        upstreamData?.error ||
        error.message ||
        "查询创作者申请记录失败";

      console.error("[vip-lists/creator-auth] 查询失败:", {
        message,
        status: upstreamStatus,
        data: upstreamData,
      });
      res.status(upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 500).json({
        success: false,
        error: message,
      });
    }
  }
);

async function handleUpdateTwitterId(req, res) {
  let row;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: "无效的名单 ID" });
    }

    row = await XhuntVipTestUser.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, error: "名单用户不存在" });
    }

    const rawTwitterId = req.body?.twitterId;
    const normalizedTwitterId =
      rawTwitterId != null && String(rawTwitterId).trim()
        ? String(rawTwitterId).trim()
        : null;

    if (normalizedTwitterId && !/^\d{1,30}$/.test(normalizedTwitterId)) {
      return res.status(400).json({ success: false, error: "Twitter ID 必须为纯数字" });
    }

    const previousTwitterId = row.twitterId;
    row.twitterId = normalizedTwitterId;
    await row.save();

    await refreshVipCache();
    await logAdminAction(req, {
      action: "vip-list-update-twitter-id",
      success: true,
      message: `listType=${row.listType} username=${row.username} previous=${previousTwitterId || "null"} current=${normalizedTwitterId || "null"}`,
    });

    res.json({
      success: true,
      data: serializeVipUser(row),
    });
  } catch (error) {
    console.error("[vip-lists/update-twitter-id] 更新失败:", error);
    await logAdminAction(req, {
      action: "vip-list-update-twitter-id",
      success: false,
      message: `username=${row?.username || "-"} error=${error.message || "更新失败"}`,
    });
    res.status(500).json({ success: false, error: error.message || "更新 Twitter ID 失败" });
  }
}

router.put(
  "/vip-lists/:id/twitter-id",
  adminAuth,
  requirePermission("vip-management"),
  handleUpdateTwitterId
);

router.post(
  "/vip-lists/:id/twitter-id",
  adminAuth,
  requirePermission("vip-management"),
  handleUpdateTwitterId
);

router.put(
  "/vip-lists/:id",
  adminAuth,
  requirePermission("vip-management"),
  handleUpdateTwitterId
);

router.post(
  "/vip-lists/add",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    const { listType, username, twitterId } = req.body || {};
    try {
      if (!["vip", "internal_test"].includes(listType)) {
        return res.status(400).json({ success: false, error: "listType 必须是 vip 或 internal_test" });
      }

      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        return res.status(400).json({ success: false, error: "username 不能为空" });
      }

      const normalizedTwitterId =
        twitterId != null && String(twitterId).trim()
          ? String(twitterId).trim()
          : null;

      if (normalizedTwitterId && !/^\d{1,30}$/.test(normalizedTwitterId)) {
        return res.status(400).json({ success: false, error: "Twitter ID 必须为纯数字" });
      }

      const [row, created] = await XhuntVipTestUser.findOrCreate({
        where: {
          username: normalizedUsername,
          listType,
        },
        defaults: {
          username: normalizedUsername,
          listType,
          twitterId: normalizedTwitterId,
        },
      });

      if (!created && normalizedTwitterId && row.twitterId !== normalizedTwitterId) {
        row.twitterId = normalizedTwitterId;
        await row.save();
      }

      await refreshVipCache();
      await logAdminAction(req, {
        action: "vip-list-add",
        success: true,
        message: `listType=${listType} username=${normalizedUsername} twitterId=${row.twitterId || "null"} created=${created}`,
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

router.post(
  "/vip-lists/add-and-sync",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    let row;
    try {
      const { listType, username, twitterId } = req.body || {};
      if (!["vip", "internal_test"].includes(listType)) {
        return res.status(400).json({ success: false, error: "listType 必须是 vip 或 internal_test" });
      }

      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        return res.status(400).json({ success: false, error: "username 不能为空" });
      }

      const normalizedTwitterId =
        twitterId != null && String(twitterId).trim() ? String(twitterId).trim() : null;
      if (normalizedTwitterId && !/^\d{1,30}$/.test(normalizedTwitterId)) {
        return res.status(400).json({ success: false, error: "Twitter ID 必须为纯数字" });
      }

      const [vipUser, created] = await XhuntVipTestUser.findOrCreate({
        where: { username: normalizedUsername, listType },
        defaults: { username: normalizedUsername, listType, twitterId: normalizedTwitterId },
      });
      row = vipUser;

      if (!created && normalizedTwitterId && row.twitterId !== normalizedTwitterId) {
        row.twitterId = normalizedTwitterId;
        await row.save();
      }

      const idSync = await syncMissingTwitterId(row);
      await refreshVipCache();
      await syncVipListsToFeatureFlags();

      await logAdminAction(req, {
        action: "vip-list-add-and-sync",
        success: true,
        message: `listType=${listType} username=${normalizedUsername} created=${created} idSync=${JSON.stringify(idSync)}`,
      });
      res.json({ success: true, data: { user: serializeVipUser(row), created, idSync } });
    } catch (error) {
      console.error("[vip-lists/add-and-sync] 添加并同步失败:", error);
      await logAdminAction(req, {
        action: "vip-list-add-and-sync",
        success: false,
        message: `username=${row?.username || "-"} error=${error.message || "添加并同步失败"}`,
      });
      res.status(500).json({ success: false, error: error.message || "添加并同步失败" });
    }
  }
);

router.post(
  "/vip-lists/sync-feature-flags",
  adminAuth,
  requirePermission("vip-management"),
  async (req, res) => {
    try {
      await syncVipListsToFeatureFlags();
      await logAdminAction(req, { action: "vip-list-sync-feature-flags", success: true });
      res.json({ success: true });
    } catch (error) {
      console.error("[vip-lists/sync-feature-flags] 同步失败:", error);
      await logAdminAction(req, {
        action: "vip-list-sync-feature-flags",
        success: false,
        message: error.message || "同步失败",
      });
      res.status(500).json({ success: false, error: error.message || "同步失败" });
    }
  }
);

router.post(
  "/vip-lists/:id/become-creator",
  adminAuth,
  requireSuperAdmin,
  async (req, res) => {
    let row;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "无效的名单 ID" });
      }

      row = await XhuntVipTestUser.findByPk(id);
      if (!row) {
        return res.status(404).json({ success: false, error: "名单用户不存在" });
      }

      const userId = String(row.twitterId || "").trim();
      if (!userId) {
        return res.status(400).json({ success: false, error: "该用户未同步 Twitter ID，请先同步ID信息" });
      }

      const creatorResponse = await axios.post(
        CREATOR_AUTH_URL,
        { user_id: userId },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      await sleep(1000);

      const submitResponse = await axios.post(
        CREATOR_SUBMIT_URL,
        { user_id: userId, status: "2" },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            auth: CREATOR_SUBMIT_AUTH,
          },
          timeout: 10000,
        }
      );

      await logAdminAction(req, {
        action: "vip-list-become-creator",
        success: true,
        message: `listType=${row.listType} username=${row.username} user_id=${userId}`,
      });

      res.json({
        success: true,
        data: {
          id: row.id,
          username: row.username,
          twitterId: userId,
          creator: creatorResponse.data,
          creatorSubmit: submitResponse.data,
        },
      });
    } catch (error) {
      const upstreamStatus = error.response?.status;
      const upstreamData = error.response?.data;
      const message =
        upstreamData?.message ||
        upstreamData?.error ||
        error.message ||
        "设置认证者失败";

      console.error("[vip-lists/become-creator] 设置失败:", {
        message,
        status: upstreamStatus,
        data: upstreamData,
      });
      await logAdminAction(req, {
        action: "vip-list-become-creator",
        success: false,
        message: `username=${row?.username || "-"} error=${message}`,
      });
      res.status(upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 500).json({
        success: false,
        error: message,
      });
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
