# AI 融资数据源调研报告：Crunchbase vs StartupHub.ai

调研日期：2026-07-09  
目标：评估 [Crunchbase](https://www.crunchbase.com/) 和 [StartupHub.ai](https://www.startuphub.ai/) 的付费套餐、官方 API、爬虫可行性，以及它们是否适合用于获取 AI 领域最新融资信息。

---

## 1. 需求背景

希望通过官方接口或爬虫方式，获取 AI 领域融资数据，并最终做成内部接口使用。

核心数据诉求：

- 获取最新被融资的 AI 公司列表；
- 查询某个公司的融资详情；
- 尽量一次性拉取所有 AI 领域融资信息；
- 需要知道某个公司：
  - 公司名称；
  - X / Twitter 账户；
  - 融资时间；
  - 融资金额；
  - 融资轮次；
  - 投资机构；
  - 领投机构；
  - 官网、行业、地区等辅助信息。

---

## 2. 结论摘要

### 2.1 推荐结论

| 目标 | 推荐 |
|---|---|
| 权威、历史融资全量、轮次和投资机构完整 | Crunchbase API / Data Licensing |
| AI 垂直、便宜、自助 API、快速接入最新 AI startup 列表 | StartupHub.ai |
| 做正式内部接口，长期稳定同步融资数据 | Crunchbase 为主，StartupHub.ai 为补充 |
| 直接爬虫抓页面 | 不建议，两个站条款都限制自动抓取 |

### 2.2 核心判断

1. **Crunchbase 更适合做“融资事实数据库”**
   - API 结构更成熟；
   - 支持公司、融资轮次、投资机构、投资关系；
   - 有明确的 `funding_rounds`、`organizations`、`investors` 等数据实体；
   - 可拿公司 X / Twitter 字段；
   - 但完整 API 通常需要 Enterprise / Applications License 或 Data Licensing，成本较高。

2. **StartupHub.ai 更适合做“AI 公司发现 / 最新 AI startup feed”**
   - 价格低；
   - 自助 API；
   - 原生聚焦 AI startup；
   - 支持按 `latest_funding_date` 排序；
   - Pro Lite 以上套餐包含 funding、employee count、social links；
   - 但公开文档中暂未看到非常明确的 round-by-round funding rounds + investors 明细 endpoint。

3. **不建议走爬虫**
   - Crunchbase Terms 明确禁止 crawl / scrape / spider；
   - StartupHub.ai Terms 也禁止未经允许使用 bots / scrapers；
   - 对长期内部服务来说，建议走官方 API 或正式数据授权。

---

## 3. Crunchbase 调研

官网：

- https://www.crunchbase.com/
- API 产品页：https://about.crunchbase.com/products/crunchbase-api
- API 文档：https://data.crunchbase.com/docs/welcome-to-crunchbase-data

---

### 3.1 Crunchbase 数据能力

Crunchbase 官方 Data API 提供：

- 公司数据；
- 融资轮次数据；
- 投资机构数据；
- 投资关系数据；
- 并购、IPO、人员、新闻等扩展信息；
- round-by-round funding data；
- 600+ endpoints。

官方 API 数据包大致分为：

- Fundamentals；
- Insights；
- Predictions。

参考：

- https://data.crunchbase.com/docs/welcome-to-crunchbase-data
- https://about.crunchbase.com/products/crunchbase-api

---

### 3.2 Crunchbase 套餐和价格

| 套餐 | 适合场景 | 价格情况 | API 权限 |
|---|---|---|---|
| Free / Basic | 少量浏览 | 免费或有限访问 | Basic API / Basic fields，能力有限 |
| Crunchbase Pro | 人工网页搜索、导出、跟踪公司 | 官方支持页显示月付 $99；年付价格以官网为准 | 不等于完整 API 权限 |
| Crunchbase Business | 团队、CRM、更多导出、预测能力 | 通常需要看 pricing 或联系 sales | 需确认 API 权限 |
| Crunchbase API / Data Licensing | 程序化访问、内部系统、产品内嵌、全量数据 | Contact Sales / 定制报价 | 完整 API 通常需要 Enterprise 或 Applications License |

重要说明：

Crunchbase API 文档明确提到：**Full API 需要 Enterprise 或 Applications License**。所以如果目标是程序化拉取融资数据，不应只购买普通 Pro 套餐。

参考：

- https://support.crunchbase.com/hc/en-us/articles/360001616808-Buy-Crunchbase-Pro
- https://data.crunchbase.com/docs/using-the-api

---

### 3.3 Crunchbase 是否能满足需求 1：获取最新被融资的 AI 公司列表？

可以。

有两种主要方式。

#### 方式 A：搜索 organizations

Endpoint：

```http
POST https://api.crunchbase.com/v4/data/searches/organizations
```

可用字段通常包括：

- `identifier`
- `short_description`
- `website_url`
- `twitter`
- `linkedin`
- `category_groups`
- `categories`
- `last_funding_at`
- `last_funding_total`
- `last_funding_type`
- `location_identifiers`

示例思路：筛选 AI 相关公司，并按最近融资时间倒序。

```json
{
  "field_ids": [
    "identifier",
    "short_description",
    "website_url",
    "twitter",
    "last_funding_at",
    "last_funding_total",
    "last_funding_type",
    "category_groups"
  ],
  "query": [
    {
      "type": "predicate",
      "field_id": "category_groups",
      "operator_id": "includes",
      "values": ["artificial-intelligence"]
    },
    {
      "type": "predicate",
      "field_id": "last_funding_at",
      "operator_id": "gte",
      "values": ["2026-01-01"]
    }
  ],
  "order": [
    {
      "field_id": "last_funding_at",
      "sort": "desc"
    }
  ],
  "limit": 1000
}
```

注意：`artificial-intelligence` 是示意值，实际 category identifier 需要通过 Crunchbase API 或页面确认。

参考：

- https://data.crunchbase.com/docs/build-market-landscapes-and-streamline-workflows

#### 方式 B：直接搜索 funding_rounds

Endpoint：

```http
POST https://api.crunchbase.com/v4/data/searches/funding_rounds
```

可用字段通常包括：

- `identifier`
- `announced_on`
- `funded_organization_identifier`
- `money_raised`
- `investment_type`
- `num_investors`

这个方式更像“融资事件流”，适合做本地 `funding_rounds` 表。

参考：

- https://data.crunchbase.com/docs/using-search-apis

---

### 3.4 Crunchbase 是否能满足需求 2：查询某个公司的融资详情？

可以。

Organization Lookup Endpoint：

```http
GET https://api.crunchbase.com/v4/data/entities/organizations/{entity_id}
```

`entity_id` 可以是 uuid 或 permalink。

官方示例中支持通过 `card_ids` 获取融资轮次等扩展卡片：

```http
GET https://api.crunchbase.com/v4/data/entities/organizations/tesla-motors
  ?card_ids=founders,raised_funding_rounds
  &field_ids=categories,short_description,rank_org_company,founded_on,website,facebook,created_at
```

建议查询字段：

```text
identifier,
name,
short_description,
website_url,
twitter,
linkedin,
location_identifiers,
categories,
category_groups,
founded_on,
last_funding_at,
last_funding_total,
last_funding_type,
num_funding_rounds,
funding_total
```

建议查询 cards：

```text
raised_funding_rounds,
raised_investments,
founders,
investors
```

具体 card 名称需要以购买的数据包和实际 API 返回为准。

参考：

- https://data.crunchbase.com/docs/examples-entity-lookup-api
- https://data.crunchbase.com/reference/getorganization

---

### 3.5 Crunchbase 是否能拿 X / Twitter 账号？

可以。

Crunchbase Organization Attributes 中有：

- `twitter`
- `facebook`
- `linkedin`
- `website_url`

虽然现在产品名是 X，但 API 字段大概率仍叫 `twitter`。

参考：

- https://data.crunchbase.com/docs/organizationsummary

---

### 3.6 Crunchbase 全量拉取可行性

可行，但依赖授权。

Search API 支持：

- 默认 50 条；
- 每页最大 1000 条；
- 通过 `after_id` / `before_id` 翻页；
- 文档提到 rate limit 为每分钟 200 calls。

推荐全量同步策略：

1. 搜索 AI 相关 organizations；
2. 分页拉取，每页 1000 条；
3. 对每家公司拉 organization detail；
4. 获取 `raised_funding_rounds`；
5. 获取每轮融资对应的 investments / investors；
6. 入库；
7. 后续按 `announced_on` 或 `last_funding_at` 增量同步。

参考：

- https://data.crunchbase.com/docs/using-search-apis
- https://data.crunchbase.com/docs/using-the-api

---

### 3.7 Crunchbase 爬虫可行性

不建议。

Crunchbase Terms 明确禁止：

- crawl；
- scrape；
- spider；
- 自动抓取页面、数据或服务内容；
- 绕过限制；
- 复制或存储大量内容；
- 未经许可将数据用于第三方工具或产品。

因此长期服务建议使用官方 API 或 Data Licensing。

参考：

- https://about.crunchbase.com/terms-of-service

---

## 4. StartupHub.ai 调研

官网：

- https://www.startuphub.ai/
- Pricing：https://www.startuphub.ai/pricing
- API Docs：https://www.startuphub.ai/api-docs
- New Startups API：https://www.startuphub.ai/new-startups-api

---

### 4.1 StartupHub.ai 定位

StartupHub.ai 是 AI startup 垂直数据库，主要覆盖：

- AI startups；
- investors；
- people；
- company profiles；
- AI-enriched data points。

它更适合发现 AI 公司、AI agent、AI infra、AI vertical applications 等垂直领域数据。

参考：

- https://www.startuphub.ai/

---

### 4.2 StartupHub.ai 套餐价格

官方 Pricing 页价格：

| 套餐 | 月费 | Search API / day | Profile API / day | API 字段 |
|---|---:|---:|---:|---|
| Free | $0/mo | 50/day | 25/day | Basic |
| Pro Mini | $5/mo | 200/day | 100/day | Basic |
| Pro Lite | $30/mo | 500/day | 250/day | Extended，含 funding、employee count、social links |
| Pro | $50/mo | 2,000/day | 1,000/day | Full，含 description、scores、competitors |
| Pro Plus | $90/mo | 10,000/day | 5,000/day | All fields |

其他限制：

- 每个账号最多 3 个 API keys；
- Search startups / investors：
  - `/api/v1/startups`
  - `/api/v1/investors`
- Full startup profile：
  - `/api/v1/startups/:slug`
- Search 结果每页最大 100；
- 支持 MCP Server；
- 支持 CSV export，但每月 export credits 有限制。

参考：

- https://www.startuphub.ai/pricing

---

### 4.3 StartupHub.ai 是否能满足需求 1：获取最新被融资的 AI 公司列表？

基本可以。

StartupHub.ai Search Startups API：

```http
GET https://www.startuphub.ai/api/v1/startups
```

支持按最新加入排序：

```http
GET /api/v1/startups?sort=created_at.desc&limit=100
```

支持按最近融资日期排序：

```http
GET /api/v1/startups?sort=latest_funding_date.desc&limit=100
```

Search Startups 文档中 `sort` 支持：

- `founded_date.desc`
- `total_funding.desc`
- `total_score.desc`
- `current_revenue.desc`
- `employee_count.desc`
- `employee_growth_quarterly_cagr.desc`
- `latest_funding_date.desc`
- `created_at.desc`

示例：

```bash
curl "https://www.startuphub.ai/api/v1/startups?sector=AI&sort=latest_funding_date.desc&limit=100" \
  -H "Authorization: Bearer sk_live_xxx"
```

参考：

- https://www.startuphub.ai/api-docs/reference/search-startups
- https://www.startuphub.ai/new-startups-api

---

### 4.4 StartupHub.ai 是否能满足需求 2：查询某个公司的融资详情？

部分可以，但需要实测确认完整度。

Startup profile endpoint：

```http
GET https://www.startuphub.ai/api/v1/startups/:slug
```

示例：

```bash
curl "https://www.startuphub.ai/api/v1/startups/anthropic" \
  -H "Authorization: Bearer sk_live_xxx"
```

公开示例返回字段包括：

- `name`
- `slug`
- `description`
- `website`
- `hq_country`
- `total_funding`
- `employee_count`
- `sectors`
- `total_score`
- `logo_url`

但是文档示例没有明确展示：

- 每轮融资时间；
- 每轮融资金额；
- 每轮投资机构；
- 领投机构。

Pricing 页说明 Pro Lite 以上包含 `funding` 和 `social links`，所以很可能能拿到部分融资字段，但是否包含完整 round-by-round investors，需要拿 API key 实测或联系 StartupHub.ai 确认。

参考：

- https://www.startuphub.ai/api-docs/reference/get-startup
- https://www.startuphub.ai/pricing

---

### 4.5 StartupHub.ai 是否能拿 X / Twitter 账号？

理论上可以。

Pricing 页明确 Pro Lite 以上包含 `social links` 字段。通常 social links 应包含 X / Twitter、LinkedIn 等链接。

但公开 API 示例未展示 social links 的具体结构，需要实测确认字段名，例如：

```json
{
  "social_links": {
    "twitter": "https://x.com/example",
    "linkedin": "https://linkedin.com/company/example"
  }
}
```

参考：

- https://www.startuphub.ai/pricing

---

### 4.6 StartupHub.ai 全量拉取可行性

#### 4.6.1 拉 startup 列表

可行。

Search API 每页最大 100 条。若总 AI startup 约 23,000 条，理论上约 230 次请求可拉完基础列表。

Pro Plus 每天 10,000 次 Search API，足够一天拉完整列表。

#### 4.6.2 拉每家公司详情 profile

可行，但受套餐日限额影响。

按 23,000 家 AI startups 估算：

| 套餐 | Profile/day | 拉 23,000 profile 约需 |
|---|---:|---:|
| Pro Lite | 250/day | 约 92 天 |
| Pro | 1,000/day | 约 23 天 |
| Pro Plus | 5,000/day | 约 5 天 |

如果想快速完成全量详情，建议至少 Pro Plus，或联系官方购买一次性 bulk export / 更高 API credits。

参考：

- https://www.startuphub.ai/pricing
- https://www.startuphub.ai/new-startups-api

---

### 4.7 StartupHub.ai Trends API

StartupHub.ai 提供趋势接口：

```http
GET https://www.startuphub.ai/api/v1/trends/current
```

返回：

- 7 天资本部署金额；
- 上一周期对比；
- 7 天融资轮次数；
- biggest rounds；
- top sectors；
- top countries；
- top stages；
- active investors；
- recent exits。

适合做首页 dashboard 或趋势看板，但不是完整融资事件明细数据源。

参考：

- https://www.startuphub.ai/api-docs/reference/trends

---

### 4.8 StartupHub.ai Monitor Webhook

StartupHub.ai Monitor API：

```http
POST https://www.startuphub.ai/api/v1/monitor
```

可以监控某个公司信号：

- funding；
- jobs；
- tech stack；
- headcount；
- news；
- status；
- pricing；
- domains。

示例：

```json
{
  "url": "cursor.com",
  "signals": ["funding", "jobs", "pricing"],
  "webhook_url": "https://yourapp.com/hooks/monitor"
}
```

适合做关注公司列表的增量提醒，不太适合全市场融资事件采集。

参考：

- https://www.startuphub.ai/api-docs/reference/monitor-watch

---

### 4.9 StartupHub.ai 爬虫可行性

不建议。

StartupHub.ai Terms 禁止未经授权使用 bots、scrapers、automated systems，也禁止绕过访问限制或用自动方式收集数据。

参考：

- https://www.startuphub.ai/terms

---

## 5. 两者对比

### 5.1 核心能力对比

| 维度 | Crunchbase | StartupHub.ai |
|---|---|---|
| 数据覆盖 | 全球通用 startup / 公司 / 投资 / 并购 / IPO | AI startup 垂直 |
| AI 领域覆盖 | 需要用 category / keyword 筛选 | 原生就是 AI startup 目录 |
| 历史融资数据 | 强，支持 round-by-round funding | 有 funding 字段，但 round-by-round investors 需实测 |
| 最新融资列表 | 强，可查 funding_rounds 或 organizations `last_funding_at` | 可按 `latest_funding_date.desc` 查 startup |
| 单家公司融资详情 | 强，organization + raised_funding_rounds + investments | 有 profile API，但文档示例只展示 total_funding |
| 投资机构详情 | 强，有 investors / investments / participated_investments | 有 investors search API |
| X / Twitter | 有 `twitter` 字段 | Pro Lite 以上有 social links，需实测字段 |
| API 接入门槛 | 高，需要 Enterprise / Applications License | 低，自助 API key |
| 价格透明度 | API 定制报价，不透明 | 透明，$0 / $5 / $30 / $50 / $90 |
| 全量拉取 | 可以，但需授权 | startup 列表可快速拉，profile 全量受日限额 |
| 爬虫合规 | 明确禁止 | 明确禁止 |
| 适合程度 | 适合作为主数据源 | 适合作为补充 AI 发现源 |

---

### 5.2 付费套餐对比

#### Crunchbase

| 套餐 | 价格 | 适合 | 局限 |
|---|---:|---|---|
| Free / Basic | 免费 / 有限 | 少量浏览或 Basic API | 字段很少，不适合完整融资系统 |
| Pro | 官方月付 $99；年付价格以官网为准 | 人工网页搜索、导出、跟踪公司 | 不是完整 API |
| Business | 联系销售 | 团队、CRM、更多导出、预测 | 仍需确认 API 权限 |
| API / Data Licensing | 定制报价 | 程序化拉取、内部系统、数据产品 | 需要销售沟通，成本最高 |

#### StartupHub.ai

| 套餐 | 月费 | 适合 |
|---|---:|---|
| Free | $0 | 试用、少量查询 |
| Pro Mini | $5 | 低频 API |
| Pro Lite | $30 | 开始拿 funding、employee、social links |
| Pro | $50 | 更完整 profile，1,000 profile/day |
| Pro Plus | $90 | 全字段、10,000 search/day、5,000 profile/day |

---

## 6. 推荐落地方案

### 6.1 推荐数据源组合

```text
主数据源：Crunchbase API / Data Licensing
辅助数据源：StartupHub.ai Pro Plus
```

职责分工：

- Crunchbase：融资事实、历史融资轮次、投资机构关系；
- StartupHub.ai：AI startup 发现、AI 细分领域、最新新增 AI 公司、social links 补充、watchlist webhook；
- 本地数据库：统一去重、合并、补全；
- 内部接口：只读本地库，不实时依赖第三方 API。

---

### 6.2 推荐服务架构

```text
Data Source Layer
├── Crunchbase Provider
│   ├── searchFundingRounds()
│   ├── searchOrganizations()
│   ├── getOrganizationDetail()
│   ├── getOrganizationFundingRounds()
│   └── getInvestors()
│
├── StartupHub Provider
│   ├── searchStartups()
│   ├── getStartupProfile()
│   ├── getTrends()
│   └── monitorWebhook()
│
└── Optional News Provider
    └── 用于补充新闻来源、校验融资公告

Local DB
├── ai_funding_companies
├── ai_funding_company_socials
├── ai_funding_rounds
├── ai_funding_investors
├── ai_funding_round_investors
├── ai_funding_source_mappings
└── ai_funding_sync_jobs

Internal API
├── GET /api/ai-funding/companies
├── GET /api/ai-funding/funding-rounds
├── GET /api/ai-funding/companies/:id
├── GET /api/ai-funding/companies/:id/funding-rounds
└── POST /api/ai-funding/sync
```

---

## 7. 数据表设计建议

### 7.1 `ai_funding_companies`

```sql
id
source
source_id
name
slug
website
x_url
linkedin_url
description
hq_country
hq_city
sectors
total_funding_usd
latest_funding_date
latest_funding_amount_usd
latest_funding_type
employee_count
created_at
updated_at
```

### 7.2 `ai_funding_rounds`

```sql
id
source
source_round_id
company_id
announced_on
round_type
money_raised_usd
money_raised_currency
lead_investor_names
source_url
created_at
updated_at
```

### 7.3 `ai_funding_investors`

```sql
id
source
source_investor_id
name
type
website
country
created_at
updated_at
```

### 7.4 `ai_funding_round_investors`

```sql
id
round_id
investor_id
is_lead
partner_name
created_at
updated_at
```

### 7.5 `ai_funding_source_mappings`

```sql
id
company_id
source
source_id
source_slug
source_url
raw_payload_json
created_at
updated_at
```

---

## 8. 同步策略建议

### 8.1 首次全量同步

#### Crunchbase

1. Search organizations：
   - category = AI / Artificial Intelligence / Machine Learning；
   - order by `last_funding_at desc`；
   - paginate 1000 per page；
2. 对每家公司调用 organization detail；
3. 拉 `raised_funding_rounds`；
4. 对每个 funding round 拉 investment / investor card；
5. 入库。

#### StartupHub.ai

1. Search startups：
   - `sector=AI`；
   - `sort=latest_funding_date.desc`；
   - `limit=100`；
   - offset / page 翻页；
2. 存基础 profile；
3. 对重点公司调用 profile API；
4. 用 StartupHub 的 social links / funding 字段补充 Crunchbase 没有的数据；
5. 如果是 Pro Plus 以下，profile 全量要排队多天跑。

---

### 8.2 增量同步

#### Crunchbase

```text
funding_rounds where announced_on >= last_sync_time - 2 days
```

建议保留 2 天 overlap，避免时区、回填和数据延迟。

#### StartupHub.ai

```text
GET /startups?sort=latest_funding_date.desc
```

直到遇到本地已同步过的 `latest_funding_date` 为止。

---

## 9. 内部接口设计建议

### 9.1 最新融资公司列表

```http
GET /api/ai-funding/companies?sort=latestFundingDate&order=desc&page=1&pageSize=50
```

返回示例：

```json
{
  "items": [
    {
      "id": 1,
      "name": "Anthropic",
      "website": "https://anthropic.com",
      "xUrl": "https://x.com/AnthropicAI",
      "sectors": ["AI", "Machine Learning"],
      "latestFundingDate": "2026-01-15",
      "latestFundingAmountUsd": 1000000000,
      "latestFundingType": "Series F",
      "totalFundingUsd": 15000000000,
      "leadInvestors": ["Investor A", "Investor B"],
      "sources": ["crunchbase", "startuphub"]
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 12345
  }
}
```

---

### 9.2 某家公司详情

```http
GET /api/ai-funding/companies/:id
```

返回示例：

```json
{
  "id": 1,
  "name": "Anthropic",
  "description": "AI safety company...",
  "website": "https://anthropic.com",
  "xUrl": "https://x.com/AnthropicAI",
  "linkedinUrl": "https://linkedin.com/company/anthropic",
  "hqCountry": "United States",
  "hqCity": "San Francisco",
  "sectors": ["AI", "Machine Learning"],
  "totalFundingUsd": 15000000000,
  "fundingRounds": [
    {
      "announcedOn": "2026-01-15",
      "roundType": "Series F",
      "moneyRaisedUsd": 1000000000,
      "leadInvestors": ["Investor A"],
      "investors": ["Investor A", "Investor B", "Investor C"]
    }
  ]
}
```

---

## 10. 风险和注意事项

### 10.1 Crunchbase API 成本可能较高

Crunchbase API / Data Licensing 通常需要销售定价。购买前建议直接确认：

1. 是否支持 `funding_rounds` 全量 API？
2. 是否支持 `organizations` 全量搜索？
3. 是否包含 `twitter` / `website_url` / social links？
4. 是否包含每轮融资的 investors / lead investors？
5. 是否允许本地缓存？
6. 缓存数据保留多久？
7. 是否允许内部接口展示？
8. 是否可以每日增量同步？
9. 有没有 bulk export / historical dump？
10. 报价按 seat、API call、数据包还是年费？

---

### 10.2 StartupHub.ai 融资明细需要实测

StartupHub.ai 文档对 startup search、profile、trends、monitor 写得比较清楚，但没有看到独立的：

```http
GET /api/v1/funding-rounds
GET /api/v1/startups/:slug/funding-rounds
```

建议购买 Pro Lite 或 Pro Plus 后测试：

```bash
curl "https://www.startuphub.ai/api/v1/startups/anthropic" \
  -H "Authorization: Bearer sk_live_xxx"
```

重点看返回里是否有类似：

```json
{
  "funding_rounds": [
    {
      "announced_on": "...",
      "amount": "...",
      "series": "...",
      "investors": ["..."],
      "lead_investors": ["..."]
    }
  ],
  "social_links": {
    "twitter": "..."
  }
}
```

如果没有完整轮次和投资机构，就把 StartupHub.ai 定位为：

- AI 公司发现；
- 总融资额；
- 最新融资日期；
- social links 补充；
- 趋势和 webhook 辅助。

---

### 10.3 不建议绕过反爬

两个站 Terms 都限制自动抓取。直接爬虫可能带来：

- 账号封禁；
- IP 封禁；
- 数据不稳定；
- 页面结构变化维护成本；
- 合规风险；
- 后续商业化风险。

---

## 11. 最终建议

### 11.1 快速低成本验证

先买：

```text
StartupHub.ai Pro Lite 或 Pro Plus
```

原因：

- $30 或 $90/月；
- 自助 API；
- 很快能拿到 AI startup 列表；
- 能按 `latest_funding_date` 排序；
- 能拿 social links / funding 字段；
- 可以快速做 MVP 接口。

限制：

- round-by-round 融资轮次和投资机构明细可能不完整，需要实测。

---

### 11.2 长期稳定完整方案

联系：

```text
Crunchbase API / Data Licensing
```

原因：

- funding_rounds、organizations、investments、investors 结构更成熟；
- 支持 round-by-round；
- 支持 Twitter 字段；
- 支持分页全量；
- 适合本地建库和长期增量同步。

缺点：

- 贵；
- 需要 sales；
- 授权条款要谈清楚，尤其是本地缓存和内部展示。

---

### 11.3 推荐最终组合

```text
主数据源：Crunchbase API
辅助数据源：StartupHub.ai Pro Plus
```

这样可以同时兼顾：

- 融资事实准确性；
- AI 垂直发现能力；
- X / social links 补充；
- 本地接口稳定性；
- 后续扩展空间。

---

## 12. 参考来源

1. Crunchbase API 产品页  
   https://about.crunchbase.com/products/crunchbase-api

2. Crunchbase Data API 文档  
   https://data.crunchbase.com/docs/welcome-to-crunchbase-data

3. Crunchbase API 使用说明  
   https://data.crunchbase.com/docs/using-the-api

4. Crunchbase Search API  
   https://data.crunchbase.com/docs/using-search-apis

5. Crunchbase Organization Lookup  
   https://data.crunchbase.com/reference/getorganization

6. Crunchbase Organization Attributes  
   https://data.crunchbase.com/docs/organizationsummary

7. Crunchbase Terms of Service  
   https://about.crunchbase.com/terms-of-service

8. StartupHub.ai 首页  
   https://www.startuphub.ai/

9. StartupHub.ai Pricing  
   https://www.startuphub.ai/pricing

10. StartupHub.ai API Docs  
    https://www.startuphub.ai/api-docs

11. StartupHub.ai Search Startups API  
    https://www.startuphub.ai/api-docs/reference/search-startups

12. StartupHub.ai Get Startup Profile API  
    https://www.startuphub.ai/api-docs/reference/get-startup

13. StartupHub.ai New Startups API  
    https://www.startuphub.ai/new-startups-api

14. StartupHub.ai Trends API  
    https://www.startuphub.ai/api-docs/reference/trends

15. StartupHub.ai Monitor API  
    https://www.startuphub.ai/api-docs/reference/monitor-watch

16. StartupHub.ai Terms  
    https://www.startuphub.ai/terms
