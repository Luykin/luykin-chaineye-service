# XHunt Admin 后台从 EJS 迁移到 React + Ant Design 方案

## 1. 背景

当前 XHunt 后台主要由以下部分组成：

- `src/xhunt/views/stats.ejs`：后台主壳
- `src/xhunt/views/partials/*.ejs`：各个功能页面
- `public/static/js/stats.js`：全局交互逻辑
- `public/static/css/stats.css`：全局样式

现状特点：

1. **EJS + 原生 DOM 脚本为主**
2. **大量内联脚本**
3. **自定义样式非常多**
4. **页面体量大、交互复杂**
5. **很多页面本质上已经接近单页后台应用**

其中样式和组件层面的问题尤其明显：

- 按钮、筛选、表格、卡片、分页、空状态等都存在大量自定义实现
- UI 一致性依赖手工维护
- 页面之间容易出现样式串色、局部风格不统一的问题

因此迁移时不建议继续走“React + 大量自定义 CSS”路线，而应直接使用成熟组件库统一页面实现。

---

## 2. 目标

本次迁移目标不是立即推倒全部后台，而是：

1. 将后台页面逐步从 **EJS** 迁移到 **React**
2. 统一采用 **Ant Design（antd）** 作为基础组件库
3. 尽量复用现有 Express API、登录态、权限体系
4. 减少继续维护 `stats.css` 这类大体量自定义样式文件
5. 逐步建立新的后台前端工程结构，最终可替换现有 EJS 后台

---

## 3. 技术路线结论

## 推荐路线

### **EJS → React + Vite + TypeScript + Ant Design**

不建议第一阶段直接上 Next.js。

### 原因

1. 现有后台是内部管理系统，**不依赖 SEO**
2. 多数页面属于 **重客户端交互页面**，不吃 SSR 红利
3. 现有 Express API、cookie 登录态、权限中间件已经成熟
4. 先迁 React 能最大程度降低重构范围
5. 先统一组件体系，比继续堆自定义样式更有收益

---

## 4. 为什么明确选用 Ant Design

## 4.1 选型结论

本项目后台迁移采用：

### **Ant Design（antd）**

作为后台主组件库。

---

## 4.2 选 antd 的原因

### 1）后台场景匹配度高

当前后台核心页面大量是：

- 表格
- 筛选
- 表单
- 弹窗
- 抽屉
- Tabs
- 分页
- 日期选择
- 状态标签
- 通知与反馈

这些正是 antd 最强的部分。

---

### 2）减少自定义样式维护成本

当前页面里大量 UI 是自己拼的，例如：

- 按钮体系
- 表格风格
- 分页
- Filter 区
- 空状态
- 统计卡片
- 弹窗
- 表单布局

如果迁 React 仍然保持大量自定义 UI，那么：

- 迁移成本高
- 后续维护成本也高
- 页面视觉一致性问题仍然会重复出现

而如果统一换成 antd：

- 大多数基础组件无需自己重新设计
- 样式一致性显著提升
- 后续开发速度更快

---

### 3）能快速迁移高密度后台页面

比如这些页面：

- `generic-stats`
- `admin-audit-logs`
- `url-stats`
- `version-stats`
- `nacos-campaigns`

如果使用 antd，很多部分都能直接用现成组件组合：

- `Table`
- `Form`
- `Input`
- `Select`
- `DatePicker`
- `Button`
- `Card`
- `Tabs`
- `Modal`
- `Drawer`
- `Tag`
- `Tooltip`
- `Empty`
- `Result`
- `Spin`
- `message`
- `notification`

这样迁移工作会更偏向“业务逻辑搬迁”，而不是“大量重新写 UI”。

---

### 4）适合渐进迁移

antd 适合新旧页面并存期间逐步替换：

- React 新页面走 antd
- 老 EJS 页面继续跑
- 后面逐步替换老页面

不需要一开始就把整套设计系统自己搭完。

---

## 4.3 选 antd 的代价

也要明确一些成本：

1. **默认视觉风格会与现有后台不同**
   - 需要接受“新后台会先变成更标准的 antd 风格”

2. **需要建立少量主题定制**
   - 比如主色、圆角、间距、字体层级

3. **复杂页面不能只靠组件库自动解决**
   - 业务复杂页仍然要认真拆模块

4. **不能一边引入 antd，一边继续到处手写自定义组件**
   - 否则收益会被稀释

