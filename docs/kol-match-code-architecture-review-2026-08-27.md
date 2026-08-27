# KOL Match 相关代码规范与架构整理建议

审查日期：2026-08-27  
审查范围：

- `src/xhunt/api/echohunt-kol-match.js`
- `src/xhunt/api/echohunt-kol-match/`
- `src/xhunt/api/kol-marketing/`
- 关联入口：
  - `src/xhunt/api/echohunt.js`
  - `src/apiServer.js`
  - `src/admin/api/kol-marketing.js`
  - `src/xhunt/api/stats-routes/kol-match-config.js`

## 1. 本次审查边界

本次只针对代码规范、写法、模块边界、公共逻辑提取和可维护性提出建议。

不纳入本次范围：

- 不改变 quota 规则。
- 不改变成功后扣费逻辑。
- 不改变搜索、推荐、打分、排序算法。
- 不改变接口入参出参。
- 不改变 Redis key 语义。
- 不改变线上运行时配置优先级。
- 不改变 DB 查询结果语义。

因此本文档里的建议应按“纯重构 / 等价迁移 / 公共提取”理解。

## 2. 当前代码结构概览

### 2.1 KOL Match 产品入口

KOL Match 产品接口挂载在：

```text
/api/xhunt/echohunt/kol-match/*
```

实际入口：

- `src/xhunt/api/echohunt.js`
  - `router.use("/kol-match", echohuntKolMatchRoutes)`
- `src/xhunt/api/echohunt-kol-match.js`
  - `GET /quota`
  - `GET /project-account/lookup`
  - `POST /strategy`
  - `POST /ai-search`
  - `POST /ai-search/stream`
  - `POST /filter-search`
  - `GET /kols/lookup`
  - `GET /kols/:twitterUserId`

### 2.2 KOL Marketing 底层检索

- `src/xhunt/api/kol-marketing/index.js`
  - 旧 XHunt KOL Marketing 搜索接口。
- `src/xhunt/api/kol-marketing/search-service.js`
  - 搜索计划生成。
  - LLM 过滤条件抽取。
  - embedding 生成。
  - pgvector 查询 SQL。
  - 查询执行和结果返回。

### 2.3 KOL Match 配置

- `src/xhunt/api/echohunt-kol-match/config.js`
  - defaults / env / Nacos 配置合并。
  - runtime config 解析。
  - config 校验。
- `src/xhunt/api/stats-routes/kol-match-config.js`
  - 管理后台读取、校验、发布配置。

## 3. 总体评价

当前代码整体功能闭环比较完整，已经覆盖：

- Auth Center 鉴权；
- XHunt VIP 判断；
- production / test env 分流；
- runtime config；
- strategy 生成；
- AI search；
- SSE progress；
- filter search；
- KOL detail / lookup；
- pgvector 检索；
- LLM fallback；
- 结果 map 和展示文案。

主要可优化点不是业务逻辑，而是：

1. `echohunt-kol-match.js` 单文件过大，职责过多。
2. 工具函数、常量、i18n 文案、mapper、SQL 片段混在同一个文件。
3. `echohunt-kol-match.js` 和 `kol-marketing/search-service.js` 有部分重复规范化逻辑。
4. handler、service、repository、mapper 边界不够清晰。
5. 部分命名、日志上下文、错误 helper 可以统一。
6. 可测试性受单文件结构影响较大。

## 4. 建议一：拆分 `echohunt-kol-match.js`，但保持业务等价

### 4.1 现状

`src/xhunt/api/echohunt-kol-match.js` 约 3350 行，承担了太多职责：

- Express router；
- route handler；
- quota helper；
- idempotency helper；
- scope gate；
- strategy 生成；
- project account lookup；
- candidate evaluator；
- profile mapper；
- score helper；
- filter search SQL；
- KOL lookup SQL；
- SSE helper；
- error helper；
- i18n 文案；
- constants。

这会导致：

- 定位代码成本高；
- 修改 mapper 也需要打开路由大文件；
- 后续加字段容易误改无关逻辑；
- 单元测试难以只测某一小块。

### 4.2 低风险拆分方式

建议只做“搬代码”，不改函数行为、不改返回结构、不改调用顺序。

推荐目标结构：

