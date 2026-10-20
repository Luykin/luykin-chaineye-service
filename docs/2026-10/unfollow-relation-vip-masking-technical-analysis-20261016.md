# 取关关系（unfollow_relation）VIP 遮挡技术改造 — 技术分析

> 日期：2026-10-16
> 涉及仓库：
> - 后端：`luykin-chaineye-service`（本仓库）
> - 前端插件：`tweet-hunt-extension`（`/Users/luykin/Documents/mac-work-new/tweet-hunt-extension`）

## 1. 需求

对 `/public/fetch/twitter/unfollow_relation` 接口按插件版本做差异化访问控制：

| 插件版本 | 普通用户（非 VIP） | VIP 用户 |
|---|---|---|
| ≤ 0.4.5（含） | 走老逻辑：返回空数据 | 走老逻辑：返回全部数据 |
| > 0.4.5 | 只能看 **3 天之前** 的 unfollow / 被 unfollow 记录；3 天之内的遮挡，展示"仅对 VIP 用户开放"引导卡片，卡片上的跳转链接与按钮文案**由后端下发**（由后端从 Nacos `xhunt_config` 读取下发，常配置为 Google 文档申请链接，后续可改任意链接，无需发版插件） | 看全部 |

"遮挡"必须由后端真实裁剪数据保证（近 3 天记录及其关联的用户信息不下发），前端只负责遮挡 UI 与引导。

## 2. 现状梳理

### 2.1 后端现状

路由：`src/xhunt/api/proxy.js:634-652`

```javascript
router.all(
  "/public/fetch/twitter/unfollow_relation",
  authenticateTokenOptional,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    try {
      const ret = isRequestXHuntVip(req);
      if (!ret) {
        // 非 VIP 返回空数据
        ensureCorsHeaders(req, res);
        return res.status(200).json({ data: [], isVip: false });
      }
    } catch (_) {}

    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);
```

- **VIP 判断**：`isRequestXHuntVip(req)`（`src/xhunt/constants/xhuntVip.js:172`），基于内存 VIP 名单（DB 表 `xhunt_vip_test_users` + Redis Pub/Sub 多 worker 同步），识别来源依次为 `req.user.twitterId`、AuthCenter 登录态、`x-tw-id` 头、`x-user-id` 头。
- **版本获取**：已有现成工具 `src/xhunt/utils/version.js`，`getVersionFromRequest(req)` 读 `x-extension-version` 头，`compareVersion(v1, v2)` / `versionToNumber(v)` 做三段数字比较（每段补零到 2 位拼接转数字）。版本号缺失/非法时 `versionToNumber` 返回 0，天然落入"老逻辑"分支，安全。
- **代理实现**：`proxyRequest(req, res, targetUrl)`（`proxy.js:55`）统一处理转发、CORS、浏览器缓存头、`applyProDataFiltering` Pro 裁剪，目前是"转发即返回"，没有给单个路由预留响应改写钩子。
- **上游真实返回结构**（kota 数据服务，`target=k8s_kota`）：

```jsonc
{
  "code": 200,
  "message": "get data success",
  "data": {
    "data": {
      "twitter_users": { "<twitter_id>": { "id": "...", "username": "...", "profile": { ... } } },
      "unfollowed_action":  [ { "created_at": "2026-09-15T19:16:35Z", "follower_id": "...", "following_id": "...", "latest": 1, "persist": 1 } ],
      "unfollowing_action": [ { "created_at": "2026-03-13T13:50:04Z", "follower_id": "...", "following_id": "...", "latest": 0, "persist": 1 } ]
    }
  }
}
```

  - `unfollowed_action`：被取关（别人取关了该用户），对方是 `follower_id`。
  - `unfollowing_action`：主动取关（该用户取关了别人），对方是 `following_id`。
  - 时间字段为 `created_at`（ISO8601）。
  - 前端读取路径是 `ret?.data?.data`（见 2.2），即内层 `data.data`。

