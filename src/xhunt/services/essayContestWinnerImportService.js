const XLSX = require("xlsx");

const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_COLUMNS = 50;
const MAX_CELL_LENGTH = 5000;

const FIELD_ALIASES = {
  handler: [
    "作者",
    "推特账号",
    "推特",
    "推特handle",
    "账号",
    "x账号",
    "twitter",
    "twitterhandle",
    "handle",
    "username",
    "user",
  ],
  name: ["昵称", "姓名", "显示名称", "作者昵称", "name", "displayname", "authorname"],
  avatar: ["头像", "头像链接", "头像url", "avatar", "image", "profileimage", "profileimageurl"],
  url: [
    "文章链接",
    "推文链接",
    "作品链接",
    "链接",
    "url",
    "link",
    "posturl",
    "tweeturl",
    "articleurl",
  ],
  post: [
    "文章概要",
    "文章摘要",
    "作品概要",
    "作品摘要",
    "概要",
    "摘要",
    "文章标题",
    "作品标题",
    "标题",
    "post",
    "title",
    "summary",
    "content",
    "description",
  ],
  reward: ["奖励", "奖金", "奖励金额", "金额", "reward", "prize", "amount"],
  award: ["奖项", "名次", "排名", "获奖等级", "award", "rank", "place"],
};

function cleanCell(value, maxLength = MAX_CELL_LENGTH) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeHeader(value) {
  return cleanCell(value, 200)
    .toLowerCase()
    .replace(/[\s_\-—–:：/\\()（）\[\]【】.]+/g, "");
}

const ALIAS_TO_FIELD = new Map();
Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
  aliases.forEach((alias) => ALIAS_TO_FIELD.set(normalizeHeader(alias), field));
});

function normalizeHandler(value) {
  const raw = cleanCell(value, 300)
    .replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .trim();
  return /^[A-Za-z0-9_]{1,128}$/.test(raw) ? raw : "";
}

function extractHandlerFromUrl(value) {
  const raw = cleanCell(value, 2000);
  const match = raw.match(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,128})(?:\/|$)/i);
  return match ? normalizeHandler(match[1]) : "";
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function detectColumns(headers) {
  const mapping = {};
  const columns = (Array.isArray(headers) ? headers : []).slice(0, MAX_IMPORT_COLUMNS).map((header, index) => {
    const source = cleanCell(header, 200);
    const field = ALIAS_TO_FIELD.get(normalizeHeader(source)) || null;
    if (field && mapping[field] === undefined) mapping[field] = index;
    return { index, source, field: field || null };
  });
  return { mapping, columns };
}

function makeRowIssue(message, level = "warning") {
  return { level, message };
}

function normalizeImportedRows(matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  if (!rows.length) {
    return { rows: [], columns: [], mapping: {}, truncated: false };
  }

  const headers = Array.isArray(rows[0]) ? rows[0] : [];
  const { mapping, columns } = detectColumns(headers);
  const dataRows = rows.slice(1, MAX_IMPORT_ROWS + 1);
  const normalizedRows = [];
  const seenHandlers = new Map();
  const seenUrls = new Map();

  dataRows.forEach((rawRow, index) => {
    const cells = Array.isArray(rawRow) ? rawRow : [];
    const get = (field, maxLength) =>
      mapping[field] === undefined ? "" : cleanCell(cells[mapping[field]], maxLength);

    const url = get("url", 2000);
    const rawHandler = get("handler", 300);
    const handler = normalizeHandler(rawHandler) || extractHandlerFromUrl(url);
    const winner = {
      name: get("name", 300),
      handler,
      avatar: get("avatar", 2000),
      reward: get("reward", 300),
      award: get("award", 300),
      post: get("post", MAX_CELL_LENGTH),
      url,
    };
    const hasContent = Object.values(winner).some(Boolean) || cells.some((cell) => cleanCell(cell));
    if (!hasContent) return;

    const sourceRow = index + 2;
    const issues = [];
    if (!handler) {
      issues.push(makeRowIssue("缺少有效的 Twitter handler，且无法从文章链接提取", "error"));
    }
    if (!winner.url) {
      issues.push(makeRowIssue("缺少作品链接"));
    } else if (!isHttpUrl(winner.url)) {
      issues.push(makeRowIssue("作品链接不是有效的 HTTP/HTTPS 地址", "error"));
    }
    if (!winner.reward) issues.push(makeRowIssue("缺少奖励，请在预览中补充"));

    const handlerKey = handler.toLowerCase();
    const urlKey = winner.url.toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
    if (handlerKey && seenHandlers.has(handlerKey)) {
      issues.push(makeRowIssue(`与第 ${seenHandlers.get(handlerKey)} 行的 Twitter 账号重复`, "error"));
    } else if (handlerKey) {
      seenHandlers.set(handlerKey, sourceRow);
    }
    if (urlKey && seenUrls.has(urlKey)) {
      issues.push(makeRowIssue(`与第 ${seenUrls.get(urlKey)} 行的作品链接重复`, "error"));
    } else if (urlKey) {
      seenUrls.set(urlKey, sourceRow);
    }

    normalizedRows.push({
      id: `row-${sourceRow}`,
      sourceRow,
      winner,
      issues,
      profileLookup: handler && (!winner.name || !winner.avatar) ? "pending" : "not-needed",
    });
  });

  return {
    rows: normalizedRows,
    columns,
    mapping,
    truncated: rows.length - 1 > MAX_IMPORT_ROWS,
  };
}

