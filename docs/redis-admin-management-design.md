# Redis 数据管理功能设计文档

## 1. 功能概述

### 1.1 需求背景

后台管理需要能够直接查询、修改和删除 Redis 中的数据，以便于：
- 快速排查缓存相关问题
- 临时调整配置值
- 清理异常或过期的缓存数据
- 监控系统关键缓存状态

### 1.2 功能目标

提供一个安全的后台管理界面，允许超级管理员（super）对 Redis 数据进行：
- 按 Key 查询数据
- 修改 String 类型的值
- 删除指定的 Key
- 查看 Key 的 TTL 和类型信息

---

## 2. 页面位置设计

### 2.1 位置选择

建议将 Redis 管理功能放在 **后台管理页面的侧边栏导航** 中，作为一个独立的 Tab：

```
侧边栏导航结构：
├── 数据概览
├── 日活详情
├── 在线用户
├── 用户留存
├── Rootdata
├── 备注查看
├── 日志搜索
├── 设备监控
├── 版本统计
├── 接口统计
├── 公告配置
├── Earn活动
├── 功能开关
├── 点评管理
├── 私信管理
├── 系统管理
│   ├── 管理员列表
│   ├── 操作日志
│   └── Redis管理  ← 新增
```

### 2.2 选择理由

1. **功能归属性**: Redis 管理属于系统级功能，与"管理员列表"、"操作日志"同属系统管理范畴
2. **权限控制**: 只有 super 管理员才能访问，与其他系统管理功能保持一致
3. **使用频率**: 属于低频但重要的运维功能，放在二级菜单避免干扰日常操作
4. **扩展性**: 未来可在此菜单下扩展更多系统级功能（如数据库查询、日志级别调整等）

---

## 3. 权限设计

### 3.1 访问权限

| 角色 | 权限 |
|------|------|
| super | 完全访问（查询、修改、删除） |
| admin | 无权限访问 |

### 3.2 权限控制实现

```javascript
// 使用现有的权限检查机制
router.get('/system/redis', adminAuth, requireRole('super'), ...)
```

### 3.3 审计日志

所有 Redis 操作（查询除外）需要记录审计日志：
- 操作类型（修改、删除）
- Key 名称
- 操作前后的值（修改时）
- 操作人
- 操作时间
- IP 地址

---

## 4. 界面设计

### 4.1 页面布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Redis 数据管理                                    [刷新]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Key 搜索: [________________________] [查询] [重置]     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  查询结果                                                │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ Key: user:session:abc123                          │   │   │
│  │  │ Type: string                                      │   │   │
│  │  │ TTL: 3600s (剩余 29分钟)                          │   │   │
│  │  │ Size: 1.2 KB                                      │   │   │
│  │  ├─────────────────────────────────────────────────┤   │   │
│  │  │ Value:                                          │   │   │
│  │  │ ┌─────────────────────────────────────────────┐ │   │   │
│  │  │ │ {                                           │ │   │   │
│  │  │ │   "userId": "xxx",                          │ │   │   │
│  │  │ │   "username": "test"                        │ │   │   │
│  │  │ │ }                                           │ │   │   │
│  │  │ └─────────────────────────────────────────────┘ │   │   │
│  │  │                                                 │   │   │
│  │  │ [编辑值] [删除Key]                              │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  最近查询历史                                          │   │
│  │  • user:session:abc123 (刚刚)                          │   │
│  │  • admin:pwdreset:xxx@example.com (5分钟前)            │   │
│  │  • rate_limit:192.168.1.1 (10分钟前)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 编辑对话框

```
┌──────────────────────────────────────────┐
│  编辑 Redis Value                    [X] │
├──────────────────────────────────────────┤
│                                          │
│  Key: user:session:abc123                │
│  Type: string                            │
│                                          │
│  Value:                                  │
│  ┌────────────────────────────────────┐  │
│  │ {                                  │  │
│  │   "userId": "xxx",                 │  │
│  │   "username": "test"               │  │
│  │ }                                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  新 TTL (秒, 可选): [________]           │
│  留空表示保持原有 TTL，-1 表示永不过期   │
│                                          │
│         [取消]      [确认保存]           │
│                                          │
└──────────────────────────────────────────┘
```

---

## 5. API 设计

