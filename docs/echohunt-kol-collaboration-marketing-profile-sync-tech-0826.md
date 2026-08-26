# EchoHunt KOL 商务合作信息同步到 `dev.kol_marketing_profile` 技术方案（0826）

## 1. 背景与目标

当前 EchoHunt 商务合作信息保存链路已经落到 XHunt 主业务 PostgreSQL：

- 主表：`XHuntKolCollaborations`
- 模型：`src/xhunt/models/XHuntKolCollaboration.js`
- 保存接口：`PUT /api/xhunt/echohunt/me/collaboration`
- 接口代码：`src/xhunt/api/echohunt.js`

现在新增目标：每次 KOL 在 EchoHunt 保存商务合作信息后，除了写入 `XHuntKolCollaborations`，还需要同步更新 K8s meta PG 里的：

```text
dev.kol_marketing_profile
```

同步关系：

```text
XHuntKolCollaboration.twitterId  <->  dev.kol_marketing_profile.twitter_user_id
```

同步规则：

1. `XHuntKolCollaborations` 仍然是 EchoHunt 商务合作信息的主存储和编辑来源。
2. `dev.kol_marketing_profile` 只同步已经存在的 KOL 画像行，不新建 profile 行。
3. 如果 `dev.kol_marketing_profile` 中存在该 `twitter_user_id`，保存时同步更新新增字段。
4. 如果不存在，跳过同步并记录日志，不影响 XHunt 主表保存。
5. 不修改 `dev.kol_marketing_profile.willingness_level`、`willingness_score`、`willingness_reason` 等 AI 推断接单意愿字段。
6. 本期只做后端存储与查询结果字段透出；前端 KOL 查询结果展示下一期再做。

---

## 2. 线上现状核对

> 仅做只读检查，未修改服务器或数据库。

服务器：

```text
Host: 150.5.161.65
User: root
Port: 22
hostname: k1
```

K8s namespace：

```text
xhunt
```

K8s Secret：

```text
secret/db
├── pg-read
├── pg-write
├── redis-cluster
├── rabbitmq
└── aes-key
```

### 2.1 `pg-read` 现状

通过 `secret/db.pg-read` 连接查询：

```text
database: meta
user: dbuser_view_remote
server: 172.31.0.9:5432
pg_is_in_recovery(): true
transaction_read_only: on
```

权限：

```text
SELECT dev.kol_marketing_profile: true
UPDATE dev.kol_marketing_profile: false
INSERT dev.kol_marketing_profile: false
```

结论：当前 `src/infra/k8s/postgres-readonly.js` 的定位正确，只能继续用于 KOL Match / KOL Marketing 查询，不能拿它写商务合作字段。

### 2.2 `pg-write` 现状

通过 `secret/db.pg-write` 连接查询：

```text
database: meta
user: dbuser_meta
server: 172.31.0.10:5432
pg_is_in_recovery(): false
transaction_read_only: off
```

权限：

```text
SELECT dev.kol_marketing_profile: true
UPDATE dev.kol_marketing_profile: true
INSERT dev.kol_marketing_profile: true
DELETE dev.kol_marketing_profile: true
```

结论：同步写入应新增独立的 K8s meta PG write 连接，使用 `pg-write` 对应连接串，不应改造/复用 readonly 实例。

### 2.3 `dev.kol_marketing_profile` 表现状

当前主键：

```text
PRIMARY KEY (twitter_user_id)
```

外键：

```text
twitter_user_id REFERENCES dev.twitter_user(id) ON DELETE CASCADE
```

当前没有 trigger：

```text
information_schema.triggers: 0 rows
```

注意：`updated_at` 不会自动更新；如果同步时需要标记更新时间，必须在 SQL 里显式写入对应字段。建议不要动表原有 `updated_at`，避免混淆 AI 画像更新时间，新增独立的 `collaboration_updated_at` / `collaboration_synced_at`。

---

## 3. 数据库字段设计

在 `dev.kol_marketing_profile` 上新增商务合作字段，避免覆盖现有 AI 推断字段。

