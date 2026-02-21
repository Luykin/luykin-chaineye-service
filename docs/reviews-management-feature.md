# 评论管理功能需求文档

## 1. 功能概述

在 XHunt 管理后台 (`stats.ejs`) 新增一个 Tab，允许运营人员通过被评论人的 Twitter handler 搜索评论，并对评论进行软删除操作。

## 2. 需求背景

- 需要快速查找某个账号收到的所有评论
- 运营人员需要能够处理不当评论（软删除）
- 软删除而非真删除，保留数据完整性

## 3. 功能设计

### 3.1 前端界面

#### Tab 信息
- **Tab 名称**: 🗑️ 评论管理
- **可见性**: 所有已登录管理员可见（需分配 `reviews-management` 权限）
- **位置**: 建议放在 `data-export` 之后

#### 界面布局
```
┌─────────────────────────────────────────────────────────────┐
│ 🗑️ 评论管理                                                  │
├─────────────────────────────────────────────────────────────┤
│ 被评论人 Handle: [________________] [搜索]                   │
├─────────────────────────────────────────────────────────────┤
│ 搜索结果（共 X 条）:                                          │
│ ┌────────────┬──────────┬──────┬────────┬──────────┬────────┐ │
│ │ 评论人     │ 被评论人 │ 评分 │ 标签   │ 评论内容 │ 操作   │ │
│ ├────────────┼──────────┼──────┼────────┼──────────┼────────┤ │
│ │ [头像]用户A │ @elonmusk│ 3.5  │ KOL,VC │ 这是评论 │ [删除] │ │
│ └────────────┴──────────┴──────┴────────┴──────────┴────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 字段说明
| 字段 | 说明 |
|------|------|
| 评论人 | 头像 + displayName (username) |
| 被评论人 | handle（@前缀） |
| 评分 | 0.0-5.0，保留1位小数 |
| 标签 | 数组格式，逗号分隔显示 |
| 评论内容 | 完整显示，不截断 |
| 评论时间 | createdAt，格式：YYYY-MM-DD HH:mm |
| 操作 | 删除按钮 |

#### 删除确认
- 点击删除按钮时弹出确认框：
  ```
  确定要删除这条评论吗？
  
  删除后：
  - 评论将归属于虚拟账号
  - 被评论人将不再看到这条评论
  - 此操作不可恢复
  
  [取消] [确定删除]
  ```

### 3.2 后端 API

#### 3.2.1 搜索评论

**接口**: `GET /api/admin/reviews`

**权限**: `reviews-management`

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| handle | string | 是 | 被评论人的 Twitter handle（不含@） |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "targetHandle": "elonmusk",
    "reviews": [
      {
        "id": "uuid-string",
        "reviewer": {
          "username": "user123",
          "displayName": "User Name",
          "avatar": "https://..."
        },
        "targetHandle": "elonmusk",
        "rating": 3.5,
        "tags": ["KOL", "VC"],
        "comment": "这是一条评论内容",
        "createdAt": "2025-01-15 14:30"
      }
    ],
    "total": 1
  }
}
```

**错误响应**:
- `400`: 缺少 handle 参数
- `404`: 未找到该 handle 对应的账号
- `403`: 无权限（缺少 `reviews-management` 权限）
- `401`: 未登录

#### 3.2.2 软删除评论

**接口**: `POST /api/admin/reviews/delete`

**权限**: `reviews-management`

**请求体**:
```json
{
  "reviewId": "uuid-string"
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "评论已删除"
}
```

**软删除逻辑**:
1. 根据 `reviewId` 查找评论记录
2. 检查虚拟账号是否存在（`id = 00000000-0000-0000-0000-000000000000`）
3. 如虚拟账号不存在，创建虚拟账号记录：
   ```javascript
   {
     id: '00000000-0000-0000-0000-000000000000',
     handle: '_deleted_',
     displayName: '已删除账号',
     avatar: '',
     xId: '0'
   }
   ```
4. 更新评论的 `xAccountId` 为虚拟账号 ID
5. 记录操作日志到 `XhuntAdminAuditLog`

**错误响应**:
- `400`: 缺少 reviewId 参数
- `404`: 评论不存在
- `403`: 无权限
- `401`: 未登录

### 3.3 权限控制

#### 权限标识
- **权限名**: `reviews-management`
- **说明**: 评论管理 - 可搜索和删除评论

#### 权限配置
- Super 管理员自动拥有此权限
- 普通管理员需要在 `permissions` 数组中包含 `"reviews-management"`
- 前端显示条件：
  ```ejs
  <% if (user.role === 'super' || (Array.isArray(user.permissions) && user.permissions.includes('reviews-management'))) { %>
    <!-- 显示评论管理 Tab -->
  <% } %>
  ```

## 4. 数据模型

### 4.1 涉及的表

#### XReviewForAccount（评论表）
| 字段 | 操作 |
|------|------|
| id | 查询条件 |
| xHuntUserId | 关联查询评论人信息 |
| xAccountId | **软删除时更新为此字段** |
| userAvatar | 展示 |
| userName | 展示 |
| rating | 展示 |
| tags | 展示 |
| comment | 展示 |
| createdAt | 展示 |

#### XAccount（账号表）
| 字段 | 说明 |
|------|------|
| id | 主键，软删除时指向 `00000000-0000-0000-0000-000000000000` |
| handle | Twitter handle |
| displayName | 显示名称 |
| avatar | 头像 URL |

#### XHuntUser（用户表）
| 字段 | 说明 |
|------|------|
| id | 主键 |
| username | Twitter 用户名 |
| displayName | 显示名称 |
| avatar | 头像 URL |

