# Ghost Following 额度管理系统 设计方案

> 用于用户分析 Twitter 关注列表中不活跃账号的额度控制机制

---

## 1. 功能概述

帮助用户分析 Twitter 关注列表中不活跃的账号。由于需要逐个查询账号活跃度，设计额度系统限制调用频率，防止滥用。

---

## 2. 核心规则

| 规则项 | 说明 |
|--------|------|
| 申请周期 | 每 30 天一个周期 |
| 普通用户额度 | 2,000 次/周期 |
| VIP 用户额度 | 5,000 次/周期 |
| 存储介质 | Redis |
| 申请方式 | **自动申请**（用户无感知） |

### 2.1 自动申请规则

| 场景 | 行为 |
|------|------|
| 从未申请过额度 | 自动申请并执行 |
| 上次申请 > 30天 | 自动申请（覆盖旧额度）并执行 |
| 有剩余额度 | 直接扣减执行 |
| **30天内申请过且额度用完** | **拒绝，告知还需等待 X 天** |

---

## 3. Redis 数据结构设计

```javascript
// 主额度记录（30天TTL）
Key:    xhunt:ghost:{userId}:quota
Field:  remaining   // 剩余额度 (number)
Field:  total       // 总额度 (number)
Field:  appliedAt   // 申请时间戳 (number, Unix ms)
TTL:    30天（精确到秒）

// 持久化申请记录（用于计算冷却期）
Key:    xhunt:ghost:{userId}:history
Field:  lastAppliedAt   // 上次申请时间
Field:  totalUsed       // 累计使用（统计用）
```

---

## 4. 接口设计

### 4.1 消费额度接口（自动申请 + 分析）

```
POST /api/xhunt/ghost-following/analyze
```

**Headers:**
```
Authorization: Bearer {JWT}
```

**Body:**
```json
{
  "targetUsername": "some_user"
}
```

#### 响应示例

**情况1: 有剩余额度，直接执行**
```json
{
  "success": true,
  "data": {
    "quota": {
      "total": 2000,
      "remaining": 1899,
      "appliedAt": 1741228800000,
      "expiresInDays": 25
    },
    "result": {
      // 活跃度分析结果（待实现）
    }
  }
}
```

**情况2: 首次使用，自动申请成功并执行**
```json
{
  "success": true,
  "data": {
    "quota": {
      "total": 5000,
      "remaining": 4999,
      "appliedAt": 1741228800000,
      "isNewQuota": true,
      "expiresInDays": 30
    },
    "result": {
      // 分析结果
    }
  }
}
```

**情况3: 30天内已用完，冷却中**
```json
{
  "success": false,
  "error": {
    "code": "QUOTA_COOLDOWN",
    "message": "本月额度已用完",
    "data": {
      "total": 2000,
      "used": 2000,
      "nextApplyAt": 1743820800000,
      "waitDays": 12,
      "waitHours": 288
    }
  }
}
```

---

### 4.2 查询额度接口

```
GET /api/xhunt/ghost-following/quota
```

**Headers:**
```
Authorization: Bearer {JWT}
```

#### 响应示例

**有额度状态**
```json
{
  "success": true,
  "data": {
    "status": "active",
    "quota": {
      "total": 5000,
      "remaining": 3200,
      "used": 1800
    },
    "appliedAt": 1741228800000,
    "expiresAt": 1743820800000,
    "nextApplyAt": null,
    "progress": {
      "analyzed": 1800,
      "totalFollowing": 2500
    }
  }
}
```

**额度已用完，冷却中**
```json
{
  "success": true,
  "data": {
    "status": "cooldown",
    "quota": {
      "total": 2000,
      "remaining": 0,
      "used": 2000
    },
    "appliedAt": 1741228800000,
    "expiresAt": 1743820800000,
    "nextApplyAt": 1743820800000,
    "waitDays": 12
  }
}
```

**状态枚举:**
- `active` - 有剩余额度可用
- `exhausted` - 额度已用完但在30天内（冷却中）
- `cooldown` - 30天周期内额度已用完
- `none` - 从未申请过额度

---

## 5. 错误码汇总

| Code | 说明 | HTTP Status |
|------|------|-------------|
| `QUOTA_COOLDOWN` | 本月额度已用完，需等待 | 403 |
| `INVALID_TARGET` | 目标账号格式错误 | 400 |
| `RATE_LIMITED` | 接口调用过于频繁 | 429 |

