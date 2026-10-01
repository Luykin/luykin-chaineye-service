# 外部活动榜单适配器技术方案

> 状态：提案（尚未实施）  
> 日期：2026-09-30  
> 目标：让**超级管理员**在既有管理后台 `/api/xhunt/stats#/nacos-campaigns` 配置未知结构的内部榜单接口，并经受控的 AI 辅助生成转换规则后，向 EchoHunt 网站稳定输出统一榜单；新增活动不应再要求为每个活动发布一段专用后端代码。

## 1. 结论

方案可行，但不应让 AI 在后台生成、保存和在线执行 JavaScript 函数。

应把 AI 的职责限定为：根据管理员提供的、经过服务端拉取和脱敏后的接口样本，生成一份**声明式、受 JSON Schema 约束的映射配置**。后端以固定的解释器执行这份配置，输出既有的 `StaticLeaderboardBundle` 兼容数据结构；前端只消费统一结构和列定义，不接触外部接口，也不执行映射逻辑。

这样可以同时达到：

- 支持未知的外部 JSON 包装层、字段名和时间字段；
- 默认稳定展示“排名 / Hunter / 声量占比”，其中 Hunter 含头像、名称、`@handle`；声量占比可展示币安广场加速标识；
- 必要时由配置增加更多榜单、指标列和请求；
- 转换规则可预览、版本化、审核、回滚和审计；
- 不把 AI 输出变成远程代码执行（RCE）入口，也不继续扩大当前任意 URL 请求带来的 SSRF 风险。

## 2. 现状与问题

### 2.1 已有的前端契约可复用

网站现有 `StaticLeaderboardBundle` 已将“数据”和“呈现”分开：`tracks[].columns` 描述列，`leaderboards[range][sourceKey]` 存放行。行已经支持 `rank`、`username`、`handle`、`twitterId`、`name`、`avatar`、`share`、`shareText`、`score` 和 `booster_bisquare` 等字段。见网站仓库 `apps/echohunt/components/leaderboard/staticLeaderboardProxy.ts:16-123`。

`LeaderboardTables.tsx` 已能依列定义渲染表格；`hunter` 列会显示头像、名字和 handle，`percent` 列会格式化百分比，并在当前的 `booster_bisquare` 为真时显示徽章。见 `apps/echohunt/components/leaderboard/LeaderboardTables.tsx:109-145,254-278,326-400`。该字段是现有展示实现的兼容字段，不能据此推断任意上游的同名字段一定等同于平台的 Binance Square 绑定状态。

YZi Labs 的静态快照也是这个契约的实际例子：其 track 声明 `rank`、`hunter`、`share` 等列，行使用上述标准字段。见 `src/xhunt/static/echohunt-leaderboard/campaigns/yzilabs.json:25-115`。

**因此，第一期不需要重写网站榜单 UI。** 适配器输出当前 bundle 结构即可；默认列固定为 `rank`、`hunter`、`share`。

### 2.2 当前后端只支持“已近似规范化”的接口

当前 `getCustomLeaderboardData` 只配置一个 GET URL；`normalizeLeaderboardPayload` 只理解 `leaderboards`、`data.leaderboards`、`data.data.leaderboards` 这类固定包装层，行对象基本原样透传。见 `src/xhunt/services/campaignLeaderboardService.js:32-102,439-463`。它不能表达“数组位于任意路径”“字段 A 是头像”“字段 B 是声量占比”等未知 API 的映射。

YZi Labs 因此成为硬编码特例：按活动 key 绕过通用 URL，拉取 `mind_share` 作为行数据，额外拉取 `mind_detail` 仅获取数据生成时间；还包含特定指标选择、过滤、重排和按 Twitter ID 查个人排名。见 `src/xhunt/services/campaignLeaderboardService.js:173-229,232-383,444-484`。

管理后台目前只保存榜单 URL、个人活动 URL、假数据开关和 `customLeaderboards` 元数据，无法保存未知 API 的多请求、行路径、字段映射或转换版本。见 `admin-web/src/pages/NacosCampaignsPage.tsx:178-188,3556-3659`。

### 2.3 安全与发布问题

现有 URL 解析接受任意 `http(s)` 地址后直接由 Axios 请求，未实现域名 allowlist、DNS/IP 私网拦截、认证密钥引用或请求配置限制。见 `src/xhunt/services/campaignLeaderboardService.js:32-50,453-463`。新能力必须先收紧这个边界，不能复制该行为。