```text
src/xhunt/api/echohunt-kol-match/
  index.js                  # 或 router.js，Express router 入口
  handlers.js               # 各 route handler
  constants.js              # 业务常量、默认值、权重、正则
  i18n.js                   # uiText、progress 文案、语言判断
  errors.js                 # publicError、sendError、normalizeKolMatchError
  quota.js                  # quota snapshot / consume / no-charge result
  idempotency.js            # idempotency key read/write helper
  scope.js                  # classifyKolMatchScope 等输入范围判断
  strategy-service.js       # generateKolMatchStrategy / loadStoredStrategy
  ai-match-service.js       # runAiMatch 主编排
  candidate-evaluator.js    # evaluateAiMatchCandidates
  project-account-service.js# lookupProjectAccount / normalizeProjectXProfile
  profile-repository.js     # filter search、lookup、detail SQL
  profile-mapper.js         # mapKolProfile、score、evidence、reason
  sse.js                    # writeSse、normalizeSseProgress、heartbeat helper
```

### 4.3 推荐拆分顺序

为降低风险，建议按“纯函数优先、handler 最后”的方式拆：

1. `constants.js`
2. `i18n.js`
3. `errors.js`
4. `sse.js`
5. `profile-mapper.js`
6. `project-account-service.js`
7. `profile-repository.js`
8. `candidate-evaluator.js`
9. `strategy-service.js`
10. `ai-match-service.js`
11. `handlers.js`
12. `index.js` / `router.js`

每一步只做：

- 移动函数；
- 补充 `module.exports`；
- 修改 require 路径；
- 保持函数签名和返回值不变。

不建议在拆分过程中顺手改业务逻辑。

## 5. 建议二：公共工具函数提取

### 5.1 字符串和数值 normalize

当前类似工具函数散落在多个文件：

- `normalizeString`
- `numeric`
- `clampInteger`
- `safeArray`
- `toIso`
- `shorten`

建议提到：

```text
src/xhunt/api/echohunt-kol-match/utils.js
```

或者如果未来多个 XHunt 模块复用，可放到：

```text
src/xhunt/utils/normalize.js
```

低风险原则：

- 先只服务 KOL Match 内部。
- 不要一开始就迁到全局公共 utils，避免影响其他业务。

### 5.2 语言和展示文案 helper

当前语言判断和文案函数在主文件里：

- `normalizeUiLang`
- `isEnglishUi`
- `uiText`
- `genericPublicProgress`
- `localizeProgressSources`
- `searchProgressTitle`
- `searchProgressMessage`

建议提到：

```text
src/xhunt/api/echohunt-kol-match/i18n.js
```

收益：

- 主业务流程更清晰；
- 后续调整中英文文案不需要进入大路由文件；
- 减少文案和流程逻辑混杂。

### 5.3 error helper

当前错误相关函数：

- `publicError`
- `sendError`
- `normalizeKolMatchError`
- `logKolMatchError`
- `isConfigError`
- `isPgStatementTimeout`

建议提到：

```text
src/xhunt/api/echohunt-kol-match/errors.js
```

注意：

- 只移动，不改变 error code、status、message、data。
- `sendError` 的响应结构保持完全一致。

## 6. 建议三：Repository / Service / Mapper 分层

### 6.1 推荐边界

当前 `echohunt-kol-match.js` 里同时有：

- 编排流程；
- SQL；
- row 到 response item 的映射；
- scoring；
- 文案。

建议分为：

```text
handler 层
  只负责 req/res、参数传入、调用 service、返回 JSON/SSE。

service 层
  负责业务编排，比如 runAiMatch、generateStrategy。

repository 层
  只负责 DB 查询，返回原始 row。

mapper 层
  只负责 row → API response item。

utils 层
  只放无副作用工具函数。
```

### 6.2 具体建议

#### `profile-repository.js`

可迁移：

- `getKolSelectSql`
- `getLatestActivityJoinSql`
- `getKolLatestActivityJoinSql`
- `getKolFromJoinSql`
- `queryKolProfilesByFilters`
- `queryKolProfileByHandle`
- `queryKolProfileByTwitterUserId`

#### `profile-mapper.js`

可迁移：

- `mapKolProfile`
- `buildInitial`
- `scoreKol`
- `scoreAiRecommendation`
- `recommendationReason`
- `evidenceFor`
- `capabilityLabels`
- `localizedSignals`
- `localizedWillingnessEvidence`
- `getInfluenceRank`
- `buildScoreContext`

#### `ai-match-service.js`

可迁移：

- `resolveStrategyForAiSearch`
- `runAiMatch`

#### `strategy-service.js`

可迁移：

- `classifyKolMatchScope`
- `throwIfScopeNotAccepted`
- `generateKolMatchStrategy`
- `loadStoredStrategy`
- `buildFallbackStrategy`
- `normalizeLlmStrategy`
- `enforceStrategyLanguage`

如果担心 `scope` 和 `strategy` 混在一起，可以再拆：

```text
scope.js
strategy-service.js
```

## 7. 建议四：减少 KOL Match 与 KOL Marketing 的重复 normalize