### 3.1 推荐字段

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `collaboration_accepting_new_invitations` | `boolean` | YES | KOL 本人设置：是否接受新项目合作邀约 |
| `collaboration_telegram` | `text` | YES | 规范化后的 Telegram，例如 `@username` |
| `collaboration_email` | `text` | YES | 商务合作邮箱，小写存储 |
| `collaboration_short_post_price` | `numeric(18,2)` | YES | 短推报价 |
| `collaboration_short_post_currency` | `text` | YES | `USDT` / `USD` |
| `collaboration_thread_price` | `numeric(18,2)` | YES | 长推 / Thread 报价 |
| `collaboration_thread_currency` | `text` | YES | `USDT` / `USD` |
| `collaboration_updated_at` | `timestamptz` | YES | 用户在 EchoHunt 更新商务合作信息的时间 |
| `collaboration_synced_at` | `timestamptz` | YES | 同步写入 `dev.kol_marketing_profile` 的时间 |
| `collaboration_source` | `text` | YES | 固定 `echohunt_web`，方便排查来源 |

### 3.2 不建议新增/修改的字段

不要改：

```text
willingness_level
willingness_score
willingness_confidence
willingness_reason
willingness_evidence
```

原因：这些字段表示 AI 从公开内容推断的接单意愿；本需求是 KOL 本人主动维护的商务合作状态，两类数据来源不同，必须分开。

### 3.3 SQL 变更脚本

建议新增 SQL 文件：

```text
scripts/k8s-pg/20260826-add-kol-collaboration-fields-to-marketing-profile.sql
```

内容：

```sql
ALTER TABLE dev.kol_marketing_profile
  ADD COLUMN IF NOT EXISTS collaboration_accepting_new_invitations boolean,
  ADD COLUMN IF NOT EXISTS collaboration_telegram text,
  ADD COLUMN IF NOT EXISTS collaboration_email text,
  ADD COLUMN IF NOT EXISTS collaboration_short_post_price numeric(18, 2),
  ADD COLUMN IF NOT EXISTS collaboration_short_post_currency text,
  ADD COLUMN IF NOT EXISTS collaboration_thread_price numeric(18, 2),
  ADD COLUMN IF NOT EXISTS collaboration_thread_currency text,
  ADD COLUMN IF NOT EXISTS collaboration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS collaboration_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS collaboration_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_short_currency_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_short_currency_check
      CHECK (
        collaboration_short_post_currency IS NULL
        OR collaboration_short_post_currency = ANY (ARRAY['USDT'::text, 'USD'::text])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_thread_currency_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_thread_currency_check
      CHECK (
        collaboration_thread_currency IS NULL
        OR collaboration_thread_currency = ANY (ARRAY['USDT'::text, 'USD'::text])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_price_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_price_check
      CHECK (
        (collaboration_short_post_price IS NULL OR collaboration_short_post_price > 0)
        AND (collaboration_thread_price IS NULL OR collaboration_thread_price > 0)
      );
  END IF;
END $$;
```

如果下一期需要按“接受邀约”筛选，可再加索引：

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kol_marketing_profile_collab_accepting
ON dev.kol_marketing_profile (collaboration_accepting_new_invitations)
WHERE collaboration_updated_at IS NOT NULL;
```

> `CREATE INDEX CONCURRENTLY` 不能放在事务里执行；如果本期只是查询结果透出、不筛选，可以先不加索引。

### 3.4 线上执行方式

只读验证字段是否已存在：

```bash
ssh -p 22 root@150.5.161.65
PGURL=$(kubectl -n xhunt get secret db -o jsonpath='{.data.pg-write}' | base64 -d)
psql "$PGURL" -P pager=off -c "
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='dev'
  and table_name='kol_marketing_profile'
  and column_name like 'collaboration_%'
