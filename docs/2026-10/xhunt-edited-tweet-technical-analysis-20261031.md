# XHunt “改贴”功能技术分析

> 2026-11-02 权限规则更新：取消 VIP 详情的 24 小时限制。VIP 与内部用户均可查看上游当前数据窗口内的全部编辑链；普通用户和匿名用户仍可查看全部数量，但详情固定为空。为兼容已发布插件，服务端暂时保留历史 `vip_24h` scope 名，`detail_window_seconds: null` 表示不再限制详情时间窗口。下文关于 VIP 24 小时裁剪的内容仅保留为原始方案记录，不再代表当前实现。

> 日期：2026-10-31  
> 状态：核心方案已实施，**尚未部署**  
> 后端仓库：`luykin-chaineye-service`（本仓库）  
> 插件仓库：`/Users/luykin/Documents/mac-work-new/tweet-hunt-extension`（只读分析）  
> 上游接口文档：`/Users/luykin/Downloads/tweet-edit-api-20261031.md`

## 1. 结论摘要

本需求建议拆成两条请求链：

1. 进入 Twitter 用户主页时只请求 XHunt 的 `/api/xhunt/twitter/edited-counts`，显示该账号最近 30 天内有多少篇“发生过编辑的逻辑帖子”。
2. 用户打开“改贴”悬浮面板时，再按权限懒加载 `/api/xhunt/twitter/edited` 详情；非 VIP 不请求详情，VIP 只获得最近 24 小时内的编辑链，内部用户获得上游当前可提供的全部编辑链。

必须先澄清一个产品文案问题：上游 `counts` 统计的是**编辑链/逻辑帖子篇数**，同一篇帖子无论改 1 次还是 5 次都只计 1 篇，并不是编辑动作次数（上游文档第 1 节及总则，`tweet-edit-api-20261031.md:3,27`）。因此第一版应展示“近 30 天改贴 N 篇”，不要展示“修改 N 次”。只有详情返回后，才能按版本数计算单篇帖子的修改次数 `version_ids.length - 1`（上游文档第 2 节，`:50-55,62-78`）。

权限必须由后端裁剪保证，前端只能决定展示形态。现有 `ProRequired` 当前直接返回子组件，并没有真正执行 Pro 校验（插件 `src/compontents/ProRequired.tsx:19-32`），不能作为数据权限边界。

推荐的 24 小时口径是：**按编辑链的 `first_created_at` 判断，首次发布时间距服务端当前时间不超过 24 小时的链对 VIP 可见**。这是上游明确使用的查询和排序口径；`last_edited_at` 被文档限定为仅供展示（上游文档 `:87-95`）。内部用户不做 24 小时裁剪，非 VIP 详情返回空 `items`。但“内部一直可见”目前最多只能解释为“在上游可查询的最近 30 天窗口内一直可见”，因为上游只返回首次发布时间在最近 30 天内的编辑帖（上游文档总则，`:3`）。

## 2. 需求拆解与范围

### 2.1 明确需求

- 在用户主页增加“改贴”入口。
- 权限与现有删帖功能一致：内部用户、VIP、非 VIP 三档。
- VIP 可查看 24 小时内的详细修改记录。
- 内部用户不受 24 小时限制。
- 非 VIP 只能看到改贴数量，不能收到新旧正文、版本 ID、时间等详情。
- 每次修改展示“旧版本 → 新版本”的文本差异。
- 一条编辑链存在 A→B→C 时，展示两段相邻 diff：A→B、B→C。
- 前端展示要紧凑，适合现有用户名右侧的窄悬浮面板。

### 2.2 第一版建议范围

- 只比较推文正文 `tweet.text`。
- 图片、视频、引用推文、投票等结构化字段暂不做字段级 diff。
- `pending` 版本只显示“历史版本补采中”，不生成猜测性 diff。
- 新增两个 XHunt 专用业务接口，由服务端调用固定的上游改贴接口；不经过 `/api/xhunt/proxy` 通用代理。
- 复用现有 VIP/内部名单、设置同步和功能灰度体系；不新增数据库表和迁移。
- 不改变上游数据服务的 30 天保留/查询窗口。

### 2.3 不在本次后端仓库内直接实现的部分

本仓库包含 XHunt 后端、管理后台和认证客户端，但不包含浏览器插件源码；项目模块清单只列出 `src/xhunt/`、`admin-web/` 和 `packages/xhunt-auth-client/` 等（本仓库 `AGENTS.md:7-19`）。插件实际位于独立仓库 `tweet-hunt-extension`，所以插件文件清单是跨仓实施建议，不能在本仓库的单次改动中完成。

## 3. 上游接口契约

### 3.1 `GET /tweet/edited_counts`

请求参数：

| 参数 | 约束 |
|---|---|
| `user_ids` | 必填；多个 Twitter ID 用逗号分隔；最多 100 个 |

以上约束来自上游文档第 1 节（`:5-11`）。成功响应的 `data.counts` 是“账号 ID → 编辑帖篇数”，无记录账号显式返回 `0`；`window_start`、`window_end` 是实际查询窗口的 Unix 秒（`:15-27`）。

