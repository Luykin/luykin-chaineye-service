const express = require("express");
const db = require("../models");
const { proApiKeyAuth } = require("../middleware/proApiKey");

const router = express.Router();

router.get("/", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  return res.send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RootDataPro Open API 文档</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: rgba(255,255,255,0.06);
      --panel2: rgba(255,255,255,0.08);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.68);
      --line: rgba(255,255,255,0.12);
      --brand: #7c5cff;
      --ok: #22c55e;
      --warn: #f59e0b;
      --bad: #ef4444;
      --codebg: rgba(0,0,0,0.35);
      --shadow: 0 20px 60px rgba(0,0,0,0.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      background: radial-gradient(1200px 600px at 20% 0%, rgba(124,92,255,0.35), transparent 60%),
                  radial-gradient(900px 500px at 80% 10%, rgba(34,197,94,0.22), transparent 55%),
                  radial-gradient(1000px 700px at 50% 100%, rgba(59,130,246,0.20), transparent 60%),
                  var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    a { color: inherit; }
    .container { max-width: 1100px; margin: 0 auto; padding: 28px 18px 80px; }
    .top {
      display: grid;
      gap: 14px;
      padding: 20px;
      background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }
    .title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
    .title h1 { margin: 0; font-size: 22px; letter-spacing: 0.2px; }
    .badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.06);
      color: var(--muted);
    }
    .grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 18px; }
    @media (min-width: 860px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    .card {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.05);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.25);
      backdrop-filter: blur(10px);
    }
    .card h2 { margin: 0 0 8px; font-size: 16px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .method {
      font-weight: 700;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid rgba(34,197,94,0.35);
      background: rgba(34,197,94,0.14);
      color: rgba(220,255,234,0.95);
    }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 13px; color: rgba(255,255,255,0.9); }
    .desc { color: var(--muted); font-size: 13px; margin: 8px 0 12px; }
    .kv { display: grid; grid-template-columns: 120px 1fr; gap: 10px; font-size: 13px; margin-top: 10px; }
    .k { color: rgba(255,255,255,0.75); }
    .v { color: rgba(255,255,255,0.92); }
    pre {
      margin: 10px 0 0;
      padding: 12px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: var(--codebg);
      overflow: auto;
      font-size: 12px;
      line-height: 1.45;
    }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .callout {
      border: 1px solid rgba(245,158,11,0.35);
      background: rgba(245,158,11,0.12);
      border-radius: 16px;
      padding: 12px 14px;
      color: rgba(255,255,255,0.9);
    }
    .callout strong { color: rgba(255,255,255,0.95); }
    .muted { color: var(--muted); }
    .pill {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.05);
      color: var(--muted);
    }
    .footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
    .hr { height: 1px; background: var(--line); margin: 14px 0; }

    details {
      margin-top: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.04);
      border-radius: 14px;
      overflow: hidden;
    }
    summary {
      cursor: pointer;
      list-style: none;
      padding: 10px 12px;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(255,255,255,0.88);
    }
    summary::-webkit-details-marker { display: none; }
    .sum-title { font-size: 13px; font-weight: 650; }
    .sum-hint { font-size: 12px; color: var(--muted); }
    .details-body { padding: 0 12px 12px; }
    .schema-title { margin-top: 10px; font-size: 12px; color: rgba(255,255,255,0.78); }
  </style>
</head>
<body>
  <div class="container">
    <div class="top">
      <div class="title">
        <h1>RootDataPro Open API 文档</h1>
        <span class="badge">Base URL: <span class="path">${baseUrl}/open</span></span>
      </div>

      <div class="callout">
        <div><strong>鉴权说明（必须）</strong></div>
        <div class="muted" style="margin-top:6px;">
          所有接口都需要 <code>APIKey</code>（按额度扣费）。
          获取 <code>APIKey</code> 请联系 TG：<a href="https://t.me/Niod88" target="_blank" rel="noreferrer">@Niod88</a>
        </div>
        <div class="hr"></div>
        <div class="muted">请求头示例：</div>
        <pre><code>Authorization: Bearer YOUR_API_KEY
