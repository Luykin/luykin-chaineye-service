# XHunt 热点投票业务技术分析与系统设计文档（v3.0 - 安全强化版）

## 1. 业务背景与核心原则

为提升 XHunt 插件在推特右侧边栏首页的用户活跃度与话题参与度，计划在侧边栏上线**热点投票模块**。该模块让用户快速了解当前核心冲突、选择立场投票、原位查看各方分布，并按需登录发表观点。

### 1.1 核心业务流程
查看事件争论核心冲突 → 免登录即时投票（支持人物 PK / 普通议题 / 🍉吃瓜） → 原位查看统计比例与分布 → 按需 Twitter 授权登录发表观点留言。

### 1.2 关键架构与设计原则
1. **单页原位交互**：在插件首页侧边栏完成所有操作，不离开当前流，不新增二级页面。
2. **唯一身份锚点：推特 ID（Twitter ID）**：
   - 插件运行于 `x.com` / `twitter.com` 页面环境，通过 Twitter Web 会话（Cookie `twid`）**无论用户是否登录 XHunt，均能稳定获取其当前推特 ID（`twitterId`）**。
   - **完全不依赖不可靠且易变造的浏览器设备指纹（Fingerprint）**。
   - 投票记录与留言均以 `twitterId` 作为唯一用户标识。
   - **彻底规避“访客身份合并”问题**：用户免登录投票与后续登录留评归属于同一个 `twitterId`，无需做跨表或冲突数据合并。
3. **富文本标题支持**：议题标题支持富文本（`titleHtml`），可在标题中直接内嵌人物头像、KOL 徽标或特定强调样式。
4. **精确投放与测试阶段隔离**：
   - 支持按**展示领域**（多选：Web3、AI）与**展示语言**（多选：zh、en）配置可见性，非目标受众不返回数据。
   - 支持**测试模式（`testingPhase`）**，与后台 `stats#/nacos-campaigns` 一致，仅对配置的“内部测试人员”（`testList`）开放。
5. **纵深防御与全方位安全规范**：
   - 严格防范 XSS（跨站脚本攻击），对富文本标题采用超严格 HTML 白名单过滤，对留言 UGC 实施绝对纯文本脱敏；
   - 建立完善的字数与尺寸限制、接口级限流防刷、参数防篡改与越权防护。

---

## 2. 总体架构与系统交互

```text
┌────────────────────────────────────────────────────────┐
│               Chrome Extension (XHunt)                 │
│                                                        │
│  [HomeRightSidebar.tsx]                                │
│    ├── [Web3HomeSidebar.tsx]                           │
│    │     ├── HunterEarnSection (贡献榜/互动榜)          │
│    │     ├── ★ HotTopicVoteSection (热点投票)           │
│    │     └── Web3HotProjectsKOLs (实时热门)             │
│    └── [AiHomeSidebar.tsx]                             │
│          ├── HunterEarnSection                         │
│          ├── ★ HotTopicVoteSection (热点投票)           │
│          └── AiHotProjectsKOLs                         │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS 请求头:
                            │   x-tw-id: {twitterId} (必传, 正则校验 ^\d{1,25}$)
                            │   x-user-id: {twitterHandle}
                            │   Authorization: Bearer {token} (选填)
┌───────────────────────────▼────────────────────────────┐
│         Backend Service (luykin-chaineye-service)       │
│                                                        │
│  安全防护中间件与身份解析:                             │
│    ├── express.json({ limit: "16kb" }) 报文大小防御    │
│    ├── validateRequest & express-validator 强类型校验  │
│    ├── sanitizeVoteTitleHtml / sanitizePlainText 防XSS  │
│    ├── voteRateLimiter (IP/用户级频率限制与防并发)     │
│    ├── 领域 & 语言权限过滤 (displayDomains, displayLanguages)│
│    └── 内测白名单校验 (testingPhase -> isCampaignTester)│
│                                                        │
│  业务能力层:                                           │
│    ├── HotVoteTopicService (议题管理/富文本安全处理)    │
│    ├── HotVoteActionService (基于 twitterId 的原子投票/改票)│
│    └── HotVoteCommentService (留言发布/敏感词风控/防刷) │
│                                                        │
│  数据层:                                               │
│    ├── Redis: 票数聚合 Hash 缓存 (HINCRBY 原子改票)      │
│    └── PostgreSQL: Sequelize 数据模型持久化            │
└────────────────────────────────────────────────────────┘
```

