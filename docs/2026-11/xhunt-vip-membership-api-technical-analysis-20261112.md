# XHunt VIP 统一会员接口与旧 Pro 订阅移除技术分析

> 日期：2026-11-12  
> 状态：已实施代码，待用户确认迁移与部署
> 涉及范围：XHunt 插件 VIP、VIP 管理后台、内部会员服务接口、旧 Pro 订阅链路

## 1. 结论

本次改造应把插件 VIP 从“永久白名单”改为“按 X ID 管理、具有明确过期时间的会员权益”。另一个内部会员服务成为唯一开通来源，管理后台只负责查看，不再直接开通或删除 VIP。

旧 Pro 从未真实上线，不存在需要继续兑现或迁移的订阅权益，因此本次直接完整移除 `XHuntUserProSubscriptions` 体系：

1. 删除 `POST /api/xhunt/stats/grant-pro` 和 `GET /api/xhunt/stats/pro-users` 路由，不保留 410 兼容观察期。
2. 删除旧 Pro 中间件、常量、模型注册、关联关系和所有运行时判断。
3. 数据库迁移直接删除 `XHuntUserProSubscriptions` 表，不保留只读历史表。
4. 从通用 DB 管理和 PostgreSQL 备份白名单中移除该表。
5. 不执行旧 Pro 到新 VIP 的数据迁移或权益补偿。
6. `isPro` 作为兼容响应字段保留，所有需要返回该字段的位置始终返回 `false`，且不能映射为新 VIP 状态。

新 VIP 不依赖定时过期任务。每次鉴权按 `expiresAt > now` 判断，到期后自然返回非 VIP。

## 2. 当前实现

### 2.1 当前 VIP 名单

VIP 和内测用户共用 `xhunt_vip_test_users`：

- `username`：必填，按小写保存。
- `twitterId`：可空，当前不是唯一索引。
- `listType`：`vip` 或 `internal_test`。
- 没有来源、过期时间、订单号和接口开通时间。

`src/xhunt/constants/xhuntVip.js` 在启动时把所有记录加载进内存：

```text
VIP username     -> Set
VIP twitterId    -> Set
内测 username    -> Set
内测 twitterId   -> Set
```

VIP 判断只检查值是否存在，因此当前 VIP 永不过期。多 worker 通过 Redis Pub/Sub 刷新，Redis 不可用时每 60 秒重新加载一次。

管理后台 `VIP / 内测名单管理` 当前可以：

- 添加 VIP 或内测用户；
- 删除记录；
- 修改 X ID；
- 把名单追加到 Nacos 功能开关；
- 把用户设置为认证者；
- 一次性加载全部记录，没有服务端分页。

### 2.2 旧 Pro 未上线但仍残留完整代码链路

`XHuntUserProSubscriptions` 不是纯历史模型，当前代码仍有以下入口或消费者：

| 位置 | 当前行为 | 移除处理 |
| --- | --- | --- |
| `POST /api/xhunt/stats/grant-pro` | 调用 `XHuntUserProSubscription.create()` 写入订阅 | 删除路由 |
| `GET /api/xhunt/stats/pro-users` | 分页读取订阅和有效/过期统计 | 删除路由 |
| `src/xhunt/middleware/pro-status.js` | 查询有效订阅并写入 `req.isPro` | 删除表查询和中间件挂载 |
| Proxy `/public/fetch/twitter/user` | 挂载 `checkProStatus` | 移除旧 Pro 中间件；保留现有 VIP 相关裁剪逻辑 |
| SSE `/feeds` | 挂载 `checkProStatus`，按版本决定是否推送，并在连接事件返回 `isPro` | 删除旧 Pro 判断，保持当前产品实际的开放行为；连接事件固定返回 `isPro: false` |
| Ghost Following | 三个入口挂载 `checkProStatusRequired` | 移除旧 Pro 中间件，额度继续按新 VIP 判断 |
| `/auth/me` | 已固定返回 `isPro: false`，旧代码仅存在于注释 | 删除旧 Pro 注释和计算逻辑，保留 `isPro: false` 兼容字段 |
| 通用 DB 管理 | 当前可发现并管理该表 | 删除表后不得再展示该入口或保留专用配置 |
| PostgreSQL 备份 | 在白名单中备份该表 | 从白名单移除 |