order by ordinal_position;
"
```

执行 SQL：

```bash
ssh -p 22 root@150.5.161.65
PGURL=$(kubectl -n xhunt get secret db -o jsonpath='{.data.pg-write}' | base64 -d)
psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/k8s-pg/20260826-add-kol-collaboration-fields-to-marketing-profile.sql
```

> 实际执行前建议先做数据库备份或确认已有备份策略。

---

## 4. 后端连接设计

### 4.1 保留现有 readonly 连接

现有文件：

```text
src/infra/k8s/postgres-readonly.js
```

当前特点：

- 默认设置 `default_transaction_read_only=on`
- 启动时校验 `pg_is_in_recovery()`
- 用于 KOL Match / KOL Marketing 查询
- 不加载业务模型，不执行 sync

该文件不要改成可写，否则会破坏现有只读安全边界。

### 4.2 新增 write 连接

建议新增：

```text
src/infra/k8s/postgres-write.js
```

职责：

1. 只提供 K8s meta PG write Sequelize 实例。
2. 不加载业务模型，不执行 `sync()`。
3. 默认要求连接到 primary：`pg_is_in_recovery() = false`。
4. 设置较保守连接池，例如 `max=2`。
5. 设置 `statement_timeout`，避免写入卡死。
6. application name 使用 `xhunt-pg-write`。

环境变量读取顺序：

```text
K8S_PG_WRITE_DATABASE_URL
PG_WRITE_DATABASE_URL
DATABASE_URL_WRITE
```

本次不改 K8s 配置，推荐把桌面文件中的连接串复制到运行机环境变量：

```text
PG_WRITE_DATABASE_URL=postgres://...
```

### 4.3 write 连接伪代码

```js
const { Sequelize, QueryTypes } = require('sequelize');

let pgWriteInstance = null;
let setupState = { configured: false, ready: false, checkedAt: null, server: null, error: null };

function getWriteUrl() {
  return process.env.K8S_PG_WRITE_DATABASE_URL ||
    process.env.PG_WRITE_DATABASE_URL ||
    process.env.DATABASE_URL_WRITE ||
    '';
}

function createPostgresWriteInstance() {
  const url = getWriteUrl();
  if (!url) {
    const error = new Error('K8s meta PG write env incomplete');
    error.code = 'PG_WRITE_NOT_CONFIGURED';
    throw error;
  }

  return new Sequelize(url, {
    dialect: 'postgres',
    logging: process.env.K8S_PG_WRITE_LOGGING === 'true',
    timezone: '+00:00',
    pool: { max: 2, min: 0, idle: 10000, acquire: 10000 },
    dialectOptions: {
      options: [
        '-c statement_timeout=3000',
        '-c idle_in_transaction_session_timeout=5000',
        '-c application_name=xhunt-pg-write',
      ].join(' '),
    },
  });
}

function getPostgresWriteInstance() {
  if (!pgWriteInstance) pgWriteInstance = createPostgresWriteInstance();
  return pgWriteInstance;
}

async function setupK8sPostgresWriteConnection() {
  const instance = getPostgresWriteInstance();
  await instance.authenticate();
  const [row] = await instance.query(`
    SELECT
      pg_is_in_recovery() AS "inRecovery",
      current_database() AS "databaseName",
      inet_server_addr()::text AS "serverAddr",
      inet_server_port() AS "serverPort",
      current_setting('transaction_read_only') AS "transactionReadOnly"
  `, { type: QueryTypes.SELECT });

  if (row.inRecovery || row.transactionReadOnly === 'on') {
    const error = new Error('[PG Write] expected primary writable database');
    error.code = 'PG_WRITE_NOT_WRITABLE';
    throw error;
  }

  return row;
}
```

---

## 5. 同步服务设计

建议新增服务：

```text
src/xhunt/services/kolMarketingProfileCollaborationSync.js
```

### 5.1 服务职责

- 接收已保存成功的 `XHuntKolCollaboration` 记录。
- 通过 write DB 更新 `dev.kol_marketing_profile`。
- 只更新已存在的 profile 行。
- 返回同步状态，供接口日志和响应排查。

### 5.2 UPDATE SQL

```sql
UPDATE dev.kol_marketing_profile
SET
  collaboration_accepting_new_invitations = $acceptingNewInvitations,
  collaboration_telegram = $telegram,
  collaboration_email = $email,
  collaboration_short_post_price = $shortPostPrice,
  collaboration_short_post_currency = $shortPostCurrency,
  collaboration_thread_price = $threadPrice,
  collaboration_thread_currency = $threadCurrency,
  collaboration_updated_at = $collaborationUpdatedAt,
  collaboration_synced_at = now(),
  collaboration_source = 'echohunt_web'