---

## 3. 安全防护与边界风控规范（核心专题）

### 3.1 XSS 跨站脚本攻击综合防御体系

前端运行在宿主网页（`x.com`）中，若发生 XSS 注入将导致推特会话风险或插件上下文提权，必须在输入端、存储端与输出端执行纵深防御。

#### 1. 富文本标题（`titleHtml`）白名单过滤规范
运营在后台可能需要配置类似：`子时 <img src="..." /> vs <img src="..." /> 阿津`。
- **允许的标签白名单**：严格限定为 `['span', 'img', 'b', 'strong', 'i', 'em']`。
  - **严禁包含**：`<script>`, `<a>`, `<iframe>`, `<object>`, `<embed>`, `<svg>`, `<style>`, `<link>`, `<form>`, `<input>` 等任意可执行代码标签。
- **允许的属性白名单**：
  - `img`：仅允许 `src`, `alt`, `class`, `width`, `height`。
  - `span` / `strong` / `em`：仅允许 `class`。
- **协议与源地址安全约束**：
  - `img.src` 协议必须且仅允许 `http:` 或 `https:`。**严厉拦截 `javascript:`, `data:`, `vbscript:`, `blob:` 等伪协议**。
  - 图片域名必须命中白名单：`pbs.twimg.com`, `abs.twimg.com`, `twitter.com`, `x.com` 或官方 CDN。
- **样式隔离**：
  - **全局禁用内联 `style` 属性**（防止利用 CSS `expression()`、负 `margin` 或定位实施点击劫持 UI Redressing）。
  - 仅允许受信任的 Tailwind 辅助类名：`w-4`, `h-4`, `rounded-full`, `inline-block`, `align-sub`, `font-bold`, `mx-1`。
- **后端清洗代码实现**（挂载于 `src/xhunt/services/inputValidator.js`）：
```javascript
const xss = require('xss');

const VOTE_TITLE_XSS_OPTIONS = {
  whiteList: {
    span: ['class'],
    strong: ['class'],
    b: [],
    em: [],
    i: [],
    img: ['src', 'alt', 'class', 'width', 'height']
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'textarea'],
  onTagAttr: (tag, name, value) => {
    if (tag === 'img' && name === 'src') {
      const trimmed = String(value || '').trim();
      if (!/^https?:\/\//i.test(trimmed)) return ''; // 拒绝伪协议
      return `src="${xss.escapeAttrValue(trimmed)}"`;
    }
    if (name === 'class') {
      // 仅允许安全的样式类名，过滤可疑字符
      const safeClass = String(value || '').replace(/[^a-zA-Z0-9_\-\s]/g, '');
      return `class="${safeClass}"`;
    }
    return '';
  }
};

function sanitizeVoteTitleHtml(html, maxLength = 1000) {
  if (!html) return '';
  const trimmed = String(html).trim().substring(0, maxLength);
  return xss(trimmed, VOTE_TITLE_XSS_OPTIONS);
}
```

#### 2. 用户留言正文（`content`）纯文本脱敏规范
用户发表的留言属于公开 UGC，必须当成**纯文本**处理：
- **后端入库前**：调用 `sanitizePlainText(content, 200)`，`whiteList: {}`，强行剥离所有 HTML 标签。
- **前端展示时**：直接通过 React 默认 JSX `{comment.content}` 进行文本转义渲染，**绝不使用 `dangerouslySetInnerHTML`**。

#### 3. 议题名称、介绍与选项文本（`title`, `summary`, `options[].name`）
- 全部执行 `sanitizePlainText`，确保纯文本入库，杜绝标签注入。

