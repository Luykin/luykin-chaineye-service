# 开发文档：自定义支持任务类型（Custom Task）

## 1. 概述

新增任务类型 `type: "custom"`，用于需要跳转第三方页面完成、并由第三方 API 判断完成状态的场景。

**核心特点**：
- 配置时仅需填写标题（中英文）
- URL 和 autoComplete 由系统自动处理
- 后端根据 `campaign` 动态决定调用哪个第三方服务

---

## 2. 配置数据结构

### 2.1 Nacos 任务配置（管理后台页面）

```json
{
  "tasks": [
    {
      "id": "bybit-custom-xxx",
      "type": "custom",
      "title": { 
        "zh": "完成指定任务", 
        "en": "Complete the task" 
      },
      "url": "https://",
      "autoComplete": false
    }
  ]
}
```

**配置规则**：

| 字段 | 值 | 说明 |
|------|----|----|
| `type` | `"custom"` | 标识为自定义支持类型 |
| `url` | `"https://"` | 固定占位，实际链接由后端接口返回 |
| `autoComplete` | `false` | 禁用自动完成 |

---

## 3. 管理后台页面改动

**文件路径**: `src/xhunt/views/partials/nacos-campaigns.ejs`

### 3.1 任务类型下拉框增加选项

在任务卡片的 type 下拉框中增加 `custom` 选项：

```html
<select data-field="type">
  <option value="twitter">twitter</option>
  <option value="telegram">telegram</option>
  <option value="other">other</option>
  <option value="custom">自定义支持</option>  <!-- 新增 -->
</select>
```

### 3.2 类型切换联动逻辑

当 `type === "custom"` 时：
- ✅ 标题输入框（zh/en）正常编辑
- ❌ URL 输入框设为 `readonly`，值固定为 `"https://"`
- ❌ autoComplete 开关 `disabled`（不可操作）

**实现要点**：
1. 监听 `select[data-field="type"]` 的 change 事件
2. 根据选中值切换相关控件的 disabled/readonly 状态
3. URL 输入框的值强制设为 `"https://"`
4. autoComplete checkbox 设为 disabled 且 unchecked

---

## 4. 后端接口设计

**文件路径**: `src/xhunt/api/campaign.js`

### 4.1 获取跳转链接

```http
POST /api/xhunt/campaign/custom-task/link
```

**请求头**：
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**请求体**：
```json
{
  "campaign": "bybit",
  "taskId": "bybit-custom-xxx"
}
```

**响应成功** (200)：
```json
{
  "success": true,
  "link": "https://third-party.com/task?ref=xxx&user=123",
  "expiresAt": "2026-03-15T12:00:00Z"
}
```

**响应失败**：
- `400` - 参数错误
- `401` - 未登录
- `404` - 任务不存在或 campaign 未配置
- `429` - 请求过于频繁
- `503` - 第三方服务不可用

---

### 4.2 查询完成状态

```http
GET /api/xhunt/campaign/custom-task/status?campaign=bybit&taskId=bybit-custom-xxx
```

**请求头**：
```
Authorization: Bearer <JWT_TOKEN>
```

**响应成功** (200)：
```json
{
  "success": true,
  "completed": true,
  "completedAt": "2026-03-15T10:30:00Z",
  "metadata": {}
}
```

**响应失败**：
- `400` - 参数错误
- `401` - 未登录
- `404` - 任务不存在

---

## 5. 调用时序图

```
┌─────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
│  插件   │      │   后端   │      │  第三方  │      │  Nacos   │
└────┬────┘      └────┬─────┘      └────┬─────┘      └────┬─────┘
     │                │                 │                 │
     │  POST /link    │                 │                 │
     │───────────────▶│                 │                 │
     │                │  读取 campaign 配置                 │
     │                │───────────────────────────────────▶│
     │                │◀───────────────────────────────────│
     │                │                 │                 │
     │                │  调用第三方生成链接接口              │
     │                │  (由业务方实现)  │                 │
     │                │────────────────▶│                 │
     │                │◀────────────────│                 │
     │                │                 │                 │
     │  返回 link     │                 │                 │
     │◀───────────────│                 │                 │
     │                │                 │                 │
     │  打开第三方链接 │                 │                 │
     │────────────────────────────────▶│                 │
     │                │                 │                 │
     │  轮询 GET /status                │                 │
     │────────────────────────────────▶│                 │
     │                │  调用第三方查询接口                  │
     │                │  (由业务方实现)  │                 │
     │                │────────────────▶│                 │
     │                │◀────────────────│                 │
     │                │                 │                 │
     │  返回 completed │                │                 │
     │◀───────────────│                 │                 │
     │                │                 │                 │
```

---

## 6. 分工说明

### 前端插件负责
- [ ] 调用 `/custom-task/link` 获取跳转链接
- [ ] 调用 `/custom-task/status` 轮询完成状态

### 管理后台页面负责
- [ ] `src/xhunt/views/partials/nacos-campaigns.ejs` 增加 `custom` 类型选项
- [ ] 实现类型切换联动（disabled/readonly 控制）

### 后端负责
- [ ] `src/xhunt/api/campaign.js` 新增两个路由
- [ ] JWT 认证 + 频率限制中间件
- [ ] campaign 配置读取
- [ ] **调用第三方接口逻辑（由业务方后续实现）**

---

## 8. 接口实现提示

### 8.1 路由注册

```javascript
// src/xhunt/api/campaign.js

// 获取跳转链接
router.post(
  "/custom-task/link",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    // TODO: 实现获取跳转链接逻辑
  }
);

// 查询完成状态
router.get(
  "/custom-task/status",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    // TODO: 实现查询完成状态逻辑
  }
);
```

### 8.2 调用第三方接口（待实现）

**说明**：第三方接口调用逻辑直接在代码中根据 `campaign` 判断实现，无需环境变量配置。

```javascript
/**
 * 调用第三方接口生成跳转链接
 * @param {string} campaign - campaignKey
 * @param {string} taskId - 任务ID
 * @param {Object} user - 用户信息
 * @returns {Promise<Object>} - { link, expiresAt }
 */
async function generateExternalLink(campaign, taskId, user) {
  // TODO: 根据 campaign 调用对应的第三方 API 生成链接
  // 示例：
  // if (campaign === 'bybit') {
  //   // 调用 bybit 合作方接口
  // } else if (campaign === 'mantle') {
  //   // 调用 mantle 合作方接口
  // }
  // 返回格式: { link: string, expiresAt: string }
}

/**
 * 调用第三方接口查询任务完成状态
 * @param {string} campaign - campaignKey
 * @param {string} taskId - 任务ID
 * @param {Object} user - 用户信息
 * @returns {Promise<Object>} - { completed, completedAt?, metadata? }
 */
async function queryExternalStatus(campaign, taskId, user) {
  // TODO: 根据 campaign 调用对应的第三方 API 查询状态
  // 返回格式: { completed: boolean, completedAt?: string, metadata?: object }
}
```

---

## 9. 附录：前端接口调用示例

### 9.1 获取跳转链接

```javascript
async function getCustomTaskLink(campaign, taskId) {
  const response = await fetch('/api/xhunt/campaign/custom-task/link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ campaign, taskId })
  });
  const data = await response.json();
  if (data.success) {
    window.open(data.link, '_blank');
  }
}
```

### 9.2 查询完成状态

```javascript
async function checkCustomTaskStatus(campaign, taskId) {
  const response = await fetch(
    `/api/xhunt/campaign/custom-task/status?campaign=${encodeURIComponent(campaign)}&taskId=${encodeURIComponent(taskId)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  const data = await response.json();
  return data.completed;
}
```
