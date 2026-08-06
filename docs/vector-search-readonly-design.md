# 只读向量检索实现说明：底层通用 + 业务显式 SQL

> 适用项目：`enterprise-admin` / XHunt 后端服务  
> 第一版业务接口：`/api/xhunt/kol-marketing/search`  
> 目标表：`dev.kol_marketing_profile`  
> 设计原则：只读从库、pgvector raw SQL、基础能力复用、具体业务查询不配置化。

---

## 1. 为什么不做 registry 配置表

当前不使用 `registry.js` 这种 target 配置中心。

原因：

- 每个业务接口应该清楚地知道自己查哪张表、返回哪些字段、支持哪些过滤条件。
- SQL 放在业务 service 里更直观，后续排查和优化更方便。
- 通用层只负责公共能力，不参与决定业务字段。
- 避免为了“通用”把业务查询变成一堆配置，增加理解成本。

最终结构是：

```text
基础设施层：src/infra/k8s/postgres-readonly.js
  -> K8s Secret 注入的 PostgreSQL 只读从库连接
  -> 不 sync，不写库，启动时校验 pg_is_in_recovery()

通用工具层：src/services/vector-search/
  -> embedding-service.js 通用 query embedding 生成与 Redis 缓存
  -> pgvector-utils.js   通用 pgvector literal / limit / filter 值清洗工具

业务层：src/xhunt/api/kol-marketing/search-service.js
  -> 显式 SQL 查询 dev.kol_marketing_profile
  -> 明确 select 字段和 filters

API 层：src/xhunt/api/kol-marketing/index.js
  -> POST /api/xhunt/kol-marketing/search
```

---

## 2. 当前接口

```text
POST /api/xhunt/kol-marketing/search
```

请求示例：

```json
{
  "query": "找适合 AI 项目早期增长合作的中文 KOL",
  "filters": {
    "language": "zh",
    "domains": ["ai", "web3"],
    "minFollowers": 50000
  },
  "limit": 20
}
```

当前支持 filters：

- `language`
- `domains`
- `keywords`
- `cooperationTypes`
- `marketingGoals`
- `projectStages`
- `willingnessLevel`
- `identityTier`
- `minFollowers`
- `maxFollowers`

---

## 3. KOL 查询 SQL 放在哪里

路径：

```text
src/xhunt/api/kol-marketing/search-service.js
```

这里显式维护：

- 查 `dev.kol_marketing_profile`
- 用 `marketing_profile_embedding` 做 pgvector cosine 检索
- 固定条件：

```sql
p.active = true
AND p.marketing_profile_embedding IS NOT NULL
```

这个固定条件要保留，因为生产索引是：

```sql
idx_kol_marketing_profile_embedding_hnsw
USING hnsw (marketing_profile_embedding vector_cosine_ops)
WHERE active AND marketing_profile_embedding IS NOT NULL
```

---

## 4. 后续新增其他表怎么做

不要改成 registry。

新增一个业务 service 即可，例如：

```text
src/xhunt/services/project-profile-search-service.js
src/xhunt/api/project-profile-search.js
```

新的业务接口目录里的前置逻辑复用：

```js
const { getQueryEmbedding } = require("../../services/vector-search/embedding-service");
const { vectorToPgLiteral } = require("../../services/vector-search/pgvector-utils");
const { getPostgresReadOnlyInstance } = require("../../infra/k8s/postgres-readonly");
```

但 SQL 自己显式写：

```sql
FROM dev.project_profile p
WHERE p.active = true
  AND p.project_embedding IS NOT NULL
ORDER BY p.project_embedding <=> $embedding::vector
LIMIT $limit
```

---

## 5. 环境变量

只读从库（优先使用 `K8S_PG_READ_*`，表示变量来自 K8s Secret/ConfigMap 注入）：

```bash
# K8s 注入的只读从库完整连接串，优先级最高；配置后可不配 HOST/PORT/DATABASE/USERNAME/PASSWORD
K8S_PG_READ_DATABASE_URL=<postgres-readonly-url>

# 是否允许这个“只读连接”落到 PostgreSQL 主库；生产建议 false，防止误查主库
K8S_PG_READ_ALLOW_PRIMARY=false

# 只读从库连接池最大连接数；第一版保守配置，避免给从库制造连接压力
K8S_PG_READ_POOL_MAX=3

# 只读从库连接池最小连接数；默认 0，空闲时不常驻连接
K8S_PG_READ_POOL_MIN=0

# 单条 SQL 超时时间，单位毫秒；防止向量查询或过滤条件异常导致慢查询
K8S_PG_READ_STATEMENT_TIMEOUT_MS=1500

# 是否启用 PostgreSQL SSL；K8s 内网通常 false，跨网络或云数据库按实际要求配置
K8S_PG_READ_SSL=false

# SSL 是否校验证书；默认校验，只有在自签证书等特殊场景才显式设为 false
K8S_PG_READ_SSL_REJECT_UNAUTHORIZED=true

# 是否打印 Sequelize SQL 日志；生产默认 false，仅排查问题时临时打开
K8S_PG_READ_LOGGING=false
```

如果不方便注入完整连接串，也支持拆分字段：