另一个运行时事实是：EchoHunt 榜单接口优先返回静态快照，只有不存在静态 bundle 时才读取动态 custom 数据。见 `src/xhunt/api/echohunt.js:1574-1606`。适配器发布时必须明确静态快照与动态数据谁优先，否则上线后新规则可能被旧快照遮蔽。

## 3. 目标、非目标和约束

### 3.1 目标

1. 超级管理员可为一个活动中的**每个自定义榜单**独立配置一套可信内部数据请求；一个榜单可有一个主 `board` 请求和多个补充请求，接口均为无认证、一次返回完整榜单的 JSON 接口。
2. 超级管理员可在后台试拉取、查看截断样本，并让 AI 建议映射。
3. 服务端将任意允许的外部 JSON 转为统一榜单 bundle；默认输出一个总榜和三列：排名、Hunter、声量占比。
4. 默认身份匹配使用 `twitterId`；只有显式配置并经人工确认后才允许以 handle 作为退化匹配。
5. 规则必须可校验、预览、审核发布、回滚和追溯。
6. 上游异常、字段漂移或映射失败时，返回最近一次成功的规范化缓存，并产生可观测告警。

### 3.2 非目标

- 不让超级管理员或 AI 上传/执行 JS、SQL、Shell、模板代码或任意 HTTP 请求代码。
- 不让网站前端直接访问内部数据源，或自己解释 JSONPath。
- 第一阶段不试图通过 AI 自动判断业务公平性、奖励资格或作弊规则；AI 只辅助结构映射。
- 不涉及已结束活动的静态化；现有成熟的人工代码方案继续负责该流程。

## 4. 目标架构

```text
管理后台
  ├─ 配置受信任内部接口 / 请求模板（仅超级管理员）
  ├─ 服务端试拉取 → 截断样本、结构摘要
  ├─ AI 生成 MappingSpec（仅 JSON）
  ├─ Schema 校验 + dry-run 预览 + 人工确认
  └─ 发布 MappingVersion
                 │
                 ▼
活动榜单服务（固定解释器）
  请求执行器 → 原始响应 → MappingSpec → CanonicalLeaderboardBundle → 缓存/观测
                 │
                 ▼
EchoHunt /campaigns/:key/leaderboard
                 │
                 ▼
网站通用表格（tracks.columns + 标准 row 字段）
```

### 4.1 管理后台位置与交互草案

不新增侧边栏菜单，也不单独做“数据源管理”页。入口固定在现有 `/api/xhunt/stats#/nacos-campaigns`：选中一个已保存的活动，在“**时间、奖励与门槛**”区块中切换为“自定义”榜单模式后，将现有 `CustomLeaderboards` 区块扩展为下列两部分：

```text
时间、奖励与门槛
└─ 自定义榜单
   ├─ 榜单 A：名称、奖金、人数、展示渠道等元数据
   │  └─ 外部榜单数据适配器 A        [仅超级管理员可编辑]
   │     ├─ 状态：未配置 / 草稿 / 预览通过 / 已发布 v3
   │     └─ ① 接口样本 → ② AI 转换规则 → ③ 转换预览 → ④ 发布
   └─ 榜单 B：名称、奖金、人数、展示渠道等元数据
      └─ 外部榜单数据适配器 B（与 A 完全独立）
```

这比把功能放在顶部全局工具栏更合适：适配器卡片嵌在它所属的 `customLeaderboards[]` 折叠面板中，始终属于明确的 `(campaignKey, leaderboardKey)`，不会把多个榜单的请求或映射混在一起。`leaderboardKey` 优先使用榜单 ID，未填写时回退 `distributionType`；`custom-{index}` 回退 key 依赖榜单数组顺序、reorder 后会漂移，**禁止用于适配器绑定**（服务端返回 422 `EXTERNAL_LEADERBOARD_KEY_UNSTABLE`，提示先填写唯一榜单 ID）。管理后台新建自定义榜单时自动生成 `lb_` 前缀的稳定 id。key 推导规则统一由 `src/xhunt/utils/custom-leaderboard-key.js` 实现，前端 `NacosCampaignsPage.tsx` 保持镜像。每个榜单分别保存草稿、样本、预览、已发布版本和运行时缓存输出。