旧 Pro 限制当前由 `PRO_ACCESS_MIN_EXTENSION_VERSION = "99.99.99"` 哨兵值关闭。既然该产品能力从未真实上线，就不能继续依赖哨兵值保留死代码，应完整删除相关链路。

### 2.3 新旧体系不能合并写入同一张订阅表

`XHuntUserProSubscriptions` 使用 `XHuntUser.id` UUID 作为身份键；本次内部会员服务使用 X/Twitter 数字 ID。两者身份键、鉴权链路和产品语义不同。

新接口不能继续写旧 Pro 表，否则会造成：

- 调用方必须先解析 XHuntUser UUID；
- 尚未登录过插件的 X 用户无法开通；
- 新 VIP 与当前 `isRequestXHuntVip()` 判断链路脱节；
- 旧 Pro 中间件可能被意外重新启用；
- 同一会员权益出现两套过期时间和两个真相源。

## 3. 模块设计

所有 VIP 规则集中在一个深模块，例如 `vipMembershipService`。HTTP 路由、管理后台和现有同步鉴权只是适配层，不分别实现到期时间写入、幂等和过期规则。会员结束时间由上游会员服务计算，本服务不计算或累加会员时长，也不根据当前过期时间推导续期结果。

模块对外接口建议保持为：

```text
grant(input)              开通或续期
batchGet(twitterIds)      批量查询
forceExpire(input)        强制过期
listForAdmin(query)       管理后台分页查看
```

模块内部负责：

- X ID 和绝对结束时间校验；
- 订单幂等；
- 并发锁；
- 当前权益更新；
- 操作记录和调用日志；
- 缓存更新和 Redis 广播；
- 管理后台分页序列化。

## 4. 数据模型

### 4.1 扩展现有 VIP 表

第一阶段建议扩展 `xhunt_vip_test_users`，而不是再建第二张当前状态表，避免双真相源。

仅对 `listType = 'vip'` 的行增加以下语义：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `vipExpiresAt` | `TIMESTAMPTZ` | VIP 真实过期时间 |
| `vipOrigin` | `VARCHAR(32)` | `legacy_manual` 或 `membership_api`，首次来源且不可改变 |
| `vipLastApiGrantedAt` | `TIMESTAMPTZ` | 最近一次接口开通成功时间；老 VIP 初始为空 |
| `vipLastApiOrderNo` | `VARCHAR(128)` | 最近一次成功订单号 |
| `vipForceExpiredAt` | `TIMESTAMPTZ` | 最近一次强制过期时间 |

约束建议：

1. VIP 必须有 `vipExpiresAt` 和 `vipOrigin`。
2. 内测用户不要求 VIP 字段。
3. X ID 是新 VIP 的唯一业务身份。
4. 增加 `listType = 'vip' AND twitterId IS NOT NULL` 的 X ID 部分唯一索引。
5. `username` 对接口创建的 VIP 允许为空；可以异步补充显示名，但不能让外部资料查询阻塞开通。

不存储长期维护的 `active/expired` 字段，状态实时计算：

```text
isVip = vipExpiresAt > now
```

### 4.2 VIP 操作表

新增 `xhunt_vip_operations`，记录成功执行的业务命令：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `clientKey` | 调用方 |
| `orderNo` | 外部订单号或操作号 |
| `action` | `grant` / `force_expire` |
| `twitterId` | 目标 X ID |
| `requestedExpiresAt` | 上游要求写入的绝对结束时间，强制过期时为空 |
| `requestHash` | 规范化请求摘要，用于发现订单号复用冲突 |
| `previousExpiresAt` | 操作前过期时间 |
| `resultExpiresAt` | 操作后过期时间 |
| `executedAt` | 实际成功执行时间 |
| `requestId` | 首次成功请求的追踪 ID |
| `responseJson` | 首次成功响应，用于幂等重放 |

唯一约束：

```text
UNIQUE(clientKey, orderNo)
```

### 4.3 接口调用日志

