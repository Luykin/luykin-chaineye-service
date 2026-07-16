# Crunchbase Tampermonkey 采集脚本技术分析文档

> 目的：参考 `tampermonkey/rootdata-fundraising-scheduled-reader.user.js` 的“真实浏览器 + Tampermonkey + DOM 解析 + 本地任务队列/回传”模式，设计一个 Crunchbase 页面内采集脚本，用于学术研究场景下读取当前账号/当前页面可见的数据。

## 1. 样本与结论摘要

本次分析的本地样本：

| 页面 | 本地文件 | 结论 |
|---|---|---|
| Advanced Search / Companies 列表页 | `/Users/luykin/Desktop/Advanced Search _ Companies _ Crunchbase.html` | 列表不是标准 `<table>`，而是 Angular 自定义组件 `grid-row` + `grid-cell[data-columnid]`。可通过 `data-columnid` 稳定取列。|
| Company Profile 页面 | `/Users/luykin/Desktop/DeepSeek - Crunchbase Company Profile & Funding.html` | 详情页主体由多个 `mat-card` 组成；基础字段多为 `tile-field > label-with-info + field-formatter`。页面内也有 Funding / Investors 摘要表，但建议以 financial_details 页为准。|
| Financial Details 页面 | `/Users/luykin/Desktop/DeepSeek - Financial Details.html` | 融资轮次和投资方区域存在标准 `<table>`，可按 `thead th` 与 `tbody tr td` 解析，最稳定。|

关键结论：

1. **列表页表格内容优先用 `grid-row:not(.blurred-row)` 读取**。样本里共有 15 个 `grid-row`，但只有前 5 个不是 `blurred-row`；后 10 个为模糊/限制展示的重复行，不应入库。
2. **列名不要依赖视觉顺序，直接依赖 `grid-cell[data-columnid]`**，例如 `identifier`、`categories`、`last_funding_at`、`location_identifiers`、`short_description`、`rank_org`、`rank_org_company`。
3. **详情页逐个公司进入 `/organization/:slug`，融资详情再进入 `/organization/:slug/financial_details`**。这和 RootData 脚本里最终采用“当前标签页逐个跳转”的模式一致，比隐藏 iframe 更稳。
4. **文本解析要优先用 `title` / `aria-label` / `href`，再 fallback 到 `textContent`**。因为浏览器自动翻译会插入多层 `<font>`，并可能出现重复/混杂文本。
5. **Chrome 建议关闭自动翻译并使用英文 Crunchbase 页面**，这样标签、日期、字段名更稳定。若必须支持中文翻译页面，需要额外维护字段标签中英映射。

---

## 2. 与 RootData Tampermonkey 脚本的复用思路

现有 `tampermonkey/rootdata-fundraising-scheduled-reader.user.js` 已经具备可复用框架：

| 能力 | RootData 现有模式 | Crunchbase 建议复用方式 |
|---|---|---|
| 配置集中管理 | `CONFIG` 保存 API、定时、重试、storage keys | 新建 `Crunchbase` 专用 `CONFIG`，包含列表 URL、详情队列、节流参数 |
| 真实浏览器采集 | `@run-at document-idle` 后等待页面 DOM | 同样在 Crunchbase 页面内等待 Angular 渲染完成 |
| DOM 解析 | `parseFundraisingRows()` / `parseDetailDocument()` | 新增 `parseCompanyListRows()` / `parseCompanyProfile()` / `parseFinancialDetails()` |
| 本地任务队列 | `localStorage` 持久化 pending/detail/recrawl job | 用 `cb_company_list_job_v1`、`cb_company_detail_job_v1` 保存进度 |
| 当前标签页详情抓取 | RootData 详情页用 `detailLoadMode: "page"` | Crunchbase 也建议当前标签页跳转，避免 iframe 节流与登录态问题 |
| 手动调试 API | 暴露 `RootDataFundraisingCollector` | 暴露 `CrunchbaseCompanyCollector` |
| 回传服务端 | `GM_xmlhttpRequest` POST 内部接口 | 后续可新增 `/api/internal/crunchbase/...` 接口；第一阶段先 console/下载 JSON |