---

## 5. 不建议的路线

以下路线不建议作为本项目后台迁移主方案：

### 5.1 React + 继续大量自定义 CSS

问题：

- 会把 EJS 问题平移到 React
- 组件化收益打折
- 后续维护仍然痛苦

---

### 5.2 直接全量上 Next.js

问题：

- 迁移决策变复杂
- 容易把页面迁移升级成架构重构
- 对内部后台短期收益不如 React + antd 明显

---

### 5.3 继续做自研设计系统

当前不合适。

因为现在最需要的是：

1. 先把后台从 EJS 解耦出来
2. 先统一组件和交互实现
3. 再考虑长期设计系统沉淀

---

## 6. 推荐技术栈

## 6.1 前端工程

- **Vite**
- **React**
- **TypeScript**
- **React Router**
- **Ant Design**
- **TanStack Query**

---

## 6.4 项目放置方式

当前阶段建议采用：

### **同仓（Monorepo / 同项目目录）**

即新前端项目直接放在当前后端仓库中，而不是一开始就拆成独立仓库。

推荐目录：

```bash
project-root/
├── src/
├── public/
├── docs/
├── admin-web/
└── package.json
```

### 推荐理由

1. **迁移期协作成本最低**
   - 前端与后端改动可以同一次提交完成
   - 调整接口时不需要跨仓协调

2. **登录态与权限复用更方便**
   - 现有 cookie session、`adminAuth`、`requirePermission` 更容易直接联调

3. **适合渐进迁移**
   - 当前是试点迁移阶段，不是最终完全分家阶段
   - 同仓更方便新旧后台并行

4. **后续仍可再拆**
   - 同仓只是当前阶段的最佳实践
   - 等 React 后台成熟后，再决定是否独立部署、独立仓库

### 当前不建议直接拆仓

因为会额外引入：

- 跨仓联调成本
- 双份环境变量维护
- 独立 CI/CD 配置
- 登录态与跨域调试复杂度

因此本方案默认：

### **新前端项目目录名为 `admin-web/`，直接放在当前后端项目根目录下**

---

## 6.2 图表

保留一套现有图表方案即可，建议优先复用已有：

- `Chart.js` 或
- `ECharts`

不建议第一阶段同时改 UI 组件库和图表方案。

---

## 6.3 请求层

统一封装：

- `apiClient`
- 默认 `credentials: "include"`
- 统一处理 401 / 403 / 500

---

## 7. 迁移原则

## 7.1 只替换页面层，不先动后端核心

优先保留：

- Express API
- `adminAuth`
- `requirePermission`
- PostgreSQL / Redis / 爬虫逻辑

第一阶段只迁：

- EJS 页面
- 原生前端脚本

---

## 7.2 新旧后台并行

建议在一段时间内保留：

- 老后台：现有 EJS
- 新后台：React + antd

例如新增：

- `/admin-react`
- 或 `/admin-v2`

作为新后台入口。

---

## 7.3 先迁低风险页面

不要一开始就碰最复杂的页面。

优先拿：

- `generic-stats`
- `admin-audit-logs`
- `url-stats`
- `version-stats`

做第一阶段试点。

---

## 7.4 统一使用 antd 原生组件

这次迁移要明确一个约束：

### **优先使用 antd 原生组件，不继续自定义大批基础 UI**

允许的自定义范围：

- 页面排版
- 少量样式覆盖
- 主题 token
- 极少数业务包装组件

不建议继续自定义：

- 按钮体系
- 表格体系
- 分页体系
- 基础筛选组件
- 基础表单控件

---

## 8. 第一阶段实施范围

## 8.1 第一批页面

建议顺序：

### P0
1. `generic-stats`
2. `admin-audit-logs`

### P1
3. `url-stats`
4. `version-stats`

---

## 8.2 第一阶段不做

以下页面先不迁：

1. `nacos-campaigns`
2. `perf-monitor-stats`
3. `binance-square-stats`
4. `feature-flags`
5. `rootdata-stats`

这些页面体量大、交互重，应该留到第二阶段或第三阶段。

---

## 9. 第一阶段目录结构建议

