# 自定义榜单列隐藏配置：技术分析

> 状态：已实施（2026-10-16）。列标识采用 key，管理后台提供常用 key 下拉多选；移动端 Rank/Hunter 同步受控隐藏。
> 后端：`luykin-chaineye-service`；管理后台：`admin-web`；网站前端：`XHunt.website`（`apps/echohunt`）
> 更新：2026-10-16

## 1. 需求

在管理后台 `api/xhunt/stats#/nacos-campaigns` 的活动配置中，给"自定义榜单"（`customLeaderboards`）每一项新增一个配置，用于声明该榜单在前端**不展示哪些列**。例如配置 `["rank", "hunter"]` 后，前端该榜单的 Rank、Hunter 列即隐藏。

## 2. 现状梳理

### 2.1 配置编辑与保存链路（后端仓库）

管理后台页面 `admin-web/src/pages/NacosCampaignsPage.tsx` 维护活动配置，发布时整体提交：

- 发布入口：`NacosCampaignsPage.tsx:1669`（`showPublishPreview`）→ `:1685`（`confirmPublish`）→ `PUT /api/xhunt/website/campaigns/internal/managed-config`（`admin-web/src/services/nacos.ts:77-88`）。
- 服务端保存：`src/xhunt/api/website-campaigns.js:596-621` → `saveManagedCampaignsConfig`（`src/xhunt/services/websiteCampaignService.js:425-508`）。关键在 `websiteCampaignService.js:150`：`nacosPayload: campaign`——**整个 campaign 对象（含 `customLeaderboards`）原样存入 PG JSONB 列，服务端宽松透传，不做字段白名单**。保存后清 Redis 缓存（`website-campaigns.js:600`）。
- 因此**新增字段在服务端保存层无需任何改动**。

但管理后台编辑器侧有一处**白名单陷阱**：`normalizeCampaign()`（`NacosCampaignsPage.tsx:456-470`）对 `customLeaderboards` 每一项做显式字段重建，未列出的字段会在"从 DB 加载进编辑器"时被丢弃：

```ts
// NacosCampaignsPage.tsx:459-470（节选）
c.customLeaderboards = c.customLeaderboards.map((it: AnyObj) => ({
  id: String(it?.id || ""),
  name: normalizeI18nText(it?.name),
  short_name: normalizeI18nText(it?.short_name),
  amount: it?.amount,
  participantCount: it?.participantCount,
  distributionType: it?.distributionType || "",
  unit: it?.unit || "",
  empty_text: normalizeI18nText(it?.empty_text || it?.emptyText),
  displayChannels: normalizeCustomLeaderboardDisplayChannels(it?.displayChannels),
  tweetSubmission: normalizeTweetSubmissionEditorConfig(it?.tweetSubmission),
}));
```

**新增 `hiddenColumns` 必须在此加一行**，否则配置保存后再次打开编辑器即丢失。

### 2.2 对外 API 输出链路（后端仓库）

网站前端通过 `GET /api/echohunt/campaigns?lang=...` 获取活动配置。读取链路：

`XHuntWebsiteCampaign.nacosPayload` → `buildPluginCampaign`（`websiteCampaignService.js:800-885`，custom 模式在 `:864` 原样透传 `customLeaderboards`，仅按 `displayChannels` 过滤）→ `summarizeCustomLeaderboards`（`src/xhunt/api/echohunt.js:482-509`）做**白名单序列化**：

```js
// echohunt.js:489-507（节选）
return {
  id, name, short_name,
  emptyText: emptyText || null,
  empty_text: emptyText || null,
  amount: item.amount ?? null,
  participantCount: item.participantCount ?? null,
  distributionType: item.distributionType || null,
  unit: item.unit || null,
  tweetSubmission: tweetSubmission.enabled ? {...} : { enabled: false },
};
```

`summarizeCustomLeaderboards` 被三处复用：活动列表项（`echohunt.js:596`）、活动详情 `leaderboardConfig.customLeaderboards`（`:1064`）、`rewardSummary.custom`（`:550`）。

**新增 `hiddenColumns` 必须在此返回对象里显式添加**，否则前端拿不到。

### 2.3 前端表格渲染（XHunt.website）

`apps/echohunt` 是 Next.js 16 + React 19 + TS + Tailwind 的独立子应用。