---

### 3.2 字段长度限制与数据载荷上限（DoS 防护）

为避免恶意超长报文挤爆数据库、导致客户端卡死或撑爆侧边栏布局，制定以下严格长度契约：

| 字段名称 | 所属实体 | 字符限制 | 校验规则（express-validator） | 溢出处理与说明 |
| :--- | :--- | :--- | :--- | :--- |
| `title` | 议题纯文本标题 | 1 ~ 100 字符 | `.trim().isLength({ min: 1, max: 100 })` | 用于搜索、消息推送与兜底展示 |
| `titleHtml` | 议题富文本标题 | 1 ~ 1000 字符 | `.trim().isLength({ min: 1, max: 1000 })` | 容纳带头像的 HTML，阻断超大攻击载荷 |
| `summary` | 核心冲突介绍 | 5 ~ 100 字符 | `.trim().isLength({ min: 5, max: 100 })` | 必须为一句话冲突说明，避免过长折行 |
| `options` | 投票选项列表 | 2 ~ 6 个元素 | `isArray({ min: 2, max: 6 })` | 选项过多会导致侧边栏高度崩溃 |
| `options[].id` | 选项标识符 | 1 ~ 32 字符 | `matches(/^[a-zA-Z0-9_-]{1,32}$/)` | 仅限字母、数字、下划线及短横线 |
| `options[].name` | 选项名称 | 1 ~ 30 字符 | `.trim().isLength({ min: 1, max: 30 })` | 按钮宽度有限，超长自动截断 `truncate` |
| `options[].avatar`| 选项头像 URL | 0 ~ 512 字符 | `isURL({ protocols: ['http','https'] })` | 非必填，只允许合法图片外链 |
| `content` | 用户留言正文 | 1 ~ 200 字符 | `.trim().isLength({ min: 1, max: 200 })` | **纯空格拒绝**，超长接口直接 400 拦截 |
| `testList` | 内测名单数组 | 0 ~ 500 个 | `isArray({ max: 500 })` | 单个 handle 长度 1 ~ 50 字符 |

- **HTTP 传输层 Payload 限制**：
  在投票与留言路由中单独设置 `express.json({ limit: "16kb" })`，超限请求直接在最外层抛出 `413 Payload Too Large`。

---

### 3.3 接口防刷、频控与防灌水体系（Anti-Abuse）

#### 1. 投票与改票防刷
- **IP 级限流**：单 IP 每分钟最多 30 次投票请求，使用 `express-rate-limit`，防止黑产通过单台代理机批量构造推特 ID 爆破。
- **Twitter ID 级限流**：同一 `twitterId` 在 3 秒内仅允许提交 1 次投票操作，基于 Redis 键 `ratelimit:vote:${twitterId}`（TTL=3s）实现。
- **改票次数强制锁**：
  - 改票不是无限的，由议题表 `maxRevotes` 控制。
  - 在 PostgreSQL 事务内执行：`UPDATE "XHuntHotVoteRecords" SET "optionId" = :newOption, "revoteCount" = "revoteCount" + 1 WHERE "topicId" = :topicId AND "twitterId" = :twitterId AND "revoteCount" < :maxRevotes`。
  - 影响行数为 0 则直接判定为超出改票次数，返回 403 `REVOTE_LIMIT_EXCEEDED`，从数据库层杜绝并发改票绕过。

#### 2. 留言防灌水与敏感词风控
- **频率限制**：单用户（`twitterId`）在同一议题下两次留言间隔不得少于 30 秒（Redis 键 `ratelimit:comment:${topicId}:${twitterId}`，TTL=30s）。
- **单人条数上限**：单个用户在同一议题下累计留言不得超过 5 条，防止机器人刷榜屠版。
- **重复内容拦截**：对用户正文计算 MD5，在 5 分钟内同一用户禁止提交内容重复的留言。
- **敏感词过滤**：接入系统现有敏感词库，匹配涉政、色情、暴恐及钓鱼链接（Regex 匹配），命中时直接拒绝发布并提示。