非超级管理员不显示编辑控件，仅显示“外部榜单适配器：仅超级管理员可配置”的只读状态；服务端对全部适配器 API 仍强制 `super` 校验。

#### 4.1.1 卡片状态与步骤

卡片首行是稳定高度的状态条，避免异步校验结果推挤页面其他操作：

| 状态 | 显示 | 主操作 |
| --- | --- | --- |
| 未配置 | 灰色 `未配置`，说明“当前仍使用旧自定义接口逻辑” | `配置数据转换` |
| 草稿 | 橙色 `草稿未发布`，显示最近编辑时间 | `继续配置` |
| 试拉取成功 | 蓝色 `已取得接口样本`，显示行数和响应时间 | `生成转换规则` |
| 预览通过 | 绿色 `预览通过`，显示映射版本和样本指纹 | `发布转换规则` |
| 已发布 | 绿色 `已发布 vN`，显示上游更新时间、最近刷新状态 | `新建草稿` / `回滚` |
| 异常 | 红色 `上游异常` 或 `结构已变化`，保留最近成功版本 | `重新试拉取` |

卡片内部使用四步的 `Steps` 导航；桌面端横向、窄屏纵向。步骤只在前置条件满足时可进入，按钮有 loading/success/error 的明确反馈，字段校验在失焦时就地显示，而不是等到最后发布才报错。

#### 4.1.2 ① 接口样本

默认只显示一个必填请求 `board`：单个完整内部 URL（query 参数直接写在 URL 中）、10 秒超时和“必需”标记。点击 `试拉取接口` 后，后台请求并显示：HTTP 状态、耗时、响应字节数、推测的数组路径、数组行数，以及截断后的 JSON 树。需要类似 YZi Labs 的更新时间时，可点击 `+ 补充请求` 添加 `detail`；它只可标为非必需。

该阶段不提供 header、Cookie、请求体或分页输入。若活动尚未通过页面现有的“发布”保存、没有稳定 `campaignKey`，整个适配器卡片置为禁用，并提示“请先发布活动基础信息”。

#### 4.1.3 ② AI 转换规则

成功试拉取后才启用 `AI 生成转换规则`。按钮旁有一个可选的“业务补充说明”输入，例如“`score > 0` 才上榜”“share 已是 0~1”。AI 返回后先展示人可读的字段映射清单，而不是一大段 JSON：

```text
榜单数组      $.data.data.data                  发现 231 行
排名          $.rank                            整数
Hunter 名称   $.name → $.username               99.6% 覆盖
Handle        $.username                        自动补 @
头像          $.profile_image_url               98.7% 覆盖
声量占比      $.value.mind_share                ratio (0~1)
推文数        $.tweet_count                     可选，汇总“总推文”
浏览数        $.view_count                      可选，汇总“总浏览”
互动数        $.like_count                      可选，汇总“总互动”
币安加速      平台 Twitter ID 绑定批量补全      12 人
```

超级管理员可点每一项修改允许的路径、类型、默认值、排序或过滤条件；“高级 JSON”仅作为只读/受 Schema 校验的审查抽屉，不提供可执行代码编辑器。修改后规则立即回到“需要预览”状态。

#### 4.1.4 ③ 转换预览（发布前的硬门槛）

点击 `预览转换结果` 后，在当前页面打开宽屏 Drawer（移动端全屏），而不是跳转新页。Drawer 顶部固定显示：

- `通过 / 不可发布` 状态、转换的行数、丢弃行数、映射版本、请求/结构指纹；
- 三个质量指标：Twitter ID 覆盖率、头像覆盖率、share 合法率；
- `重新试拉取`、`返回修改规则` 和 `发布转换规则` 操作。

主体左侧（窄屏置顶）为错误和警告列表，例如“6 行缺 Twitter ID”“2 行 share 超出 0~1”；右侧是与网站一致的真实转换结果表格，固定展示 `排名 / Hunter / 声量占比`。Hunter 单元格真实显示头像、名称和 handle；声量单元格显示百分比与 Binance Square 加速标识。点一行可打开“原始字段 → 规范化字段”的对照抽屉，帮助管理员判断 AI 映射是否正确。

