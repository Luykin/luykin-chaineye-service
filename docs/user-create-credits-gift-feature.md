# User Create 积分赠送功能文档

## 功能概述

当管理员通过代理接口创建新用户时 (`POST /pro/admin/user/create`)，系统会自动为该用户赠送初始积分。积分数量根据用户的活跃度和排名动态计算。

## 触发条件

- **请求路径**: `/pro/admin/user/create`
- **请求方法**: `POST`
- **触发时机**: 原请求成功返回之前

## 积分计算规则

### 计算公式

```
总积分 = 基础额度 + 登录奖励 + 排名奖励
```

### 1. 基础额度

- **固定值**: `200` 积分

### 2. 登录奖励

根据用户过去 30 天的登录活跃天数计算：

| 条件 | 计算方式 |
|------|----------|
| 过去30天登录天数 × 50 | 基础奖励 |
| 上限 | 最高 `800` 积分 |

**公式**: `min(过去30天登录天数 × 50, 800)`

### 3. 排名奖励（三档互斥，取最高档）

| 排名区间 | 奖励积分 |
|----------|----------|
| 前 1 万名 (`kolRank20W <= 10000`) | `1000` 积分 |
| 前 5 万名 (`kolRank20W <= 50000`) | `600` 积分 |
| 前 10 万名 (`kolRank20W <= 100000`) | `200` 积分 |
| 未上榜或排名 > 10万 | `0` 积分 |

### 计算示例

| 过去30天登录天数 | KOL排名 | 基础 | 登录奖励 | 排名奖励 | **总计** |
|------------------|---------|------|----------|----------|----------|
| 0天 | 未上榜 | 200 | 0 | 0 | **200** |
| 10天 | 未上榜 | 200 | 500 | 0 | **700** |
| 20天 | 前10万 | 200 | 800 | 200 | **1200** |
| 16天 | 前5万 | 200 | 800 | 600 | **1600** |
| 5天 | 前1万 | 200 | 250 | 1000 | **1450** |
| 30天 | 前1万 | 200 | 800 | 1000 | **2000** |

## 外部 API 调用

### 接口信息

| 项目 | 值 |
|------|-----|
| **URL** | `https://data.cryptohunt.ai/pro/admin/user/addCredits` |
| **方法** | `POST` |
| **Content-Type** | `application/json` |

### 请求参数

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `address` | string | 请求体 `address` | 用户钱包地址 |
| `tx` | string | Header 拼接 | `x-user-id` + `x-request-id` |
| `credits` | number | 计算得出 | 赠送积分数量 |
| `operation` | string | 固定值 | `"gift"` |

### 请求示例

```json
{
  "address": "0x46169b3b8c5bad72dec14897395fdc4bbf89cf5f",
  "tx": "user_abc123req_xyz789",
  "credits": 1450,
  "operation": "gift"
}
```

## 数据来源

### 1. 登录天数统计

**表**: `DailyActiveUsers`

**查询逻辑**: 统计该用户在过去30天内（含当日）有活跃记录的日期数量

```sql
SELECT COUNT(DISTINCT date) as active_days
FROM "DailyActiveUsers"
WHERE "userId" = :username
  AND date >= CURRENT_DATE - 30 * INTERVAL '1 day'
```

### 2. 用户排名

**表**: `XHuntUsers`

**字段**: `kolRank20W`

**说明**: 该字段存储用户在20万KOL中的排名，数值越小排名越靠前。

## 实现位置

**文件**: `src/xhunt/api/proxy.js`

**修改点**: 在 `/public/*` 或 `/auth/*` 路由处理中，针对 `/pro/admin/user/create` 路径添加特殊处理逻辑。

## 注意事项

1. **异步处理**: 积分赠送请求在原请求成功返回之前执行，但不应阻塞原请求的响应
2. **错误处理**: 积分赠送失败不应影响原请求的成功返回，仅记录错误日志
3. **重复调用**: 如用户已存在，`/pro/admin/user/create` 可能返回用户已存在的错误，此时不应赠送积分
4. **性能考虑**: 涉及数据库查询，需确保在可接受的时间内完成

## 相关代码参考

### 登录天数查询参考

文件: `src/script/DailyActiveUser.js`

```javascript
// 查询近 N 天活跃用户
const rows = await pgInstance.query(
  `SELECT
      u."username" AS handler,
      COUNT(d."date") AS activedays
   FROM "DailyActiveUsers" d
   JOIN "XHuntUsers" u ON u."username" = d."userId"
   WHERE d."date" >= CURRENT_DATE - (:days::int) * INTERVAL '1 day'
   GROUP BY u."username"`,
  { type: Sequelize.QueryTypes.SELECT, replacements: { days: 30 } }
);
```

### 用户排名查询参考

字段位于 `XHuntUsers.kolRank20W`，直接使用 Sequelize 查询即可：

```javascript
const user = await XHuntUser.findOne({
  where: { username: userId }
});
const kolRank = user?.kolRank20W;
```
