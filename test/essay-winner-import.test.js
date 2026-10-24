const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const {
  buildGoogleSheetExportUrl,
  normalizeImportedRows,
  workbookToMatrix,
} = require("../src/xhunt/services/essayContestWinnerImportService");

test("maps the supported Chinese essay winner columns", () => {
  const parsed = normalizeImportedRows([
    ["作者", "文章链接", "文章概要", "奖励", "奖项"],
    [
      "@echo_hunter",
      "https://x.com/echo_hunter/status/123",
      "一篇文章摘要",
      "500 USDC",
      "🥇 1st Prize",
    ],
  ]);

  assert.deepEqual(parsed.mapping, { handler: 0, url: 1, post: 2, reward: 3, award: 4 });
  assert.deepEqual(parsed.rows[0].winner, {
    name: "",
    handler: "echo_hunter",
    avatar: "",
    reward: "500 USDC",
    award: "🥇 1st Prize",
    post: "一篇文章摘要",
    url: "https://x.com/echo_hunter/status/123",
  });
  assert.equal(parsed.rows[0].profileLookup, "pending");
});

test("extracts handler from an X post URL and reports duplicate rows", () => {
  const parsed = normalizeImportedRows([
    ["文章链接", "摘要"],
    ["https://x.com/same_user/status/1", "作品一"],
    ["https://x.com/same_user/status/2", "作品二"],
  ]);

  assert.equal(parsed.rows[0].winner.handler, "same_user");
  assert.equal(parsed.rows[1].winner.handler, "same_user");
  assert.ok(parsed.rows[1].issues.some((issue) => issue.level === "error" && issue.message.includes("Twitter 账号重复")));
});

test("preserves UTF-8 Chinese values in CSV buffers", () => {
  const workbook = workbookToMatrix(Buffer.from("作者,文章链接,文章概要\n测试账号,https://x.com/test_user/status/1,中文概要", "utf8"));
  const parsed = normalizeImportedRows(workbook.matrix);

  assert.equal(parsed.columns[0].source, "作者");
  assert.equal(parsed.rows[0].winner.post, "中文概要");
  assert.equal(parsed.rows[0].winner.handler, "test_user");
});

test("reads uploaded XLSX workbooks", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Twitter Handle", "Tweet URL", "Reward"],
      ["xlsx_user", "https://x.com/xlsx_user/status/2", "200 USDC"],
    ]),
    "获奖名单"
  );
  const parsedWorkbook = workbookToMatrix(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const parsed = normalizeImportedRows(parsedWorkbook.matrix);

  assert.equal(parsedWorkbook.sheetName, "获奖名单");
  assert.equal(parsed.rows[0].winner.handler, "xlsx_user");
  assert.equal(parsed.rows[0].winner.reward, "200 USDC");
});

test("builds a safe Google Sheets CSV export URL from query or hash gid", () => {
  const result = buildGoogleSheetExportUrl(
    "https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?usp=sharing#gid=20261024"
  );
  assert.deepEqual(result, {
    spreadsheetId: "abc_DEF-123",
    gid: "20261024",
    exportUrl: "https://docs.google.com/spreadsheets/d/abc_DEF-123/export?format=csv&gid=20261024",
  });
  assert.throws(
    () => buildGoogleSheetExportUrl("https://example.com/spreadsheets/d/abc/edit#gid=0"),
    /只支持 docs\.google\.com/
  );
});
