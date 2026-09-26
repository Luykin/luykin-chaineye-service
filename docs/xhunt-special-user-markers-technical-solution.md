# XHunt Twitter 账号特殊标记（疑似诈骗/官方认证/多维皮肤）全栈技术方案

> **文档版本**：v1.2.0（实施完成版）  
> **更新时间**：2026-09-26  
> **归档路径**：`docs/xhunt-special-user-markers-technical-solution.md`  
> **涉及代码库**：  
> - **后端系统**：`enterprise-admin`（Express.js / PostgreSQL / Redis / Sequelize）  
> - **管理后台**：`admin-web`（React 18 / Ant Design / React Query）  
> - **浏览器插件**：`tweet-hunt-extension`（Plasmo MV3 / React 18 / Tailwind CSS）  
> **核心诉求**：支持管理员在后台为指定 Twitter Handler 配置自定义特殊标记（如“疑似诈骗”、“官方认证”、“搬运账号”等）；**支持丰富的皮肤体系（7大色系、4种形态、11种内置微图标、呼吸微动画、Tooltip原因及证据链接）**；**支持配置该标记的可见范围（全部人可见 或 通过请求头 twid 限制指定白名单用户可见）**；插件在 X (Twitter) 网页的**个人主页**、**发推信息流**与**私聊列表/聊天窗口**等场景中，精准在用户名字后渲染轻量高质感的视觉标记。

---

## 1. 需求背景与核心价值

### 1.1 业务背景
随着 Web3 与 Twitter 社交生态的发展，假冒高仿号、私信钓鱼、恶意空投引流、冒充官方客服等恶意行为频发。普通用户在浏览推文、查阅个人主页或处理私信时，极易受到具有误导性的昵称或头像蒙骗。
运营团队与安全合规团队需要具备**精准标定特殊账号**的能力：
- **风险提示**：针对恶意钓鱼、私聊杀猪盘、高仿骗局账号，显著标定“疑似诈骗”、“高危钓鱼”、“假冒客服”等警示标签，阻断诈骗转化。
- **正面认证**：针对核心团队、官方大使、重点合作方等账号，赋予“官方合作”、“合规核验”等背书标签。
- **中立与特征备注**：如“搬运账号”、“AI机器人”、“已注销”等运营备注。

### 1.2 多维丰富皮肤体系设计（Rich Visual Skin System）
为了避免视觉效果单一单调，特殊标记不仅仅是单调的颜色块，而是构建了成体系的视觉表达模型：
1. **色系主题（Color Preset）**：提供兼顾浅色/深色主题的 7 组语义色（警示红 `danger-red`、风险橙 `warning-orange`、认证蓝 `info-blue`、安全绿 `success-green`、尊享紫 `purple-special`、黄金金 `gold-amber`、中性灰 `neutral-gray`）。
2. **形态变体（Variant）**：
   - `subtle`（柔和药丸，默认）：半透明轻底色 + 彩色文字 + 细微边框，自然融入推特页面。
   - `solid`（实色醒目）：高饱和实底 + 白字，强提醒。
   - `outline`（线框镂空）：透明背景 + 彩色外框 + 彩色文字，利落轻盈。
   - `glow`（微光霓虹）：带微妙彩色光晕外发光，突出抓眼。
3. **微型语义图标（Micro Icon）**：
   内置 11px 高清矢量 SVG 图标集（警示盾牌 `shield-alert`、警告三角 `alert-triangle`、安全盾牌 `shield-check`、认证打勾 `badge-check`、危险骷髅 `skull`、热门火苗 `flame`、尊贵皇冠 `crown`、机器人 `bot`、禁止符号 `ban`、闪电 `zap`，或纯文字 `none`）。
4. **微妙呼吸动效（Effect / Animation）**：
   支持 `pulse`（呼吸微动效），专为恶性诈骗或高危钓鱼号设计，以 2.2s 平缓呼吸闪烁提升警示度。