示意响应：

```json
{
  "code": 200,
  "message": "get data success",
  "data": {
    "counts": { "2985599460": 2 },
    "window_start": 1790815200,
    "window_end": 1793407200
  }
}
```

### 3.2 `GET /tweet/edited`

请求参数：

| 参数 | 约束 |
|---|---|
| `user_id` | 必填，单个 Twitter ID |
| `limit` | 默认 20，范围 1～50，按逻辑帖子分页 |
| `offset` | 默认 0，非负整数；历史版本不单独占分页篇数 |

参数定义见上游文档第 2 节（`:29-39`）。

每个 `items[]` 元素是一条编辑链：

| 字段 | 含义 | 前端用途 |
|---|---|---|
| `edit.root_id` | 最早版本 ID | React key / 链标识 |
| `edit.latest_id` | 最新版本 ID | 校验最新版本 |
| `edit.version_ids` | 版本 ID 列表 | 构造相邻 diff 链 |
| `edit.first_created_at` | 首次发布时间，Unix 秒 | 30 天查询、排序及推荐的 VIP 24h 裁剪口径 |
| `edit.last_edited_at` | 最后编辑时间，Unix 秒 | 仅展示；上游明确说明不作为查询时间口径 |
| `latest` | 最新版完整推文，可能为 `null` | 卡片主摘要 |
| `history_complete` | 所有版本是否已入库 | 是否显示“不完整”提示 |
| `versions` | 版本状态及完整推文对象 | diff 数据源 |

字段定义和示例见上游文档第 2 节（`:43-100`）。`available` 表示版本已入库；`pending` 时 `tweet=null`（`:100`）。

### 3.3 分页一致性

- `items` 按首次发布时间倒序（上游文档 `:87`）。
- 下一页保持 `user_id` 和 `limit`，执行 `offset += limit`（`:102-112`）。
- `items.length < limit` 表示末页；满页仍需继续请求确认（`:113`）。
- 每次请求重新计算最近 30 天窗口，不提供固定分页快照；新增记录和补采可能改变列表位置（`:114-115`）。

因此前端翻页应按 `edit.root_id` 去重，不能假定 `offset` 分页期间数据绝对稳定。

### 3.4 错误契约

- 参数业务校验失败或查询失败时，响应体 `code` 可能为 400/500，客户端不能只检查 HTTP 状态（上游文档 `:117-119`）。
- 查询参数解析失败时，上游可能直接返回 HTTP 400 文本，不带统一 JSON 外层（`:120`）。
- 上游文档没有定义鉴权、VIP、内部用户、24 小时或缓存策略；这些必须由 XHunt 专用业务接口补齐，不能声称来自上游契约。

## 4. 现有后端能力

### 4.1 专用业务接口与上游映射

本功能不使用 `/api/xhunt/proxy/public/*`。后端新增两个固定用途的 XHunt 接口：

```text
GET /api/xhunt/twitter/edited-counts?user_ids=...
GET /api/xhunt/twitter/edited?user_id=...&limit=20&offset=0
```

服务端分别调用固定的上游路径：

```text
/tweet/edited_counts
/tweet/edited
```

采用 `/api/xhunt/twitter` 命名空间与现有专用接口 `/api/xhunt/twitter/rename-info` 一致；该接口也是为了避免开放通用外部 URL 代理而单独挂载（`src/apiServer/routes/xhunt.js:127-136`、`src/xhunt/api/twitter-rename.js:8-10`）。新增接口只允许访问代码中写死的两个上游路径，基地址复用 `DATA_SERVICE_BASE_URL`，不接受 `target`、任意 URL 或任意路径参数。这样可以把参数校验、身份识别、权限裁剪、超时和错误映射收敛为稳定的 XHunt 业务契约。

### 4.2 现有删帖权限

删帖有专用路由，顺序位于通用 `/public/*` 之前，并使用可选 token 认证、安全中间件和 AI 内容限流（`src/xhunt/api/proxy.js:635-645,680-688`）。

删帖过滤当前规则是：

- 内部用户直接返回上游数据，不受时间和内容限制（`src/xhunt/utils/pro-data-filtering.js:50-58`）。
- 其他用户先按服务端当前时间筛选最近 24 小时，时间字段为 `create_time`（`:72-80`）。
- VIP 返回最近 24 小时完整正文（`:82-85`）。
- 非 VIP 保留最近 24 小时条目结构和数量，但正文及敏感值被遮挡（`:87-92`）。
- 该规则不依赖插件版本、付费 Pro 或 Legacy Pro（`:112-123`）。

“改贴权限和删帖一致”应复用的是 `isRequestInternalTestUser` 和 `isRequestXHuntVip` 两个名单判定，而不是 `req.isPro`、付费订阅或已过期的 Legacy Pro 分支。

### 4.3 VIP / 内部身份来源

VIP 和内部名单分别加载到内存 Set；记录可以按 username 或 Twitter ID 匹配（`src/xhunt/constants/xhuntVip.js:13-16,24-47,136-149`）。请求身份依次兼容：