---

### 3.4 身份鉴权、防越权（IDOR）与防篡改

#### 1. 推特 ID（`twitterId`）合法性强校验
- 请求头 `x-tw-id` 必须通过正则表达式校验：`/^\d{1,25}$/`（匹配标准的推特 Snowflake ID 纯数字格式）。非法格式直接 400 拒绝。
- 若请求中带有 XHunt 登录 Token，中间件自动校验 `req.user.twitterId === req.headers['x-tw-id']`。若不一致直接返回 403 `TWITTER_ID_MISMATCH`，彻底防止伪造他人推特 ID 投票。

#### 2. 留言发布的鉴权硬约束
- **必须通过 `authenticateToken` 中间件**（未登录直接 401 拦截）。
- **禁止信任客户端 Body 传递的用户信息**：入库的 `twitterId`、`userName`、`userAvatar` 必须全部且强制从服务端的 `req.user`（已校验通过的 JWT 及 DB 记录）中提取，杜绝冒用他人身份发表言论。

#### 3. 议题时效与状态防篡改
- 每次投票和留言时，必须先验证议题状态：
  `status === 'published' AND NOW() BETWEEN startTime AND endTime`。
  对于草稿、已下线、已归档或未在时间段内的议题，一律返回 403 `TOPIC_NOT_ACTIVE`。

---

## 4. 插件前端设计（tweet-hunt-extension）

### 4.1 挂载位置与代码结构
- **宿主文件**：
  - `src/compontents/homeRightSidebar/Web3HomeSidebar.tsx`（行 173 附近）
  - `src/compontents/homeRightSidebar/AiHomeSidebar.tsx`（行 45 附近）
- **挂载插槽**：紧随 `<HunterEarnSection />` 之后，`<Web3HotProjectsKOLs />` / `<AiHotProjectsKOLs />` 之前。
- **组件结构**：
```text
src/compontents/HotTopicVote/
├── HotTopicVoteSection.tsx        // 模块总入口：生命周期、网络容错、显隐关闭控制
├── HotTopicHeader.tsx             // 标题与关闭按钮（🔥 热点投票 + 关闭 ✕）
├── HotTopicRichTitle.tsx          // 富文本标题安全呈现组件（过滤清洗与图片渲染）
├── HotTopicEntityPK.tsx           // 人物 PK 对立布局（双方圆形头像、名称、VS）
├── HotTopicEntityTopic.tsx        // 普通议题布局（纯文字选项、一句话冲突说明）
├── VoteActionPanel.tsx            // 投票前操作区（选项按钮组 + 🍉吃个瓜）
├── VoteResultPanel.tsx            // 投票后原位结果区（已选项标记、修改选择、进度条）
├── VoteCommentSection.tsx         // 留言区（未登录提示/输入框、留言列表、分页器）
├── hooks/
│   ├── useHotVoteTopic.ts         // 议题拉取、本地选择暂存、改票上限管理
│   └── useVoteComments.ts         // 留言列表获取、提交发布、分页控制
└── types.ts                       // TypeScript 类型声明
```

### 4.2 前端输入验证与防重设计
- **字数实时提示**：留言输入框右下角显示实时字数 `current/200`，超长禁止输入并变红警示。
- **空输入拦截**：当 `content.trim().length === 0` 时，【发布】按钮处于 `disabled` 状态。
- **异步加锁（`useLockFn`）**：投票和发布留言使用 ahooks 的 `useLockFn`，在异步网络请求返回前，禁止多次点击触发重复发包。

---

## 5. 后端数据库模型设计（PostgreSQL + Sequelize）