---

## 3. 列表页结构分析

目标 URL 示例：

```txt
https://www.crunchbase.com/discover/organization.companies/489a197116cd090d95a06fea4422d995
```

本地样本标题：

```html
<title>Advanced Search | Companies | Crunchbase</title>
```

### 3.1 表格不是 `<table>`

列表数据结构类似：

```html
<grid-row class="ng-star-inserted">
  <grid-cell data-columnid="identifier" class="column-id-identifier">
    <field-formatter>
      <identifier-formatter>
        <a title="DeepSeek" aria-label="DeepSeek" href="/organization/deepseek">
          <img src="...">
          <div class="identifier-label">DeepSeek</div>
        </a>
      </identifier-formatter>
    </field-formatter>
  </grid-cell>

  <grid-cell data-columnid="categories">...</grid-cell>
  <grid-cell data-columnid="last_funding_at">...</grid-cell>
  <grid-cell data-columnid="location_identifiers">...</grid-cell>
  <grid-cell data-columnid="short_description">...</grid-cell>
  <grid-cell data-columnid="rank_org">...</grid-cell>
  <grid-cell data-columnid="rank_org_company">...</grid-cell>
</grid-row>
```

对应表头是：

```html
<grid-column-header>Organization Name</grid-column-header>
<grid-column-header>Industries</grid-column-header>
<grid-column-header>Last Funding Date</grid-column-header>
<grid-column-header>Headquarters Location</grid-column-header>
<grid-column-header>Description</grid-column-header>
<grid-column-header>CB Rank (Organization)</grid-column-header>
<grid-column-header>CB Rank (Company)</grid-column-header>
```

但脚本不需要依赖表头文本，直接用 `data-columnid` 更稳定。

### 3.2 样本列字段

| `data-columnid` | 含义 | 推荐解析方式 |
|---|---|---|
| `identifier` | 公司名称、详情链接、logo | `a[title]` / `a[aria-label]` / `a[href*="/organization/"]` / `img[src]` |
| `categories` | 行业分类 | 读取所有 `a[title]`，fallback 到逗号分隔文本 |
| `last_funding_at` | 最近融资日期 | 读取文本，如 `Jun 16, 2026`；保留原文，后端可再规范化 |
| `location_identifiers` | 总部位置 | 读取所有 `a[title]`，例如 `Hangzhou / Zhejiang / China` |
| `short_description` | 简介 | 优先取 `.field-type-text_long[title]` |
| `rank_org` | CB Rank Organization | 数字文本 |
| `rank_org_company` | CB Rank Company | 数字文本 |
| `select` / `add_column` | 选择框/加列按钮 | 跳过 |

### 3.3 样本中解析出的前 5 行

| name | slug | categories | lastFundingAt | location | rankOrg | rankCompany |
|---|---|---|---|---|---:|---:|
| DeepSeek | `deepseek` | Artificial Intelligence (AI), Developer APIs, Foundational AI, Generative AI, Machine Learning, Software | Jun 16, 2026 | Hangzhou, Zhejiang, China | 11 | 10 |
| MiniMax | `minimax-a48a` | Artificial Intelligence (AI), Foundational AI, Generative AI, Software, Video | Jul 10, 2026 | Singapore, Central Region, Singapore | 16 | 15 |
| Z.ai | `zdotai` | Artificial Intelligence (AI), Data Integration, Foundational AI, Information Technology, Machine Learning, Software | Jul 8, 2026 | Haidian, Beijing, China | 26 | 24 |
| NVIDIA | `nvidia` | AI Infrastructure, Artificial Intelligence (AI), Autonomous Vehicles, Cloud Computing, Embedded Systems, Foundational AI, Gaming, Hardware, Quantum Computing, Semiconductor | Jun 15, 2026 | Santa Clara, California, United States | 29 | 26 |
| Nscale | `nscale` | AI Infrastructure, Artificial Intelligence (AI), Data Center, GPU, Information Technology, Internet, Telecommunications | Jul 7, 2026 | London, England, United Kingdom | 44 | 36 |