新增 `xhunt_vip_api_call_logs`，每次 HTTP 尝试都记录，包括失败和幂等重放：

- `clientKey`
- `requestId`
- `orderNo`
- `action`
- `twitterId`
- `targetCount`
- `requestHash`
- `httpStatus`
- `errorCode`
- `replayed`
- `durationMs`
- `createdAt`

日志不得保存 Authorization、token、共享密钥或未经处理的完整请求头。

## 5. 内部会员接口

统一前缀：

```text
/api/internal/xhunt/v1/vip
```

### 5.1 开通或续期

```http
POST /api/internal/xhunt/v1/vip/grant
```

```json
{
  "orderNo": "member-order-20261112-0001",
  "twitterId": "1368827101575516161",
  "expiresAt": "2027-05-12T08:00:00.000Z"
}
```

`expiresAt` 是上游会员服务计算后的权威结束时间。本服务不接收天数或小时数，也不执行“从当前时间增加”或“从原过期时间续期”的计算，而是把通过校验的同一绝对时间点写入 `vipExpiresAt`。

时间格式和安全边界：

- 必须使用 ISO 8601，并显式携带 `Z` 或时区偏移；服务端统一转换为 UTC 保存，但不能对该时间点加减或取整。
- `expiresAt` 最早不得小于服务端当前时间加 12 小时，对应最少 0.5 天。
- `expiresAt` 最晚不得超过服务端当前时间加 5 个日历年。
- 不接受等于或早于当前时间的开通请求；立即失效必须调用强制过期接口。

上述 0.5 天至 5 年仅作为请求安全边界：超出范围时原样拒绝，不能截断为边界值，也不能由本服务重新计算一个结束时间。

写入语义：

```text
newExpiresAt = request.expiresAt
```

因此上游可以通过新的权威结束时间延长或缩短会员，本服务只负责校验、幂等落库和执行。响应中的 `previousExpiresAt` 仅用于审计，不参与计算；即使是续期请求，也不能使用 `max(previousExpiresAt, now) + duration` 一类本地规则。

接口不接收 `sourceVersion`，也不根据 `orderNo`、当前过期时间或请求时间比较状态新旧。针对同一个 X ID，每个不同订单都是一条新的权威命令，最后一次成功处理的订单直接覆盖当前 `vipExpiresAt`。例如第一次写入 11 月 12 日，下一次不同订单写入 11 月 9 日，则最终过期时间就是 11 月 9 日。

调用方必须严格控制同一 X ID 的调用顺序，不得并发发送多个不同订单。本服务只保证数据库内串行写入和订单幂等，无法识别上游是否把旧命令延迟发送到了新命令之后；一旦发生乱序，后成功处理的请求仍会覆盖前值。

成功响应：

```json
{
  "success": true,
  "data": {
    "orderNo": "member-order-20261112-0001",
    "twitterId": "1368827101575516161",
    "previousExpiresAt": null,
    "expiresAt": "2027-05-12T08:00:00.000Z",
    "grantedAt": "2026-11-12T08:00:00.000Z",
    "replayed": false
  }
}
```

### 5.2 批量查询

```http
POST /api/internal/xhunt/v1/vip/batch-query
```

```json
{
  "twitterIds": ["1368827101575516161", "1225173132"]
}
```

- 原始数组最多 100 项；不能先去重再绕过限制。
- 服务端内部去重，响应按第一次出现顺序返回。
- 无写操作，不要求订单号。

每个结果区分：

- `active`：当前有效；
- `expired`：存在历史记录但已过期；
- `not_found`：从未存在。

### 5.3 强制过期

```http
POST /api/internal/xhunt/v1/vip/force-expire
```

```json
{
  "requestNo": "vip-force-20261112-0001",
  "twitterId": "1368827101575516161",
  "reason": "risk_control"
}
```

强制过期不删除记录，只把 `vipExpiresAt` 设置为当前时间并写操作流水。已过期用户返回成功和 `changed: false`。

初期只实现和保留接口能力，不向普通会员服务凭证授予 `vip:force-expire` 权限；必要时再单独授权。

## 6. 幂等与并发