WHERE twitter_user_id::text = $twitterId
RETURNING twitter_user_id::text AS "twitterUserId";
```

### 5.3 服务伪代码

```js
const { QueryTypes } = require('sequelize');
const { getPostgresWriteInstance } = require('../../infra/k8s/postgres-write');

function toNullableDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

async function syncKolCollaborationToMarketingProfile(record) {
  const json = typeof record.toJSON === 'function' ? record.toJSON() : record;
  const twitterId = String(json.twitterId || '').trim();
  if (!twitterId) return { status: 'skipped', reason: 'TWITTER_ID_REQUIRED' };

  const db = getPostgresWriteInstance();
  const rows = await db.query(`
    UPDATE dev.kol_marketing_profile
    SET
      collaboration_accepting_new_invitations = $acceptingNewInvitations,
      collaboration_telegram = $telegram,
      collaboration_email = $email,
      collaboration_short_post_price = $shortPostPrice,
      collaboration_short_post_currency = $shortPostCurrency,
      collaboration_thread_price = $threadPrice,
      collaboration_thread_currency = $threadCurrency,
      collaboration_updated_at = $collaborationUpdatedAt,
      collaboration_synced_at = now(),
      collaboration_source = 'echohunt_web'
    WHERE twitter_user_id::text = $twitterId
    RETURNING twitter_user_id::text AS "twitterUserId"
  `, {
    bind: {
      twitterId,
      acceptingNewInvitations: Boolean(json.acceptingNewInvitations),
      telegram: json.telegram || null,
      email: json.email || null,
      shortPostPrice: toNullableDecimal(json.shortPostPrice),
      shortPostCurrency: json.shortPostCurrency || 'USDT',
      threadPrice: toNullableDecimal(json.threadPrice),
      threadCurrency: json.threadCurrency || 'USDT',
      collaborationUpdatedAt: json.updatedAt || new Date(),
    },
    type: QueryTypes.SELECT,
  });

  if (!rows.length) {
    return { status: 'skipped', reason: 'PROFILE_NOT_FOUND', twitterId };
  }

  return { status: 'updated', twitterId };
}

module.exports = { syncKolCollaborationToMarketingProfile };
```

---

## 6. 保存接口改造方案

当前接口：

```text
src/xhunt/api/echohunt.js
PUT /me/collaboration
```

当前保存流程：

```text
鉴权
-> 获取 Twitter identity
-> normalize payload
-> pgInstance.transaction 写 XHuntKolCollaboration
-> 返回 serializeKolCollaboration(record)
```

改造后流程：

```text
鉴权
-> 获取 Twitter identity
-> normalize payload
-> pgInstance.transaction 写 XHuntKolCollaboration
-> XHunt 主库提交成功
-> 调 syncKolCollaborationToMarketingProfile(record)
-> 返回 collaboration 数据 + profileSync 状态
```

推荐代码形态：

```js
const { syncKolCollaborationToMarketingProfile } = require('../services/kolMarketingProfileCollaborationSync');

// PUT /me/collaboration 内部
const record = await pgInstance.transaction(...);

let profileSync = { status: 'skipped', reason: 'NOT_ATTEMPTED' };
try {
  profileSync = await syncKolCollaborationToMarketingProfile(record);
} catch (syncError) {
  profileSync = {
    status: 'failed',
    reason: syncError.code || syncError.message || 'PROFILE_SYNC_FAILED',
  };
  console.warn('[EchoHunt Collaboration] sync kol_marketing_profile failed', {
    authCenterUserId: req.authCenter.user.id,
    twitterId: record.twitterId,
    reason: profileSync.reason,
  });
}