只有所有阻断项为零且管理员在预览 Drawer 勾选“我已确认当前转换结果可用于公开榜单”后，`发布转换规则` 才可点击。发布前服务端再次比较映射版本、请求指纹与 schema fingerprint；任何变化都使预览失效并要求重新试拉取。

#### 4.1.5 ④ 发布和后续修改

`发布转换规则` 与页面顶部的“发布活动”是两个清晰分开的动作：

- 顶部“发布活动”继续保存活动标题、奖励、时间和自定义榜单元数据；
- 卡片内“发布转换规则”发布已预览通过的适配器版本，并将它关联到当前已保存的 `campaignKey`，同时失效榜单缓存。

已发布后，卡片保持只读摘要，主操作改为 `新建草稿`，不会直接修改线上版本。草稿经过一次新的成功预览后才可替换当前版本；`回滚` 只显示历史已发布版本并要求确认。这样避免运营编辑一个 URL 时即时影响公开榜单。

### 4.2 核心原则：配置数据，不配置代码

AI 可以产出如下受限 JSON，不可以产出 `function`、`eval`、JavaScript 字符串或任意表达式：

```json
{
  "version": 1,
  "rowsPath": "$.data.data.data",
  "updatedAt": { "from": "request:detail", "path": "$.data.data.data[0].create_time", "type": "datetime" },
  "defaultTrack": { "id": "mindshare", "title": { "zh": "声量榜", "en": "Mindshare" } },
  "row": {
    "rank": { "path": "$.rank", "type": "integer" },
    "twitterId": { "coalesce": ["$.t_twitter_id", "$.twitter_id"], "type": "string" },
    "username": { "path": "$.username", "type": "handle" },
    "name": { "coalesce": ["$.name", "$.username"], "type": "string" },
    "avatar": { "coalesce": ["$.profile_image_url", "$.avatar"], "type": "httpsUrl" },
    "share": { "path": "$.value.mind_share", "type": "ratio" },
    "booster_bisquare": { "path": "$.value.booster_bisquare", "type": "boolean" }
  },
  "sort": [{ "field": "share", "direction": "desc" }],
  "filter": [{ "field": "share", "operator": "gt", "value": 0 }]
}
```

这里的 `path` 是实现方定义的受限 JSONPath 子集（只允许属性、数组下标和受限通配符），不是可执行脚本。`coalesce`、类型转换、比较、排序和过滤都是白名单操作；未实现的操作应校验失败，而不是“尽量执行”。

### 4.3 规范化输出契约

适配器在后端统一产出如下最小契约，并转换为现有 `StaticLeaderboardBundle`：

```ts
type CanonicalLeaderboardRow = {
  rank: number;
  twitterId: string | null;
  username: string | null;
  handle: string | null;             // 统一带 @
  name: string;
  avatar: string | null;
  share: number | null;               // 0~1 的比例
  shareText: string | null;           // 后端由 share 生成，避免前端猜单位
  // 上游业务指标；仅在活动明确声明其语义时才展示为对应徽章。
  booster_bisquare: boolean | null;
  // “是否币安广场加速”的规范字段；可由上游映射，或由平台 Twitter ID 绑定批量补全。
  binanceSquareAccelerated: boolean;
  metrics: Record<string, string | number | boolean | null>;
  raw: Record<string, unknown>;       // 仅白名单字段；不得原样泄露全部上游响应
};

type CanonicalLeaderboard = {
  campaign: string;
  source: "external-adapter";
  mappingVersion: number;
  updatedAt: string;
  leaderboardDataUpdatedAt: string | null;
  tracks: Array<{ id: string; columns: Column[] }>;
  leaderboards: Record<string, CanonicalLeaderboardRow[]>;
};
```

默认 `columns` 始终为：

```json
[
  { "key": "rank", "label": "Rank", "type": "rank" },
  { "key": "hunter", "label": "Hunter", "type": "user" },
  { "key": "share", "label": "Mindshare", "type": "percent" }
]
```

管理员可在第二期从允许的字段类型（`number`、`percent`、`text`、`duration_days`、`boolean`、`address`）中追加列；不得配置 HTML 或前端组件代码。网站的第一期通用组件应改为读取 `binanceSquareAccelerated` 显示“币安广场加速”标识；可短期兼容 `booster_bisquare`，但必须由活动配置明确其业务含义，不能混作平台绑定状态。