- 表格组件：`apps/echohunt/components/leaderboard/LeaderboardTables.tsx`，内含 `DynamicLeaderboardTable`（`:310`）与 `DynamicWinnersTable`（`:421`）。**列不是 JSX 写死的**，组件接收 `columns: { key, sourceKey?, label, type }[]`，表头和单元格都 `columns.map(...)` 渲染（表头 `:374-378`，单元格 `:392-399`），特殊单元格按 `column.key` 分派（`rank` → RankBadge，`hunter` → HunterCell）。
- 列名本地化：`getLocalizedColumnLabel`（`LeaderboardTables.tsx:93-109`），已知 key：`rank / hunter / author / award / post / reward / tweets / views / likes / kolEngages / invites / share`。**注意：mindshare 百分比列的 key 是 `share`，不是 `mindshare`。**
- `columns` 的来源：后端生成榜单 bundle 时写入 `tracks[].columns`（`src/xhunt/services/echohuntLeaderboardService.js:203-216` `buildColumnsFromRows`：固定 `rank` + `hunter`，再按行数据追加 `score / share / tweets / views / likes / reward`）。
- **前端已有的列过滤点**：`apps/echohunt/components/LeaderboardPage.tsx:1131-1148`，`LeaderboardPanel` 内用硬编码 `hiddenColumnKeys` 过滤出 `visibleColumns`，再喂给两个表格组件（`:1226`、`:1228`）：

```tsx
const hiddenColumnKeys = new Set([
  'address','evmAddress','wallet','walletAddress','xhuntRank','xHuntRank',
  'tweets','views','likes','kolEngages','score','invites','ambassador','isAmbassador',
  ...(campaign.dataKey === 'realgo' ? ['score', 'gpt', 'gemini'] : []),
]);
const visibleColumns = selectedTrack?.columns.filter((column) => !hiddenColumnKeys.has(column.key)) || [];
```

**这是接入"按配置隐藏列"最自然的改动点。**

- track ↔ 配置项的匹配已有先例：`getTrackEmptyText`（`apps/echohunt/lib/staticLeaderboardProxy.ts:215-240`），按 `it.id || it.distributionType` 与 `track.id/track.sourceKey` 匹配，新增配置可直接复用此模式。
- 配置在面板中已可访问：`campaign.original.leaderboardConfig.customLeaderboards`（`LeaderboardPanel` 入参链路 `staticLeaderboardProxy.ts:420`）。前端类型 `lib/campaigns.ts:110-128` 有 `[key: string]: unknown` 兜底，新增字段不改类型也能读到。

### 2.4 移动端注意点

移动端不是表格而是卡片（`LeaderboardTables.tsx:333` `sm:hidden`），指标列由同一个 `columns` 数组派生（过滤掉 `rank/hunter/...` 后 `slice(0, 4)`，`:327-329`）。因此在 `visibleColumns` 处统一过滤即可同时影响两端。但**移动端的 Rank 角标和 Hunter 头部是写死渲染的**（`LeaderboardTables.tsx:344-351`），不走 `mobileMetricColumns`——若要求移动端也隐藏 Rank/Hunter，需额外处理这两处。

## 3. 配置契约设计

### 3.1 字段定义

在 `customLeaderboards[i]` 上新增：

| 字段 | 类型 | 含义 | 校验 |
|---|---|---|---|
| `hiddenColumns` | `string[]`，可选 | 该榜单在前端隐藏的列 key 列表 | 元素必须为已知列 key 之一（见下表）；缺省/空数组 = 不隐藏 |

列标识使用 **key**（而非显示名 "Rank"/"Hunter"），与后端 bundle 的 `tracks[].columns[].key` 及前端过滤逻辑保持一致。

可选列 key 清单（与 `getLocalizedColumnLabel` 对齐）：

| key | 前端显示（中/英示例） | 说明 |
|---|---|---|
| `rank` | Rank / 排名 | 桌面表格与移动端卡片角标 |
| `hunter` | Hunter | 桌面表格与移动端卡片头部 |
| `author` | Author / 作者 | winners 表 |
| `award` | Award / 奖励 | winners 表 |
| `post` | Post / 推文 | |
| `reward` | Reward / 奖励 | |
| `tweets` | Tweets / 推文数 | |
| `views` | Views / 浏览量 | |
| `likes` | Likes / 点赞 | |
| `kolEngages` | KOL 互动 | |
| `invites` | Invites / 邀请 | |
| `share` | Mindshare 百分比列 | **注意 key 不是 `mindshare`** |

配置示例（nacos `customLeaderboards` 项）：

```json
{
  "id": "lb_mindshare",
  "name": { "zh": "Mindshare 榜", "en": "Mindshare" },
  "distributionType": "mindshare",
  "unit": "USDT",
  "hiddenColumns": ["rank", "hunter"],
  "tweetSubmission": { "enabled": false }
}
```

### 3.2 是否新增 shared contract

`shared/xhunt/` 下已有 `custom-leaderboard-key-contract.json` 与 `tweet-submission-contract.json` 两个契约（admin-web 以相对路径直接 import，后端服务也引用同一文件）。本次已仿照新增 **`shared/xhunt/leaderboard-column-contract.json`**（可隐藏列 key 清单 + 中英文 label），admin-web 的下拉选项与 `echohunt.js` 的输出过滤均从该文件取数，保证单一数据源。

## 4. 改动落点

### 4.1 后端仓库（luykin-chaineye-service）