5. **交互证据卡片（Hover Tooltip & Action）**：
   鼠标悬浮展示详细标记原因；若配置了证据/公示链接，点击可直接新标签页跳转查证。

### 1.3 可见性控制诉求（Visibility Scope & Twid 权限控制）
在实际运营与风控场景中，并非所有标记都适合立即面向全网公开：
1. **全部人可见（All / Public）**：
   - 适用于已事实核实、证据确凿的严重诈骗账号、已获官方授信的蓝标/金标合作伙伴等，面向所有安装插件的受众公开生效。
2. **指定用户可见（Restricted / Twid Whitelist）**：
   - **内部研判与预审灰度**：安全分析师或审核团队初判可疑账号时，先打上“疑似诈骗”标记，并仅对审核组管理员的 Twitter 账号（指定其 `twid`）可见，在真实 Twitter 页面实地验证其发推和私信表现，确认无误后再切换为全量公开，避免过早公开引发法律或公关争议。
   - **特定受众内测**：对部分 VIP 用户、安全志愿者或特定测试社群开放特定的前沿预警标记。
   - **技术实现**：浏览器插件发送网络请求时，底层 `secureFetchInContent` 会自动在请求头中携带当前登录 Twitter 用户的 `x-tw-id`（即用户自身的 Twitter 数字 ID）。后端服务依据请求头的 `twid`，精确判断并返回该用户有权查阅的标记列表。

### 1.4 核心展示场景定义
依据需求，标记必须在 X (Twitter) 网页的以下 3 大场景中，于目标 handler 的**名字后面**紧凑呈现：

| 场景 | 具体位置 | 对应 X 网页 DOM 特征 |
|------|---------|---------------------|
| **1. 个人主页** | 个人 Profile 顶部大卡片中用户昵称（Display Name）及认证图标（Blue/Gold Verified Badge）后方 | `main div[data-testid="UserName"]` 内部第一行 |
| **2. 发推信息流** | 推荐/关注信息流（Home Timeline）、个人推文列表、推文详情正文（Tweet Detail）、引用推文卡片（Quote Tweet）及回复区发推人昵称后方 | `article div[data-testid="User-Name"]` 内部 Display Name / Handle 区域 |
| **3. 私聊场景** | ① 消息列表页左侧会话条目（Conversation Item）对方昵称后<br>② 右侧已打开聊天窗口顶部标题栏（DM Conversation Header）对方昵称后<br>③ 聊天消息流气泡区发送者名字后（如有） | `div[data-testid="conversation"]`、`[data-testid="DM_Conversation_Avatar"]` 所在 Header 区域 |

---

## 2. 总体架构设计

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    管理后台 Admin Web (admin-web)                       │
 │  - 特殊标记管理页面 (/special-markers)                                  │
 │  - 配置项: Handler、标记文本、7大色系、4种形态、11种微图标、呼吸动效    │
 │  - 可见性范围: [ 全部人可见 ] vs [ 指定用户可见 (输入 twid / handle 自动反查) ] │
 │  - 实时推特风格模拟微徽章“所见即所得”预览卡片                          │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ 管理员操作 (JWT + 权限校验 + 审计日志)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    后端服务 API Server (enterprise-admin)              │
 │  - 管理路由: /api/xhunt/stats/special-markers                          │
 │  - 公开路由: GET /api/xhunt/special-markers/all                        │
 │    ├─ 提取请求头 req.headers['x-tw-id']                                │
 │    ├─ Redis 缓存全量基础池 (xhunt:special-markers:all:v1)              │
 │    ├─ 内存极速过滤: visible_scope === 'all' || visible_twids.has(twid) │
 │    └─ 响应头: Vary: x-tw-id, Accept-Encoding + ETag 协商缓存 (300s TTL) │
 │  - 存储层: PostgreSQL (xhunt_special_user_markers)                     │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP GET (自动附加 Header x-tw-id)
                                     │ 返回该用户权限范围内的专属标记字典
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                 XHunt 浏览器插件 (tweet-hunt-extension)                │
 │  - 请求发起: secureFetchInContent 自动附加请求头 x-tw-id                │
 │  - 本地缓存中心 (SpecialMarkersManager: 内存 Map + LocalStorage)       │
 │  - 全局 DOM 监听器: 基于 subscribeToMutation 批量增量分发              │
 │  - 节点识别器 (MarkerTargetMatcher):                                   │
 │    ├─ Profile Matcher: main [data-testid="UserName"]                   │
 │    ├─ Tweet Matcher: article [data-testid="User-Name"]                 │
 │    └─ DM Matcher: [data-testid="conversation"] & DM Header             │
 │  - 标记渲染器 (MarkerBadgeRenderer):                                   │
 │    ├─ 丰富视觉呈现: 11px 徽章 + 内置矢量 SVG 图标 + 呼吸微动画          │
 │    ├─ 7 大语义色系 (红/橙/蓝/绿/紫/金/灰) + 主题自适应 (Dark/Light)     │
 │    ├─ Tooltip 悬浮说明 (原因备注与证据外链)                            │
 │    └─ 事件拦截: 阻止冒泡避免触发 Twitter 卡片/推文跳转                 │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 落地实现的接口与数据模型规范