- 旧插件登录态 `req.user.twitterId`；
- AuthCenter 主 Twitter ID / identity；
- `x-tw-id`；
- 旧版 `x-user-id` username。

具体取值见 `src/xhunt/constants/xhuntVip.js:151-187`。无 token 时 `authenticateTokenOptional` 会直接放行（`src/xhunt/middleware/auth.js:123-139`），此时未命中名单的访问者自然按非 VIP 处理。

### 4.4 现有缓存与失败模式

现有通用代理的 GET 默认会下发 3 分钟公共缓存，而且未知路径的数据过滤逻辑会原样返回；因此它不适合作为改贴详情的直接入口（`src/xhunt/api/proxy.js:216-249,292-321`，`src/xhunt/utils/pro-data-filtering.js:243-244`）。两个专用业务接口应自行设置 `no-cache, no-store, must-revalidate`，并在权限处理、上游响应解析或结构校验失败时 fail-closed，绝不返回未裁剪的详情。

### 4.5 用户设置与管理后台 Feature Flags

服务端用户设置已有 `sidebars.showDelInfo: true`，但没有 `showEditInfo`（`src/xhunt/api/user-settings.js:44-60`）。默认配置会与数据库已有 JSON 深合并，因此新增默认键可自动补给老用户；读取、合并保存和按类别重置分别见 `:143-170`、`:228-290`、`:322-378`。

管理后台功能键中文映射已有 `showDelInfo: 显示删帖`，没有改贴键（`admin-web/src/pages/FeatureFlagsPage.tsx:31-68`）。页面会把 `show*`/`enable*` 键加入灰度选择项，并管理 `flexibleTesting`、测试组和金丝雀（`:171-235`）。配置实际读写 Nacos `xhunt_config / DEFAULT_GROUP`，且只有 `feature_flags_config` 权限可发布（`src/xhunt/api/stats.js:2740-2845`）。

用户个人开关与 Nacos 灰度是两层不同职责：前者决定用户是否主动显示，后者决定功能是否对该用户开放；两层都不能替代后端数据权限。

## 5. 推荐的 XHunt 业务接口契约

### 5.1 Counts 响应

`GET /api/xhunt/twitter/edited-counts` 保留上游 `code/message/data`，同时注入 XHunt 自有访问元数据：

```jsonc
{
  "code": 200,
  "message": "get data success",
  "data": {
    "counts": { "2985599460": 2 },
    "window_start": 1790815200,
    "window_end": 1793407200,
    "xhunt_access": {
      "detail_scope": "count_only", // internal_source_window | vip_24h | count_only
      "detail_window_seconds": 0,
      "count_semantics": "edited_threads"
    }
  }
}
```

推荐注入元数据的原因：前端只需预取一次 counts，就能判断悬浮面板是否应该懒加载详情；非 VIP 无需发起必然被裁空的详情请求。`detail_scope` 只描述访问能力，不包含敏感数据。

三种 scope：

| 身份 | `detail_scope` | `detail_window_seconds` |
|---|---|---:|
| 内部用户 | `internal_source_window` | `null` |
| VIP | `vip_24h` | `86400` |
| 非 VIP / 匿名 | `count_only` | `0` |

### 5.2 Details 响应

`GET /api/xhunt/twitter/edited` 保持上游结构，业务接口只裁剪 `data.items` 并附加同样的 `xhunt_access`：

| 身份 | `data.items` |
|---|---|
| 内部用户 | 上游当前返回的全部 items |
| VIP | 只保留 `first_created_at` 落在服务端最近 24h 的 items |
| 非 VIP / 匿名 | `[]` |

非 VIP 详情响应不能保留 `edit.root_id`、`version_ids`、时间、`latest` 或 masked tweet 对象；需求是“只看数量”，空 `items` 比逐字段遮挡更不易泄漏。

### 5.3 业务成功判定

前端 API 层建议统一判定：

```text
HTTP 非 2xx                  → 请求错误
HTTP 2xx 且 body.code != 200 → 上游业务错误
HTTP 2xx 且 body.code == 200 → 成功
```

这覆盖上游“HTTP 成功但业务 code 失败”的契约。专用接口应把上游 HTTP 400 文本、无效 JSON、超时和网络失败统一转换为 JSON 错误响应，插件仍需接受无 `data` 的错误形态。建议本地参数校验失败返回 HTTP 400，上游不可用或响应无法解析返回 502，调用超时返回 504。

## 6. 后端实现方案

### 6.1 路由

实现新增 `src/xhunt/api/edited-tweets.js`，并通过 `src/xhunt/api/twitter.js` 聚合现有改名与改贴路由，再由 `src/apiServer/routes/xhunt.js` 统一挂载到 `/api/xhunt/twitter`。该前缀继续使用现有 XHunt 外层中间件：

```text
fingerprintLimiter → browserOnlyMiddleware → securityMiddleware → edited-tweets router
```

router 内两个 GET 接口再执行：

```text
authenticateTokenOptional → aiContentRateLimit → 参数校验 → handler
```