### 1. 热点议题主表 `XHuntHotVoteTopics`
```javascript
module.exports = (sequelize) => {
  return sequelize.define("XHuntHotVoteTopic", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: "议题唯一ID",
    },
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "纯文本标题 (限100字)",
    },
    titleHtml: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "富文本标题 (限1000字符，白名单HTML标签)",
    },
    summary: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "一句话核心冲突介绍 (限100字)",
    },
    topicType: {
      type: DataTypes.ENUM("person_pk", "general_topic"),
      defaultValue: "person_pk",
      comment: "议题形式: 人物PK / 普通议题",
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      comment: "选项定义: [{ id, name, avatar, color, isGua }]",
    },
    displayDomains: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ["web3"],
      comment: "可见领域: ['web3', 'ai']",
    },
    displayLanguages: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ["zh"],
      comment: "可见语言: ['zh', 'en']",
    },
    testingPhase: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否处于测试阶段 (测试阶段仅对 testList 可见)",
    },
    testList: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: false,
      defaultValue: [],
      comment: "内部测试人员名单 (Twitter handle 或 ID 列表)",
    },
    maxRevotes: {
      type: DataTypes.INTEGER,
      defaultValue: 2,
      comment: "允许修改选择的最大次数 (默认2次)",
    },
    status: {
      type: DataTypes.ENUM("draft", "published", "ended", "archived"),
      defaultValue: "draft",
      comment: "议题状态",
    },
    sortWeight: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "排序权重 (数值大者优先展示)",
    },
    startTime: { type: DataTypes.DATE, allowNull: true },
    endTime: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "XHuntHotVoteTopics",
    timestamps: true,
    indexes: [
      { fields: ["status", "sortWeight"] },
      { fields: ["testingPhase"] },
      { fields: ["createdAt"] },
    ],
  });
};
```

### 2. 用户投票流水表 `XHuntHotVoteRecords`
```javascript
module.exports = (sequelize) => {
  return sequelize.define("XHuntHotVoteRecord", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    topicId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "XHuntHotVoteTopics", key: "id" },
      comment: "所属议题ID",
    },
    twitterId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "推特唯一ID (唯一身份标识，不依赖登录)",
    },
    xHuntUserId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "XHuntUsers", key: "id" },
      comment: "XHunt 用户 ID (若已登录则关联)",
    },
    optionId: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "当前支持的选项ID",
    },
    previousOptionId: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "上一次支持的选项ID",
    },
    revoteCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "已修改次数",
    },
    clientIp: { type: DataTypes.STRING(64), allowNull: true },
  }, {
    tableName: "XHuntHotVoteRecords",
    timestamps: true,
    indexes: [
      {
        name: "uk_hot_vote_topic_twitter_id",
        unique: true,
        fields: ["topicId", "twitterId"],
        comment: "同一推特用户在同一议题下唯一",
      },
      { fields: ["topicId", "optionId"] },
      { fields: ["twitterId"] },
    ],
  });
};
```

### 3. 议题留言表 `XHuntHotVoteComments`
```javascript
module.exports = (sequelize) => {
  return sequelize.define("XHuntHotVoteComment", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    topicId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "XHuntHotVoteTopics", key: "id" },
    },
    twitterId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "留言者推特ID (用户索引与投票身份严格对应)",
    },
    xHuntUserId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "XHuntUsers", key: "id" },
      comment: "必须登录才能留言",
    },
    userName: { type: DataTypes.STRING(128), allowNull: false },
    displayName: { type: DataTypes.STRING(128), allowNull: true },
    userAvatar: { type: DataTypes.STRING(512), allowNull: false },
    content: { 
      type: DataTypes.STRING(200), 
      allowNull: false, 
      comment: "留言内容 (脱敏纯文本，限200字)" 
    },
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false, comment: "管理员屏蔽" },
  }, {
    tableName: "XHuntHotVoteComments",
    timestamps: true,
    indexes: [
      { name: "idx_hot_vote_comments_topic_created", fields: ["topicId", "createdAt"] },
      { name: "idx_hot_vote_comments_twitter_id", fields: ["twitterId"] },
      { name: "idx_hot_vote_comments_topic_twitter", fields: ["topicId", "twitterId"] },
    ],
  });
};
```