```bash
admin-web/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx
    ├── app/
    │   ├── router.tsx
    │   ├── providers.tsx
    │   └── auth.ts
    ├── layouts/
    │   └── AdminLayout.tsx
    ├── pages/
    │   ├── GenericStatsPage.tsx
    │   ├── AuditLogsPage.tsx
    │   ├── UrlStatsPage.tsx
    │   └── VersionStatsPage.tsx
    ├── modules/
    │   ├── generic-stats/
    │   ├── audit-logs/
    │   ├── url-stats/
    │   └── version-stats/
    ├── components/
    │   ├── ui/
    │   ├── tables/
    │   ├── filters/
    │   ├── permission/
    │   └── states/
    ├── services/
    │   ├── apiClient.ts
    │   ├── auth.ts
    │   └── stats.ts
    ├── hooks/
    ├── types/
    └── styles/
```

---

## 10. 认证与权限接入方案

## 10.1 登录态复用

前端不重新设计登录体系，直接复用现有：

- cookie session
- `adminAuth`

所有请求统一带：

```ts
credentials: "include"
```

---

## 10.2 当前管理员信息接口

建议复用或提供一个简洁接口，例如：

`GET /admin/auth-check`

返回：

```json
{
  "success": true,
  "loggedIn": true,
  "admin": {
    "id": 1,
    "email": "xx@xx.com",
    "role": "super",
    "permissions": ["generic-stats", "audit-logs:read"]
  }
}
```

React 启动后：

1. 拉取当前用户
2. 注入 Auth Context
3. 根据权限渲染菜单与页面

---

## 10.3 权限控制原则

### 前端权限
用于：

- 菜单隐藏
- 页面空状态
- 按钮禁用

### 后端权限
继续作为最终安全校验：

- `adminAuth`
- `requirePermission(...)`

---

## 11. 路由方案

不建议继续用一个大页面内塞几十个 tab pane。

建议改为真实路由：

```bash
/admin-react/generic-stats
/admin-react/admin-audit-logs
/admin-react/url-stats
/admin-react/version-stats
```

这样能获得：

1. 页面边界更清楚
2. 路由级权限更自然
3. 代码分割更容易
4. 首屏更轻

---

## 12. 组件策略（基于 Ant Design）

## 12.1 直接使用的 antd 组件

优先直接使用：

- `Layout`
- `Menu`
- `Button`
- `Card`
- `Table`
- `Form`
- `Input`
- `Select`
- `DatePicker`
- `Space`
- `Tag`
- `Tooltip`
- `Modal`
- `Drawer`
- `Tabs`
- `Pagination`
- `Empty`
- `Result`
- `Spin`
- `Alert`
- `message`
- `notification`

---

## 12.2 应该包装但不要过度包装的部分

允许封装少量业务壳组件，例如：

- `AdminPage`
- `PageHeader`
- `FilterCard`
- `PermissionGuard`
- `QueryTable`

但不要一开始就搞成很重的内部组件系统。

第一阶段目标是：

### **尽快可用，而不是先造一套大而全设计系统**

---

## 12.3 样式策略

### 原则
尽量少写自定义 CSS。

优先级建议：

1. **antd 原生组件**
2. **antd token 主题定制**
3. **少量页面级布局样式**
4. **最后才是局部覆盖**

不建议再复制一份新的大 CSS 文件。

---

## 13. 第一阶段页面拆分建议

## 13.1 Generic Stats

建议拆成：

- `GenericStatsPage`
- `GenericStatsFilterForm`
- `GenericStatsSummaryCards`
- `GenericStatsAggregateTable`
- `GenericStatsEventTable`

antd 实现建议：

- 筛选：`Form + Select + DatePicker + Input + Button`
- 聚合：`Card + Table`
- 事件：`Card + Table + Tooltip`
- 加载：`Spin`
- 空态：`Empty`

---

## 13.2 Admin Audit Logs

建议拆成：

- `AuditLogsPage`
- `AuditLogsFilterForm`
- `AuditLogsTable`

antd 实现建议：

- 筛选：`Form + Input + Button`
- 列表：`Table`
- 状态：`Tag`
- 提示：`Tooltip`

---

## 13.3 URL Stats

建议拆成：

- `UrlStatsPage`
- `UrlStatsFilterForm`
- `UrlStatsChartCard`
- `UrlStatsTable`

antd 实现建议：

- 外壳：`Card`
- 筛选：`Form`
- 统计区：`Row + Col + Statistic`
- 列表：`Table`

---

## 13.4 Version Stats

建议拆成：

- `VersionStatsPage`
- `VersionStatsFilterBar`
- `VersionStatsChart`
- `VersionStatsTable`