两个接口都使用可选认证：counts 本身对所有用户开放，但需要根据身份返回 `xhunt_access.detail_scope`；details 则必须在服务端识别内部/VIP/普通用户并裁剪。匿名请求可正常获取 counts，details 只返回空 `items`。

### 6.2 权限过滤模块

实现新增 `src/xhunt/services/edited-tweet-service.js` 与 `src/xhunt/utils/edited-tweet-access.js`：

- service 只负责调用固定上游路径、白名单化查询参数、超时、JSON 解析和上游错误归一化；不接受调用方传入任意目标地址。
- access 模块公开类似 `applyEditedTweetAccess(req, data, { endpoint, nowSeconds })` 的小接口，内部封装身份分级、访问元数据、24h 裁剪、异常结构校验和 counts/details 差异。

路由 handler 依次调用 service 和 access 模块，不接入 `proxyRequest` 或 `applyProDataFiltering`。这样既复用删帖的 VIP/内部名单语义，又让改贴权限不受通用代理中的插件版本、`req.isPro`、付费 Pro 和 Legacy Pro 分支影响。

这个 seam 同时作为测试面：单元测试只需要构造请求身份、上游响应和固定时间，无需启动路由或理解其他代理路径。

伪代码：

```text
if response is not object:
    return response

attachAccessMetadata(response, role)

if endpoint is edited_counts:
    return response

if items is not an array:
    fail closed

if internal:
    return response

if not VIP:
    response.data.items = []
    return response

cutoff = floor(Date.now() / 1000) - 86400
response.data.items = items.filter(item =>
    first_created_at is finite
    and first_created_at >= cutoff
    and first_created_at <= now
)
return response
```

无效或缺失 `first_created_at` 的条目必须裁掉，不能因解析失败透传。权限过滤异常时，details 路由应像删帖一样返回 500，不得继续返回未裁剪上游正文。

### 6.3 24 小时边界

与现有删帖实现一致，建议：

- 使用服务端 `Date.now()`，不信任客户端时间。
- 边界使用 `timestamp >= cutoff && timestamp <= now`。
- 上游时间是 Unix 秒，转换时不要误当毫秒（上游文档总则 `:3`）。
- 按 `first_created_at` 裁切与上游的倒序排序一致：一旦某页进入 24h 以前，后续页不会再次出现符合条件的帖子。
- 若要容忍上游时钟漂移，可以单独确认后加入极小未来容差；未确认前按 fail-closed 处理未来时间。

若产品明确要求“最后一次编辑发生后 24 小时”，则应由上游增加同口径的查询/排序能力或 `has_more` 游标。当前列表按 `first_created_at` 排序，XHunt 业务接口再按 `last_edited_at` 过滤会产生稀疏页；前端用 `items.length < limit` 判断末页时可能提前停止，无法保证找到后续首次发布较早、但最近又被编辑的链。

### 6.4 缓存

两个专用接口都必须由 handler 直接设置 no-store：

- details 响应随内部/VIP/普通身份变化，绝不能被共享缓存复用。
- counts 若注入 `xhunt_access` 也变成身份相关响应。
- VIP 24h 边界和上游补采会动态变化。
- 上游明确不保证分页快照（上游文档 `:114`）。

响应应为：

```http
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

建议在新 router 内提取一个很小的 `setNoStoreHeaders(res)` helper，或把现有 helper 移入可复用的 HTTP 工具模块；不要为了复用私有函数而让新接口经过通用代理。

### 6.5 参数与安全

- counts 最多接受 100 个 ID；插件主页场景只传当前一个 ID（上游文档 `:11`）。
- details 的 `limit` 必须在 1～50，`offset` 必须是非负整数（`:35-39`）；专用接口应在调用上游前明确返回 400，不能静默改写调用方参数。
- 插件构造 URL 时应使用 `URLSearchParams`，避免直接拼接未编码值。
- 后端仍应保留现有 `securityMiddleware`、指纹限流、浏览器来源校验和 `aiContentRateLimit`。
- 日志只记录路径、状态码、耗时、request id、身份 scope 和裁剪条数；不要打印完整推文正文或 token。

## 7. 插件前端现状

### 7.1 删帖数据当前是整包预取

插件的 `fetchDelTwitterInfo` 在 API 层调用 `/fetch/tweet/deleted`，直接返回 `ret?.data?.data`（插件 `src/contents/services/api.ts:402-414`）。`useMainData` 在主页 DOM 就绪后创建删帖请求，并与其他主页数据一起执行 `fetchDelData()`（插件 `src/contents/hooks/useMainData.ts:62-84,170-194`）。

删帖数量来自已经拉回的完整数组长度；用户名右侧显示 `deletedTweets.length`，悬浮内容渲染 `DeletedTweetsSection`（插件 `src/compontents/area/NameRightData.tsx:877-896`）。这套“先拉详情再算数量”的模式不适合改贴，因为普通用户不应收到详情，而且编辑链包含多个完整推文版本，负载更大。

### 7.2 当前权限组件不能承担鉴权

删帖 hover 被 `ProRequired` 包裹（插件 `NameRightData.tsx:885-892`），但组件第 31～32 行直接放行；原 Pro 判断全部注释（插件 `src/compontents/ProRequired.tsx:19-32,46-141`）。因此改贴必须以 counts 返回的 `xhunt_access` 控制 UI，并以服务端 details 裁剪作为最终安全边界。

### 7.3 设置与灰度

插件设置页的 `nameRight` 分组已有 `showDelInfo`；统一键列表和基础功能列表也包含该键（插件 `src/utils/settingsManager.ts:7-60,62-180`）。`useCrossPageSettings().isEnabled` 的优先级是 flexibleTesting → testConfig → canaryConfig → 本地开关（`:483-542`）。

云设置上传会显式收集 sidebarKeys，当前包括 `showDelInfo`；下载则遍历服务端 sidebars 的布尔字段写回本地（插件 `src/contents/services/userSettings.ts:102-126,203-214`）。新增 `showEditInfo` 时，至少要同步更新设置配置、统一键列表、基础键策略、云上传白名单和中英文文案。

灰度初期建议把 `showEditInfo` 加入设置配置和统一键列表，但暂不加入 `BASE_SETTING_KEYS`：先由 Nacos `testConfig` / `flexibleTesting` 明确放行，远程配置未加载时默认隐藏。全量稳定后再决定是否升为基础功能，避免网络或配置异常时新功能意外对所有用户开放。

## 8. 插件前端推荐方案

### 8.1 数据流：counts 预取、details 懒加载

主页加载：

```text
twitterId ready
  → fetchEditedTweetCounts([twitterId])
  → editedThreadCount + detailScope
  → count > 0 且 showEditInfo 开启时展示“改贴 (N)”