订单号是业务幂等键，`X-Request-Id` 是每次 HTTP 尝试的追踪键，两者不能混用。

同一订单的处理规则：

1. 相同 `clientKey + orderNo`、相同 X ID、相同 `expiresAt` 和 action：不重复写入，返回首次成功结果，`replayed: true`。
2. 相同订单号但 X ID、`expiresAt` 或 action 不同：返回 `409 IDEMPOTENCY_CONFLICT`。
3. 前一次因校验、数据库或事务错误未成功提交：允许同一订单重试。
4. 不同订单一律视为新的权威命令，通过校验后直接覆盖当前绝对 `expiresAt`，无论新时间比当前时间更早还是更晚。
5. `orderNo` 是不透明幂等键，不能用于排序或判断订单新旧。

事务执行顺序：

1. 规范化请求并计算 `requestHash`。
2. 通过操作表唯一约束抢占订单。
3. 对目标 X ID 加行锁；不存在时先以唯一索引安全创建，再加锁。
4. 通过行锁或事务级 advisory lock 串行处理同一 X ID 的不同订单，避免并发写入破坏当前状态和操作记录的一致性。
5. 把请求中的绝对 `expiresAt` 原值写入 VIP 当前状态，并记录操作结果。
6. 同一事务提交。
7. 提交后更新当前 worker 缓存并发布 Redis 刷新消息。

幂等必须由 PostgreSQL 唯一约束保证，Redis 只能用于缓存和通知。

这里的“最后一次”指数据库串行后最后成功提交的不同订单，不是客户端发起时间或 `orderNo` 字典顺序。调用方违反串行约定并发请求时，最终结果取决于数据库实际锁定和提交顺序，本服务不提供上游业务顺序纠正。

## 7. 到期判断与缓存

现有 VIP `Set` 改为带过期时间的 Map：

```text
Map<twitterId, expiresAt>
Map<legacyUsername, expiresAt>
```

每次同步判断都检查 `expiresAt > Date.now()`。这样自然到期不依赖定时任务、外部回调或 Redis 刷新。

数据库加载时只需读取：

- 所有内测用户；
- 当前尚未过期的 VIP。

Map 中仍然保存过期时间，因此一条 VIP 即使在加载后才到期，也会在下一次请求时立刻变为非 VIP。

`GET /api/xhunt/auth/me` 当前使用 `private, max-age=240`。该缓存可能让客户端在到期后继续显示最多四分钟的旧状态，建议改为 `no-store` 或显著缩短；服务端受保护功能始终独立实时判断，不能信任客户端缓存的 `isVip`。

## 8. 管理后台

### 8.1 VIP 改为只读分页

新增独立分页接口，不直接破坏现有 `/vip-lists` 返回结构：

```text
GET /api/xhunt/stats/vip-memberships
```

查询参数：

- `page`
- `pageSize`，最大 100
- `status=active|expired|all`
- `origin=legacy_manual|membership_api`
- `keyword`，匹配 X ID 或用户名

页面展示：

- X ID
- 用户名快照
- 当前状态
- 过期时间
- 首次来源
- 最近接口开通成功时间
- 最近订单号
- 强制过期时间
- 创建时间

VIP 页面移除添加、删除、修改 ID、成为认证者和同步功能开关操作。后端对应接口也必须拒绝 `listType=vip`，不能只隐藏前端按钮。

内测名单继续由管理后台维护，保留现有新增、修改和删除能力。本次只关闭 VIP 名单的后台写入，后端写接口应按 `listType` 分流校验，不能影响 `internal_test`。

### 8.2 保持旧名单查询兼容

当前 `/api/xhunt/stats/vip-lists` 被多个后台页面复用，不能直接改成分页响应。兼容接口继续返回原结构，但其中 VIP 只能返回当前有效记录。

### 8.3 Nacos 与 E2E 关联的阶段性处理

Nacos 同步当前把 VIP 追加到金丝雀名单且不会删除；E2E 投放批量授权同样是一次性复制权限，不会随 VIP 到期自动撤销。因此，首期不能直接把新会员接口的开通、续期和到期事件自动同步到这两个系统，否则会产生“VIP 已过期，但派生权限仍永久保留”的状态不一致。