### 3.4 列表页解析伪代码

```js
function cleanText(value) {
  return String(value || "")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href) {
  if (!href) return "";
  try {
    return new URL(href, location.origin).toString();
  } catch (_) {
    return href;
  }
}

function getUniqueTitles(root) {
  return [...new Set(
    [...root.querySelectorAll("[title]")]
      .map((el) => cleanText(el.getAttribute("title")))
      .filter(Boolean)
  )];
}

function parseCompanyListRows(doc = document) {
  const rows = [...doc.querySelectorAll("grid-row:not(.blurred-row)")];

  return rows.map((row, index) => {
    const cell = (id) => row.querySelector(`grid-cell[data-columnid="${id}"]`);
    const identifierCell = cell("identifier");
    const link = identifierCell?.querySelector('a[href*="/organization/"]');
    const href = absoluteUrl(link?.getAttribute("href") || "");
    const slug = href.match(/\/organization\/([^/?#]+)/)?.[1] || "";

    return {
      index: index + 1,
      name: cleanText(
        link?.getAttribute("title") ||
        link?.getAttribute("aria-label") ||
        link?.textContent
      ),
      slug,
      detailUrl: href,
      financialDetailsUrl: slug
        ? `https://www.crunchbase.com/organization/${slug}/financial_details`
        : "",
      logo: absoluteUrl(identifierCell?.querySelector("img")?.getAttribute("src") || ""),
      categories: getUniqueTitles(cell("categories")),
      lastFundingAtText: cleanText(cell("last_funding_at")?.textContent),
      locations: getUniqueTitles(cell("location_identifiers")),
      shortDescription: cleanText(
        cell("short_description")?.querySelector("[title]")?.getAttribute("title") ||
        cell("short_description")?.textContent
      ),
      rankOrg: cleanText(cell("rank_org")?.textContent),
      rankOrgCompany: cleanText(cell("rank_org_company")?.textContent),
      pageUrl: location.href,
      scrapedAt: new Date().toISOString(),
    };
  }).filter((row) => row.name && row.detailUrl);
}
```

---

## 4. Company Profile 详情页结构分析

详情页 URL：

```txt
https://www.crunchbase.com/organization/deepseek
```

本地样本标题：

```html
<title>DeepSeek - Crunchbase Company Profile & Funding</title>
```

### 4.1 页面主要卡片

样本里有多个 `mat-card`，重要卡片包括：

| 卡片标题/内容 | 可采字段 |
|---|---|
| 顶部摘要：`DeepSeek Total Funding CN¥50B Growth Score ...` | totalFunding、growthScore、heatScore（可选） |
| `About DeepSeek` | CB Rank、简介、Founded、公司状态、融资阶段、总部、员工数、官网、行业 |
| `Funding Rounds` | 最近融资概要；但完整数据建议去 financial_details |
| `Key People` | 关键人物与职位 |
| `Details` | Legal Name、Also Known As、Operating Status、Company Type、Founders 等 |
| `Company Funding` | Total Funding Amount、Number of Funding Rounds、Lead Investors、融资表摘要 |

### 4.2 基础字段解析方式

详情卡中的字段常见结构：

```html
<tile-field>
  <div class="tile-field">
    <label-with-info>Legal Name</label-with-info>
    <field-formatter>Hangzhou DeepSeek Artificial Intelligence Co., Ltd.</field-formatter>
  </div>