- **缓存注意点**：`proxyRequest` 对 GET 默认下发 `Cache-Control: public, max-age=180`（`proxy.js:404-424`）。改造后该接口响应将**随请求者 VIP 身份不同而不同**，继续 `public` 缓存存在串数据风险，需要把该路径从默认缓存组中剔除（见 3.4）。

### 2.2 前端插件现状

- **API 层**：`src/contents/services/api.ts:797` `fetchUnfollowRelation(twid, limit=30, offset=0)`，经 `secureFetch` 请求 `${kbPublicPrefix}/fetch/twitter/unfollow_relation?...&target=k8s_kota`，返回 `ret?.data?.data`，**丢弃了 `isVip` 等外层元信息**。
- **页面组装**：`src/compontents/PersonalAnalysisPanel.tsx:157` 拉取 unfollow 数据，与 follow 数据合并成 `mergedUnfollowData`（`:252-264`），在 `unfollowing` tab 渲染 `UnfollowInfoPanel`（`:552`），且 **`isPro={true}` 是硬编码**（老逻辑下能看到数据的必然是 VIP，所以前端遮挡逻辑形同虚设）。
- **展示组件**：`src/compontents/UnfollowInfoPanel.tsx`，两个子 tab：`active`（主动取关，读 `unfollowing_action`）/ `passive`（被取关，读 `unfollowed_action`）。内部已有"非 Pro 跳过前 5 条 + ProPanel 引导"的旧遮挡代码（`BLUR_COUNT = 5`，`:196-200`、`:269-272`），但因 `isPro` 恒为 true 从未生效。
- **注意**：用户提到的 `FollowRelationPanel.tsx` 实际只用于 `following` / `followers` 两个 tab（`PersonalAnalysisPanel.tsx:534、543`）；取关 tab 用的是 `UnfollowInfoPanel.tsx`。本次改造的主角是 `UnfollowInfoPanel.tsx`（`FollowRelationPanel` 的 `type: 'unfollowing'` 分支当前无调用方，可不动）。
- **TG 群链接**：插件内已有 `https://t.me/xhunt_ai` 的使用先例（`UserAuthPanel.tsx:99`、`SettingsPage.tsx:1448` 等），但本次引导链接**不在前端写死**，由后端下发（见 3.4），TG 群地址仅作为后端配置的初始值。
- **i18n**：所有用户可见文案必须走 `useI18n`，新增 key 需同步 `src/locales/zh.json` 与 `en.json`（仓库硬性约定）。

## 3. 后端改造方案（luykin-chaineye-service）

### 3.1 版本分流

在路由 handler 中用现成工具判断：

```javascript
const { getVersionFromRequest, compareVersion } = require("../utils/version");

// 新逻辑门槛：版本 > 0.4.5
const version = getVersionFromRequest(req);
const isNewLogic = compareVersion(version, "0.4.5") > 0;
```

- `version` 为 `null`/非法时 `versionToNumber` 返回 0，`compareVersion` 返回 -1 → 自动走老逻辑（VIP-only）。这同时覆盖了 web 端、旧插件等不带版本头的请求，行为安全。
- 阈值 `0.4.5` 建议提为模块级常量（如 `UNFOLLOW_RELATION_NEW_RULE_VERSION = "0.4.5"`），方便日后调整。

### 3.2 响应裁剪（核心）

给 `proxyRequest` 增加一个可选的 JSON 变换钩子（第 4 个参数，默认空操作，不影响其他 12+ 个调用方），在 `applyProDataFiltering` 之后、`res.json` 之前执行：

```javascript
async function proxyRequest(req, res, targetUrl, transformJson = null) {
  // ...
  if (isJson) {
    let data = JSON.parse(responseText);
    data = applyProDataFiltering(req, data);
    if (typeof transformJson === "function") {
      data = transformJson(data) ?? data;
    }
    return res.status(statusCode).json(data);
  }
  // ...
}
```