### 5.1 接口列表

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/admin/system/redis/query` | 查询指定 Key 的值 | super |
| POST | `/api/admin/system/redis/update` | 修改 String 类型的值 | super |
| DELETE | `/api/admin/system/redis/delete` | 删除指定的 Key | super |
| GET | `/api/admin/system/redis/keys` | 按前缀扫描 Keys（限制数量） | super |

### 5.2 接口详情

#### 5.2.1 查询 Key

```http
GET /api/admin/system/redis/query?key=user:session:abc123
```

响应：
```json
{
  "success": true,
  "data": {
    "key": "user:session:abc123",
    "type": "string",
    "ttl": 3600,
    "size": 1234,
    "value": "{\"userId\": \"xxx\", \"username\": \"test\"}",
    "valueFormatted": {
      "userId": "xxx",
      "username": "test"
    }
  }
}
```

#### 5.2.2 修改 Value

```http
POST /api/admin/system/redis/update
Content-Type: application/json

{
  "key": "user:session:abc123",
  "value": "{\"userId\": \"xxx\", \"username\": \"newname\"}",
  "ttl": 3600
}
```

响应：
```json
{
  "success": true,
  "message": "更新成功"
}
```

#### 5.2.3 删除 Key

```http
DELETE /api/admin/system/redis/delete
Content-Type: application/json

{
  "key": "user:session:abc123"
}
```

响应：
```json
{
  "success": true,
  "message": "删除成功"
}
```

#### 5.2.4 扫描 Keys（可选）

```http
GET /api/admin/system/redis/keys?pattern=user:session:*&count=50
```

响应：
```json
{
  "success": true,
  "data": {
    "keys": [
      "user:session:abc123",
      "user:session:def456"
    ],
    "count": 2
  }
}
```

### 5.3 安全措施

1. **Key 白名单检查（可选）**: 可以配置禁止操作的关键 Key 前缀（如 `admin:session:*`）
2. **操作确认**: 删除操作需要二次确认
3. **速率限制**: 限制 API 调用频率，防止误操作或恶意扫描
4. **敏感数据处理**: 自动识别并脱敏敏感信息（如密码哈希、Token 等）

---

## 6. 技术实现

### 6.1 后端实现

新增文件：
```
src/admin/api/redis.js          # Redis 管理 API 路由
```

修改文件：
```
src/admin/api/admin.js          # 添加系统管理子路由挂载
src/xhunt/views/stats.ejs       # 添加侧边栏菜单项和对应 Tab 内容
public/static/js/stats.js       # 添加前端交互逻辑（或新建 redis-tab.js）
```

### 6.2 核心代码示例

```javascript
// src/admin/api/redis.js
const express = require('express');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const { getRedisClient } = require('../../lib/redisClient');
const { XhuntAdminAuditLog } = require('../../models/postgres-start');

const router = express.Router();