---

## 6. 接口设计与安全校验实现规范

### 6.1 插件端接口与参数校验

#### 1. 获取当前热点议题及个人投票态
- **Path**: `GET /api/xhunt/hot-vote/active`
- **Request Headers**:
  - `x-tw-id`: 用户当前推特 ID（必填，`matches(/^\d{1,25}$/)`）
  - `x-user-id`: 用户当前推特 Handle
- **Query**:
  - `domain`: `web3` | `ai`
  - `lang`: `zh` | `en`
- **安全过滤逻辑**：
  1. 状态为 `published` 且当前时间在 `startTime ~ endTime`；
  2. 匹配 `displayDomains` 与 `displayLanguages`；
  3. **测试阶段隔离**：若 `testingPhase === true`，仅当 `testList` 包含 `x-user-id` 或 `x-tw-id` 时返回，否则返回 `null`；
  4. 若未投票，下发数据中 `results` 字段强行置 `null`。

#### 2. 提交投票（免登录 / 登录）
- **Path**: `POST /api/xhunt/hot-vote/topics/:topicId/vote`
- **Validators**:
```javascript
[
  header('x-tw-id').trim().matches(/^\d{1,25}$/).withMessage('无效的推特ID'),
  param('topicId').isUUID().withMessage('无效的议题ID'),
  body('optionId').trim().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('无效的选项ID'),
  validateRequest
]
```
- **业务安全处理**：
  - 校验当前 IP 频控（1分钟30次）与该 `twitterId` 频控（3秒1次）；
  - 检查议题有效性与选项存在性；
  - 数据库 `INSERT ... ON CONFLICT DO NOTHING` 或事务判断；
  - 成功后利用 Redis `HINCRBY` 更新聚合票数。

#### 3. 修改投票
- **Path**: `PUT /api/xhunt/hot-vote/topics/:topicId/vote`
- **Validators**:
```javascript
[
  header('x-tw-id').trim().matches(/^\d{1,25}$/).withMessage('无效的推特ID'),
  param('topicId').isUUID().withMessage('无效的议题ID'),
  body('newOptionId').trim().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('无效的新选项ID'),
  validateRequest
]
```
- **业务安全处理**：
  - 校验 `revoteCount < maxRevotes`，并在 SQL 事务内以行级锁更新；
  - Redis Pipeline 扣减旧票并增加新票。

#### 4. 获取留言列表（公开查询）
- **Path**: `GET /api/xhunt/hot-vote/topics/:topicId/comments`
- **Validators**:
```javascript
[
  param('topicId').isUUID().withMessage('无效的议题ID'),
  query('page').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 20 }).toInt(),
  validateRequest
]
```

#### 5. 发布留言（需 XHunt 登录鉴权）
- **Path**: `POST /api/xhunt/hot-vote/topics/:topicId/comments`
- **Middleware**: `authenticateToken`
- **Validators**:
```javascript
[
  param('topicId').isUUID().withMessage('无效的议题ID'),
  body('content').trim().isLength({ min: 1, max: 200 }).withMessage('留言字数限制在 1-200 字之间'),
  validateRequest
]
```
- **业务安全处理**：
  - 提取 `req.user.twitterId`，严格不从 body 读取；
  - 校验 30 秒发言间隔与单人 5 条上限；
  - 执行 `sanitizePlainText(req.body.content, 200)` 去除任何标签；
  - 敏感词库检测；
  - 写入 `XHuntHotVoteComments`。

---

### 6.2 运营管理后台接口（Admin CMS）
- `GET /api/xhunt/admin/hot-vote/topics`：议题列表（权限：`adminAuth`, `requirePermission('nacos_config')`）。
- `POST /api/xhunt/admin/hot-vote/topics`：新建议题（服务端在入库前必须对 `titleHtml` 执行 `sanitizeVoteTitleHtml`）。
- `PUT /api/xhunt/admin/hot-vote/topics/:id`：修改议题配置。
- `DELETE /api/xhunt/admin/hot-vote/topics/:topicId/comments/:commentId`：违规留言屏蔽（置 `isDeleted = true` 并记入 `XhuntAdminAuditLog`）。
- `GET /api/xhunt/admin/hot-vote/internal-testers`：获取预设内测名单。