res.set('Cache-Control', 'no-store');
return res.json({
  success: true,
  data: serializeKolCollaboration(record),
  profileSync,
});
```

### 6.1 同步失败是否阻塞保存

推荐本期策略：**不阻塞用户保存**。

原因：

1. `XHuntKolCollaborations` 是主存储，不能因为 K8s meta PG 暂时异常导致用户无法维护资料。
2. 两个库无法共用同一个事务；即使同步失败，XHunt 主表也已经提交。
3. 本期前端不展示 KOL 查询结果中的商务字段，同步失败可以通过日志发现并补偿。

如果坤哥要求强一致，可改成：同步失败时接口返回 500，但要接受“XHunt 主表已保存、前端看到失败”的用户体验问题。

---

## 7. 查询结果透出方案

本期后端可以先把字段放进 KOL 查询结果，前端暂不展示。

### 7.1 `src/xhunt/api/echohunt-kol-match.js`

修改 `getKolSelectSql()`，新增选择字段：

```sql
k.collaboration_accepting_new_invitations AS "collaborationAcceptingNewInvitations",
k.collaboration_telegram AS "collaborationTelegram",
k.collaboration_email AS "collaborationEmail",
k.collaboration_short_post_price::text AS "collaborationShortPostPrice",
k.collaboration_short_post_currency AS "collaborationShortPostCurrency",
k.collaboration_thread_price::text AS "collaborationThreadPrice",
k.collaboration_thread_currency AS "collaborationThreadCurrency",
k.collaboration_updated_at AS "collaborationUpdatedAt",
k.collaboration_synced_at AS "collaborationSyncedAt",
k.collaboration_source AS "collaborationSource"
```

修改 `mapKolProfile(row)`，新增：

```js
collaboration: row.collaborationUpdatedAt ? {
  acceptingNewInvitations: row.collaborationAcceptingNewInvitations === true,
  status: row.collaborationAcceptingNewInvitations === true ? 'ACTIVE' : 'PAUSED',
  telegram: row.collaborationTelegram || null,
  email: row.collaborationEmail || null,
  shortPostPrice: row.collaborationShortPostPrice || null,
  shortPostCurrency: row.collaborationShortPostCurrency || 'USDT',
  threadPrice: row.collaborationThreadPrice || null,
  threadCurrency: row.collaborationThreadCurrency || 'USDT',
  updatedAt: toIso(row.collaborationUpdatedAt),
  syncedAt: toIso(row.collaborationSyncedAt),
  source: row.collaborationSource || null,
} : null,
```

### 7.2 `src/xhunt/api/kol-marketing/search-service.js`

如果 KOL Marketing embedding search 也需要透出同样字段，需要在两个 SELECT 分支都补字段：

- `WITH filtered_profiles AS MATERIALIZED (...)` 内部 SELECT
- 最外层 SELECT
- 非 hard filter 分支 SELECT

字段同上。

---

## 8. 部署步骤

### 8.1 后端代码

新增/修改：

```text
src/infra/k8s/postgres-write.js
src/xhunt/services/kolMarketingProfileCollaborationSync.js
src/xhunt/api/echohunt.js
src/xhunt/api/echohunt-kol-match.js
src/xhunt/api/kol-marketing/search-service.js  # 如本期需要 KOL Marketing search 同步透出
scripts/k8s-pg/20260826-add-kol-collaboration-fields-to-marketing-profile.sql
```

### 8.2 K8s 环境变量

不需要修改 K8s deployment 配置。

在实际运行当前后端代码的服务器（例如 `ssh root@150.5.158.179 -p 8864`）配置可写库环境变量即可。推荐使用：

```text
PG_WRITE_DATABASE_URL=postgres://...
```

也支持拆分字段：

```text
PG_WRITE_HOST=...
PG_WRITE_PORT=5432
PG_WRITE_DATABASE=meta
PG_WRITE_USERNAME=...
PG_WRITE_PASSWORD=...
```

注意：`src/infra/k8s/postgres-write.js` 仍兼容 `K8S_PG_WRITE_DATABASE_URL`，但本次部署不要求也不建议修改 K8s deployment env。

### 8.3 数据库变更

1. 先确认 `pg-write` 是 primary：

```sql
select pg_is_in_recovery(), current_setting('transaction_read_only');
```

预期：

```text
pg_is_in_recovery = false
transaction_read_only = off
```

2. 执行 SQL 加字段。
3. 再查询 `information_schema.columns` 验证字段存在。

### 8.4 重启服务

按当前服务部署方式重启 API。项目约定本地不自动启动服务，线上由坤哥控制。

---

## 9. 验证用例

### 9.1 表结构验证

```sql
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='dev'
  and table_name='kol_marketing_profile'
  and column_name like 'collaboration_%'