## 5. 数据模型与后台操作流

不要把完整规则继续塞进现有 `leaderboardConfig` 的松散 JSON。第一期新增独立表；请求、映射、样本和预览先作为受 Schema 约束的 JSON 字段随适配器保存，后续需要完整审计历史时再拆表。

| 实体 | 关键字段 | 用途 |
| --- | --- | --- |
| `XhuntExternalLeaderboardAdapter` | `id`, `campaignKey`, `leaderboardKey`, `draftConfig`, `publishedConfig`, `lastSample`, `lastPreview`, `publishedVersion`, `status` | 一个 `(campaignKey, leaderboardKey)` 一条记录；草稿、发布版本和预览状态彼此独立。 |
| 后续拆表（非第一期） | `ExternalLeaderboardRequest`、`ExternalLeaderboardMappingVersion`、`ExternalLeaderboardFetchAudit` | 当需要不可变历史、回滚列表和长期审计时再拆分；当前先用操作审计日志与适配器快照满足发布追溯。 |

后台建议分为以下步骤：

1. **配置入口与权限**：在既有 `/api/xhunt/stats#/nacos-campaigns` 的每个自定义榜单折叠面板中增加一个“外部榜单适配器”区块。前端仅向超级管理员显示；后端保存、试拉取、AI 草稿、预览、发布和回滚接口均必须强制 `super` 角色校验，不能只依赖前端隐藏。接口路径带 `leaderboardKey`，并在服务端验证它确实属于该活动且没有重复。
2. **定义请求**：添加 `board`（必填）及 `detail` 等命名请求。每个请求设定 allowlisted 内部 URL、GET、固定查询参数、允许替换变量、超时和是否必需。第一期不支持分页；试拉取和发布校验都必须确认该响应包含完整榜单。
3. **试拉取**：后端执行请求，展示最大尺寸/深度/数组条数均受限的脱敏 JSON 样本、HTTP 元数据和结构树。
4. **AI 建议映射**：AI 输入仅为样本、请求说明及明确的标准字段要求；输出必须是 `MappingSpec` JSON 和人类可读的字段对应说明。
5. **校验与预览（强制）**：AI 草稿或人工修改后的规则都必须在管理后台对最近一次真实试拉取响应执行 dry-run。页面展示转换后的前 50 行、默认三列、头像/名称/handle、声量百分比、币安广场加速标识、丢弃行原因、字段覆盖率和与当前发布版本的 diff；管理员可展开查看规范化 JSON。若结果不符合预期，可继续编辑规则或让 AI 基于同一脱敏样本重新生成草稿。
6. **发布门槛**：只有最近一次 dry-run 通过 JSON Schema 与语义校验，且超级管理员在预览页显式确认“转换结果可用”后，发布按钮才可用。发布时必须校验预览所用的 `mappingVersion`、请求指纹和响应 schema fingerprint 未变化；任一项变化就要求重新试拉取和预览。发布成功后才将版本设为 `published` 并立即失效相关缓存。
7. **监控与回滚**：任一映射版本可一键回滚。上线后若连续结构指纹变化或必填字段覆盖率低于阈值，停止刷新、使用最近成功缓存并告警。

## 6. AI 辅助的输入、输出与护栏

### 6.1 可交给 AI 的内容

- 每个命名请求的 method、非敏感参数说明和脱敏/截断响应样本；
- 管理员声明的业务语义，例如“`mind_share` 是 0~1 比例”“分数大于 0 才可上榜”；
- 目标标准字段、默认列和允许的 DSL 操作说明；
- 需要时给出当前已发布映射，要求 AI 生成最小 diff。

### 6.2 不可交给 AI 的内容

- `Authorization`、Cookie、API key、用户 token 或超出榜单转换所需的个人数据；
- 任意生产配置的写权限；
- 直接发布权限。AI 只能返回“候选草稿”。

### 6.3 必须由程序而非 AI 保证的规则