# 或者（如果你的网关/客户端不方便带 Bearer）
X-API-Key: YOUR_API_KEY</code></pre>
        <div class="muted" style="margin-top:8px;">如果你不确定你当前系统使用哪一种 header，以实际部署的鉴权中间件为准。</div>
      </div>

      <div class="row">
        <span class="pill">返回格式：JSON</span>
        <span class="pill">错误格式：{ success: false, error, message? }</span>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="row">
          <span class="method">GET</span>
          <span class="path">/open/quota</span>
        </div>
        <div class="desc">查询当前 APIKey 的额度/到期/状态信息。</div>
        <div class="kv">
          <div class="k">鉴权</div><div class="v">需要 APIKey</div>
          <div class="k">Query</div><div class="v">无</div>
        </div>
        <pre><code>curl -s '${baseUrl}/open/quota' \
  -H 'Authorization: Bearer YOUR_API_KEY' | jq .</code></pre>

        <details>
          <summary>
            <span class="sum-title">Schema</span>
            <span class="sum-hint">请求/响应字段结构（点击展开）</span>
          </summary>
          <div class="details-body">
            <div class="schema-title">请求</div>
            <pre><code>{
  "method": "GET",
  "path": "/open/quota",
  "headers": {
    "Authorization": "Bearer &lt;APIKey&gt;" 
  }
}</code></pre>

            <div class="schema-title">成功响应（success = true）</div>
            <pre><code>{
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": [
        "key",
        "status",
        "expires_at",
        "credits_total",
        "credits_remaining",
        "remark"
      ],
      "properties": {
        "key": { "type": "string" },
        "status": { "type": "string" },
        "expires_at": { "type": ["string", "null"] },
        "credits_total": { "type": "number" },
        "credits_remaining": { "type": "number" },
        "remark": { "type": ["string", "null"] }
      }
    }
  }
}</code></pre>

            <div class="schema-title">错误响应（通用）</div>
            <pre><code>{
  "type": "object",
  "required": ["success", "error"],
  "properties": {
    "success": { "type": "boolean", "const": false },
    "error": { "type": "string" },
    "message": { "type": "string" }
  }
}</code></pre>
          </div>
        </details>
      </div>

      <div class="card">
        <div class="row">
          <span class="method">GET</span>
          <span class="path">/open/get_item?project_id=123</span>
        </div>
        <div class="desc">根据 <code>project_id</code> 获取项目详情（含标签、生态、团队、投融资信息）。</div>
        <div class="kv">
          <div class="k">鉴权</div><div class="v">需要 APIKey（权限等级：2）</div>
          <div class="k">Query</div><div class="v"><code>project_id</code> (number, 必填)</div>
        </div>
        <pre><code>curl -s '${baseUrl}/open/get_item?project_id=123' \
  -H 'Authorization: Bearer YOUR_API_KEY' | jq .</code></pre>

        <details>
          <summary>
            <span class="sum-title">Schema</span>
            <span class="sum-hint">请求/响应字段结构（点击展开）</span>
          </summary>
          <div class="details-body">
            <div class="schema-title">请求</div>
            <pre><code>{
  "method": "GET",
  "path": "/open/get_item",
  "query": {
    "project_id": "number (required)"
  },
  "headers": {
    "Authorization": "Bearer &lt;APIKey&gt;"
  }
}</code></pre>

            <div class="schema-title">成功响应（success = true）</div>
            <pre><code>{
  "type": "object",
  "required": ["success", "project", "fundingRounds"],
  "properties": {
    "success": { "type": "boolean", "const": true },
    "project": { "type": "object", "description": "项目详情（字段较多，随库表变动）" },
    "fundingRounds": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "单轮融资记录（附带 investor 摘要）"
      }
    }
  }
}</code></pre>

            <div class="schema-title">错误响应（该接口常见）</div>
            <pre><code>{
  "oneOf": [
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "INVALID_PROJECT_ID"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "NOT_FOUND"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"type": "string"}, "message": {"type": "string"} } }
  ]
}</code></pre>
          </div>
        </details>
      </div>

      <div class="card">
        <div class="row">
          <span class="method">GET</span>
          <span class="path">/open/get_org?org_id=123</span>
        </div>
        <div class="desc">根据 <code>org_id</code> 获取机构详情（含标签、分类、团队、投融资信息）。</div>
        <div class="kv">
          <div class="k">鉴权</div><div class="v">需要 APIKey（权限等级：2）</div>
          <div class="k">Query</div><div class="v"><code>org_id</code> (number, 必填)</div>
        </div>
        <pre><code>curl -s '${baseUrl}/open/get_org?org_id=123' \
  -H 'Authorization: Bearer YOUR_API_KEY' | jq .</code></pre>

        <details>
          <summary>
            <span class="sum-title">Schema</span>
            <span class="sum-hint">请求/响应字段结构（点击展开）</span>
          </summary>
          <div class="details-body">
            <div class="schema-title">请求</div>
            <pre><code>{
  "method": "GET",
  "path": "/open/get_org",
  "query": {
    "org_id": "number (required)"
  },
  "headers": {
    "Authorization": "Bearer &lt;APIKey&gt;"
  }
}</code></pre>

            <div class="schema-title">成功响应（success = true）</div>
            <pre><code>{
  "type": "object",
  "required": ["success", "organization", "fundingRounds"],
  "properties": {
    "success": { "type": "boolean", "const": true },
    "organization": { "type": "object", "description": "机构详情（字段较多，随库表变动）" },
    "fundingRounds": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "单轮融资记录（附带 investor 摘要）"
      }
    }
  }
}</code></pre>

            <div class="schema-title">错误响应（该接口常见）</div>
            <pre><code>{
  "oneOf": [
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "INVALID_ORG_ID"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "NOT_FOUND"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"type": "string"}, "message": {"type": "string"} } }
  ]
}</code></pre>
          </div>
        </details>
      </div>

      <div class="card">
        <div class="row">
          <span class="method">GET</span>
          <span class="path">/open/get_people?people_id=123</span>
        </div>
        <div class="desc">根据 <code>people_id</code> 获取人物详情（含关联项目/机构、投融资信息）。</div>
        <div class="kv">
          <div class="k">鉴权</div><div class="v">需要 APIKey（权限等级：2）</div>
          <div class="k">Query</div><div class="v"><code>people_id</code> (number, 必填)</div>
        </div>
        <pre><code>curl -s '${baseUrl}/open/get_people?people_id=123' \
  -H 'Authorization: Bearer YOUR_API_KEY' | jq .</code></pre>

        <details>
          <summary>
            <span class="sum-title">Schema</span>
            <span class="sum-hint">请求/响应字段结构（点击展开）</span>
          </summary>
          <div class="details-body">
            <div class="schema-title">请求</div>
            <pre><code>{
  "method": "GET",
  "path": "/open/get_people",
  "query": {
    "people_id": "number (required)"
  },
  "headers": {
    "Authorization": "Bearer &lt;APIKey&gt;"
  }
}</code></pre>

            <div class="schema-title">成功响应（success = true）</div>
            <pre><code>{
  "type": "object",
  "required": ["success", "people"],
  "properties": {
    "success": { "type": "boolean", "const": true },
    "people": { "type": "object", "description": "人物详情（字段较多，随库表变动）" }
  }
}</code></pre>

            <div class="schema-title">错误响应（该接口常见）</div>
            <pre><code>{
  "oneOf": [
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "INVALID_PEOPLE_ID"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"const": "NOT_FOUND"} } },
    { "type": "object", "required": ["success", "error"], "properties": { "success": {"const": false}, "error": {"type": "string"}, "message": {"type": "string"} } }
  ]
}</code></pre>
          </div>
        </details>
      </div>
    </div>

    <div class="footer">
      <div>已提供可折叠 Schema（请求/响应字段结构）。如需补充更多接口或更严格的 OpenAPI 3.1 输出，也可以继续扩展。</div>
    </div>
  </div>