```bash
# 只读从库主机地址，例如 pg-read.default.svc.cluster.local
K8S_PG_READ_HOST=<postgres-readonly-host>

# 只读从库端口；默认 5432
K8S_PG_READ_PORT=5432

# 只读从库数据库名，例如 meta
K8S_PG_READ_DATABASE=<database-name>

# 只读从库账号
K8S_PG_READ_USERNAME=<username>

# 只读从库密码，必须通过 Secret 注入，不要硬编码
K8S_PG_READ_PASSWORD=<password>

# Sequelize dialect，默认 postgres，通常不用改
K8S_PG_READ_DIALECT=postgres
```

兼容旧命名：`PG_READ_DATABASE_URL` / `DATABASE_URL_READ` / `PG_READ_*`。新配置优先使用 `K8S_PG_READ_*`，明确表示该连接来自 K8s 注入的只读从库 Secret。

KOL embedding：

```bash
# KOL 画像 query embedding 模型；必须和 dev.kol_marketing_profile 表内存量向量模型一致
KOL_MARKETING_PROFILE_EMBEDDING_MODEL=<必须和表内向量模型一致>

# KOL 画像 query embedding 维度；必须等于 marketing_profile_embedding 的 vector 维度
KOL_MARKETING_PROFILE_EMBEDDING_DIMENSIONS=1536

# KOL 画像内部 embedding HTTP 接口；配置后优先走该接口，不直接请求外部 LiteLLM/OpenAI
KOL_MARKETING_PROFILE_EMBEDDING_ENDPOINT_URL=http://backend-v1.xhunt.svc.cluster.local:3010/ai/embedding

# KOL 画像 embedding 服务 API Key；不填时复用 LLM_API_KEY
KOL_MARKETING_PROFILE_EMBEDDING_API_KEY=<可选，不填复用 LLM_API_KEY>

# KOL 画像 embedding 服务 Base URL；未配置内部 endpoint 时使用，不填则复用 LLM_BASE_URL / llmConfig.baseURL
KOL_MARKETING_PROFILE_EMBEDDING_BASE_URL=<可选，不填复用 LLM_BASE_URL>

# KOL 画像 query embedding Redis 缓存 TTL，单位秒；默认 86400
KOL_MARKETING_PROFILE_EMBEDDING_CACHE_TTL_SECONDS=86400

# KOL 画像 embedding 请求重试次数；不填时复用 llmConfig.maxRetries 或默认 2
KOL_MARKETING_PROFILE_EMBEDDING_MAX_RETRIES=2

# KOL 画像 embedding 请求超时时间，单位毫秒；默认 30000
KOL_MARKETING_PROFILE_EMBEDDING_TIMEOUT_MS=30000

# KOL Marketing 搜索每日次数限制；默认 30，未配置时可兜底 VECTOR_SEARCH_DAILY_LIMIT
KOL_MARKETING_SEARCH_DAILY_LIMIT=30
```

兼容旧命名：

```bash
# 历史 KOL 搜索 embedding 模型变量；仅兼容旧配置，新配置请用 KOL_MARKETING_PROFILE_EMBEDDING_MODEL
KOL_SEARCH_EMBEDDING_MODEL=<legacy>

# 历史 KOL 搜索 embedding API Key；仅兼容旧配置，新配置请用 KOL_MARKETING_PROFILE_EMBEDDING_API_KEY
KOL_SEARCH_EMBEDDING_API_KEY=<legacy>
```

通用兜底：

```bash
# 向量检索通用 embedding 模型兜底；业务专用模型未配置时使用
VECTOR_SEARCH_EMBEDDING_MODEL=<fallback>

# 向量检索通用每日次数限制兜底；业务专用日限额未配置时使用
VECTOR_SEARCH_DAILY_LIMIT=30
```

统一 LLM embedding 兜底（`src/lib/llm/embedding.js`）：

```bash
# 通用内部 embedding HTTP 接口；业务未配置 <PREFIX>_EMBEDDING_ENDPOINT_URL 时使用
LLM_EMBEDDING_ENDPOINT_URL=<optional-internal-embedding-endpoint>

# 通用 embedding 模型；业务和 VECTOR_SEARCH 都未配置模型时使用
LLM_EMBEDDING_MODEL=gemini-embedding-001

# 通用 embedding 维度；业务未显式传 dimensions 时使用，默认 1536
LLM_EMBEDDING_DIMENSIONS=1536

# 通用 OpenAI-compatible Base URL；仅未配置内部 endpoint 时使用
LLM_EMBEDDING_BASE_URL=<optional-openai-compatible-base-url>

# 通用 OpenAI-compatible API Key；仅未配置内部 endpoint 时使用，不填则复用 LLM_API_KEY
LLM_EMBEDDING_API_KEY=<optional-secret>

# 通用 embedding 请求超时时间，单位毫秒；默认复用 llmConfig.timeout
LLM_EMBEDDING_TIMEOUT_MS=30000

# 通用 embedding OpenAI SDK 重试次数；默认复用 llmConfig.maxRetries
LLM_EMBEDDING_MAX_RETRIES=2
```

---

## 6. 生产保护

- 只读 Sequelize 实例放在 `src/infra/k8s/postgres-readonly.js`。
- 连接级设置：
  - `default_transaction_read_only=on`
  - `statement_timeout` 默认 1500ms
  - `idle_in_transaction_session_timeout=3000`
  - `application_name=xhunt-pg-readonly`
- 默认不允许只读连接落到主库。
- 不执行 `sync`。
- 不返回 `marketing_profile_embedding`。
- 所有用户输入都走 bind 参数。
- `limit` 最大 50。