### 7.1 现状

`src/xhunt/api/kol-marketing/search-service.js` 中已有：

- `normalizeLanguage`
- `normalizeDomain`
- `normalizeWillingnessLevel`
- `normalizeFilters`
- `excludeLowWillingnessWithCollaborationSql`

`src/xhunt/api/echohunt-kol-match.js` 中也有类似：

- `normalizeMarket`
- `normalizeDomain`
- `normalizeProductHardFilters`
- `normalizeFilterSearchInput`
- `willingnessMinimumToLevels`
- `excludeLowWillingnessWithCollaborationSql`

### 7.2 低风险建议

先不要改变 filter 的业务语义，只抽最底层、确定性强的 normalize：

```text
src/xhunt/api/kol-marketing/filter-normalizer.js
```

可放：

- `normalizeLanguage`
- `normalizeDomain`
- `normalizeWillingnessLevel`
- `normalizeFilters`

然后：

- `kol-marketing/search-service.js` 引用它；
- `echohunt-kol-match.js` 只引用通用 normalize；
- KOL Match 自己的产品层 preset 逻辑仍留在 KOL Match 内。

这样能减少重复，但不改变“产品筛选条件怎么解释”。

## 8. 建议五：SQL 片段公共提取

### 8.1 现状

KOL Profile 查询字段在多处维护：

- `search-service.js` 内的 embedding 查询 projection；
- `echohunt-kol-match.js` 内的 `getKolSelectSql()`；
- detail / lookup / filter search 也有相似字段需求。

### 8.2 低风险建议

先抽公共 SQL 片段，不改变 SQL 条件：

```text
src/xhunt/api/kol-marketing/profile-sql.js
```

可放：

- `getKolProfileSelectSql(alias, options)`
- `getLatestActivityJoinSql(twitterUserIdExpression)`
- `getPersonProfileTypeFilterSql(alias)`

注意：

- 初期只服务 KOL Match 内部也可以。
- 不建议一次性重写 `search-service.js` 的 SQL。
- 可以先把 `echohunt-kol-match.js` 的 SQL 片段迁出来。

## 9. 建议六：常量集中管理

当前主文件里包含大量常量：

- quota bucket；
- Redis prefix；
- 默认 limit；
- scoring weights；
- vocabulary；
- aliases；
- progress 文案；
- sensitive patterns；
- dangerous input patterns。

建议拆为：

```text
src/xhunt/api/echohunt-kol-match/constants.js
src/xhunt/api/echohunt-kol-match/patterns.js
```

示例：

```text
constants.js
  AI_QUOTA_BUCKET
  FILTER_QUOTA_BUCKET
  STRATEGY_CACHE_PREFIX
  IDEMPOTENCY_CACHE_PREFIX
  DEFAULT_AI_RESULT_LIMIT
  AI_SCORE_WEIGHTS

patterns.js
  SENSITIVE_OUTPUT_PATTERNS
  DANGEROUS_INPUT_PATTERNS
  TOPIC_EN_SIGNALS
  GOAL_EN_SIGNALS
```

收益：

- 主流程文件更短；
- 文案、正则、业务常量调整更集中；
- 降低 merge conflict。

## 10. 建议七：命名规范微调

以下是纯命名层面的建议，不要求马上改。

### 10.1 route handler 命名

当前：

- `quotaHandler`
- `strategyHandler`
- `aiSearchHandler`
- `filterSearchHandler`

可以统一为动宾结构：

- `handleGetQuota`
- `handleCreateStrategy`
- `handleAiSearch`
- `handleAiSearchStream`
- `handleFilterSearch`
- `handleLookupKol`
- `handleGetKolDetail`

优点：

- 一眼能看出是 handler；
- 和 service 函数区分更明显。

### 10.2 repository 查询函数命名

当前：

- `queryKolProfilesByFilters`
- `queryKolProfileByHandle`
- `queryKolProfileByTwitterUserId`

可以保留，已经比较清晰。

如果迁移到 repository，可以统一：

- `findKolProfilesByFilters`
- `findKolProfileByHandle`
- `findKolProfileByTwitterUserId`

### 10.3 mapper 函数命名

当前：

- `mapKolProfile`

建议如果 API 返回结构是 KOL Match 专用，可以更明确：

- `mapKolProfileToMatchItem`

避免未来和其他 KOL profile mapper 混淆。

## 11. 建议八：日志上下文 helper

当前很多日志都手动组装：

- `requestId`
- `authCenterUserId`
- `filters`
- `strategyId`
- `dbCostMs`
- `configVersion`

建议提取：