### 3.1 数据表字段（PostgreSQL 表名：`xhunt_special_user_markers`）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 自增 | 主键 |
| `username` | VARCHAR(255) | NOT NULL | - | 目标账号 Handle（去@、小写存储，唯一索引） |
| `twitter_id` | VARCHAR(64) | NULL | NULL | 目标账号 Twitter 数字 ID |
| `marker_text` | VARCHAR(32) | NOT NULL | - | 标记文本（如：疑似诈骗） |
| `color_preset` | VARCHAR(32) | NOT NULL | 'danger-red' | 预设色系（7 种） |
| `variant` | VARCHAR(32) | NOT NULL | 'subtle' | 形态（subtle/solid/outline/glow） |
| `icon` | VARCHAR(32) | NOT NULL | 'none' | 微图标（11 种） |
| `effect` | VARCHAR(32) | NOT NULL | 'none' | 动效（none/pulse） |
| `custom_text_color` | VARCHAR(32) | NULL | NULL | 自定义文字颜色 |
| `custom_bg_color` | VARCHAR(32) | NULL | NULL | 自定义背景颜色 |
| `description` | VARCHAR(500) | NULL | NULL | 标记原因/说明（Tooltip 展示） |
| `link_url` | VARCHAR(500) | NULL | NULL | 证据或详情跳转链接 |
| `visible_scope` | VARCHAR(16) | NOT NULL | 'all' | 可见范围（all/whitelist） |
| `visible_twids` | JSONB | NOT NULL | `[]` | 允许查看的 Twitter ID 列表 |
| `enabled` | BOOLEAN | NOT NULL | true | 是否启用 |
| `operator_id` | INTEGER | NULL | NULL | 最后操作管理员 ID |
| `operator_email` | VARCHAR(255) | NULL | NULL | 最后操作管理员邮箱 |
| `created_at` | TIMESTAMPTZ | NOT NULL | NOW() | 创建时间 |
| `updated_at` | TIMESTAMPTZ | NOT NULL | NOW() | 更新时间 |

### 3.2 插件公开 API 响应数据示例
- **请求地址**：`GET /api/xhunt/special-markers/all`
- **请求头**：自动携带 `x-tw-id: <当前用户TwitterId>`
- **返回体**：
```json
{
  "success": true,
  "data": {
    "version": 1780000000000,
    "count": 2,
    "markers": {
      "scammer_alpha": {
        "text": "疑似诈骗",
        "color": "danger-red",
        "variant": "solid",
        "icon": "shield-alert",
        "effect": "pulse",
        "desc": "用户举报：在私聊中假冒官方人员索要钱包私钥与助记词",
        "link": "https://example.com/scam-report/1001",
        "twid": "1570682472358346752"
      },
      "trusted_dao": {
        "text": "官方认证",
        "color": "info-blue",
        "variant": "subtle",
        "icon": "badge-check",
        "desc": "ChainEye 战略合作社区"
      }
    }
  }
}
```