```

打开 hover：

```text
count_only
  → 不请求 details，直接显示 VIP 提示

vip_24h / internal_source_window
  → HoverStatItem.onHover 调用 hook 请求首屏 details
  → 展示列表、相邻 diff、分页
```

`HoverStatItem` 只在面板实际打开时把 `hoverContent` portal 渲染出来（插件 `src/compontents/HoverStatItem.tsx:146-180,703-744`），并提供异步 `onHover` 回调。改贴入口可在 `onHover` 中触发首屏详情加载，无需在全局 `useMainData` 中预取完整详情。

更推荐增加 `useEditedTweets(twitterId, enabled)` hook，把 counts 预取、访问 scope、详情缓存、翻页去重和重试收敛在一个接口中。`NameRightData` 已能从 `usePlacementTracking()` 获得 `twitterId`（插件 `src/compontents/area/NameRightData.tsx:499-503`），无需再扩展全局 `MainData` 和多层 props。详情加载可直接接到 `HoverStatItem.onHover`；该组件已有一次悬浮触发的异步回调接口（插件 `src/compontents/HoverStatItem.tsx:11-20,512-526`），hook 再按 `twitterId` 缓存首屏结果，避免重复悬浮请求。

### 8.2 类型建议

在插件 `src/types/index.ts` 增加独立类型，不复用 `DeletedTweet`。现有 `DeletedTweet` 是单条推文结构（插件 `src/types/index.ts:7-37`），无法表达编辑链和 pending 状态。

建议类型：

```ts
type EditedVersionStatus = 'available' | 'pending';

interface EditedTweetVersion {
  id: string;
  is_latest: boolean;
  status: EditedVersionStatus;
  tweet: DeletedTweet | null;
}

interface EditedTweetChain {
  edit: {
    root_id: string;
    latest_id: string;
    version_ids: string[];
    first_created_at: number;
    last_edited_at: number;
  };
  latest: DeletedTweet | null;
  history_complete: boolean;
  versions: EditedTweetVersion[];
}
```

### 8.3 紧凑 UI

用户名右侧入口建议：

```text
改贴 (2)
```

这里的 2 必须解释为“近 30 天内有 2 篇帖子发生过编辑”，不是“总共编辑 2 次”。建议 tooltip 或面板标题直接写“近 30 天改贴 2 篇”。

详情卡片默认态：

```text
最新正文摘要（最多 2 行）
修改 2 次 · 最后修改 3 小时前        [展开]
```

展开态：

```text
第 1 次  A → B
原句中删除的文字  新增的文字