```javascript
function buildKolMatchLogContext(req, extra = {}) {
  return {
    requestId: getRequestId(req),
    authCenterUserId: getAuthCenterUserId(req),
    ...getKolMatchRuntimeMeta(req),
    ...extra,
  };
}
```

使用方式：

```javascript
console.warn("[EchoHunt KOL Match] filter search failed", buildKolMatchLogContext(req, {
  filters: normalizedFilters,
  code: error.code,
  message: error.message,
}));
```

注意：

- 只改变日志写法；
- 不改变日志含义；
- 不输出敏感数据。

## 12. 建议九：测试文件组织

当前：

- `src/xhunt/api/echohunt-kol-match/handlers/quota.test.js`

这个文件实际是 test-env handler，不是单元测试。命名上容易和测试框架里的 `.test.js` 混淆。

由于现有 dispatcher 就是按 `.test.js` 识别 test handler，因此不建议直接改名。

建议补充目录说明，避免误解：

```text
src/xhunt/api/echohunt-kol-match/handlers/
  README.md       # 已有，建议强调这里不是 Jest/Mocha 单测
```

真正的单元测试建议放到：

```text
src/xhunt/api/echohunt-kol-match/__tests__/
```

优先测试纯函数：

- normalize 类函数；
- scope 分类；
- prompt input builder；
- profile mapper；
- SQL builder；
- config validation。

## 13. 建议十：保留现有配置模块，但拆出 schema / default

`config.js` 目前约 522 行，可读性还可以，但也同时包含：

- 默认配置；
- hard limits；
- env override；
- Nacos 加载；
- cache；
- validate；
- Express middleware。

低风险拆分方式：

```text
src/xhunt/api/echohunt-kol-match/config/
  index.js        # 对外保持原 exports
  defaults.js     # DEFAULT_KOL_MATCH_RUNTIME_CONFIG、HARD_LIMITS
  normalize.js    # normalizeEffectiveConfig、deepMerge
  loader.js       # loadConfigDocument、resolveKolMatchRuntimeConfigValue
  validator.js    # validateKolMatchRuntimeConfigDocument
  middleware.js   # resolveEchohuntAppEnv、resolveKolMatchRuntimeConfig
```

如果暂时不想拆目录，也可以只先拆：

- `config-defaults.js`
- `config-validator.js`

保持 `config.js` 继续作为 facade，对外 API 不变。

## 14. 推荐实施路线

### 第一阶段：纯文件整理

不改业务逻辑，只搬代码：

1. 提取 `constants.js`。
2. 提取 `i18n.js`。
3. 提取 `errors.js`。
4. 提取 `sse.js`。
5. 提取 `utils.js`。

风险最低，收益是主文件明显变短。

### 第二阶段：按职责拆服务

1. 提取 `profile-mapper.js`。
2. 提取 `project-account-service.js`。
3. 提取 `profile-repository.js`。
4. 提取 `candidate-evaluator.js`。
5. 提取 `strategy-service.js`。
6. 提取 `ai-match-service.js`。

每一步做等价迁移。

### 第三阶段：KOL Marketing 公共模块

1. 提取 `filter-normalizer.js`。
2. 提取 `profile-sql.js`。
3. 逐步让 KOL Match 和 KOL Marketing 共用。

这一步涉及两个模块，建议放在主文件拆分之后。

### 第四阶段：补纯函数单测

优先测不依赖 DB / Redis / LLM 的函数：

- filter normalize；
- scope classify；
- mapper；
- config validate；
- SQL builder；
- i18n helper。

## 15. 不建议本次做的事情

以下虽然从架构上可以讨论，但不属于本次“代码规范 / 公共提取”范围：

1. 调整 quota 扣费时机。
2. 调整 quota 并发策略。
3. 调整 idempotency 语义。
4. 调整推荐打分权重。
5. 调整召回数量和结果数量。
6. 调整 filter 解释逻辑。
7. 调整 LLM prompt 业务规则。
8. 调整 DB 查询策略。
9. 调整 API 返回结构。

这些都可能影响线上业务表现，应单独立项评估。

## 16. 结论

KOL Match 当前业务链路完整，但 `echohunt-kol-match.js` 文件职责过重，长期维护成本会逐步上升。

本次建议的主线是：

```text
先拆纯工具和常量
  → 再拆 mapper / repository / service
  → 最后抽 KOL Marketing 公共 normalize / SQL
```

整个过程应坚持：

- 不改业务逻辑；
- 不改接口契约；
- 不改 Redis key 语义；
- 不改 SQL 查询语义；
- 不改推荐结果排序；
- 每次只做等价迁移。

这样可以在风险较低的前提下，逐步提升 KOL Match 代码的可读性、可测试性和后续扩展能力。