路由 handler 改造后的逻辑：

```text
isVip = isRequestXHuntVip(req)
if (!isNewLogic):
    # 老逻辑（版本 ≤ 0.4.5 或无版本头）
    非 VIP → { data: [], isVip: false }   # 保持现状，老插件行为不变
    VIP   → 原样代理
else:
    # 新逻辑（版本 > 0.4.5）
    VIP   → 原样代理（可在响应内层标注 isVip: true）
    非 VIP → 代理 + transformJson 裁剪：
        cutoff = Date.now() - 3 * 24 * 3600 * 1000
        inner = data.data.data
        inner.unfollowed_action  = 仅保留 created_at < cutoff 的条目
        inner.unfollowing_action = 仅保留 created_at < cutoff 的条目
        inner.twitter_users = 只保留被保留 action 引用到的 id（见 3.3）
        注入元信息：inner.is_vip = false、inner.vip_masked = true、
                    inner.masked_unfollowed_count / masked_unfollowing_count（被裁掉的条数）、
                    inner.vip_cta = { url, label: { zh, en } }（引导跳转，见 3.3）
```

设计要点：

- **3 天窗口按服务端时间计算**（`created_at` 是 UTC ISO 串，`Date.parse` 后直接比较），不受客户端时区影响。
- **必须同步裁剪 `twitter_users`**：否则被遮记录对应的用户头像/用户名仍会通过 user map 泄漏，遮挡形同虚设（详见 3.3）。
- 被裁条数以 `masked_*_count` 下发，供前端展示"还有 N 条近 3 天记录"之类的引导文案（可选，但推荐）。
- 元信息注入在内层 `data.data` 里，与前端现有 `ret?.data?.data` 读取路径兼容，前端只需多读几个字段。
- 上游返回异常结构（缺 `data.data`、数组字段缺失）时 transform 必须防御性判空、原样透传，不能因裁剪把正常响应打挂。

### 3.3 twitter_users 裁剪规则

保留的 id 集合 = 保留的 `unfollowed_action` 的 `follower_id` + `following_id` ∪ 保留的 `unfollowing_action` 的 `follower_id` + `following_id`（两侧 id 都保留，避免前端取 `twitter_users[targetId]` 时出现 undefined；当前页面用户自己的 profile 前端有其他数据源，保留无害）。遍历 `twitter_users` 按集合过滤即可。

### 3.4 引导跳转（CTA）由后端从 Nacos 下发

遮挡卡片上的跳转链接**不写死在前端**（例如配置为 Google 文档申请链接或其他说明页），由后端从 Nacos `xhunt_config`（`DEFAULT_GROUP`）读取并在裁剪响应时注入：

```jsonc
"vip_cta": {
  "url": "https://docs.google.com/document/d/example",
  "label": { "zh": "申请 VIP 权限", "en": "Apply for VIP Access" }
}
```

- 值来源于 **Nacos `xhunt_config` 的 `unfollowVipCta` 字段**（同时兼容字符串简写 `"unfollowVipCta": "https://..."` 或顶层 `unfollowVipCtaUrl`，本地兜底模板在 `src/xhunt/constants/nacos_config.json`，并带 60s 内存 TTL 缓存），改链接只需在后台修改 Nacos 配置，无需重启或发插件版本。
- 前端原则：**后端返回啥就展示啥**——`url` 缺失或为空时前端不渲染 CTA 按钮，只保留说明文案。
- 仅非 VIP 的裁剪响应注入该字段；VIP 响应无需携带。

### 3.5 缓存修正

`unfollow_relation` 响应现在依赖请求者身份（VIP / 非 VIP / 老版本），不能再走 `DEFAULT` 组（`public, max-age=180`）。将该路径加入 `NO_CACHE_PATHS`（`proxy.js`）。推荐 `NO_CACHE_PATHS`，VIP 状态变更可即时生效。