---

## 7. 需求验收支持矩阵（A01~A14 安全与功能整合）

| 编号 | 验收场景 | 技术支撑与安全保障方案 |
| :--- | :--- | :--- |
| **A01** | 配置不同热点 | 后端动态配置，插件端动态组件渲染，无需增设或打包新页面。 |
| **A02** | 人物与多选项议题 | 支持富文本带头像标题（经 XSS 白名单清洗）与选项展示；系统兜底提供“吃个瓜”。 |
| **A03** | 未登录投票 | 依托 Twitter 宿主环境的 `x-tw-id`（正则校验），免登录且杜绝伪造。 |
| **A04** | 投票前后展示 | 投票后原位平滑切换显示当前已选项、修改按钮与分布条。未投前结果强制为 null。 |
| **A05** | 选择吃瓜 | 吃瓜选项作为合法 `optionId` 入库，修改选择与结果查看逻辑完全对齐。 |
| **A06** | 重复点击与失败重试 | 数据库 `(topicId, twitterId)` 唯一索引防重；结果加载失败支持原位重试。前端 `useLockFn` 防重发。 |
| **A07** | 修改选择 | 事务条件约束 `revoteCount < maxRevotes`，原子切换票数，修改失败保留原选择。 |
| **A08** | 未登录浏览留言 | 留言列表接口公开可查；输入区域展示登录引导遮罩。 |
| **A09** | 留言入口位置 | 布局层级严格遵循：标题冲突 → 选项/结果 → 大家的留言 → 引导/输入框 → 列表。 |
| **A10** | 登录后留言 | 前后端一致采用 `twitterId`，登录回跳无需身份合并，保留选择并显示输入框。 |
| **A11** | 留言异常 | 前端校验 1-200 字，禁止纯空格；接口网络异常时保留文本域内容供用户重试。 |
| **A12** | 留言身份 | 取自登录用户绑定的官方昵称与头像，正文严格执行纯文本转义，不设匿名发布选项。 |
| **A13** | 配置与关闭 | 本地存储记录卡片隐藏态，关闭不触发撤票；领域与语言严格匹配过滤。 |
| **A14** | 事件隔离 | 所有存储与缓存均带 `topicId` 命名空间，改票次数与结果状态互不串用。 |

---

## 8. 开发分工与排期

- **Phase 1: 后端数据模型、安全清洗与管理后台配置（2 天）**
  - 新建 `XHuntHotVoteTopics`、`XHuntHotVoteRecords`、`XHuntHotVoteComments` 模型与同步。
  - 实现 `sanitizeVoteTitleHtml` 富文本白名单清洗与 `express-validator` 规则。
  - 完成 Admin 配置接口（富文本标题、领域/语言多选、`testingPhase`、`testList` 名单）。
  - 实现基于 `twitterId` 的防重投票、改票及 Redis Pipeline 计数。
- **Phase 2: 插件端核心 UI、富文本安全渲染与免登录链路（2.5 天）**
  - 在 `Web3HomeSidebar.tsx` 与 `AiHomeSidebar.tsx` 插槽中实现 `HotTopicVoteSection`。
  - 实现富文本标题安全渲染（带内联头像）、人物 PK 视图、文字选项及原位进度条切换。
  - 对接免登录投票接口、字数实时统计与本地状态恢复。
- **Phase 3: 留言系统、内测验证与端到端联调（1.5 天）**
  - 对接 Twitter 登录授权后输入框就绪、留言防刷、敏感词过滤与分页器。
  - 在测试环境中验证 `testingPhase` 白名单拦截机制与跨领域/语言过滤。
  - 针对 XSS 边界用例、高频重发、字数溢出及 A01~A14 进行完整回归与容错调优。