</tile-field>
```

因此可以使用：

```js
function parseTileFields(root = document) {
  const fields = {};
  for (const tile of root.querySelectorAll("tile-field")) {
    const label = cleanText(tile.querySelector("label-with-info")?.textContent);
    const formatter = tile.querySelector("field-formatter");
    if (!label || !formatter) continue;

    const links = [...formatter.querySelectorAll("a[href]")].map((a) => ({
      text: cleanText(a.getAttribute("title") || a.textContent),
      href: absoluteUrl(a.getAttribute("href")),
    })).filter((x) => x.text || x.href);

    fields[label] = {
      text: cleanText(formatter.textContent),
      links,
    };
  }
  return fields;
}
```

### 4.3 DeepSeek 样本可见字段

从样本可见字段中可稳定采到：

| 字段 | 样本值 |
|---|---|
| Company Name | DeepSeek |
| Founded | 2023 |
| Operating Status | Active |
| Company Type | For Profit |
| Funding Stage | Series A |
| Headquarters | Hangzhou, Zhejiang, China |
| Employee Count | 101-250 |
| Website | `www.deepseek.com` |
| Categories | Artificial Intelligence (AI), Developer APIs, Foundational AI, Generative AI, Machine Learning, Software |
| Sub-Organization of | High-Flyer AI |
| Legal Name | Hangzhou DeepSeek Artificial Intelligence Co., Ltd. |
| Also Known As | 深度求索 |
| Founders | Liang Wenfeng |
| Key People | Zhou Guangshang: CEO; Ruan Chong: Chief Scientist; Shangyan Zhou: Chief Scientist; Liang Wenfeng: Founder |

注意：部分字段可能受账号权限、视口位置、懒加载影响，需要滚动页面触发渲染后再解析。

---

## 5. Financial Details 融资详情页结构分析

融资详情页 URL：

```txt
https://www.crunchbase.com/organization/deepseek/financial_details
```

本地样本标题：

```html
<title>DeepSeek - Financial Details</title>
```

页面核心是标准表格，适合直接解析。

### 5.1 Highlights

`Highlights` 卡片可见文本：

```txt
DeepSeek has raised a total of CN¥50B in funding over 1 round.
This was a Series A round raised on Jun 16, 2026.
DeepSeek is funded by 9 investors.
Loyal Valley Capital and JD.com are the most recent investors.
Funding Rounds 1
Total Funding Amount CN¥50B
Lead Investors 1
Investors 9
```

可作为摘要字段，但不要只依赖自然语言句子，优先解析下面的表格和 `tile-field` 数值。

### 5.2 Funding Rounds 表

表头：

```txt
Announced Date | Transaction Name | Number of Investors | Money Raised | Lead Investors | Funding Type
```

样本行：

| Announced Date | Transaction Name | Number of Investors | Money Raised | Lead Investors | Funding Type |
|---|---|---:|---:|---|---|
| Jun 16, 2026 | Series A - DeepSeek | 9 | CN¥50B | Liang Wenfeng | Series A |

其中 Transaction Name 链接：

```txt
https://www.crunchbase.com/funding_round/deepseek-series-a--e09c87ba
```

Lead Investors 链接：

```txt
https://www.crunchbase.com/person/liang-wenfeng
```

### 5.3 Investors 表

表头：

```txt
Investor Name | Lead Investor | Funding Round | Partners
```

样本投资方：

| Investor Name | Lead Investor | Funding Round | Partners |
|---|---|---|---|
| Loyal Valley Capital | — | Series A - DeepSeek | — |
| JD.com | — | Series A - DeepSeek | — |
| NetEase | — | Series A - DeepSeek | — |
| National Artificial Intelligence Industry Investment Fund | — | Series A - DeepSeek | — |
| Contemporary Amperex Technology | — | Series A - DeepSeek | — |
| Tencent | — | Series A - DeepSeek | — |
| Monolith Management | — | Series A - DeepSeek | — |
| Liang Wenfeng | Yes | Series A - DeepSeek | — |
| IDG Capital | — | Series A - DeepSeek | — |

### 5.4 通用表格解析伪代码

```js
function parseTable(table) {
  const headers = [...table.querySelectorAll("thead th")]
    .map((th) => cleanText(th.textContent));

  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")];
    const row = {};

    headers.forEach((header, index) => {
      const td = cells[index];
      if (!td) return;

      row[header] = {
        text: cleanText(td.textContent),
        links: [...td.querySelectorAll("a[href]")].map((a) => ({
          text: cleanText(a.getAttribute("title") || a.textContent),
          href: absoluteUrl(a.getAttribute("href")),
        })).filter((x) => x.text || x.href),
      };
    });

    return row;
  });
}