首期处理口径：

- 新会员接口开通或续期 VIP 时，暂不自动同步 Nacos 金丝雀和 E2E 投放权限。
- VIP 自然到期或被强制过期时，也暂不自动修改这两个系统。
- 已经通过旧流程复制到 Nacos 或 E2E 的历史权限保持现状，本次迁移不自动新增或清理。
- 这只是阶段性隔离措施，不代表永久解除 VIP 与这些权限的业务关联。

该关联是明确的后续必做项。后续确认业务触发条件后，应在 VIP 模块之外增加可重试、可审计的同步适配层，并至少解决：

1. 哪些 VIP 状态或来源应获得 Nacos 金丝雀、E2E 投放权限；
2. 开通、续期、缩短、自然到期和强制过期分别如何同步；
3. 同步失败的重试、告警和人工补偿；
4. 定期对账及过期权限回收，避免继续使用只追加不删除的同步方式。

在该后续能力完成前，可能出现“新 VIP 已生效，但没有金丝雀或 E2E 派生权限”的已知差异。遇到实际业务需求时，需要按上述统一关联方案处理，不能恢复无到期回收能力的一次性复制逻辑。

## 9. `XHuntUserProSubscriptions` 完整移除方案

### 9.1 移除定义

旧 Pro 从未真实上线，不存在需要保护的有效会员权益，也不需要为新 VIP 模块保留兼容 seam。完成后应满足：

- `XHuntUserProSubscriptions` 表不存在；
- Sequelize 模型、模型注册和 `XHuntUser` 关联不存在；
- Pro 开通、查询和鉴权路由不存在；
- Proxy、SSE、Ghost Following 等运行时链路不再包含旧 Pro 判断；
- 通用 DB 管理和备份配置不再引用该表；
- 旧 Pro 数据不迁移到新 VIP，也不生成补偿权益。
- 对外响应中的 `isPro` 兼容字段继续存在，但值只能是 `false`。

### 9.2 删除接口与运行时链路

直接删除以下路由，不保留 `410 Gone` 观察期：

- `POST /api/xhunt/stats/grant-pro`
- `GET /api/xhunt/stats/pro-users`

实施时同时：

1. 从 Proxy 的 profile 路由移除 `checkProStatus`。
2. 从 SSE `/feeds` 移除 `checkProStatus` 和 99.99.99 版本门槛判断，保持当前实际开放行为；`connection_established` 事件中的 `isPro` 改为固定 `false`。
3. 从 Ghost Following 的 analyze、quota、following 路由移除 `checkProStatusRequired`；额度继续由 `isRequestXHuntVip()` 决定。
4. 删除 `src/xhunt/middleware/pro-status.js` 和旧 Pro 常量。
5. 删除 `/auth/me` 中旧 Pro 注释和不再使用的 Pro 计算代码，但保留固定为 `false` 的 `isPro` 响应字段。
6. 保留 `applyProDataFiltering` 中仍在使用的 VIP 删帖裁剪；只删除旧付费 Pro 和 legacy Pro 分支，不能整文件删除。
7. 删除 `XHuntUserProSubscription` 模型文件、模型注册和 `XHuntUser` 关联。

路由删除后，请求按普通不存在路由处理。由于该能力从未上线，不再为假定的旧调用方维护兼容响应。

### 9.3 `isPro` 响应兼容规则

删除旧 Pro 实现不等于删除对外响应契约。所有原本需要返回 `isPro` 的位置继续返回该字段，并统一使用字面值 `false`：

- `GET /api/xhunt/auth/me`：保留 `isPro: false`；当前配套的 `proExpiryTime: null`、`isLegacyPro: false` 也保持兼容。
- SSE `/feeds` 的 `connection_established` 事件：保留 `isPro: false`。
- 后续代码中只要响应结构要求 `isPro`，同样只能返回 `false`。

该字段不能读取数据库、不能依赖 `req.isPro`、不能调用旧 Pro 判断，也不能把 `isVip` 映射为 `isPro`。新 VIP 与兼容字段 `isPro` 的语义必须保持独立。

