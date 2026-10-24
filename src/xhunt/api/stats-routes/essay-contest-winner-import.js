const express = require("express");
const axios = require("axios");
const { adminAuth, requirePermission } = require("../../../admin/middleware/adminAuth");
const { queryTwitterProfile } = require("./twitter-id-handler-lookup");
const {
  buildGoogleSheetExportUrl,
  normalizeImportedRows,
  workbookToMatrix,
} = require("../../services/essayContestWinnerImportService");

const router = express.Router();
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const LOOKUP_CONCURRENCY = 5;
const ALLOWED_FILE_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

function getExtension(fileName) {
  const match = String(fileName || "").trim().toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

function decodeUploadedFile(file) {
  const name = String(file?.name || "").trim();
  const extension = getExtension(name);
  if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
    const error = new Error("仅支持 .xlsx、.xls 或 .csv 文件");
    error.status = 400;
    throw error;
  }
  const base64 = String(file?.base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    const error = new Error("上传文件内容无效");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    const error = new Error(`文件大小必须小于 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
    error.status = 400;
    throw error;
  }
  return { name, buffer };
}

async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return result;
}

async function enrichTwitterProfiles(rows) {
  const cache = new Map();
  return mapWithConcurrency(rows, LOOKUP_CONCURRENCY, async (row) => {
    if (row.profileLookup !== "pending" || !row.winner.handler) return row;
    const cacheKey = row.winner.handler.toLowerCase();
    let profilePromise = cache.get(cacheKey);
    if (!profilePromise) {
      profilePromise = queryTwitterProfile({ username: row.winner.handler }).catch(() => null);
      cache.set(cacheKey, profilePromise);
    }
    const profile = await profilePromise;
    if (!profile) {
      return {
        ...row,
        profileLookup: "failed",
        issues: [...row.issues, { level: "warning", message: "未能自动获取 Twitter 昵称或头像，可手动补充" }],
      };
    }
    return {
      ...row,
      profileLookup: "completed",
      winner: {
        ...row.winner,
        handler: profile.handler || row.winner.handler,
        name: row.winner.name || profile.displayName || row.winner.handler,
        avatar: row.winner.avatar || profile.avatar || "",
      },
    };
  });
}

function summarize(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.issues.some((issue) => issue.level === "error")) summary.errors += 1;
      if (row.issues.some((issue) => issue.level === "warning")) summary.warnings += 1;
      if (row.profileLookup === "completed") summary.profilesCompleted += 1;
      if (row.profileLookup === "failed") summary.profilesFailed += 1;
      return summary;
    },
    { total: 0, errors: 0, warnings: 0, profilesCompleted: 0, profilesFailed: 0 }
  );
}

router.post(
  "/essay-contest-winners/import-preview",
  adminAuth,
  requirePermission("nacos_config"),
  async (req, res) => {
    try {
      const sourceType = String(req.body?.sourceType || "").trim();
      let source;
      let parsedWorkbook;

      if (sourceType === "google-sheet") {
        const googleSheet = buildGoogleSheetExportUrl(req.body?.googleSheetUrl);
        const response = await axios.get(googleSheet.exportUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          maxContentLength: MAX_FILE_BYTES,
          maxBodyLength: MAX_FILE_BYTES,
          headers: { Accept: "text/csv,application/octet-stream;q=0.9" },
        });
        const buffer = Buffer.from(response.data);
        if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
          const error = new Error("Google Sheets 内容为空或超过 3MB 限制");
          error.status = 400;
          throw error;
        }
        parsedWorkbook = workbookToMatrix(buffer);
        source = { type: sourceType, spreadsheetId: googleSheet.spreadsheetId, gid: googleSheet.gid };
      } else if (sourceType === "file") {
        const upload = decodeUploadedFile(req.body?.file);
        parsedWorkbook = workbookToMatrix(upload.buffer, { sheetName: req.body?.sheetName });
        source = { type: sourceType, fileName: upload.name };
      } else {
        const error = new Error("请选择 Google Sheets 或 Excel 文件作为导入来源");
        error.status = 400;
        throw error;
      }

      const parsed = normalizeImportedRows(parsedWorkbook.matrix);
      if (!parsed.columns.length || !parsed.rows.length) {
        const error = new Error("表格中没有可导入的数据，请检查首行为列名且下方存在数据");
        error.status = 400;
        throw error;
      }
      if (parsed.mapping.handler === undefined && parsed.mapping.url === undefined) {
        const error = new Error("未识别到作者/推特账号或文章链接列");
        error.status = 400;
        throw error;
      }

      const rows = await enrichTwitterProfiles(parsed.rows);
      return res.json({
        success: true,
        data: {
          source,
          sheetName: parsedWorkbook.sheetName,
          sheetNames: parsedWorkbook.sheetNames,
          columns: parsed.columns,
          rows,
          truncated: parsed.truncated || parsedWorkbook.truncated,
          summary: summarize(rows),
        },
      });
    } catch (error) {
      const status = Number(error.status) || (error.response ? 502 : 400);
      if (error.response) {
        console.error("[essay-winner-import] Google Sheets 获取失败:", error.response.status, error.message);
      } else if (status >= 500) {
        console.error("[essay-winner-import] 预览失败:", error.message);
      }
      const message = error.response
        ? "无法读取 Google Sheets，请确认文档已开放为“知道链接的任何人可查看”"
        : error.message || "表格解析失败";
      return res.status(status).json({ success: false, error: message });
    }
  }
);

module.exports = router;
module.exports.decodeUploadedFile = decodeUploadedFile;
module.exports.enrichTwitterProfiles = enrichTwitterProfiles;