### 3.6 后端改动清单

| 文件 | 改动 |
|---|---|
| `src/xhunt/utils/unfollow-relation-masking.js`（新增独立模块） | 封装版本阈值判断（`> 0.4.5`）、老版本非 VIP 拦截判断、近 3 天记录与 `twitter_users` 裁剪、Nacos `xhunt_config.unfollowVipCta` 读取与缓存 |
| `src/xhunt/api/proxy.js` | 1) `proxyRequest` 增加异步 `transformJson` 可选钩子；2) `unfollow_relation` 路由委托给 `utils/unfollow-relation-masking.js`；3) 该路径加入 `NO_CACHE_PATHS` |
| `src/xhunt/constants/nacos_config.json` | 补充 `unfollowVipCta` 默认配置模板 |

不新增依赖、不动其他路由。`applyProDataFiltering` 与本裁剪正交（一个按 Pro 裁字段、一个按 VIP+时间裁条目），保持各自独立。

## 4. 前端插件改造方案（tweet-hunt-extension）

### 4.1 API 层（`src/contents/services/api.ts`）

`fetchUnfollowRelation` 返回值从 `ret?.data?.data` 扩展为带元信息的结构，例如：

```ts
Promise<{
  data: UnfollowRelationData;
  isVip: boolean;
  maskedUnfollowedCount: number;
  maskedUnfollowingCount: number;
  vipCta?: { url: string; label: { zh: string; en: string } };
} | undefined>
```

其中 `isVip` / `vipCta` 等读取后端注入的 `ret.data.data.is_vip` / `ret.data.data.vip_cta`（缺省视为 `false` / 无 CTA——老后端对非 VIP 返回 `{data: []}`，`ret.data.data` 为 undefined，同样落到 undefined 分支，行为不变）。

同步在 `src/types/index.ts` 的 `UnfollowRelationData` 上补充可选字段 `is_vip?: boolean`、`vip_cta?: ...` 等，或按上述包装结构定义新类型。

### 4.2 面板组件（`src/compontents/UnfollowInfoPanel.tsx`）

- `isPro` prop 语义改为 `isVip`（或新增 prop，保留 `isPro` 兼容），数据源为 4.1 返回的 `isVip`。
- **VIP**：渲染全部记录（后端已返回全量）。
- **非 VIP**：后端下发的已是 3 天前的记录，直接渲染；在列表**顶部**渲染遮挡引导卡片：
  - 锁形 icon + 标题"近 3 天的取关动态仅对 VIP 用户开放"；
  - 可用 `masked_*_count` 显示"有 N 条近 3 天记录"；
  - CTA 按钮**完全由后端下发的 `vip_cta` 驱动**：按钮文案按当前语言取 `vip_cta.label.zh / en`，点击跳转 `vip_cta.url`（`window.open` / `openNewTab`，与插件现有外链方式一致）；`vip_cta` 或其 `url` 缺失时**不渲染按钮**，只保留说明文案。前端不写死任何链接；
  - 视觉上可叠加 2~3 条模糊（blur）的占位条目增强"被遮住"的感知，但这些占位必须是纯假数据，不渲染真实用户信息。
- 删除或保留旧的 `BLUR_COUNT = 5` 逻辑：建议删除（该逻辑从未生效，且与新规则"按时间遮挡"语义冲突），减少死代码；如担心影响 `FollowRelationPanel` 的同款逻辑，`FollowRelationPanel` 本次不动。
- 两个子 tab（active / passive）各自独立判断：哪个列表有被裁记录就显示哪张引导卡。

### 4.3 页面组装（`src/compontents/PersonalAnalysisPanel.tsx`）

- `:555` 处 `isPro={true}` 硬编码改为传入真实 `isVip`（来自 4.1 的请求结果 state）。
- `mergedUnfollowData` 合并逻辑不变；`unfollowRelationData` 的读取适配 4.1 的新返回结构。