</body>
</html>`);
});

function parseIntParam(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

router.get("/quota", proApiKeyAuth(0), async (req, res) => {
  try {
    const row = await db.ApiKey.findOne({ where: { key: req.proApiKey.key } });
    if (!row) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    return res.json({
      success: true,
      data: {
        key: row.key,
        status: row.status,
        expires_at: row.expires_at,
        credits_total: Number(row.credits_total),
        credits_remaining: Number(row.credits_remaining),
        remark: row.remark,
      },
    });
  } catch (err) {
    console.error("[rootdatapro] /open/quota error", err);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: err?.message || String(err),
    });
  }
});

/**
 * 根据类型收集所有需要查询的 id 列表。
 * 返回形如 { Project: Set<id>, Organization: Set<id>, Person: Set<id> }
 */
function collectIdsByType(items, typeKey, idKey) {
  const map = { Project: new Set(), Organization: new Set(), Person: new Set() };
  for (const item of items) {
    const t = item[typeKey];
    if (map[t]) {
      map[t].add(item[idKey]);
    }
  }
  return map;
}

/**
 * 通用批量查询函数。
 * @param {"Project"|"Organization"|"Person"} entityType
 * @param {Set<number>} ids
 * @returns {Promise<Record<number, any>>}
 */
async function batchFetchEntities(entityType, ids) {
  if (!ids || ids.size === 0) return {};
  const idArray = [...ids];
  let Model, idColumn, attributesToSelect;

  if (entityType === "Project") {
    Model = db.Project;
    idColumn = "project_id";
    attributesToSelect = ["project_id", "project_name", "logo", "X"];
  } else if (entityType === "Organization") {
    Model = db.Organization;
    idColumn = "org_id";
    attributesToSelect = ["org_id", "org_name", "logo", "X"];
  } else if (entityType === "Person") {
    Model = db.Person;
    idColumn = "people_id";
    attributesToSelect = ["people_id", "people_name", "head_img", "X"];
  } else {
    return {};
  }

  const rows = await Model.findAll({
    where: { [idColumn]: idArray },
    attributes: attributesToSelect,
  });

  const res = {};
  for (const row of rows) {
    res[row[idColumn]] = row.toJSON();
  }
  return res;
}

async function attachInvestorEntities(investments) {
  // 1. 收集各类型 id
  const idsByType = collectIdsByType(investments, "investorType", "investorId");

  // 2. 批量查询
  const [projectMap, orgMap, personMap] = await Promise.all([
    batchFetchEntities("Project", idsByType.Project),
    batchFetchEntities("Organization", idsByType.Organization),
    batchFetchEntities("Person", idsByType.Person),
  ]);

  // 3. 组装结果
  const result = [];
  for (const inv of investments) {
    let investorSummary = null;
    if (inv.investorType === "Project") investorSummary = projectMap[inv.investorId] || null;
    else if (inv.investorType === "Organization") investorSummary = orgMap[inv.investorId] || null;
    else if (inv.investorType === "Person") investorSummary = personMap[inv.investorId] || null;

    const { investorType, fundedType, ...rest } = inv.toJSON();
    result.push({ ...rest, investor: investorSummary });
  }
  return result;
}

async function attachFundedEntities(investments) {
  // 1. 收集 id
  const idsByType = collectIdsByType(investments, "fundedType", "fundedId");

  // 2. 批量查询（funded 目前只有 Project 和 Organization）
  const [projectMap, orgMap] = await Promise.all([
    batchFetchEntities("Project", idsByType.Project),
    batchFetchEntities("Organization", idsByType.Organization),
  ]);

  const result = [];
  for (const inv of investments) {
    let fundedSummary = null;
    if (inv.fundedType === "Project") fundedSummary = projectMap[inv.fundedId] || null;
    else if (inv.fundedType === "Organization") fundedSummary = orgMap[inv.fundedId] || null;

    const { investorType, fundedType, ...rest } = inv.toJSON();
    result.push({ ...rest, funded: fundedSummary });
  }
  return result;
}

router.get("/get_item", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_item", req.query);
  const project_id = parseIntParam(req.query.project_id);
  if (!project_id) {
    return res.status(400).json({ success: false, error: "INVALID_PROJECT_ID" });
  }

  try {
    const project = await db.Project.findByPk(project_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Ecosystem, as: "Ecosystems", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!project) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Project", fundedId: project_id },
      attributes: { exclude: ["id", "createdAt", "updatedAt"] },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    const projectJson = project.toJSON();
    if (projectJson.InvestmentsMade) {
      projectJson.InvestmentsMade = await attachFundedEntities(project.InvestmentsMade);
    }

    return res.json({
      success: true,
      project: projectJson,
      fundingRounds: fundingRoundsWithInvestors,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/get_item error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/get_org", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_org", req.query);
  const org_id = parseIntParam(req.query.org_id);
  if (!org_id) {
    return res.status(400).json({ success: false, error: "INVALID_ORG_ID" });
  }

  try {
    const org = await db.Organization.findByPk(org_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.InvestorCategory, as: "Categories", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!org) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Organization", fundedId: org_id },
      attributes: { exclude: ["id", "createdAt", "updatedAt"] },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    const orgJson = org.toJSON();
    if (orgJson.InvestmentsMade) {
      orgJson.InvestmentsMade = await attachFundedEntities(org.InvestmentsMade);
    }

    return res.json({
      success: true,
      organization: orgJson,
      fundingRounds: fundingRoundsWithInvestors,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/get_org error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/get_people", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_people", req.query);
  const people_id = parseIntParam(req.query.people_id);
  if (!people_id) {
    return res.status(400).json({ success: false, error: "INVALID_PEOPLE_ID" });
  }

  try {
    const person = await db.Person.findByPk(people_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Project, as: "MemberOfProjects", through: { attributes: ["position"] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Organization, as: "MemberOfOrganizations", through: { attributes: ["position"] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!person) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const personJson = person.toJSON();
    if (personJson.InvestmentsMade) {
      personJson.InvestmentsMade = await attachFundedEntities(person.InvestmentsMade);
    }

    return res.json({ success: true, people: personJson });
  } catch (err) {
    console.error("[rootdatapro] /open/get_people error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "NOT FOUND API",
    message: "Not Found api route",
  });
});

module.exports = router;