---

## 6. 业务流程

### 6.1 状态流转图

```
用户首次调用 analyze
        │
        ▼
┌───────────────┐
│  从未申请过？  │ ──是──→ 自动申请额度 ──→ 扣减1次 ──→ 执行分析
└───────────────┘
        │ 否
        ▼
┌───────────────┐
│  超过30天？    │ ──是──→ 自动申请新额度 ──→ 扣减1次 ──→ 执行分析
└───────────────┘
        │ 否
        ▼
┌───────────────┐
│  还有剩余额度？ │ ──是──→ 扣减1次 ──→ 执行分析
└───────────────┘
        │ 否
        ▼
   返回 QUOTA_COOLDOWN
   （本月额度已用完，X天后恢复）
```

### 6.2 消费接口核心逻辑（伪代码）

```javascript
async function analyze(req, res) {
  const userId = req.user.id;
  const isVip = await checkVip(userId);
  const quotaKey = `xhunt:ghost:${userId}:quota`;
  const historyKey = `xhunt:ghost:${userId}:history`;
  
  // 1. 检查现有额度
  let quota = await redis.hgetall(quotaKey);
  
  if (quota && quota.remaining > 0) {
    // 有额度，直接扣减执行
    const newRemaining = await redis.hincrby(quotaKey, 'remaining', -1);
    return executeAnalyze(req, res, quota, newRemaining);
  }
  
  // 2. 无额度或额度为0，检查是否符合申请条件
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  
  // 获取上次申请时间（从历史记录或现有额度）
  let lastAppliedAt = quota?.appliedAt || await redis.hget(historyKey, 'lastAppliedAt');
  
  if (!lastAppliedAt || (now - lastAppliedAt) >= thirtyDays) {
    // 可以申请新额度
    const newQuota = {
      total: isVip ? 5000 : 2000,
      remaining: isVip ? 4999 : 1999,  // 扣除本次
      appliedAt: now
    };
    
    await redis.hset(quotaKey, newQuota);
    await redis.expire(quotaKey, 30 * 24 * 60 * 60);  // 30天TTL
    
    // 更新历史记录
    await redis.hset(historyKey, 'lastAppliedAt', now);
    
    return executeAnalyze(req, res, newQuota, newQuota.remaining, true);
  }
  
  // 3. 30天内已申请过，且额度用完（或无额度）→ 拒绝
  const nextApplyAt = parseInt(lastAppliedAt) + thirtyDays;
  const waitMs = nextApplyAt - now;
  const waitDays = Math.ceil(waitMs / (24 * 60 * 60 * 1000));
  
  return res.status(403).json({
    success: false,
    error: {
      code: "QUOTA_COOLDOWN",
      message: "本月额度已用完",
      data: {
        total: quota ? parseInt(quota.total) : (isVip ? 5000 : 2000),
        used: quota ? parseInt(quota.total) : 0,
        nextApplyAt,
        waitDays,
        waitHours: Math.ceil(waitMs / (60 * 60 * 1000))
      }
    }
  });
}
```

---

## 7. 关键技术点

| 问题 | 解决方案 |
|------|----------|
| 额度扣减原子性 | 使用 Redis `DECR` / `HINCRBY` 命令保证原子性 |
| 如何区分"从没申请"和"申请完用完了" | 用 `history` 记录持久化保存 `lastAppliedAt` |
| 额度30天后处理 | Redis TTL 机制，30天后自动清空，下次使用时重新申请 |
| VIP状态变化 | 下次申请时按最新VIP状态计算额度 |
| 批量分析扣减 | 逐个调用，每个 username 独立扣减1次额度 |

---

## 8. 文件结构

```
src/xhunt/
└── api/
    └── ghost-following.js      # 本模块路由实现
```

---

## 9. 后续扩展建议

1. **批量分析优化**：支持一次请求传入多个 username，内部循环扣减，返回批量结果
2. **分析结果缓存**：已分析过的账号结果缓存7天，相同账号不重复扣减额度
3. **中断恢复**：记录分析进度到 Redis，支持断点续传
4. **导出功能**：分析完成后支持导出 CSV/JSON 格式的僵尸账号列表
5. **额度购买**：允许用户购买额外额度（不重置30天周期）

---

## 10. 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-03-06 | v1.0 | 初始设计方案，简化申请流程为自动申请 |