order by ordinal_position;
```

### 9.2 保存已有 profile 的 KOL

前置：找一个存在于 `dev.kol_marketing_profile` 的 `twitter_user_id`。

调用：

```http
PUT /api/xhunt/echohunt/me/collaboration
```

预期：

```json
{
  "success": true,
  "data": { "status": "ACTIVE" },
  "profileSync": { "status": "updated" }
}
```

DB 验证：

```sql
select
  twitter_user_id,
  collaboration_accepting_new_invitations,
  collaboration_telegram,
  collaboration_email,
  collaboration_short_post_price,
  collaboration_short_post_currency,
  collaboration_thread_price,
  collaboration_thread_currency,
  collaboration_updated_at,
  collaboration_synced_at,
  collaboration_source
from dev.kol_marketing_profile
where twitter_user_id::text = '<twitterId>';
```

### 9.3 保存不存在 profile 的 KOL

预期：

```json
{
  "success": true,
  "profileSync": {
    "status": "skipped",
    "reason": "PROFILE_NOT_FOUND"
  }
}
```

### 9.4 暂停邀约

请求：

```json
{
  "acceptingNewInvitations": false,
  "telegram": "@xxx",
  "email": "kol@example.com",
  "shortPostPrice": "800",
  "shortPostCurrency": "USDT",
  "threadPrice": "1500",
  "threadCurrency": "USDT"
}
```

预期：

```text
collaboration_accepting_new_invitations = false
联系方式和报价按提交值保留
```

### 9.5 KOL 查询结果透出

调用 KOL Match 查询接口，后端结果中的每个 KOL item 可包含：

```json
{
  "collaboration": {
    "acceptingNewInvitations": true,
    "status": "ACTIVE",
    "telegram": "@xxx",
    "email": "kol@example.com",
    "shortPostPrice": "800.00",
    "shortPostCurrency": "USDT",
    "threadPrice": "1500.00",
    "threadCurrency": "USDT",
    "updatedAt": "2026-08-26T...Z",
    "syncedAt": "2026-08-26T...Z",
    "source": "echohunt_web"
  }
}
```

前端本期不展示该字段。

---

## 10. 风险与注意事项

### 10.1 双库非原子事务

`XHuntKolCollaborations` 和 `dev.kol_marketing_profile` 不在同一个数据库事务中，不能做到强原子。

推荐处理：

- XHunt 主表保存成功即为用户保存成功。
- `kol_marketing_profile` 同步失败记录日志。
- 后续如需要强可靠，可加 outbox/retry job。

### 10.2 隐私字段扩大存储范围

Telegram / Email / 报价会复制到 K8s meta PG。需要确认：

- 只有授权后端服务可读。
- 查询接口暂不向非授权角色公开。
- 日志不能打印联系方式和报价明文。

### 10.3 不覆盖 AI 意愿字段

本需求字段代表“本人设置”，不得覆盖 AI 推断字段，否则 KOL Match 现有筛选语义会被污染。

### 10.4 `updated_at` 不自动更新

线上表没有 trigger。本需求新增独立时间字段并显式更新：

```text
collaboration_updated_at
collaboration_synced_at
```

不要为了本需求修改原表 `updated_at` 语义。

---

## 11. 实施清单

1. 新增 SQL 文件，给 `dev.kol_marketing_profile` 添加 `collaboration_*` 字段。
2. 线上通过 `pg-write` 执行 SQL。
3. 新增 `src/infra/k8s/postgres-write.js`。
4. 在运行后端代码的服务器配置 `PG_WRITE_DATABASE_URL` 或 `PG_WRITE_*` 拆分字段；不修改 K8s deployment 配置。
5. 新增 `src/xhunt/services/kolMarketingProfileCollaborationSync.js`。
6. 改造 `PUT /api/xhunt/echohunt/me/collaboration`，保存 XHunt 主表后同步 `dev.kol_marketing_profile`。
7. 修改 KOL Match 查询 SELECT 与 `mapKolProfile`，后端结果透出 `collaboration` 字段。
8. 如需要，修改 KOL Marketing search service 同步透出字段。
9. 本地做静态检查，不自动启动项目。
10. 线上验证：保存接口、DB 字段、KOL 查询结果。