### 9.4 删除数据库表和外围配置

数据库迁移直接执行 `DROP TABLE` 删除 `XHuntUserProSubscriptions`。不再增加只读触发器、表注释或写权限限制，因为删除表本身就是最终保护。

同时删除：

- 通用 DB 管理中的表展示或专用配置；
- PostgreSQL 备份白名单中的表名；
- 仅用于该表恢复、统计或序列化的代码。

这是有意的数据删除。迁移前不需要评估或兑现所谓“未到期订阅”，也不生成旧 Pro 到新 VIP 的迁移清单。down 迁移如需支持回滚，只能重建空表结构，不能承诺恢复已删除数据；生产环境仍由用户确认并执行迁移。

## 10. 旧 VIP 数据迁移

迁移执行时使用同一个数据库时间点：

```text
vipOrigin = legacy_manual
vipExpiresAt = migrationCutoverAt + interval '6 months'
vipLastApiGrantedAt = NULL
vipLastApiOrderNo = NULL
```

上线前必须先检查：

- VIP 是否存在缺失 X ID；
- 同一个 X ID 是否对应多条 VIP；
- X ID 是否全部为纯数字；
- 迁移前后 VIP 数量是否一致。

缺失或重复 X ID 应作为切换阻断项，不能在迁移里静默删除或合并。

## 11. 内部接口认证

新接口使用独立服务凭证，不使用随机路径作为安全措施：

- `X-Client-Key`
- `Authorization: Bearer <service token>`
- `X-Request-Id`
- HTTPS 或内网网关
- token 哈希存储和可轮换
- 调用频率限制

权限范围：

- `vip:grant`
- `vip:read`
- `vip:force-expire`

初期会员服务只授予 `vip:grant` 和 `vip:read`。

实现使用以下环境变量注入哈希凭证和限流，不保存明文 token：

```text
XHUNT_VIP_SERVICE_CREDENTIALS=[{"clientKey":"membership-service","tokenHash":"<sha256-hex>","scopes":["vip:grant","vip:read"]}]
XHUNT_VIP_API_RATE_LIMIT_PER_MINUTE=120
```

凭证数组允许同一 `clientKey` 暂时配置多个 token 哈希，以便无中断轮换。`vip:force-expire` 只应配置给单独的高权限凭证。

## 12. 发布顺序

1. 只读检查现有 VIP 的 X ID 完整性和重复情况。
2. 完整移除旧 Pro 路由、中间件、常量、模型、关联及调用方判断。
3. 执行数据库迁移：VIP 字段、操作表、调用日志表、唯一索引，并删除旧 Pro 表。
4. 从通用 DB 管理和 PostgreSQL 备份白名单中移除旧 Pro 表。
5. 部署 VIP 模块、三个内部接口和精确到期缓存判断。
6. 部署管理后台只读分页页面及后端写入拦截。
7. 让内部会员服务开始调用新接口。
8. 观察接口调用、幂等重放、缓存刷新和过期行为。
9. 验证首期新 VIP 不会意外写入 Nacos 金丝雀或 E2E 投放权限，并记录尚未实现统一关联的已知差异。

迁移和部署命令由用户在对应环境确认后执行；本方案不授权自动修改生产环境。

## 13. 测试重点

### 13.1 VIP 模块

- `expiresAt` 距当前不足 12 小时拒绝，刚好 12 小时通过。
- `expiresAt` 为当前时间加 5 个日历年通过，超过后拒绝。
- 缺少时区的时间字符串拒绝，带偏移的时间正确转换为 UTC。
- 已过期、不存在和未过期用户都精确写入上游给定的 `expiresAt`，本服务不累加时长。
- 同一 X ID 先用一个订单写入 11 月 12 日、再用另一个订单写入 11 月 9 日时，最终值为 11 月 9 日。
- 不同订单的新 `expiresAt` 无论早于还是晚于当前值，都会按成功处理顺序覆盖。
- 相同订单重复三次只写入一次。
- 相同订单不同参数返回 409。
- `orderNo` 不参与排序，不同订单不会因为编号大小被拒绝。
- 同一 X ID 的不同订单被数据库串行处理，操作记录中的前后值和最终状态一致。
- 100 人批量查询通过，101 人拒绝。
- 到期临界点 `expiresAt === now` 返回非 VIP。
- 强制过期幂等、再次开通可恢复。