function parseFinancialDetails(doc = document) {
  const tables = [...doc.querySelectorAll("table")];

  const parsed = tables.map((table) => ({
    headers: [...table.querySelectorAll("thead th")].map((th) => cleanText(th.textContent)),
    rows: parseTable(table),
  }));

  const fundingRounds = parsed.find((t) =>
    t.headers.includes("Announced Date") &&
    t.headers.includes("Transaction Name")
  )?.rows || [];

  const investors = parsed.find((t) =>
    t.headers.includes("Investor Name") &&
    t.headers.includes("Funding Round")
  )?.rows || [];

  return {
    fundingRounds,
    investors,
    scrapedAt: new Date().toISOString(),
    pageUrl: location.href,
  };
}
```

---

## 6. 推荐数据结构

### 6.1 列表页公司行

```json
{
  "source": "crunchbase",
  "listUrl": "https://www.crunchbase.com/discover/organization.companies/489a197116cd090d95a06fea4422d995",
  "index": 1,
  "name": "DeepSeek",
  "slug": "deepseek",
  "detailUrl": "https://www.crunchbase.com/organization/deepseek",
  "financialDetailsUrl": "https://www.crunchbase.com/organization/deepseek/financial_details",
  "logo": "https://images.crunchbase.com/image/upload/...",
  "categories": ["Artificial Intelligence (AI)", "Developer APIs"],
  "lastFundingAtText": "Jun 16, 2026",
  "locations": ["Hangzhou", "Zhejiang", "China"],
  "shortDescription": "DeepSeek is an artificial intelligence software company...",
  "rankOrg": "11",
  "rankOrgCompany": "10",
  "scrapedAt": "2026-07-15T...Z"
}
```

### 6.2 公司详情聚合结果

```json
{
  "source": "crunchbase",
  "slug": "deepseek",
  "name": "DeepSeek",
  "detailUrl": "https://www.crunchbase.com/organization/deepseek",
  "financialDetailsUrl": "https://www.crunchbase.com/organization/deepseek/financial_details",
  "profile": {
    "founded": "2023",
    "operatingStatus": "Active",
    "companyType": "For Profit",
    "fundingStage": "Series A",
    "headquarters": ["Hangzhou", "Zhejiang", "China"],
    "employeeCount": "101-250",
    "website": "www.deepseek.com",
    "legalName": "Hangzhou DeepSeek Artificial Intelligence Co., Ltd.",
    "alsoKnownAs": "深度求索",
    "founders": [{ "name": "Liang Wenfeng", "href": "https://www.crunchbase.com/person/liang-wenfeng" }]
  },
  "financials": {
    "totalFundingAmount": "CN¥50B",
    "numberOfFundingRounds": "1",
    "fundingRounds": [],
    "investors": []
  },
  "scrapedAt": "2026-07-15T...Z"
}
```

---

## 7. 脚本整体流程设计

### 7.1 页面匹配

建议 `@match`：

```js
// ==UserScript==
// @name         Crunchbase Company Scheduled Reader
// @namespace    https://cryptohunt.ai/
// @version      0.1.0
// @description  Browser-side Crunchbase company list/profile/financial details reader for research.
// @match        https://www.crunchbase.com/discover/organization.companies/*
// @match        https://www.crunchbase.com/organization/*
// @match        https://www.crunchbase.com/funding_round/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==
```

说明：第一阶段只需要 `discover` 和 `organization`，`funding_round` 可以预留给后续融资轮次详情页采集。

### 7.2 状态机

```txt
列表页 discover
  ↓ 解析 grid-row:not(.blurred-row)
  ↓ 写入 localStorage detailJob queue
  ↓ 跳转第一个 /organization/:slug