// 查询 Key
router.get('/query', adminAuth, requireRole('super'), async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) {
      return res.status(400).json({ success: false, error: '缺少 key 参数' });
    }

    const redis = await getRedisClient();
    const type = await redis.type(key);
    
    if (type === 'none') {
      return res.json({ success: true, data: null });
    }

    const ttl = await redis.ttl(key);
    let value;
    
    switch (type) {
      case 'string':
        value = await redis.get(key);
        break;
      case 'hash':
        value = await redis.hGetAll(key);
        break;
      case 'list':
        value = await redis.lRange(key, 0, 99);
        break;
      case 'set':
        value = await redis.sMembers(key);
        break;
      case 'zset':
        value = await redis.zRangeWithScores(key, 0, 99);
        break;
      default:
        value = `[不支持的数据类型: ${type}]`;
    }

    const size = Buffer.from(JSON.stringify(value)).length;

    res.json({
      success: true,
      data: {
        key,
        type,
        ttl: ttl > 0 ? ttl : null,
        size,
        value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        valueFormatted: value
      }
    });
  } catch (err) {
    console.error('[redis admin] query error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 修改 Value（仅支持 string 类型）
router.post('/update', adminAuth, requireRole('super'), express.json(), async (req, res) => {
  try {
    const { key, value, ttl } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const redis = await getRedisClient();
    
    // 获取旧值用于审计日志
    const oldValue = await redis.get(key);
    
    // 设置新值
    if (ttl !== undefined && ttl > 0) {
      await redis.set(key, value, { EX: ttl });
    } else {
      await redis.set(key, value);
    }

    // 记录审计日志
    await XhuntAdminAuditLog.create({
      adminId: req.adminUser.id,
      email: req.adminUser.email,
      action: 'redis-update',
      route: '/admin/system/redis/update',
      method: 'POST',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      success: true,
      message: JSON.stringify({ key, oldValue: oldValue?.slice(0, 500), newValue: value?.slice(0, 500) })
    });

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    console.error('[redis admin] update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除 Key
router.delete('/delete', adminAuth, requireRole('super'), express.json(), async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ success: false, error: '缺少 key 参数' });
    }

    const redis = await getRedisClient();
    
    // 获取旧值用于审计日志
    const oldValue = await redis.get(key);
    
    await redis.del(key);

    // 记录审计日志
    await XhuntAdminAuditLog.create({
      adminId: req.adminUser.id,
      email: req.adminUser.email,
      action: 'redis-delete',
      route: '/admin/system/redis/delete',
      method: 'DELETE',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      success: true,
      message: JSON.stringify({ key, oldValue: oldValue?.slice(0, 500) })
    });

    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('[redis admin] delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```

### 6.3 前端实现

在 `stats.ejs` 中添加新的 Tab：

```html
<!-- 侧边栏添加菜单 -->
<button class="tab-btn" data-tab="system">
  <svg class="nav-icon-svg"><use href="#icon-settings"/></svg>
  <span class="nav-text">系统管理</span>
</button>

<!-- Tab 内容 -->
<div class="tab-content" id="tab-system">
  <div class="system-tabs">
    <button class="sub-tab-btn active" data-subtab="redis">Redis 管理</button>
    <button class="sub-tab-btn" data-subtab="admin-users">管理员列表</button>
    <button class="sub-tab-btn" data-subtab="audit-logs">操作日志</button>
  </div>
  
  <div class="sub-tab-content" id="subtab-redis">
    <!-- Redis 管理界面 -->
  </div>
</div>
```

---

## 7. 风险与安全考虑

### 7.1 风险评估

| 风险 | 等级 | 应对措施 |
|------|------|----------|
| 误删关键数据 | 高 | 二次确认对话框；敏感 Key 前缀警告 |
| 泄露敏感信息 | 中 | 自动脱敏敏感字段；仅 super 可访问 |
| 性能影响 | 低 | 限制 Value 显示大小；限制扫描数量 |
| 误修改配置 | 中 | 修改前显示原值对比；审计日志 |

### 7.2 敏感 Key 前缀列表

以下前缀的 Key 操作时显示警告：
- `admin:*` - 管理员相关
- `webauthn:*` - 认证相关
- `jwt:*` - Token 相关
- `session:*` - 会话相关
- `password:*` - 密码相关

---

## 8. 开发计划

### 8.1 开发阶段

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 1 | 后端 API 开发 | 0.5 天 |
| 2 | 前端界面开发 | 0.5 天 |
| 3 | 测试与优化 | 0.5 天 |

### 8.2 文件变更清单

**新增文件：**
- `src/admin/api/redis.js` - Redis 管理 API

**修改文件：**
- `src/admin/api/admin.js` - 挂载 Redis 路由
- `src/xhunt/views/stats.ejs` - 添加界面元素
- `public/static/css/stats.css` - 添加样式
- `public/static/js/stats.js` - 添加交互逻辑

---

## 9. 后续扩展建议

1. **批量操作**: 支持批量删除、批量修改 TTL
2. **导入导出**: 支持将 Redis 数据导出为 JSON，或从 JSON 导入
3. **监控面板**: 显示 Redis 整体状态（内存使用、连接数、命中率等）
4. **Key 分析**: 统计 Key 前缀分布、大 Key 检测
5. **命令行模式**: 支持直接执行 Redis 命令（风险较高，需谨慎）

---

## 10. 总结

本设计将 Redis 管理功能集成到现有的后台管理页面中，作为一个系统管理子模块，仅对 super 管理员开放。通过：

1. **合理的页面位置**: 放在"系统管理"分类下，与管理员列表、操作日志同级
2. **完善的权限控制**: 仅 super 可访问，所有操作记录审计日志
3. **友好的用户界面**: 提供搜索、查看、编辑、删除的完整流程
4. **安全的设计**: 敏感操作二次确认，敏感 Key 警告，自动脱敏

实现一个安全、易用的 Redis 数据管理功能。