### 13.2 旧 Pro 移除

- `grant-pro` 和 `pro-users` 路由不存在。
- `XHuntUserProSubscriptions` 表、模型注册和关联不存在。
- 通用 DB 管理和 PostgreSQL 备份配置不再引用旧 Pro 表。
- Proxy、SSE、Ghost Following 不再包含旧 Pro 查询或判断。
- `/auth/me` 始终返回 `isPro: false`，并继续返回 `proExpiryTime: null`、`isLegacyPro: false`。
- SSE `/feeds` 的 `connection_established` 事件始终返回 `isPro: false`。
- `isPro` 不会因用户是 VIP 而变成 `true`。
- Ghost Following 的 VIP 配额仍按新 VIP 正常工作。
- VIP 删帖裁剪不受删除旧 Pro 分支影响。
- 全仓库不存在可执行的旧 Pro 开通、查询或鉴权链路。

### 13.3 管理后台

- VIP 列表服务端分页、筛选和搜索正确。
- 管理后台不存在 VIP 添加、删除和改 ID入口。
- 绕过前端直接请求旧 VIP 写接口仍被拒绝。
- 老 VIP 来源、过期时间和接口开通时间展示正确。
- 新会员接口开通、续期或过期 VIP 时，首期不会自动改动 Nacos 金丝雀和 E2E 投放权限。
- 内测名单的新增、修改和删除仍可正常使用。

## 14. 预计改动范围

| 范围 | 预计改动 |
| --- | --- |
| PostgreSQL migrations | VIP 字段、操作表、调用日志表、唯一索引、删除旧 Pro 表 |
| VIP 模型与缓存 | 有效期、来源、订单字段和 Map 过期判断 |
| 新内部路由 | grant、batch-query、force-expire 和服务认证 |
| `stats-routes/vip-lists.js` | 新分页查询、禁止管理后台写 VIP、兼容旧读取结构 |
| `VipManagementPage.tsx` | VIP 只读表格、分页、筛选、来源与时间展示 |
| `stats.js` | 删除旧 Pro 开通和查询路由 |
| `pro-status.js` 及调用方 | 移除旧 Pro 查询和中间件挂载 |
| `auth.js` | 清理旧 Pro 计算和注释代码，保留固定为 `false` 的 `isPro` 兼容字段 |
| `sse.js` | 移除旧 Pro 门槛判断，连接事件固定返回 `isPro: false` |
| 模型与关联 | 删除 `XHuntUserProSubscription` 模型、注册和关联 |
| DB Admin 与备份配置 | 移除旧 Pro 表引用 |
| 测试 | 幂等、并发、到期、旧 Pro 完整移除和回归测试 |

## 15. 已确认业务口径

已确认：

1. 开通和续期不传递时长，统一传递上游计算好的绝对 `expiresAt`。
2. 上游会员服务是结束时间的权威来源，本服务不执行时长累加、时间截断或续期推导。
3. 合法的新状态可以延长或缩短当前会员，以请求中的绝对结束时间为准。
4. 0.5 天至 5 年只作为合法范围校验；越界请求被拒绝，不由本服务修正。
5. 管理后台只关闭 VIP 写入；内测名单继续保留新增、修改和删除能力。
6. 首期新 VIP 暂不自动同步 Nacos 金丝雀或 E2E 投放权限；这不是永久解除，后续必须补充包含到期回收、重试和对账能力的统一关联方案。
7. 旧 Pro 从未真实上线，无需保留历史数据、开通/查询接口或权益补偿；代码链路和 `XHuntUserProSubscriptions` 表直接完整移除。
8. 不使用 `sourceVersion`；调用方负责同一 X ID 的严格调用顺序，不同订单按本服务最后成功处理者直接覆盖当前过期时间。
9. `isPro` 是保留的响应兼容字段，所有需要返回它的位置始终返回 `false`，且与 `isVip` 无关。