第 2 次  B → C
原句中删除的文字  新增的文字
```

视觉建议：

- 使用单列 inline diff，不用左右并排；现有 hover 面板最大宽度约 400px（插件 `HoverStatItem.tsx:703-737`）。
- 删除片段：浅红背景 + 删除线。
- 新增片段：浅绿背景。
- 未变化长文本只保留变更点前后少量上下文，中间用省略号折叠。
- 卡片默认只展示最新版摘要和修改次数；用户主动展开后才渲染全部 diff。
- `history_complete=false` 时显示“历史版本仍在补采，差异可能不完整”。
- 任一相邻版本为 `pending` 时，该段显示“历史版本补采中”，不显示空白 diff。
- 所有用户可见文案必须同时写入 `src/locales/zh.json` 和 `en.json`；插件规范要求所有文案通过 `useI18n`（插件 `AGENTS.md`“硬性约定”第 4 条）。现有删帖相关键位于 `zh.json:24-32,554-555` 和 `en.json:24-32,543-544`。

交互和无障碍要求：

- 不能只依赖鼠标 hover。现有 `HoverStatItem` 主要绑定鼠标事件，新入口应同时支持点击和键盘 focus/Enter/Space，并提供 `aria-expanded`、可见焦点和明确的展开文案。
- 新增与删除不能只靠红绿颜色区分；使用语义化 `<del>` / `<ins>`（或等价的屏幕阅读器标签）并保留删除线、`+`/`−` 等非颜色线索。
- 最新正文和长 diff 可以默认两行截断，但必须提供可见的“展开全文”，不能让关键信息只能通过省略号猜测。
- 动态加载、补采完成和错误重试状态使用 `aria-live="polite"`，避免内容更新对屏幕阅读器静默发生。

## 9. 相邻版本 diff 链算法

### 9.1 排序前提

上游示例中的 `version_ids` 是从旧到新，但字段说明只称其为“编辑链版本 ID 列表”，没有明确写出排序保证（上游文档 `:53,93`）。前端不能靠 `is_latest` 独自重建中间版本顺序，也不应按字符串 ID 擅自排序。

实施前应让上游确认：`edit.version_ids` 是否稳定按 oldest → newest 排列。推荐把这个保证补进接口文档；未确认时可以沿用示例顺序，但必须记录为契约风险。

### 9.2 构链步骤

```text
versionById = Map(versions.map(v => [v.id, v]))
orderedIds = 去重后的 edit.version_ids

for i from 1 to orderedIds.length - 1:
    before = versionById[orderedIds[i - 1]]
    after  = versionById[orderedIds[i]]

    if before/after 缺失，或任一 status=pending，或 tweet=null:
        生成 pending transition
    else:
        diff(before.tweet.text, after.tweet.text)
