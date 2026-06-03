const express = require("express");
const axios = require("axios");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");
const { XhuntUserTag } = require("../../../models/postgres-start");
const { logAdminAction } = require("./shared");
const { refreshUserTagsCache } = require("../../services/userTagsCache");

const router = express.Router();
const TWITTER_USER_LOOKUP_URL = "https://data.cryptohunt.ai/fetch/twitter/user";
const NACOS_PUBLIC_CONFIG_URL = "https://kb.cryptohunt.ai/nacos-configs";
const TAG_DATA_IDS = {
  zh: "xhunt_built_in_tag",
  en: "xhunt_built_in_tag_en",
};

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((tag) => String(tag || "").trim()).filter(Boolean))
  );
}

async function refreshTagsCacheSafe() {
  try {
    await refreshUserTagsCache();
  } catch (error) {
    console.error("[user-tags] 刷新 Redis 缓存失败:", error.message);
  }
}

function serialize(row) {
  return {
    id: row.id,
    username: row.username,
    twitterId: row.twitterId || null,
    tagsZh: normalizeTags(row.tagsZh),
    tagsEn: normalizeTags(row.tagsEn),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

function normalizeNacosTagConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((result, [username, tags]) => {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) return result;
    result[normalizedUsername] = normalizeTags(tags);
    return result;
  }, {});
}

async function fetchNacosTagConfig(lang) {
  const response = await axios.get(NACOS_PUBLIC_CONFIG_URL, {
    params: { dataId: TAG_DATA_IDS[lang], group: "DEFAULT_GROUP" },
    timeout: 10000,
  });
  const content = response.data?.data?.content ?? response.data?.content ?? response.data;
  const parsed = typeof content === "string" ? JSON.parse(content || "{}") : content;
  return normalizeNacosTagConfig(parsed);
}

router.get(
  "/user-tags",
  adminAuth,
  requirePermission("nacos-tags"),
  async (req, res) => {
    try {
      const rows = await XhuntUserTag.findAll({ order: [["username", "ASC"]] });
      res.json({ success: true, data: rows.map(serialize) });
    } catch (error) {
      console.error("[user-tags] 获取失败:", error);
      res.status(500).json({ success: false, error: error.message || "获取标签失败" });
    }
  }
);

router.post(
  "/user-tags/upsert",
  adminAuth,
  requirePermission("nacos-tags"),
  async (req, res) => {
    try {
      const id = Number(req.body?.id || 0);
      const username = normalizeUsername(req.body?.username);
      const twitterId = String(req.body?.twitterId || "").trim() || null;
      const tagsZh = normalizeTags(req.body?.tagsZh);
      const tagsEn = normalizeTags(req.body?.tagsEn);

      if (!username) {
        return res.status(400).json({ success: false, error: "username 不能为空" });
      }

      let row = id > 0 ? await XhuntUserTag.findByPk(id) : null;
      if (row) {
        row.username = username;
        row.twitterId = twitterId;
        row.tagsZh = tagsZh;
        row.tagsEn = tagsEn;
        await row.save();
      } else {
        const [createdOrFound, created] = await XhuntUserTag.findOrCreate({
          where: { username },
          defaults: { username, twitterId, tagsZh, tagsEn },
        });
        row = createdOrFound;
        if (!created) {
          row.twitterId = twitterId;
          row.tagsZh = tagsZh;
          row.tagsEn = tagsEn;
          await row.save();
        }
      }

      await refreshTagsCacheSafe();
      await logAdminAction(req, {
        action: "user-tags-upsert",
        success: true,
        message: `username=${username}`,
      });
      res.json({ success: true, data: serialize(row) });
    } catch (error) {
      console.error("[user-tags/upsert] 保存失败:", error);
      await logAdminAction(req, { action: "user-tags-upsert", success: false, message: error.message });
      res.status(500).json({ success: false, error: error.message || "保存失败" });
    }
  }
);

router.delete(
  "/user-tags/:id",
  adminAuth,
  requirePermission("nacos-tags"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "无效 ID" });
      }
      const row = await XhuntUserTag.findByPk(id);
      if (!row) return res.status(404).json({ success: false, error: "标签记录不存在" });
      const username = row.username;
      await row.destroy();
      await refreshTagsCacheSafe();
      await logAdminAction(req, { action: "user-tags-delete", success: true, message: `username=${username}` });
      res.json({ success: true });
    } catch (error) {
      console.error("[user-tags/delete] 删除失败:", error);
      await logAdminAction(req, { action: "user-tags-delete", success: false, message: error.message });
      res.status(500).json({ success: false, error: error.message || "删除失败" });
    }
  }
);

router.post(
  "/user-tags/sync-twitter-ids",
  adminAuth,
  requirePermission("nacos-tags"),
  async (req, res) => {
    const { force = true } = req.body || {};
    try {
      const rows = await XhuntUserTag.findAll({ order: [["username", "ASC"]] });
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
          results.push({ id: row.id, username: row.username, status: "failed", error: error.message || "同步失败" });
        }
      }

      await refreshTagsCacheSafe();
      await logAdminAction(req, {
        action: "user-tags-sync-twitter-ids",
        success: true,
        message: `total=${rows.length} updated=${updated} skipped=${skipped} failed=${failed}`,
      });
      res.json({ success: true, data: { total: rows.length, updated, skipped, failed, results } });
    } catch (error) {
      console.error("[user-tags/sync-twitter-ids] 同步失败:", error);
      await logAdminAction(req, { action: "user-tags-sync-twitter-ids", success: false, message: error.message });
      res.status(500).json({ success: false, error: error.message || "同步失败" });
    }
  }
);

router.post(
  "/user-tags/import-from-nacos",
  adminAuth,
  requirePermission("nacos-tags"),
  async (req, res) => {
    const { overwrite = false } = req.body || {};
    try {
      const [zhConfig, enConfig] = await Promise.all([
        fetchNacosTagConfig("zh"),
        fetchNacosTagConfig("en"),
      ]);
      const usernames = Array.from(new Set([...Object.keys(zhConfig), ...Object.keys(enConfig)])).sort();
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const username of usernames) {
        const [row, isCreated] = await XhuntUserTag.findOrCreate({
          where: { username },
          defaults: {
            username,
            tagsZh: zhConfig[username] || [],
            tagsEn: enConfig[username] || [],
          },
        });
        if (isCreated) {
          created += 1;
          continue;
        }
        if (overwrite) {
          row.tagsZh = zhConfig[username] || [];
          row.tagsEn = enConfig[username] || [];
          await row.save();
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      await refreshTagsCacheSafe();
      await logAdminAction(req, {
        action: "user-tags-import-from-nacos",
        success: true,
        message: `total=${usernames.length} created=${created} updated=${updated} skipped=${skipped} overwrite=${overwrite}`,
      });
      res.json({ success: true, data: { total: usernames.length, created, updated, skipped } });
    } catch (error) {
      console.error("[user-tags/import-from-nacos] 导入失败:", error);
      await logAdminAction(req, { action: "user-tags-import-from-nacos", success: false, message: error.message });
      res.status(500).json({ success: false, error: error.message || "导入失败" });
    }
  }
);

module.exports = router;