function workbookToMatrix(buffer, options = {}) {
  const sourceBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const isBinaryWorkbook =
    (sourceBuffer[0] === 0x50 && sourceBuffer[1] === 0x4b) ||
    (sourceBuffer[0] === 0xd0 && sourceBuffer[1] === 0xcf);
  // SheetJS treats a raw CSV Buffer as a legacy code page. Explicitly decoding
  // text input preserves Chinese headers and values from Google Sheets exports.
  const workbook = isBinaryWorkbook
    ? XLSX.read(sourceBuffer, {
        type: "buffer",
        raw: false,
        cellDates: false,
        sheetRows: MAX_IMPORT_ROWS + 1,
      })
    : XLSX.read(sourceBuffer.toString("utf8").replace(/^\uFEFF/, ""), {
        type: "string",
        raw: false,
        cellDates: false,
        sheetRows: MAX_IMPORT_ROWS + 1,
      });
  const requestedSheet = cleanCell(options.sheetName, 200);
  const sheetName = requestedSheet && workbook.SheetNames.includes(requestedSheet)
    ? requestedSheet
    : workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new Error("表格中没有可读取的工作表");
  }
  const sheet = workbook.Sheets[sheetName];
  const fullRangeRef = sheet["!fullref"] || sheet["!ref"] || "A1:A1";
  const fullRange = XLSX.utils.decode_range(fullRangeRef);
  const readRange = {
    s: fullRange.s,
    e: {
      r: Math.min(fullRange.e.r, MAX_IMPORT_ROWS),
      c: Math.min(fullRange.e.c, MAX_IMPORT_COLUMNS - 1),
    },
  };
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
    range: readRange,
  });
  return {
    matrix,
    sheetName,
    sheetNames: workbook.SheetNames,
    truncated: fullRange.e.r > MAX_IMPORT_ROWS || fullRange.e.c >= MAX_IMPORT_COLUMNS,
  };
}

function buildGoogleSheetExportUrl(input) {
  let parsed;
  try {
    parsed = new URL(cleanCell(input, 3000));
  } catch {
    throw new Error("Google Sheets 链接格式不正确");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") {
    throw new Error("只支持 docs.google.com 的 Google Sheets 链接");
  }
  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match) throw new Error("无法从链接中识别 Google Sheets 文档 ID");
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const gid = parsed.searchParams.get("gid") || hashParams.get("gid") || "0";
  if (!/^\d+$/.test(gid)) throw new Error("Google Sheets gid 格式不正确");
  return {
    spreadsheetId: match[1],
    gid,
    exportUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`,
  };
}

module.exports = {
  FIELD_ALIASES,
  MAX_IMPORT_ROWS,
  buildGoogleSheetExportUrl,
  detectColumns,
  extractHandlerFromUrl,
  normalizeHandler,
  normalizeImportedRows,
  workbookToMatrix,
};