### 4.4 文案（i18n）

`zh.json` / `en.json` 同步新增（key 名示例）：

| key | zh | en |
|---|---|---|
| `unfollowRecentVipOnlyTitle` | 近 3 天的取关动态仅对 VIP 用户开放 | Unfollow activity from the last 3 days is VIP only |
| `unfollowRecentVipOnlyDesc` | 已有 {count} 条近 3 天记录被隐藏 | {count} recent records are hidden |

CTA 按钮文案**不进 i18n 文件**，由后端 `vip_cta.label` 下发（见 3.4），前端按当前语言选取展示。

### 4.5 前端改动清单

| 文件 | 改动 |
|---|---|
| `src/contents/services/api.ts` | `fetchUnfollowRelation` 返回带 `isVip`/遮挡计数/`vipCta` 的结构 |
| `src/types/index.ts` | 补充响应类型字段 |
| `src/compontents/UnfollowInfoPanel.tsx` | 非 VIP 顶部遮挡引导卡（锁 icon + 文案 + 后端下发的 CTA + 假数据模糊占位）；清理 `BLUR_COUNT` 死逻辑 |
| `src/compontents/PersonalAnalysisPanel.tsx` | 去掉 `isPro={true}` 硬编码，传真实 VIP 状态 |
| `src/locales/zh.json` / `en.json` | 新增 2 条文案 |

## 5. 兼容性与发布顺序

1. **先后端、再前端**。后端先上线：老插件（≤ 0.4.5）走老逻辑完全不受影响；新逻辑只对 `x-extension-version > 0.4.5` 的请求生效，而 > 0.4.5 的插件尚未发布，等于后端先就绪、零风险。
2. 插件发布 0.4.6（或下一个版本）后，新版本自动命中新逻辑。
3. 后端以版本头为唯一分流依据，无需配置开关；如需紧急回退新逻辑，把阈值常量调成一个极大版本号即可。
4. 非插件来源（web、脚本）不带版本头 → 永远走老逻辑（VIP-only），不会借新逻辑绕过 VIP 限制拿到 3 天前数据——如果产品上希望 web 端也享受"3 天前可见"，需要另行评估。

## 6. 边界情况

| 场景 | 预期行为 |
|---|---|
| 无 `x-extension-version` 头 | 老逻辑（VIP-only） |
| 版本号格式非法 | `versionToNumber` → 0，老逻辑 |
| 非 VIP 且全部记录都在 3 天内 | 返回空数组 + `vip_masked: true` + 计数，前端只显示引导卡 |
| 上游返回缺 `data.data` 或字段缺失 | transform 判空透传，不报错 |
| `created_at` 解析失败 | 该条目视为"近 3 天"裁掉（宁可少给，不泄漏） |
| VIP 状态刚变更 | 该路径已改为 no-cache，下一次请求即生效 |
| 老版本插件 + VIP | 行为与今天完全一致 |

## 7. 测试建议

后端（本地 `yarn dev` 后）：

1. 不带版本头 + 非 VIP → `{ data: [], isVip: false }`（老逻辑回归）。
2. `x-extension-version: 0.4.5` + 非 VIP → 同上（边界值走老逻辑）。
3. `x-extension-version: 0.4.6` + 非 VIP → 返回中无 3 天内记录，`twitter_users` 无被裁条目对应的 id，含 `is_vip: false` 与遮挡计数。
4. `x-extension-version: 0.4.6` + VIP（`x-tw-id` 在 VIP 名单）→ 全量数据。
5. 响应头确认无 `Cache-Control: public`（no-cache 生效）。

前端：

1. `npx tsc --noEmit` 通过。
2. mock 两种响应（VIP 全量 / 非 VIP 裁剪）验证面板渲染、子 tab 计数、TG 跳转。
3. 中英双语文案检查。