```

结果数量应为 `max(orderedIds.length - 1, 0)`。A、B、C 三个版本生成 A→B 和 B→C 两段，不能只比较 A→C，否则会丢失中间修改语义。

### 9.3 文本 diff 策略

第一版推荐 token 级 diff：

1. 统一 `\r\n`/`\r` 为 `\n`，不做 trim，避免吞掉首尾空白变化。
2. 英文按“单词 + 空白 + 标点”切分。
3. 中文可优先使用 `Intl.Segmenter(lang, { granularity: 'word' })`；不可用时回退到 Unicode 字符切分。
4. 对 token 序列执行 diff，输出 `equal / delete / insert` 片段。优先评估成熟的 `diff` 包并只引入 `diffArrays`；若不新增依赖，则实现带 token 上限的 LCS，避免手写无边界的复杂算法。
5. 合并相邻同类型片段。
6. 对过长 equal 片段保留变更点前后上下文，其余折叠为 `…`。
7. 使用 React 文本节点渲染，禁止把未经清洗的推文 HTML送入 `dangerouslySetInnerHTML`。

现有删帖组件会清洗 `info.html` 后再注入（插件 `src/compontents/DeletedTweetsSection.tsx:269-285`）。diff 建议直接使用 `tweet.text`，可以完全避免 HTML 标签参与算法和 XSS 风险。

### 9.4 性能保护

- diff 只在用户展开某一编辑链时计算，并用 `useMemo` 缓存。
- 默认只展开一条链或一段 transition。
- 帖子卡片使用 `root_id`，transition 使用 `${root_id}:${beforeId}:${afterId}` 作为稳定 React key，禁止使用数组下标。
- 超长文本设置 token 上限；超过上限时回退为“旧正文 / 新正文”折叠展示，避免二次复杂度算法阻塞内容脚本。
- 翻页合并按 `root_id` 去重，应保留新响应中的版本状态，以便 pending 补采完成后刷新。

## 10. 时间与权限待确认项

| 问题 | 选项 | 推荐 |
|---|---|---|
| VIP 的 24h 从何时计算 | `first_created_at` / `last_edited_at` | 第一版用 `first_created_at`，与上游查询、排序和分页契约一致；若产品坚持后者，先扩展上游契约 |
| 同一链多次修改是否逐次过期 | 整条链统一判断 / 每段各自 24h | 第一版整条链按 `first_created_at` 判断；接口没有每个版本的编辑时间，无法精确逐段过期 |
| 非 VIP 数量口径 | 近 30 天编辑帖篇数 / 近 24h / 编辑动作总次数 | 按现有接口只能可靠展示“近 30 天编辑帖篇数” |
| “内部一直可见” | 上游 30 天窗口内不限时 / 真正永久 | 第一版前者；真正永久需要上游扩展保留期或查询能力 |
| `version_ids` 顺序 | oldest→newest 是否契约保证 | 要求上游明确保证 |

如果产品坚持“非 VIP 展示总编辑动作次数”，现有 counts 接口无法满足。不能用 `counts` 冒充动作次数；需要上游新增 `edit_action_counts`，或在 counts 响应中同时返回 `thread_count` 与 `edit_count`。

如果产品坚持“每一次 diff 各自只对 VIP 可见 24h”，上游必须为每个版本补充 `created_at/edited_at`；当前只有整条链的 `last_edited_at`（上游文档 `:94-100`）。

## 11. 兼容性与错误展示

### 11.1 向后兼容

- 新增专用 XHunt 业务路由，不改变现有删帖、通用代理或其他 Pro 数据裁剪；改贴请求不会进入 `/api/xhunt/proxy`。
- Counts/details 保留上游字段，只附加 `xhunt_access`，老客户端忽略新增字段即可。
- 新增 `showEditInfo` 默认键通过服务端 deepMerge 自动补给既有账号，不需要数据迁移（`src/xhunt/api/user-settings.js:63-86,148-170`）。
- 插件功能键应先进入 flexibleTesting 或 testConfig，小范围验证后再决定是否加入基础功能列表。

### 11.2 前端状态

| 状态 | 展示 |
|---|---|
| count=0 | 不显示“改贴”入口 |
| count>0 + count_only | 显示数量；hover 显示 VIP 提示，不请求详情 |
| vip_24h + details 为空 | 显示“近 30 天 N 篇；最近 24 小时无可见详情” |
| internal_source_window + details 为空 | 显示“暂无可用详情”，允许刷新 |
| `history_complete=false` | 展示不完整提示，保留已完成的相邻 diff |
| HTTP/业务错误 | 保留 count；面板显示可重试错误，不伪装成 0 |
| 翻页数据漂移 | 按 `root_id` 去重，允许刷新第一页 |

## 12. 测试计划

### 12.1 后端单元测试

已新增 `node:test` 用例；本仓库现有测试使用 `node:test` + `node:assert/strict`（例如 `test/e2e-scoring-settings-migration.test.js:1-3`）。覆盖重点包括：

1. 内部用户 details 原样返回 30 天窗口内全部链。
2. VIP 只返回 `first_created_at` 在 `[now-24h, now]` 内的链。
3. VIP 的边界值恰好 24h 可见。
4. VIP 缺失、非法、未来 `first_created_at` 的链被裁掉。
5. 非 VIP / 匿名 details 的 `items=[]`，无任何正文和版本元数据。
6. Counts 对三种身份都保留 `counts`，但 `xhunt_access` 正确。
7. 过滤器抛错时 details 返回 500，不透传上游正文。
8. 非目标路径保持原行为。

### 12.2 后端路由测试

1. 两个业务路由只映射到固定上游 `/tweet/edited*`，不是 `/fetch/tweet/...`，也不能访问任意外部路径。
2. 接口拒绝 `target`、URL 等目标选择参数，只向上游发送校验后的 `user_id/user_ids/limit/offset`。
3. 缺参数、limit 越界、offset 非整数时错误不被包装成成功。
4. HTTP 200 + `code=400/500` 能被客户端识别。
5. 响应头为 no-store；不同身份请求不会共享缓存。
6. 有效 token、`x-tw-id`、`x-user-id`、AuthCenter identity 的名单判断均正确。

### 12.3 前端单元测试

1. `counts=2` 显示“近 30 天改贴 2 篇”，不显示“修改 2 次”。
2. `count_only` 不触发 details 请求。
3. `vip_24h/internal_source_window` 只在首次 `onHover`/点击展开时请求 details，同一账号重复打开复用缓存。
4. A→B 生成 1 段，A→B→C 生成 2 段。
5. pending、缺版本、重复 ID、`latest=null`、`history_complete=false` 不崩溃。
6. 中英文、中文标点、emoji、换行、纯新增、纯删除、完全相同文本的 diff 正确。
7. 长 unchanged 上下文被折叠，展开后无布局溢出。
8. `showEditInfo=false` 时入口完全隐藏。

### 12.4 手工验收

- 普通用户只收到 counts；浏览器 Network 中 details 不应出现。
- 手工调用 details 也拿不到正文，验证不是只做前端遮挡。
- VIP 查看 `first_created_at` 分别为 23h59m 与 24h01m 的两条链，确认边界。
- 内部用户查看超过 24h、但仍在上游 30 天窗口内的链。
- 同一帖子三版本确实展示两段相邻 diff。
- pending 补采完成后刷新，diff 能从占位切换为正文差异。

## 13. 发布与回滚计划

推荐顺序：

1. 与上游确认 `version_ids` 顺序和 24h 口径。
2. 后端先上线两个专用业务接口、权限裁剪、no-store 和测试；此时无插件调用，风险较低。
3. 管理后台增加 `showEditInfo` 中文映射，Nacos 先配置 flexibleTesting 内测用户。
4. 插件上线 counts 预取、details 懒加载、紧凑 diff 和设置项。
5. 先内部用户验证完整历史，再验证 VIP 24h，最后验证普通用户只见数量。
6. 逐步扩大灰度；观察上游错误率、details P95、pending 比例和权限裁剪异常。

回滚时优先从 Nacos 灰度配置中关闭 `showEditInfo`，使插件隐藏入口；后端路由可保留。若发现权限裁剪异常，details 必须继续 fail-closed，不能通过关闭过滤来“临时恢复”。

## 14. 文件影响清单（已实施）

### 14.1 本仓库

| 文件 | 建议变更 |
|---|---|
| `src/apiServer/routes/xhunt.js` | 注册聚合后的 Twitter router，挂载到现有 `/api/xhunt/twitter` 命名空间，并沿用指纹、浏览器来源和安全中间件 |
| `src/apiServer/boot/preload.js` | 预加载聚合后的 Twitter router，启动时覆盖改名与改贴模块检查 |
| `src/xhunt/api/twitter.js` | 聚合现有改名路由与新增改贴路由，避免相同前缀重复执行外层中间件 |
| `src/xhunt/api/edited-tweets.js` | 提供 `GET /edited-counts`、`GET /edited`；可选认证、参数校验、no-store、错误映射和响应输出 |
| `src/xhunt/services/edited-tweet-service.js` | 只调用固定的两个上游路径；封装查询参数白名单、超时、JSON 解析及上游错误归一化 |
| `src/xhunt/utils/edited-tweet-access.js` | 深模块：封装三档权限、访问 scope、counts/details 差异、24h 裁剪和异常结构校验 |
| `src/xhunt/api/user-settings.js` | `sidebars` 默认增加 `showEditInfo: true` |
| `admin-web/src/pages/FeatureFlagsPage.tsx` | 增加 `showEditInfo: 显示改贴` 的管理后台标签 |
| `test/edited-tweet-access.test.js` | 通过 access 模块公开接口覆盖三档 scope、24h 边界、异常 fail-closed 和 counts 语义 |
| `test/edited-tweet-service.test.js` | 覆盖固定上游映射、参数白名单、业务错误、无效 JSON 和 HTTP 400 文本响应 |
| `test/edited-tweets-api.test.js` | 通过临时 Express 测试实例覆盖专用路径映射、no-store、普通用户详情清空与 target 拒绝 |

预计不需要数据库迁移；用户设置存于 JSON，并在读取时与默认配置深合并（`src/xhunt/api/user-settings.js:63-86,143-170`）。

### 14.2 插件仓库

| 文件 | 建议变更 |
|---|---|
| `src/contents/services/api.ts` | 调用 `/api/xhunt/twitter/edited-counts` 与 `/api/xhunt/twitter/edited`，检查 HTTP 与业务 `code`；不使用通用 proxy client |
| `src/types/index.ts` | 新增编辑链、版本、访问 scope、分页响应类型 |
| `src/contents/hooks/useEditedTweets.ts` | counts 预取、access、details 懒加载、缓存、分页去重和重试 |
| `src/compontents/area/NameRightData.tsx` | 增加“改贴 (N)”入口和 hover panel |
| `src/compontents/HoverStatItem.tsx` | 补齐点击/键盘打开能力和 ARIA 状态，避免新入口只支持 hover |
| `src/compontents/EditedTweetsSection.tsx` | 懒加载详情、分页、卡片、pending/错误/锁定状态 |
| `src/utils/editedTweetDiff.ts` | 纯函数：版本构链、tokenize、相邻文本 diff、上下文折叠；采用有 token 上限的 LCS，未增加依赖 |
| `src/utils/settingsManager.ts` | 增加 `showEditInfo` 设置、统一键和灰度策略 |
| `src/contents/services/userSettings.ts` | 云设置 sidebarKeys 增加 `showEditInfo` |
| `src/locales/zh.json` / `en.json` | 增加改贴、次数、补采、权限、错误等文案 |
| 对应测试文件 | 覆盖 API、构链、diff、权限 UI 和懒加载 |

## 15. 验收标准

- 非 VIP 的任何响应中都不存在改贴正文、版本 ID 或编辑时间，只能获得逻辑帖子篇数。
- VIP 不能获得 `first_created_at` 超过约定 24 小时边界的编辑链。
- 内部用户能获得上游当前 30 天窗口内的全部编辑链。
- A→B→C 显示两段相邻 diff，且 pending 不伪造差异。
- 页面初始加载只请求 counts，详情在有权限且打开面板时才请求。
- UI 明确区分“改贴篇数”和“编辑动作次数”。
- 响应不使用共享缓存，权限处理异常时不透传数据。
- `showEditInfo` 同时受 Nacos 灰度和用户本地/云设置控制，但后端权限不依赖这些 UI 开关。

## 16. 实施前必须确认

1. VIP 的 24h 是否接受按上游查询口径 `first_created_at` 计算；若必须按 `last_edited_at`，先由上游补齐同口径查询/排序或可靠游标。
2. “内部一直可见”是否接受受上游最近 30 天窗口限制。
3. 产品文案是否接受“近 30 天改贴 N 篇”；若必须显示动作总次数，需要上游扩展 counts。
4. 上游是否保证 `version_ids` 从旧到新稳定排序。
5. 第一版是否只比较正文文本；媒体、引用和投票变化是否明确延后。

以上五项确认后再进入编码，可以避免权限语义、数量文案和 diff 顺序在前后端出现不可兼容的解释。