- `rowsPath` 在样本中命中数组；
- 每行至少存在可用 `twitterId` 或管理员显式批准的替代身份键；默认发布要求 Twitter ID 覆盖率达到设定阈值（建议 95%）；
- `rank` 可安全转换为正整数，或在声明排序规则后由后端重新编号；
- `share` 为有限数且强制是 `0~1` ratio；拒绝 `0~100` percent，禁止自动猜测或换算；
- `binanceSquareAccelerated` 必须来自经确认的上游布尔字段，或由平台以规范化的 `twitterId` 批量查询有效 Binance Square 绑定后补全；
- `avatar` 必须是允许的 `https` URL 或空值；
- 映射输出不存在未声明字段、函数、原型路径、递归深度超限或结果行数超限；
- 发布版本必须有成功且未过期的真实响应 dry-run 记录；没有预览记录、预览失败或响应结构已变化时，后端拒绝发布；
- 完整保留操作审计记录；所有操作人均必须是超级管理员。

## 7. 请求安全、可靠性与可观测性

### 7.1 出站请求安全

- 仅超级管理员可填写 URL，但 URL 必须命中服务端的内部域名 allowlist；默认包含 `DATA_SERVICE_BASE_URL` 的 host 与公网 `PUBLIC_DATA_SERVICE_BASE_URL`（默认 `https://data.cryptohunt.ai`）的 host，其他内部 host 通过 `EXTERNAL_LEADERBOARD_ALLOWED_HOSTS`（逗号分隔）显式配置。填写公网数据服务域名时服务端自动改写为内网 `DATA_SERVICE_BASE_URL`，避免生产环境从内网回源公网域名失败。禁止相对 URL 和任意公网 URL。
- 内部域名可能正常解析到私网 IP，因此以显式 host allowlist 为信任边界；禁止 URL 内嵌用户名/密码，并拒绝所有重定向。
- 第一阶段仅支持无认证 GET、固定 query 参数和 JSON 响应；禁止自定义 header、Cookie、请求体和重定向认证。
- 设置连接/响应超时、最大响应字节数、最大解压大小、最大 JSON 深度和最大数组行数；按 source 做并发及速率限制。

### 7.2 缓存与失败策略

以 `campaignKey + leaderboardKey + publishedMappingVersion + 请求参数` 为缓存键；建议默认 TTL 5 分钟，与 YZi Labs 的现有策略一致，但可在受限范围内配置。运行时可将同一活动多个榜单的结果聚合成一个 bundle，但任一榜单的请求、映射版本和失败处理仍独立。主 `board` 请求失败时使用最近成功的规范化缓存，并明确标记 `stale: true` 给日志/指标（对外 bundle 不暴露内部错误）。非必需 `detail` 请求失败不阻断榜单，但 `leaderboardDataUpdatedAt` 为 `null`，`updatedAt` 应表示本服务成功获得主数据的时间。

### 7.3 指标和日志

至少记录并告警：`campaignKey`、`leaderboardKey`、adapter/version、request key、source host、HTTP 状态、耗时、缓存命中/陈旧命中、解析行数、丢弃行数、字段覆盖率、schema fingerprint、上游更新时间和 error code。日志不得记录完整原始响应。

## 8. 与现有系统的集成和迁移

### 8.1 服务端

新增独立模块，避免继续膨胀 `campaignLeaderboardService.js`：

```text
src/xhunt/services/external-leaderboard/
  requestExecutor.js       # 内部域名 allowlist、SSRF 防护、限额
  mappingSchema.js         # JSON Schema 与语义校验
  mappingInterpreter.js    # 受限 JSONPath/转换/排序/重排
  adapterService.js        # fetch、cache、stale fallback、版本选择
  previewService.js        # 管理后台试拉取与 dry-run
```

`getCustomLeaderboardData` 与 `getCustomUserActivityData` 先检查活动是否绑定已发布适配器；是则委托 `adapterService`，否则维持当前 legacy URL 行为。`buildCustomLeaderboardBundle` 仍接收既有统一输出，从而降低接口和前端变更面。

个人排名默认在已规范化的完整榜单中用 `twitterId` 查找，不配置 user-activity API；这是“上游一次返回完整数据”的直接收益。

### 8.2 EchoHunt 前端

第一期沿用现有 `StaticLeaderboardBundle`、track 和 columns。需要做的前端改动应很小：确认类型接受服务端下发的动态 bundle，并让现有加速徽章优先读取 `binanceSquareAccelerated`；若新增 `metrics` 列，则由后端在行顶层投影受批准的列 key，保持当前 `formatCellValue` 工作方式。