#### XhuntAdminAuditLog（管理员操作日志表）
记录所有删除操作：
- `adminId`: 执行删除的管理员 ID
- `email`: 管理员邮箱
- `action`: `"review-delete"`
- `route`: `"/api/admin/reviews/delete"`
- `method`: `"POST"`
- `ip`: 操作者 IP
- `userAgent`: 浏览器 UA
- `success`: 是否成功
- `message`: JSON 字符串，包含被删除评论的 reviewId 和原 xAccountId

## 5. 文件变更清单

### 5.1 新增文件

| 文件路径 | 说明 |
|----------|------|
| `src/xhunt/views/partials/reviews-management.ejs` | 评论管理 Tab 的 HTML 内容 |
| `src/admin/api/reviews.js` | 评论管理 API 路由 |

### 5.2 修改文件

| 文件路径 | 变更内容 |
|----------|----------|
| `src/xhunt/views/stats.ejs` | 1. 添加 Tab 按钮<br>2. 添加 Tab 内容区域<br>3. 权限判断逻辑 |
| `src/routes/admin.js` | 注册新的 API 路由 `/api/admin/reviews` |

### 5.3 可选修改

| 文件路径 | 变更内容 |
|----------|----------|
| `src/xhunt/views/static/js/stats.js` | 如需复杂交互，可添加独立 JS 逻辑 |

## 6. 接口详细实现

### 6.1 GET /api/admin/reviews

```javascript
// 伪代码
async function getReviewsByHandle(req, res) {
  const { handle } = req.query;
  
  // 1. 查找被评论人账号
  const targetAccount = await XAccount.findOne({
    where: { handle: { [Op.iLike]: handle } }
  });
  
  if (!targetAccount) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }
  
  // 2. 查询所有评论（包括关联的评论人信息）
  const reviews = await XReviewForAccount.findAll({
    where: { xAccountId: targetAccount.id },
    include: [{
      model: XHuntUser,
      as: 'xHuntUser',
      attributes: ['username', 'displayName', 'avatar']
    }],
    order: [['createdAt', 'DESC']]
  });
  
  // 3. 格式化返回
  const formattedReviews = reviews.map(r => ({
    id: r.id,
    reviewer: {
      username: r.xHuntUser?.username,
      displayName: r.xHuntUser?.displayName || r.userName,
      avatar: r.xHuntUser?.avatar || r.userAvatar
    },
    targetHandle: targetAccount.handle,
    rating: parseFloat(r.rating),
    tags: r.tags || [],
    comment: r.comment,
    createdAt: formatDateTime(r.createdAt)
  }));
  
  return res.json({
    success: true,
    data: {
      targetHandle: targetAccount.handle,
      reviews: formattedReviews,
      total: formattedReviews.length
    }
  });
}
```

### 6.2 POST /api/admin/reviews/delete

```javascript
// 伪代码
const VIRTUAL_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';

async function softDeleteReview(req, res) {
  const { reviewId } = req.body;
  const admin = req.adminUser;
  
  // 1. 查找评论
  const review = await XReviewForAccount.findByPk(reviewId);
  if (!review) {
    return res.status(404).json({ success: false, error: '评论不存在' });
  }
  
  // 2. 检查/创建虚拟账号
  let virtualAccount = await XAccount.findByPk(VIRTUAL_ACCOUNT_ID);
  if (!virtualAccount) {
    virtualAccount = await XAccount.create({
      id: VIRTUAL_ACCOUNT_ID,
      handle: '_deleted_',
      displayName: '已删除账号',
      avatar: '',
      xId: '0',
      xLink: ''
    });
  }
  
  // 3. 记录原 xAccountId（用于审计日志）
  const originalXAccountId = review.xAccountId;
  
  // 4. 更新评论指向虚拟账号
  await review.update({ xAccountId: VIRTUAL_ACCOUNT_ID });
  
  // 5. 记录审计日志
  await XhuntAdminAuditLog.create({
    adminId: admin.id,
    email: admin.email,
    action: 'review-delete',
    route: '/api/admin/reviews/delete',
    method: 'POST',
    ip: req.ip || '',
    userAgent: req.headers['user-agent'] || '',
    success: true,
    message: JSON.stringify({
      reviewId: review.id,
      originalXAccountId,
      virtualAccountId: VIRTUAL_ACCOUNT_ID
    })
  });
  
  return res.json({ success: true, message: '评论已删除' });
}
```

## 7. 测试建议

### 7.1 功能测试
1. 搜索存在的 handle，验证返回正确的评论列表
2. 搜索不存在的 handle，验证返回 404
3. 点击删除，验证确认框弹出
4. 确认删除后，验证评论 xAccountId 已更新
5. 验证虚拟账号自动创建（如不存在）
6. 验证审计日志正确记录

### 7.2 权限测试
1. Super 管理员可正常访问
2. 分配了 `reviews-management` 权限的普通管理员可访问
3. 未分配权限的普通管理员应看到 403 或无 Tab 入口
4. 未登录用户访问 API 返回 401

## 8. 注意事项

1. **虚拟账号**: ID 固定为 `00000000-0000-0000-0000-000000000000`，用于标识已删除的评论
2. **审计日志**: 所有删除操作必须记录到 `XhuntAdminAuditLog`，包含 reviewId 和原 xAccountId
3. **Handle 查询**: 不区分大小写（使用 `Op.iLike`）
4. **无需分页**: 假设单账号评论数量不会过大
5. **完整显示**: 评论内容不截断，表格可能需要横向滚动

## 9. 后续优化建议

- 支持批量删除
- 支持按评论人搜索
- 支持按时间范围筛选
- 支持恢复已删除的评论（反向操作）
- 评论内容敏感词过滤提示