---

## 4. 实施变更清单（Code Changelog）

### 4.1 后端服务（`enterprise-admin`）
1. `migrations-pg/20260926150000-create-xhunt-special-user-markers.js`：新建数据库迁移脚本。
2. `src/xhunt/models/XhuntSpecialUserMarker.js`：定义 Sequelize 数据模型。
3. `src/models/postgres/registry.js`：注册 `XhuntSpecialUserMarker` 模型。
4. `src/xhunt/services/specialMarkersCache.js`：实现底层 Redis 缓存与基于 `req.headers['x-tw-id']` 的内存权限过滤服务。
5. `src/xhunt/api/stats-routes/special-markers.js`：管理后台 RESTful 接口（增删查改、批量导入、反查 Twitter ID、补齐 ID、审计日志）。
6. `src/xhunt/api/stats.js`：挂载管理后台路由 `/api/xhunt/stats/special-markers`。
7. `src/xhunt/api/special-markers.js`：面向插件客户端的极速拉取接口，支持 ETag 与 `Vary: x-tw-id`。
8. `src/apiServer/routes/xhunt.js`：注册公开路由 `/api/xhunt/special-markers`。

### 4.2 管理后台前端（`admin-web`）
1. `admin-web/src/types/specialMarkers.ts`：定义完整的 TypeScript 类型体系。
2. `admin-web/src/services/specialMarkers.ts`：封装与后端的交互 API。
3. `admin-web/src/pages/SpecialUserMarkersPage.tsx`：实现特殊标记管理页面（统计卡片、搜索筛选、表格预览、编辑与“所见即所得”推特名字预览卡片、可见性范围切换与 handle 自动转 twid 助手、批量导入弹窗）。
4. `admin-web/src/app/router.tsx`：注册路由 `/special-markers`。
5. `admin-web/src/config/admin-navigation.tsx`：侧边栏菜单挂载“特殊标记配置”。

### 4.3 浏览器插件前端（`tweet-hunt-extension`）
1. `src/types/index.ts`：增加 `SpecialMarkerItem` 与响应结构类型定义。
2. `src/contents/services/api.ts`：新增 `getSpecialUserMarkers()` 接口请求函数。
3. `src/utils/specialMarkersManager.ts`：单例本地缓存管理器，维护 Map 索引、自动同步并与 `twId` 变更联动。
4. `src/css/style.css`：注入 7 大色系、4 种形态、呼吸微动画 `xhunt-marker-pulse` 及双主题自适应样式。
5. `src/contents/hooks/useSpecialUserMarkers.ts`：实现三大场景（个人主页、发推信息流、私聊会话与聊天窗口）的 DOM 精准识别与徽章挂载，内置矢量 SVG 图标，拦截事件冒泡。
6. `src/contents/Main.tsx`：在 `FeatureLayer` 中安全挂载 `useSpecialUserMarkers`。

---

## 5. 验证与上线指南

### 5.1 验证结果
- [x] 后端全部 6 个新建/修改文件 `node -c` 语法检查全部通过。
- [x] 管理后台 `admin-web` 执行 `npx tsc --noEmit` 静态类型检查 0 错误通过。
- [x] 浏览器插件 `tweet-hunt-extension` 执行 `npx tsc --noEmit` 静态类型检查 0 错误通过。

### 5.2 部署建议
1. **执行数据库迁移**：
   在测试/发布流程中执行：`yarn db:migrate:pg`，完成 `xhunt_special_user_markers` 数据表与索引创建。
2. **权限分配**：
   在管理后台用户管理或角色配置中，为需要的管理员账号授予 `special-markers` 权限。
3. **插件打包发布**：
   依常规发布流程进行插件生产构建与发版。