已结束活动的静态化和静态优先级不属于本方案；继续使用现有成熟的人工代码流程。适配器只服务进行中的动态活动，且后台应明确提示：静态快照存在时 EchoHunt 当前会优先返回静态数据。

### 8.3 YZi Labs 迁移样例

将当前硬编码的两个请求变为：

| request key | 角色 | 必需 | 作用 |
| --- | --- | --- | --- |
| `board` | `mind_share` | 是 | `rowsPath` 提取榜单行。 |
| `detail` | `mind_detail` | 否 | `updatedAt` 路径提取上游数据时间。 |

将现有的字段选择、`score > 0` 过滤、按 `share desc` 排序/重新编号、Twitter ID 匹配和 `booster_bisquare` 映射写进 MappingSpec。用现有 YZi Labs 响应快照做契约测试，和当前输出逐行比对后，再删除活动 key 特例。

## 9. 分期实施计划

| 阶段 | 交付 | 验收标准 |
| --- | --- | --- |
| P0：契约固化 | Canonical schema、JSON Schema、样本 fixture、现有 bundle 兼容测试 | 默认三列和 Binance 徽章不变；非法规则不能执行。 |
| P1：安全执行器 | 内部域名 allowlist、请求执行器、缓存、SSRF/响应大小保护、单请求映射 | 一个一次返回完整数据的未知结构 GET 榜单可经人工 JSON 配置上线。 |
| P2：后台预览 | 在 Nacos Campaigns 页增加请求配置、样本查看、规则编辑、dry-run、发布/回滚与审计 | 超级管理员无需改代码可完成配置，但必须人工发布。 |
| P3：AI 草稿 | 受限 prompt、结构摘要、JSON-only 输出、自动校验和 diff | AI 只产生可验证草稿，失败时可人工编辑。 |
| P4：复杂活动迁移 | 多请求、字段质量告警、YZi Labs 迁移、旧 URL 兼容期 | 删除 YZi Labs 专用分支，输出与基线一致。 |

## 10. 测试与上线门槛

- 为解释器建立 fixture 测试：嵌套数组、缺字段、类型错误、0/1 与 0/100 百分比、排序并列、布尔加速标识、恶意 path。
- 为请求执行器建立安全测试：非 allowlisted 域名、DNS 重绑定、私网 IP、重定向、超大响应、超时，以及拒绝 header/body/分页配置。
- 为每个发布版本保存一个脱敏 fixture，并在发布时执行转换快照测试；YZi Labs 必须与现网旧转换结果对比。
- 端到端验证动态 bundle 在网站桌面/移动端均显示默认三列、头像/名字/handle 和 Binance Square 加速标识；验证上游同名业务字段不会被误标为平台绑定状态。
- 灰度发布：先仅管理员预览，再内部活动，最后单个公开活动；仪表盘连续观察缓存陈旧率、解析失败率和字段覆盖率。

## 11. 已确认的产品决策

1. 操作入口固定在 `/api/xhunt/stats#/nacos-campaigns`，且配置、试拉取、AI 草稿、预览、发布、回滚均仅限超级管理员。
2. 数据源均为项目内部、可直接访问的无认证接口；本方案不处理凭据、OAuth 或 Secret Manager。
3. 上游接口一次返回完整榜单；本方案第一期不支持分页。
4. `share` 强制使用 `0~1` 的 ratio 单位；服务端负责生成百分比文本，禁止猜测或接受 `0~100`。
5. 活动结束后的静态化由既有成熟的人工代码方案负责，不在本方案范围内。

## 12. 参考实现依据

- 现有自定义榜单服务和 YZi Labs 特例：`src/xhunt/services/campaignLeaderboardService.js:32-102,173-229,232-383,439-503`。
- EchoHunt 动态榜单接口与静态优先级：`src/xhunt/api/echohunt.js:1574-1606`。
- 现有管理后台自定义榜单表单：`admin-web/src/pages/NacosCampaignsPage.tsx:178-188,3556-3659`。
- 后端静态示例：`src/xhunt/static/echohunt-leaderboard/campaigns/yzilabs.json:1-115`。
- 网站通用类型和渲染器（位于用户指定的网站仓库）：`apps/echohunt/components/leaderboard/staticLeaderboardProxy.ts:16-123`、`apps/echohunt/components/leaderboard/LeaderboardTables.tsx:109-145,254-400`。