| 层 | 文件：行 | 改动 |
|---|---|---|
| 编辑态规范化（白名单） | `admin-web/src/pages/NacosCampaignsPage.tsx:459-470` | **必须**：`hiddenColumns` 加一行（数组规范化，过滤非法 key） |
| 表单 UI | `NacosCampaignsPage.tsx:3700-3760` | **必须**：在自定义榜单编辑器中加多选框（参考 `displayChannels` 的 Select multiple 写法） |
| 前端校验 | `NacosCampaignsPage.tsx:1585-1633` | 建议：元素必须在白名单内、去重 |
| 新增项默认值 | `NacosCampaignsPage.tsx:2024-2037` | 可选：`hiddenColumns: []` |
| 服务端保存 | `websiteCampaignService.js:425-508` | 不用改（nacosPayload 整体透传 JSONB） |
| EchoHunt 输出白名单 | `src/xhunt/api/echohunt.js:489-507` | **必须**：返回对象显式加 `hiddenColumns`（规范化为字符串数组，缺省 `[]`） |
| 插件端输出 | `websiteCampaignService.js:914-939` | 不用改（本就透传） |
| shared contract | `shared/xhunt/` | 可选 |

### 4.2 前端仓库（XHunt.website）

| 层 | 文件：行 | 改动 |
|---|---|---|
| track ↔ 配置匹配 helper | `apps/echohunt/lib/staticLeaderboardProxy.ts`（仿 `:215-240` `getTrackEmptyText`） | 新增 `getTrackHiddenColumns(track, campaign): Set<string>` |
| 列过滤 | `apps/echohunt/components/LeaderboardPage.tsx:1131-1148` | 把配置结果并入 `hiddenColumnKeys` 再过滤 `visibleColumns` |
| 类型补充 | `apps/echohunt/lib/campaigns.ts:110-128` | 可选：补 `hiddenColumns?: string[]`（有 `unknown` 兜底，不改也能跑） |
| 移动端 Rank/Hunter | `apps/echohunt/components/leaderboard/LeaderboardTables.tsx:344-351` | **已确认全端隐藏**：移动端卡片的 Rank 角标/Hunter 头部改为按过滤后的 `columns` 受控渲染 |

### 4.3 备选路线：后端生成 bundle 时直接剔除

`src/xhunt/services/echohuntLeaderboardService.js:203-216` 生成 `tracks[].columns` 时也可按配置剔除列。**不推荐作为主路线**，原因：

1. bundle 有缓存/重建周期，配置调整不能即时生效；
2. `columns` 同时驱动桌面表格与移动端指标列，后端剔除会影响所有消费方（含未来的第三方），而需求语义是"网站前端展示隐藏"；
3. 前端 `LeaderboardPanel` 已有现成的过滤点与 `displayMetrics` 等 nacos 驱动 UI 开关的先例（`CampaignDetailView.tsx:289-298`），前端过滤成本最低。

但需注意：后端剔除路线对"数据不下发"有要求时才需要（当前需求仅是展示隐藏，行数据里本就含这些字段）。

## 5. 边界与注意事项

1. **列 key ≠ 显示名**：配置写 `rank`/`hunter`/`share`，不要写 `Rank`/`Mindshare`。admin 表单用下拉多选可避免运营填错。
2. **`share` 是 mindshare 百分比列的 key**，命名容易误解，文档与表单文案需标注。
3. **移动端语义**：已按"隐藏即全端隐藏"实施——移动端卡片的 Rank 角标、Hunter/Author 头部改为根据过滤后的 `columns` 受控渲染（`LeaderboardTables.tsx`），不再写死。
4. **全部列被隐藏**时表格将只剩空壳，建议校验保留至少 1 个可见列（或前端兜底：全隐藏时回退展示全部，需产品定）。
5. **winners 表**（`DynamicWinnersTable`）与 leaderboard 表共用 `visibleColumns`，配置会同时作用于两类 track；如需分开控制，配置结构要升级为 `{ leaderboard: string[], winners: string[] }`，建议第一版从简。
6. **缓存**：保存配置后 Redis 缓存（`xhunt:campaign-config:plugin-campaigns:v2` 及网站公开缓存）会主动失效（`website-campaigns.js:600`），前端下一次拉取即生效，无需重启服务。
7. **审计**：managed-config 链路不写 `xhunt_nacos_config_snapshots`，审计靠 `logAdminAction`，本次无新增审计需求。

## 6. 实施步骤建议

1. 后端仓库：admin-web 编辑器（规范化 + 表单 + 校验）→ `echohunt.js` 输出白名单加字段。
2. 前端仓库：`getTrackHiddenColumns` helper → `LeaderboardPanel` 过滤合并 → （可选）类型补充与移动端处理。
3. 自验证：在管理后台给某榜单配置 `["rank"]`，发布后直接请求 `GET /api/echohunt/campaigns?lang=zh` 确认 `customLeaderboards[].hiddenColumns` 下发；前端页面确认对应列消失、其他榜单不受影响、移动端表现符合预期。