详情页 /organization/:slug
  ↓ 解析 profile / details / key people
  ↓ 保存到 detailJob 当前 item
  ↓ 跳转 /organization/:slug/financial_details

融资详情页 /organization/:slug/financial_details
  ↓ 解析 Funding Rounds 表
  ↓ 解析 Investors 表
  ↓ 合并 item
  ↓ 可选 POST 后端 / 或保存 localStorage
  ↓ 跳转下一个 /organization/:slug

队列结束
  ↓ 回到列表页或停留
  ↓ 页面面板显示完成、可复制 JSON
```

### 7.3 当前标签页跳转优先

不建议用隐藏 iframe 批量抓 Crunchbase 详情页，原因：

1. Crunchbase 是 Angular 应用，详情区和表格区存在懒加载/异步渲染。
2. 浏览器会节流后台/隐藏 iframe。
3. 登录态、权限弹窗、Pro 限制提示在 iframe 中更难处理。
4. RootData 脚本已经验证了“当前标签页逐个跳转”的稳定性更高。

---

## 8. 等待与异常检测

### 8.1 等待条件

| 页面 | 成功条件 |
|---|---|
| Discover 列表页 | 存在 `grid-row:not(.blurred-row) grid-cell[data-columnid="identifier"] a[href*="/organization/"]` |
| Company Profile 页 | 存在 `h1` 或页面标题匹配公司名，并出现 `mat-card` / `tile-field` |
| Financial Details 页 | 存在 `h2` 包含 `Financial Details`，且出现 funding/investor `table` |

### 8.2 异常/限制检测

建议检测以下文本：

```txt
You've reached your monthly limit
You’ve reached your monthly limit
Sign in
Log in
Verify you are human
Access Denied
Too Many Requests
Something went wrong
```

处理策略：

1. 页面未加载完成：轮询等待，最多 30-60 秒。
2. 临时空数据：刷新重试，最多 2-3 次。
3. 月度限制/权限限制：不要重试刷屏，标记 `blocked: monthly_limit_or_permission`。
4. 当前公司 financial_details 表为空：保留 profile，financials 标记为空。

---

## 9. 字段解析稳定性策略

### 9.1 文本清洗

必须清理：

- `\u200B` 零宽字符。
- 多余空白。
- 自动翻译产生的重复 `<font>` 嵌套。
- `—` / `-` / `N/A` 统一为空或保留原文。

### 9.2 属性优先级

| 数据 | 优先级 |
|---|---|
| 公司/投资方/人物名称 | `title` > `aria-label` > `textContent` |
| 链接 | `href`，统一转绝对 URL |
| 简介长文本 | `[title]` > `textContent` |
| 分类/地点多选 | 所有 `a[title]` 去重；若为空再拆文本 |
| 表格字段 | `thead th` 建 header map，按列读取 `td` |

### 9.3 多语言问题

截图里页面存在中文翻译内容，但保存的 HTML 样本是英文。建议：

1. **运行采集浏览器关闭自动翻译**。
2. Chrome 语言固定为英文。
3. 日期保留原文；后端做多语言日期解析时再处理 `Jun 16, 2026` / `2026年6月16日`。
4. 如果无法关闭翻译，维护 label map，例如：

```js
const FIELD_LABEL_MAP = {
  "Legal Name": "legalName",
  "法定名称": "legalName",
  "Also Known As": "alsoKnownAs",
  "又名": "alsoKnownAs",
  "Operating Status": "operatingStatus",
  "经营状态": "operatingStatus",
};
```

---

## 10. 与后端接口的建议

第一阶段建议只完成浏览器内采集与 JSON 导出；第二阶段再新增后端接口。

后端可参考 RootData internal 路由风格，新增：

```txt
POST /api/internal/crunchbase/companies/import
POST /api/internal/crunchbase/companies/details/import
POST /api/internal/crunchbase/companies/alert
```

请求头沿用内部 token 模式：

```txt
Authorization: Bearer <CLIENT_TOKEN>
```

或：

```txt
x-client-token: <CLIENT_TOKEN>
```

### 10.1 import payload 示例

```json
{
  "source": "tampermonkey",
  "runId": "cb_2026-07-15T14:30:00.000Z",
  "listUrl": "https://www.crunchbase.com/discover/organization.companies/489a197116cd090d95a06fea4422d995",
  "rows": [],
  "details": [],
  "meta": {
    "userAgent": "...",
    "scrapedAt": "2026-07-15T14:30:00.000Z"
  }
}
```

---

## 11. 分阶段实施建议

### 阶段 1：纯前端验证

目标：不接后端，只在 Console / 面板 / 剪贴板输出。

- 新建 `tampermonkey/crunchbase-company-scheduled-reader.user.js`。
- 实现 `parseCompanyListRows()`。
- 实现 `parseFinancialDetails()`。
- 暴露：

```js
window.CrunchbaseCompanyCollector.parseList()
window.CrunchbaseCompanyCollector.parseFinancialDetails()
window.CrunchbaseCompanyCollector.copyLastResult()
```

### 阶段 2：详情页队列

目标：从列表页排队逐个进入详情页。

- localStorage 保存 detail queue。
- 当前标签页跳转 `/organization/:slug`。
- 再跳转 `/organization/:slug/financial_details`。
- 每个公司完成后写回 localStorage。
- 支持 `resume()`。

### 阶段 3：后端接收

目标：接入服务端 import API。

- 新增 internal routes。
- 做 token 校验。
- 先保存 raw JSON，后续再规范化入库。
- 加 alert 接口用于失败通知。

### 阶段 4：增强数据

可选采集：

- funding_round 详情页。
- key people 详情页。
- website / social links。
- news 列表。

---

## 12. 注意事项

1. **只采集当前账号可见内容**，不要尝试绕过登录、Pro、月度限制或 blurred rows。
2. **请求节流**：公司详情跳转间隔建议 2-5 秒，并加随机抖动。
3. **不要服务端直接高频请求 Crunchbase**；本方案重点是浏览器内人工账号可见数据读取。
4. **保留 raw payload**，因为 Crunchbase DOM 和字段随时会调整，raw 可用于回溯解析。
5. **日期和金额先保留原文**，例如 `CN¥50B`、`Jun 16, 2026`，后端统一规范化。
6. **本地 HTML 中图片可能变成 `./..._files/...` 相对路径**；线上脚本会读到真实 `https://images.crunchbase.com/...`。

---

## 13. 推荐文件结构

```txt
tampermonkey/
  crunchbase-company-scheduled-reader.user.js
  crunchbase-company-scheduled-reader.map.md

docs/
  crunchbase-tampermonkey-technical-analysis.md

src/routes/
  crunchbase-tampermonkey.js        # 第二阶段再加
```

---

## 14. 最小可行版本功能清单

- [ ] 在 discover 页面解析可见公司列表。
- [ ] 跳过 `.blurred-row`。
- [ ] 生成 `detailUrl` 与 `financialDetailsUrl`。
- [ ] 在详情页解析 profile 基础字段。
- [ ] 在 financial_details 页解析 Funding Rounds 表。
- [ ] 在 financial_details 页解析 Investors 表。
- [ ] localStorage 队列可恢复。
- [ ] 右下角浮动面板显示进度。
- [ ] 一键复制 JSON。
- [ ] 可选回传后端。