antd 实现建议：

- 筛选：`Segmented / Select / DatePicker`
- 图表区：`Card`
- 数据区：`Table`

---

## 14. API 复用策略

第一阶段尽量直接复用现有接口：

### Generic Stats
- `GET /api/xhunt/stats/generic-stats/types`
- `GET /api/xhunt/stats/generic-stats/events`
- `GET /api/xhunt/stats/generic-stats/aggregate`

### Audit Logs
- `GET /api/xhunt/stats/admin-audit/logs`

### URL Stats
- `GET /api/xhunt/stats/url-stats`

### Version Stats
- `GET /api/xhunt/stats/version-stats`

### Auth
- `GET /admin/auth-check`

---

## 15. 第一阶段实施步骤

## Step 1：初始化前端工程

目标：

- 建立 `admin-web`
- 跑通 Vite + React + TS + antd
- 配代理到现有后端

预估：

- 0.5 ~ 1 天

---

## Step 2：接入登录态与权限

目标：

- `AuthProvider`
- `apiClient`
- 登录态校验
- 401/403 处理

预估：

- 0.5 ~ 1 天

---

## Step 3：搭建后台 Layout

目标：

- `Layout + Sider + Header + Menu`
- 菜单权限过滤
- 页面容器

预估：

- 1 天

---

## Step 4：迁 Generic Stats

目标：

- React 化通用统计页
- 不依赖 `window.*`
- 用 antd 完成筛选、卡片、表格

预估：

- 1 ~ 2 天

---

## Step 5：迁 Audit Logs

目标：

- 建立标准列表页模板
- 抽出可复用筛选/表格模式

预估：

- 1 ~ 1.5 天

---

## Step 6：迁 URL Stats / Version Stats

目标：

- 验证图表和统计列表组合页

预估：

- 2 ~ 4 天

---

## Step 7：联调与试运行

目标：

- 新旧后台并存
- 入口可访问
- 坤哥可试用

预估：

- 0.5 ~ 1 天

---

## 16. 时间评估

## 第一阶段最小版

包含：

- 工程壳子
- auth
- layout
- generic-stats
- admin-audit-logs

预估：

### **4 ~ 7 个工作日**

---

## 第一阶段完整版

包含：

- 工程壳子
- auth
- layout
- generic-stats
- admin-audit-logs
- url-stats
- version-stats

预估：

### **7 ~ 12 个工作日**

---

## 17. 风险点

### 1）不要边迁边重做整个设计系统
第一阶段只借助 antd 建立统一性，不要再同时推进大规模自研样式体系。

### 2）不要过早碰最复杂页面
`nacos-campaigns`、`perf-monitor` 等留后面处理。

### 3）不要同时重构后端接口
优先吃现有 API。

### 4）不要继续复制大量自定义 CSS
否则会把旧问题迁移到新项目里。

---

## 18. 第二阶段建议方向

第一阶段稳定后，再进入第二阶段：

### 第二阶段候选页面

- `online-users`
- `notes-stats`
- `security-violations`
- `message-stats`
- `vip-management`
- `device-monitor`

### 第三阶段候选页面

- `nacos-campaigns`
- `feature-flags`
- `perf-monitor`
- `binance-square`
- `rootdata-stats`

---

## 19. 最终建议

对于当前后台迁移，建议明确以下原则：

1. **先 React，不先 Next.js**
2. **先复用现有 Express API**
3. **先统一到 antd**
4. **先迁简单页验证路径**
5. **新旧后台并行一段时间**

---

## 20. 当前建议拍板事项

建议坤哥确认以下 4 点：

1. 是否确定采用 **Vite + React + TypeScript + Ant Design**
2. 是否接受新后台入口路径，例如：
   - `/admin-react`
   - 或 `/admin-v2`
3. 是否接受第一阶段页面范围：
   - `generic-stats`
   - `admin-audit-logs`
   - `url-stats`
   - `version-stats`
4. 是否接受新旧后台并行一段时间

---

## 21. 下一步建议

如果方案确认，下一步建议继续补一份：

### 《admin-web 初始化脚手架方案》

包括：

1. 目录创建清单
2. `package.json` 建议依赖
3. `vite.config.ts` 代理配置建议
4. `AuthProvider` 结构建议
5. `apiClient` 结构建议
6. `AdminLayout` 与菜单结构建议
7. 第一批页面骨架结构建议
