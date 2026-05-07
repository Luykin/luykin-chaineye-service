# 币安广场爬虫技术方案文档

## 1. 项目概述

### 1.1 目标
构建一个币安广场（Binance Square）内容爬虫系统，实现：
1. 种子用户关注列表采集与存储
2. 基于关注关系计算高影响力目标用户（Top 50）
3. 定时抓取目标用户的文章/引用/回复/关注数据
4. 历史版本镜像存储与对比分析
5. 数据保留策略（3天滚动清理）

### 1.2 架构定位
本项目复用现有 `RootDataPro` 爬虫基础设施：
- **数据库**：使用 PostgreSQL（`rootdatapro` 数据库），**不使用 SQLite**
- 迁移文件统一放在 `migrations-pg/` 目录下
- 复用 Puppeteer + Stealth 浏览器封装
- 复用 Redis 任务队列与状态管理
- 复用 Sequelize ORM 与工厂函数模型定义
- 复用 `node-schedule` 定时调度器
- **代码组织**：所有新功能集中在 `src/binance-square/` 目录下，不分散到现有模块中
- **管理后台**：复用现有 `src/xhunt/views/stats.ejs` 管理后台风格，新增币安广场管理页面

---

## 2. 数据模型设计

### 2.1 模型总览

| 模型 | 表名 | 说明 |
|------|------|------|
| BinanceSquareUser | `BinanceSquareUsers` | 币安广场用户主表（种子+被关注者+目标用户） |
| BinanceSquareFollowing | `BinanceSquareFollowings` | 关注关系表（谁关注了谁） |
| BinanceSquareSeedConfig | `BinanceSquareSeedConfigs` | 种子用户配置表（可手动维护） |
| BinanceSquareTargetRank | `BinanceSquareTargetRanks` | 目标用户排名表（Top 50计算结果） |
| BinanceSquarePost | `BinanceSquarePosts` | 帖子/文章主表（去重存储） |
| BinanceSquarePostSnapshot | `BinanceSquarePostSnapshots` | 帖子历史镜像表（3天滚动） |
| BinanceSquareCrawlLog | `BinanceSquareCrawlLogs` | 爬取日志表（复用 RootDataPro CrawlLog 模式） |
| BinanceSquareConfig | `BinanceSquareConfigs` | 爬虫配置表（定时间隔等动态调控项） |

### 2.2 字段约束设计原则

爬虫系统的核心特点是**数据来源不稳定**（API限流、字段变动、网络中断、部分数据缺失），因此字段约束设计遵循以下原则：

| 原则 | 说明 | 示例 |
|------|------|------|
| **API字段全部允许null** | 币安接口返回的数据字段，一律不设 `allowNull: false`，不设 `defaultValue`。API返回什么就存什么，缺失的存null。 | `squareUid`, `displayName`, `totalFollowerCount` |
| **程序传入字段保持not null** | 由代码传入/生成的关键字段（查询key、关联字段、状态标记），保持 `allowNull: false`。 | `username`, `followerUsername`, `postId` |
| **计数字段不设默认值** | 不默认填充0，保持null表示"未知/未获取"。查询时用 `COALESCE(count, 0)` 处理。 | `totalFollowerCount`, `likeCount` |
| **保留rawData字段** | 每个表都保留 `rawData: JSONB`，API返回的完整原始数据写入此处，字段缺失时可通过rawData追溯。 | `BinanceSquareUser.rawData` |
| **不删除不存在的字段** | 新增字段随时加，旧字段保留（不删除），通过rawData兼容历史数据。 | 表结构只增不减 |

### 2.3 详细字段定义

#### 2.2.1 BinanceSquareUser（用户主表）

> **设计原则**：API返回的字段全部允许null，防止接口变动或数据缺失导致写入失败。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareUser", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: "自增主键",
    },
    // === 程序传入/生成的关键字段（not null） ===
    username: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "用户名（如 CZ）—— 程序传入的查询key",
    },
    isSeedUser: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "是否为种子用户",
    },
    isTargetUser: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "是否为目标用户(Top50)",
    },
    followScore: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "被关注分数（种子用户关注次数）",
    },
    lastCrawledAt: {
      type: DataTypes.DATE,
      comment: "最后抓取时间 —— 帖子抓取时更新，关注同步时不更新",
    },

    // === API返回的字段（全部允许null） ===
    squareUid: {
      type: DataTypes.STRING(64),
      comment: "币安广场用户UID —— API返回，可能缺失",
    },
    displayName: {
      type: DataTypes.STRING(256),
      comment: "显示名称 —— API返回，可能缺失",
    },
    avatar: {
      type: DataTypes.TEXT,
      comment: "头像URL —— API返回，可能缺失",
    },
    biography: {
      type: DataTypes.TEXT,
      comment: "个人简介 —— API返回，可能缺失",
    },
    role: {
      type: DataTypes.INTEGER,
      comment: "角色标识 —— API返回，可能缺失",
    },
    verificationType: {
      type: DataTypes.INTEGER,
      comment: "认证类型 —— API返回，可能缺失",
    },
    verificationDescription: {
      type: DataTypes.STRING(256),
      comment: "认证描述 —— API返回，可能缺失",
    },
    totalFollowerCount: {
      type: DataTypes.INTEGER,
      comment: "粉丝总数 —— API返回，可能缺失",
    },
    totalFollowingCount: {
      type: DataTypes.INTEGER,
      comment: "关注总数 —— API返回，可能缺失",
    },
    totalPostCount: {
      type: DataTypes.INTEGER,
      comment: "帖子总数 —— API返回，可能缺失",
    },
    totalLikeCount: {
      type: DataTypes.INTEGER,
      comment: "获赞总数 —— API返回，可能缺失",
    },
    totalShareCount: {
      type: DataTypes.INTEGER,
      comment: "被分享总数 —— API返回，可能缺失",
    },
    accountLang: {
      type: DataTypes.STRING(16),
      comment: "账号语言 —— API返回，可能缺失",
    },
    isKol: {
      type: DataTypes.BOOLEAN,
      comment: "是否KOL —— API返回，可能缺失",
    },
    userStatus: {
      type: DataTypes.INTEGER,
      comment: "用户状态 —— API返回，可能缺失",
    },
    level: {
      type: DataTypes.INTEGER,
      comment: "用户等级 —— API返回，可能缺失",
    },

    // === 原始数据备份 ===
    rawData: {
      type: DataTypes.JSONB,
      comment: "原始API响应数据（完整备份）—— API异常时用于排查",
    },
  }, {
    tableName: "BinanceSquareUsers",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["username"] },
      { fields: ["squareUid"] },
      { fields: ["isSeedUser"] },
      { fields: ["isTargetUser"] },
      { fields: ["followScore"] },
      { fields: ["lastCrawledAt"] },
    ],
  });
};
```

#### 2.2.2 BinanceSquareFollowing（关注关系表）

> **设计原则**：关系表字段由程序传入，保持not null。被关注者SquareUid由API返回，允许null。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareFollowing", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // 程序传入的关键字段（not null）
    followerUsername: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "关注者用户名（种子用户）",
    },
    followingUsername: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "被关注者用户名",
    },
    // API返回的字段（允许null）
    followingSquareUid: {
      type: DataTypes.STRING(64),
      comment: "被关注者SquareUid —— API返回，可能缺失",
    },
  }, {
    tableName: "BinanceSquareFollowings",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["followerUsername", "followingUsername"] },
      { fields: ["followerUsername"] },
      { fields: ["followingUsername"] },
    ],
  });
};
```

#### 2.2.3 BinanceSquareSeedConfig（种子用户配置表）

> **设计原则**：配置表由人工维护，username必须提供，其他可选。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareSeedConfig", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    username: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "用户名 —— 手动配置时必须提供",
    },
    displayName: {
      type: DataTypes.STRING(256),
      comment: "显示名称 —— 可选",
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "排序权重",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: "是否激活",
    },
    description: {
      type: DataTypes.TEXT,
      comment: "备注说明",
    },
  }, {
    tableName: "BinanceSquareSeedConfigs",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["username"] },
      { fields: ["isActive", "sortOrder"] },
    ],
  });
};
```

#### 2.2.4 BinanceSquareTargetRank（目标用户排名表）

> **设计原则**：排名数据由程序聚合计算生成，核心字段not null。seedFollowers为辅助信息，允许null。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareTargetRank", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // 程序生成的核心字段（not null）
    username: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "目标用户用户名",
    },
    rank: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "排名(1-50)",
    },
    followerCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "被种子用户关注次数",
    },
    lastCalculatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "最后计算时间",
    },
    // 辅助信息（允许null）
    seedFollowers: {
      type: DataTypes.JSONB,
      comment: "关注该用户的种子用户列表[{username,displayName}] —— 聚合时生成",
    },
  }, {
    tableName: "BinanceSquareTargetRanks",
    timestamps: true,
    indexes: [
      { fields: ["rank"] },
      { fields: ["lastCalculatedAt"] },
    ],
  });
};
```

#### 2.2.5 BinanceSquarePost（帖子主表）

> **设计原则**：帖子表为TODO功能预留。程序生成的key字段（postId, username, postType）not null，API返回的内容字段全部允许null（纯图片帖可能没有title/content，新帖可能没有互动数据）。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquarePost", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // === 程序传入的关键字段（not null） ===
    postId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "币安帖子ID —— 程序传入的唯一标识",
    },
    username: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "作者用户名 —— 程序传入",
    },
    postType: {
      type: DataTypes.ENUM("article", "quote", "reply", "following"),
      allowNull: false,
      comment: "帖子类型 —— 程序传入",
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "是否已删除",
    },
    lastSnapshotId: {
      type: DataTypes.STRING(64),
      comment: "最新镜像批次ID",
    },

    // === API返回的内容字段（全部允许null） ===
    title: {
      type: DataTypes.TEXT,
      comment: "标题 —— API返回，纯图片帖可能为空",
    },
    content: {
      type: DataTypes.TEXT,
      comment: "内容正文 —— API返回，可能为空",
    },
    contentText: {
      type: DataTypes.TEXT,
      comment: "纯文本内容 —— API返回，可能为空",
    },
    mediaUrls: {
      type: DataTypes.JSONB,
      comment: "媒体文件URL数组 —— API返回，可能为空",
    },
    likeCount: {
      type: DataTypes.INTEGER,
      comment: "点赞数 —— API返回，新帖可能为空",
    },
    shareCount: {
      type: DataTypes.INTEGER,
      comment: "分享数 —— API返回，可能为空",
    },
    commentCount: {
      type: DataTypes.INTEGER,
      comment: "评论数 —— API返回，可能为空",
    },
    viewCount: {
      type: DataTypes.INTEGER,
      comment: "浏览数 —— API返回，可能为空",
    },
    publishedAt: {
      type: DataTypes.DATE,
      comment: "发布时间 —— API返回，可能为空",
    },
    sourceUrl: {
      type: DataTypes.TEXT,
      comment: "原文链接 —— API返回，可能为空",
    },

    // === 原始数据备份 ===
    rawData: {
      type: DataTypes.JSONB,
      comment: "原始API数据",
    },
  }, {
    tableName: "BinanceSquarePosts",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["postId"] },
      { fields: ["username"] },
      { fields: ["postType"] },
      { fields: ["publishedAt"] },
      { fields: ["isDeleted"] },
      { fields: ["lastSnapshotId"] },
    ],
  });
};
```

#### 2.2.6 BinanceSquarePostSnapshot（帖子镜像表）

> **设计原则**：程序生成的标识字段not null，从Post表复制的数据字段全部允许null（保持与源表一致）。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquarePostSnapshot", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // === 程序生成的标识字段（not null） ===
    postId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "帖子ID",
    },
    snapshotId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "镜像批次ID（格式：YYYYMMDDHHmmss）",
    },
    snapshotTime: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "镜像时间",
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "帖子是否已删除",
    },

    // === 从Post表复制的数据字段（全部允许null） ===
    title: {
      type: DataTypes.TEXT,
      comment: "标题快照 —— 源数据可能为空",
    },
    content: {
      type: DataTypes.TEXT,
      comment: "内容快照 —— 源数据可能为空",
    },
    contentText: {
      type: DataTypes.TEXT,
      comment: "纯文本快照 —— 源数据可能为空",
    },
    mediaUrls: {
      type: DataTypes.JSONB,
      comment: "媒体URL快照 —— 源数据可能为空",
    },
    likeCount: {
      type: DataTypes.INTEGER,
      comment: "点赞数 —— 源数据可能为空",
    },
    shareCount: {
      type: DataTypes.INTEGER,
      comment: "分享数 —— 源数据可能为空",
    },
    commentCount: {
      type: DataTypes.INTEGER,
      comment: "评论数 —— 源数据可能为空",
    },
    viewCount: {
      type: DataTypes.INTEGER,
      comment: "浏览数 —— 源数据可能为空",
    },

    // === 差异记录 ===
    diffFromPrev: {
      type: DataTypes.JSONB,
      comment: "与上一版本的差异记录 —— 每次抓取时自动计算，无变化时存null",
    },
  }, {
    tableName: "BinanceSquarePostSnapshots",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["postId", "snapshotId"], name: "idx_snapshot_postid_snapshotid_unique" },
      { fields: ["snapshotId"] },
      { fields: ["snapshotTime"] },
      { fields: ["postId", "snapshotTime"] },
    ],
  });
};
```

#### 2.2.7 BinanceSquareCrawlLog（爬取日志表）

> **设计原则**：taskType和status由程序设置（not null），其他信息根据实际执行情况可能缺失。target_calculate任务没有targetId，失败时可能没有durationMs/itemsCount。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareCrawlLog", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // 程序设置的核心字段（not null）
    taskType: {
      type: DataTypes.ENUM("following", "post", "target_calculate"),
      allowNull: false,
      comment: "任务类型",
    },
    status: {
      type: DataTypes.ENUM("success", "failed", "partial"),
      allowNull: false,
      comment: "执行状态",
    },
    // 可选的辅助信息（允许null）
    targetId: {
      type: DataTypes.STRING(128),
      comment: "目标标识（用户名/帖子ID）—— target_calculate任务无此字段",
    },
    errorMessage: {
      type: DataTypes.TEXT,
      comment: "错误信息 —— 失败时记录",
    },
    durationMs: {
      type: DataTypes.INTEGER,
      comment: "耗时毫秒 —— 失败时可能为空",
    },
    itemsCount: {
      type: DataTypes.INTEGER,
      comment: "抓取项目数 —— 失败时可能为空",
    },
    filterType: {
      type: DataTypes.ENUM("ALL", "REPLY", "QUOTE"),
      comment: "帖子抓取的filterType —— 非帖子任务为空",
    },
    snapshotId: {
      type: DataTypes.STRING(64),
      comment: "关联镜像批次ID —— 非帖子任务为空",
    },
  }, {
    tableName: "BinanceSquareCrawlLogs",
    timestamps: true,
    indexes: [
      { fields: ["taskType", "status"] },
      { fields: ["filterType"] },
      { fields: ["targetId"] },
      { fields: ["snapshotId"] },
      { fields: ["createdAt"] },
    ],
  });
};
```

#### 2.2.8 BinanceSquareConfig（爬虫配置表）

> **设计原则**：支持管理后台动态调控爬虫行为，配置即时生效。

```javascript
module.exports = (sequelize) => {
  return sequelize.define("BinanceSquareConfig", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    configKey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "配置项key",
    },
    configValue: {
      type: DataTypes.STRING(256),
      allowNull: false,
      comment: "配置项value（字符串存储，使用时转换）",
    },
    description: {
      type: DataTypes.TEXT,
      comment: "配置说明",
    },
    minValue: {
      type: DataTypes.STRING(64),
      comment: "最小值（用于前端校验，数字类型时）",
    },
    maxValue: {
      type: DataTypes.STRING(64),
      comment: "最大值（用于前端校验，数字类型时）",
    },
    updatedBy: {
      type: DataTypes.STRING(128),
      comment: "最后修改人（admin邮箱）",
    },
  }, {
    tableName: "BinanceSquareConfigs",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["configKey"] },
    ],
  });
};
```

**默认配置项**：

| configKey | configValue | minValue | maxValue | 说明 |
|-----------|-------------|----------|----------|------|
| `post_crawl_interval_hours` | `2` | `0.5` | `4` | 帖子抓取间隔（小时） |
| `snapshot_retention_days` | `3` | `1` | `7` | 镜像保留天数 |

> 定时调度器启动时从数据库读取配置，支持**热更新**：管理后台修改配置后，下次调度时自动生效（正在运行的定时任务不受影响，新任务按新间隔执行）。

### 2.4 模型关联关系

```javascript
// src/binance-square/models/index.js

// 用户 ↔ 关注关系（一对多）
db.BinanceSquareUser.hasMany(db.BinanceSquareFollowing, {
  foreignKey: "followerUsername",
  sourceKey: "username",
  as: "Followings",
});

// 用户 ↔ 帖子（一对多）
db.BinanceSquareUser.hasMany(db.BinanceSquarePost, {
  foreignKey: "username",
  sourceKey: "username",
  as: "Posts",
});

// 帖子 ↔ 镜像（一对多）
db.BinanceSquarePost.hasMany(db.BinanceSquarePostSnapshot, {
  foreignKey: "postId",
  sourceKey: "postId",
  as: "Snapshots",
});
```

### 2.5 数据库连接

币安广场模块复用 RootDataPro 的 PostgreSQL 连接（`rootdatapro` 数据库），在 `src/binance-square/models/index.js` 中通过传入已有的 `sequelize` 实例初始化模型。

```javascript
// 使用方式（复用 rootdatapro 的 sequelize 实例）
const { sequelize } = require("../../rootdatapro/models");
const db = require("./index")(sequelize);
```

---

## 3. 目录结构设计

```
src/binance-square/
├── models/                          # 数据模型（PostgreSQL）
│   ├── index.js                     # 模型初始化与关联
│   ├── BinanceSquareUser.js
│   ├── BinanceSquareFollowing.js
│   ├── BinanceSquareSeedConfig.js
│   ├── BinanceSquareTargetRank.js
│   ├── BinanceSquarePost.js
│   ├── BinanceSquarePostSnapshot.js
│   ├── BinanceSquareCrawlLog.js
│   └── BinanceSquareConfig.js       # 爬虫配置表（动态调控）
├── scraper/                         # 爬虫核心
│   ├── index.js                     # 爬虫入口与主控逻辑
│   ├── api-client.js                # 币安API HTTP客户端
│   ├── taskManager.js               # 任务队列管理器（Redis）
│   ├── db-updater.js                # 数据库写入器（UPSERT+批量）
│   ├── snapshot-manager.js          # 镜像管理器（生成/对比/清理）
│   └── parsers/
│       ├── followingParser.js       # 关注列表解析
│       └── postParser.js            # 帖子内容解析
├── api/                             # 内部管理API
│   └── binance-square.js            # 路由：/api/binance-square/internal
├── services/                        # 业务服务
│   ├── scheduler.js                 # 定时调度器
│   └── config-service.js            # 配置读取服务（动态调控）
└── views/                           # 管理后台页面（复用stats.ejs风格）
    ├── binance-square-tab.ejs       # 嵌入stats.ejs的Tab页（总览+操作面板）
    ├── seed-users.ejs               # 种子用户管理子面板
    ├── target-users.ejs             # Top50目标用户子面板
    ├── posts-list.ejs               # 帖子列表子面板
    └── post-detail.ejs              # 帖子详情+镜像对比子面板
```

---

## 4. API 接口设计

### 4.1 内部管理 API（`/api/binance-square/internal`，需 adminAuth）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/seed/init` | 初始化种子用户（将25人名单写入SeedConfig+User表） |
| GET | `/seed/list` | 获取种子用户列表 |
| POST | `/seed/add` | 添加种子用户 |
| POST | `/seed/remove` | 移除种子用户 |
| POST | `/following/sync` | 手动触发：同步所有种子用户的关注列表 |
| POST | `/following/sync/:username` | 手动触发：同步单个种子用户的关注列表 |
| POST | `/target/calculate` | 手动触发：计算Top50目标用户 |
| GET | `/target/list` | 获取当前Top50目标用户列表 |
| POST | `/crawl/posts` | 手动触发：抓取目标用户帖子 |
| POST | `/crawl/start` | 启动定时爬虫任务 |
| POST | `/crawl/pause` | 暂停定时爬虫任务 |
| POST | `/crawl/posts` | 手动触发：抓取目标用户帖子 |
| POST | `/crawl/start` | 启动定时爬虫任务 |
| POST | `/crawl/pause` | 暂停定时爬虫任务 |
| GET | `/crawl/status` | 获取爬虫运行状态 |
| GET | `/posts` | 查询帖子列表（支持分页、类型筛选、用户名筛选） |
| GET | `/posts/:postId` | 查询单条帖子详情 |
| GET | `/posts/:postId/snapshots` | 查询某帖子的历史镜像列表 |
| GET | `/posts/snapshot-compare` | 对比两个镜像批次（或同一帖子两个时间点） |
| GET | `/crawl/logs` | 查询爬取日志列表（支持按类型/状态/时间筛选） |
| GET | `/config` | 获取爬虫配置列表 |
| POST | `/config` | 更新爬虫配置（管理后台动态调控） |

### 4.2 关键接口请求/响应示例

#### 4.2.1 初始化种子用户
```http
POST /api/binance-square/internal/seed/init
```
请求体：
```json
{
  "seeds": [
    { "username": "CZ", "displayName": "CZ" },
    { "username": "heyi", "displayName": "heyi" },
    { "username": "richardteng", "displayName": "richardteng" },
    { "username": "justinsun", "displayName": "justinsun" },
    { "username": "zhuyidan", "displayName": "zhuyidan" },
    { "username": "jack", "displayName": "jack" },
    { "username": "shock", "displayName": "shock" },
    { "username": "ember", "displayName": "ember" },
    { "username": "TheCryptoLark", "displayName": "TheCryptoLark" },
    { "username": "aiaptx", "displayName": "aiaptx" },
    { "username": "killthewolf", "displayName": "killthewolf" },
    { "username": "thankucrypto", "displayName": "thankucrypto" },
    { "username": "korm_brc20", "displayName": "korm_brc20" },
    { "username": "bitwing", "displayName": "bitwing" },
    { "username": "btc7873", "displayName": "btc7873" },
    { "username": "square-creator-294f8fe75", "displayName": "square-creator-294f8fe75" },
    { "username": "seven_78977", "displayName": "seven_78977" },
    { "username": "cc27107", "displayName": "cc27107" },
    { "username": "cnaapp", "displayName": "cnaapp" },
    { "username": "square-mlh", "displayName": "square-mlh" },
    { "username": "meta8mate", "displayName": "meta8mate" },
    { "username": "pumpman", "displayName": "pumpman" },
    { "username": "btcpiggy", "displayName": "btcpiggy" },
    { "username": "yanchibit", "displayName": "yanchibit" },
    { "username": "lianyanshe", "displayName": "lianyanshe" }
  ]
}
```
**说明**：初始25人名单通过此API手动导入，**不硬编码在迁移文件中**。后续可通过 `/seed/add` 和 `/seed/remove` 动态维护。

#### 4.2.2 同步关注列表
```http
POST /api/binance-square/internal/following/sync
```
响应：
```json
{
  "success": true,
  "data": {
    "totalSeeds": 25,
    "processed": 25,
    "newUsers": 156,
    "newRelations": 2341,
    "durationMs": 45000
  }
}
```

#### 4.2.3 计算Top50
```http
POST /api/binance-square/internal/target/calculate
```
响应：
```json
{
  "success": true,
  "data": {
    "totalCandidates": 156,
    "top50": [
      { "rank": 1, "username": "xxx", "followerCount": 25, "seedFollowers": ["CZ", "heyi"] },
      // ...
    ],
    "updatedAt": "2026-05-07T09:00:00Z"
  }
}
```

### 4.3 统一响应格式

所有接口统一返回格式：
```json
{
  "success": true|false,
  "data": {},
  "error": "错误信息（失败时）"
}
```

### 4.4 管理后台集成

币安广场管理后台以 **Tab 形式嵌入现有 `stats.ejs`**，复用相同的 Sidebar + Main Content 布局。

**接入方式**：
1. 在 `src/xhunt/views/stats.ejs` 的 sidebar 导航中添加"币安广场"入口
2. 在 Tab 区域新增 `binance-square-tab.ejs` partial
3. 币安广场的所有子页面作为该 Tab 内的子面板切换（不刷新页面）

```javascript
// src/apiServer.js 路由挂载
const binanceSquareRoutes = require("./binance-square/api/binance-square");

// API路由（JSON接口）
app.use("/api/binance-square/internal", adminAuth, binanceSquareRoutes);
```

**管理后台页面结构**（单Tab内多子面板）：

```
┌─────────────────────────────────────────────┐
│  币安广场                              [刷新] │  ← Tab标题
├─────────────────────────────────────────────┤
│ [总览] [种子用户] [目标用户] [帖子列表] [日志] │  ← 子面板导航
├─────────────────────────────────────────────┤
│                                               │
│  子面板内容区（通过JS切换，不刷新页面）         │
│                                               │
└─────────────────────────────────────────────┘
```

**子面板功能**：

| 子面板 | 功能 |
|--------|------|
| **总览** | 爬虫运行状态、上次抓取时间、最近24小时抓取统计、快捷操作按钮（同步关注/计算Top50/抓取帖子） |
| **种子用户** | 25人名单表格（增删改）、每个用户的关注数、最后同步时间、手动触发同步按钮 |
| **目标用户** | Top50排名表格（被关注次数、关注者列表）、手动重新计算按钮 |
| **帖子列表** | 按用户名/类型/时间筛选、分页、查看详情按钮 |
| **帖子详情** | 帖子内容、历史镜像时间轴、选中两个镜像对比diff |
| **日志** | CrawlLog列表（任务类型/状态/耗时/数量）、支持按类型筛选 |

### 4.5 路由挂载

```javascript
// src/apiServer.js 或主入口文件
const binanceSquareRoutes = require("../binance-square/api/binance-square");

// 挂载到 adminAuth 下
app.use("/api/binance-square/internal", adminAuth, binanceSquareRoutes);
```

---

## 5. 爬虫工作流程

### 5.1 阶段一：种子用户初始化

```
[管理员调用] POST /seed/init
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 批量写入种子用户配置到            │
│    BinanceSquareSeedConfig 表        │
│ 2. 同步写入 BinanceSquareUser 表    │
│    - isSeedUser = true              │
│    - isTargetUser = false           │
└─────────────────────────────────────┘
```
**注意**：名单通过API手动导入，不在迁移文件中硬编码。

> **⚠️ 重要：关注同步时的Upsert策略**
>
> 被关注者可能本身就是种子用户（如CZ关注了heyi，heyi也在种子名单中）。
> 写入Users表时必须**保护isSeedUser标记**，避免把种子用户覆盖为非种子用户：
> ```javascript
> // 正确做法：只更新API字段，不覆盖isSeedUser/isTargetUser
> await BinanceSquareUser.bulkCreate(usersToUpsert, {
>   updateOnDuplicate: [
>     "squareUid", "displayName", "avatar", "biography",
>     "totalFollowerCount", "totalPostCount", "rawData"
>     // 注意：不更新 isSeedUser / isTargetUser / followScore
>   ]
> });
> ```

> **⚠️ 重要设计决策：种子用户配置与关注关系分离**
>
> - `BinanceSquareSeedConfigs` 仅用于**配置管理**（记录哪些用户名是种子、是否激活、排序），**不参与关注关系的业务逻辑**
> - 实际的"谁关注谁"关系存储在 `BinanceSquareFollowing` 表中，关联的是 `BinanceSquareUsers` 表
> - 种子用户的身份通过 `BinanceSquareUsers.isSeedUser = true` 标识，而非通过 `SeedConfigs` 表查询
>
> **同步时的数据流**：
> ```
> SeedConfigs（查配置：isActive=true的种子名单）
>     ↓
> 调用币安API获取关注列表
>     ↓
> Following表（写入关系：谁关注了谁）
> Users表（upsert被关注者，isSeedUser=false）
> ```

### 5.2 阶段二：关注列表同步

```
[手动触发或定时任务] POST /following/sync
    │
    ▼
┌─────────────────────────────────────┐
│ 遍历所有 isActive=true 的种子用户   │
│ 对每个种子用户：                      │
│   ├─ 调用 API 获取关注列表           │
│   │   POST /bapi/composite/v3/...   │
│   │   { targetUsername, pageIndex,  │
│   │     pageSize: 20 }              │
│   │   分页遍历直到获取全部            │
│   │                                 │
│   ├─ 解析响应中的 followers 数组     │
│   │                                 │
│   ├─ 批量写入/更新用户表             │
│   │   bulkCreate(BinanceSquareUser) │
│   │   updateOnDuplicate             │
│   │                                 │
│   └─ 批量写入关注关系                │
│       bulkCreate(BinanceSquareFollowing)
│       ignoreDuplicates              │
└─────────────────────────────────────┘
    │
    ▼
记录 CrawlLog（taskType=following, status=success）
```

> **⚠️ 重要：关注数的两种来源与一致性校验**
>
> 每个用户的"关注数"有两个来源，必须理解其区别：
>
> | 来源 | 获取方式 | 准确性 | 用途 |
> |------|---------|--------|------|
> | **API返回的 `data.total`** | 接口响应中的 total 字段 | 实时准确 | 存入 `Users.totalFollowingCount`，用于**校验抓取完整性** |
> | **数据库 `Following` 表 COUNT** | `SELECT COUNT(*) FROM Followings WHERE followerUsername='xxx'` | 反映实际抓取到的数据 | 用于 **Top50排名计算** |
>
> **一致性校验**：每次同步完成后，对比两个数字
> ```javascript
> if (followingRecords.length !== apiResponse.data.total) {
>   console.warn(
>     `抓取不完整：${targetUsername} 抓了 ${followingRecords.length} 条，` +
>     `API 返回 total=${apiResponse.data.total}`
>   );
>   // 记录到 CrawlLog，状态标记为 partial
> }
> ```
> 如果不一致，说明分页抓取有遗漏（如API新增关注者、分页边界问题等），需要告警但**不阻塞流程**。

**API 分页处理逻辑**：
```javascript
async function fetchAllFollowing(targetUsername) {
  const allFollowings = [];
  let pageIndex = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await apiClient.post("/friendly/pgc/user/following", {
      targetUsername,
      pageIndex,
      pageSize: 20,
    });

    if (!res.success || !res.data?.followers) break;

    allFollowings.push(...res.data.followers);

    const total = res.data.total || 0;
    hasMore = pageIndex * 20 < total;
    pageIndex++;

    // 请求间隔：500-1200ms 随机延迟
    await sleep(500 + Math.random() * 700);
  }

  return allFollowings;
}
```

### 5.3 阶段三：计算Top50目标用户（手动触发）

```
[管理员手动触发] POST /target/calculate
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 聚合查询关注关系                  │
│    SELECT followingUsername,         │
│           COUNT(*) as followerCount,│
│           ARRAY_AGG(followerUsername)│
│    FROM BinanceSquareFollowings      │
│    WHERE followerUsername IN         │
│          (SELECT username FROM       │
│           BinanceSquareSeedConfigs   │
│           WHERE isActive = true)     │
│    GROUP BY followingUsername        │
│    ORDER BY followerCount DESC       │
│    LIMIT 50                          │
│                                      │
│ 2. 清空旧 TargetRank 记录           │
│ 3. 批量写入新排名                    │
│ 4. 更新 User 表 isTargetUser 标记   │
│    - Top50: isTargetUser = true      │
│    - 其他: isTargetUser = false      │
│ 5. 更新 followScore                 │
└─────────────────────────────────────┘
```
**策略**：纯手动触发，**不自动执行**。管理员可在关注同步完成后手动调用此接口计算最新Top50。

> **⚠️ 重要：Top50计算只统计活跃种子用户的关注关系**
>
> 计算时只选取 `BinanceSquareSeedConfigs.isActive = true` 的种子用户作为关注者来源：
> ```sql
> SELECT "followingUsername", COUNT(*) as "followerCount"
> FROM "BinanceSquareFollowings"
> WHERE "followerUsername" IN (
>   SELECT "username" FROM "BinanceSquareSeedConfigs" WHERE "isActive" = true
> )
> GROUP BY "followingUsername"
> ORDER BY "followerCount" DESC
> LIMIT 50
> ```
> 这样当某个种子用户被标记为 `isActive=false` 时，其关注关系不参与Top50计算，排名会自动重新计算。

### 5.4 阶段四：帖子抓取

**接口**：`GET /bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter`

**参数**：
| 参数 | 说明 | 示例 |
|------|------|------|
| `targetSquareUid` | 目标用户的squareUid | `dxCeCLOM7uOFJKX8EnS3Kw` |
| `timeOffset` | 时间戳偏移（分页用） | `Date.now()`（主帖）/ `-1`（回复） |
| `filterType` | 过滤类型 | `ALL` / `REPLY` |

**两种抓取模式**：

| filterType | 说明 | 抓取内容 |
|-----------|------|---------|
| `ALL` | 主帖（文章/引用/直播等） | 用户自己发的帖子 |
| `REPLY` | 回复帖 | 用户在别人帖子下的回复 |
| `QUOTE` | 引用帖 | 用户引用的帖子（如有需要） |

**分页逻辑（时间范围控制）**：
```
统一分页逻辑（适用于 ALL / REPLY / QUOTE）：
  初始请求: timeOffset = -1
      │
      ▼
  获取返回的 contents 数组
      │
      ▼
  如果 contents 为空数组 → 停止（该用户无此类型帖子）
      │
      ▼
  检查最后一篇帖子的 latestReleaseTime
      │
      ├─ 如果在7天内 → timeOffset = lastPostTime，继续请求
      │
      └─ 如果超过7天 → 停止
```

**抓取流程**：
```
[Cron: 0 */2 * * *] 每2小时执行
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 生成 snapshotId                  │
│    格式: YYYYMMDDHHmmss             │
│                                      │
│ 2. 获取 isTargetUser=true 的50人    │
│    SELECT username, squareUid       │
│    FROM BinanceSquareUsers          │
│    WHERE isTargetUser = true        │
│                                      │
│ 3. 对每个目标用户循环抓取：           │
│                                      │
│    A. 抓取主帖 (filterType=ALL)      │
│       ├─ timeOffset = -1             │
│       ├─ 分页抓取直到7天前           │
│       └─ 解析 contents → 写入Posts   │
│                                      │
│    B. 抓取回复 (filterType=REPLY)    │
│       ├─ timeOffset = -1             │
│       ├─ 分页抓取直到7天前           │
│       └─ 解析 contents → 写入Posts   │
│                                      │
│    C. 请求间隔：500-1200ms           │
│                                      │
│ 4. 解析并写入 BinanceSquarePost     │
│    - upsert 模式（postId 唯一）      │
│    - 更新 lastSnapshotId             │
│                                      │
│ 5. 生成镜像记录                     │
│    - 写入 BinanceSquarePostSnapshot │
│    - diffFromPrev 自动计算并填充     │
│                                      │
│ 6. 记录 CrawlLog                    │
│    - taskType="post"                 │
│    - 分别记录ALL和REPLY的抓取数量    │
└─────────────────────────────────────┘
    │
    ▼
[数据清理] 删除3天前的镜像记录
```

**帖子字段映射（API → DB）**：

| API字段 | DB字段 | 说明 |
|---------|--------|------|
| `id` | `postId` | 帖子唯一ID |
| `username` | `username` | 作者用户名 |
| `contentType` | `postType` | 映射规则见下方 |
| `title` | `title` | 标题（注意：接口返回可能是对象或字符串） |
| `body` | `content` | HTML正文 |
| `bodyTextOnly` | `contentText` | 纯文本 |
| `imageList` | `mediaUrls` | 图片URL数组 |
| `likeCount` | `likeCount` | 点赞数 |
| `shareCount` | `shareCount` | 分享数 |
| `commentCount` | `commentCount` | 评论数 |
| `viewCount` | `viewCount` | 浏览数 |
| `latestReleaseTime` | `publishedAt` | 发布时间（时间戳转Date） |
| `webLink` | `sourceUrl` | 原文链接 |
| `quoteContent` | `rawData.quoteContent` | 引用内容（JSONB内） |
| `isReplyPost` | `rawData.isReplyPost` | 是否回复帖 |
| `replyCount` | `rawData.replyCount` | 回复数 |
| `contentStatus` | `rawData.contentStatus` | 内容状态 |
| `hashtagList` | `rawData.hashtagList` | 话题标签 |
| `hyperlinkList` | `rawData.hyperlinkList` | 超链接 |
| `squareUid` | `rawData.squareUid` | 作者UID |
| `displayName` | `rawData.displayName` | 作者显示名 |
| `avatar` | `rawData.avatar` | 作者头像 |
| `firstReleaseTime` | `rawData.firstReleaseTime` | 首次发布时间 |
| `createTime` | `rawData.createTime` | 创建时间 |
| `updateTime` | `rawData.updateTime` | 更新时间 |

> **contentType → postType 映射规则**：
>
> 币安API的 `contentType` 是数字，需映射为数据库ENUM：
>
> | API contentType | postType | 说明 |
> |----------------|----------|------|
> | `0` | `article` | 普通文章/帖子 |
> | `1` | `quote` | 引用帖（quoteContent不为null） |
> | `2` | `reply` | 回复帖（isReplyPost=true） |
> | 其他 | `article` | 未知类型默认归为article |
>
> 实际判断逻辑：先检查 `isReplyPost === true` → `reply`；再检查 `quoteContent !== null` → `quote`；其余 → `article`。

**回复帖特有字段（存 rawData）**：

| API字段 | rawData路径 | 说明 |
|---------|-------------|------|
| `parentContentId` | `rawData.parentContentId` | 父帖子ID（被回复的原帖） |
| `replyUsers` | `rawData.replyUsers` | 回复了哪些用户 `[{username, nickname}]` |
| `replyUserCount` | `rawData.replyUserCount` | 回复用户数量 |
| `replyPostList` | `rawData.replyPostList` | 子回复列表（嵌套回复） |
| `isShowMore` | `rawData.isShowMore` | 是否显示更多 |

**注意事项**：
1. `title` 字段接口返回类型不固定（有时是字符串，有时是对象），写入前需做类型检查
2. `quoteContent` 不为空时，说明这是一篇引用帖，引用的原帖信息存入 `rawData`
3. `isReplyPost=true` 时，说明是回复帖，`parentContentId` 指向被回复的原帖
4. `contentStatus` 可能表示帖子状态（正常/审核中/删除等），后续可用于判断 `isDeleted`
5. 每个目标用户需要调**两次**接口（ALL + REPLY），抓取量翻倍，注意控制请求频率
6. 回复帖的 `body` / `bodyTextOnly` / `title` 可能为null，字段约束已做容错处理

### 5.5 镜像对比机制

> **策略：全量存储 + 全量diff**
>
> 每次抓取都生成镜像记录，同时计算与上一版本的差异存入 `diffFromPrev`。
> 估算存储：~457 MB / 3天（36,000条镜像），完全可接受。

**对比字段范围**：

| 字段 | 类型 | 对比方式 | diff记录格式 |
|------|------|---------|-------------|
| `title` | 文本 | 字符串严格对比 | `{old: "原标题", new: "新标题"}` |
| `content` | 文本 | 字符串严格对比 | `{old: "原内容", new: "新内容"}` |
| `contentText` | 文本 | 字符串严格对比 | `{old: "...", new: "..."}` |
| `likeCount` | 数字 | 数值对比 | `{old: 100, new: 150, delta: 50}` |
| `shareCount` | 数字 | 数值对比 | `{old: 10, new: 12, delta: 2}` |
| `commentCount` | 数字 | 数值对比 | `{old: 5, new: 8, delta: 3}` |
| `viewCount` | 数字 | 数值对比 | `{old: 1000, new: 1200, delta: 200}` |
| `isDeleted` | 布尔 | 布尔对比 | `{old: false, new: true}` |

**不参与对比的字段**（每次请求都会变，属于"噪声"）：
- `createTime` / `updateTime` / `browseTime`（系统时间戳）
- `isLiked` / `isFollowed`（和登录态相关）
- `tradingPairs` 价格（实时变动）
- 随机token、临时URL等

**diffFromPrev 存储格式示例**：
```json
{
  "title": {
    "old": "AMA. 英语和中文（我只会这两种）",
    "new": "AMA. 英语和中文（我只会这两种）- 更新"
  },
  "likeCount": {
    "old": 15234,
    "new": 15678,
    "delta": 444
  },
  "viewCount": {
    "old": 892100,
    "new": 901200,
    "delta": 9100
  }
}
```

**对比逻辑**：
```javascript
const DIFF_FIELDS = [
  { key: "title", type: "text" },
  { key: "content", type: "text" },
  { key: "contentText", type: "text" },
  { key: "likeCount", type: "number" },
  { key: "shareCount", type: "number" },
  { key: "commentCount", type: "number" },
  { key: "viewCount", type: "number" },
  { key: "isDeleted", type: "boolean" },
];

async function computeDiff(currentSnapshot, prevSnapshot) {
  if (!prevSnapshot) return null;

  const diff = {};
  for (const { key, type } of DIFF_FIELDS) {
    const oldVal = prevSnapshot[key];
    const newVal = currentSnapshot[key];

    if (oldVal !== newVal) {
      diff[key] = { old: oldVal, new: newVal };
      if (type === "number") {
        diff[key].delta = (newVal || 0) - (oldVal || 0);
      }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}
```

**查询接口**：
```
GET /api/binance-square/internal/posts/snapshot-compare
  ?postId=12345
  &snapshotId1=20260507090000
  &snapshotId2=20260507110000
```

### 5.6 数据清理策略

```javascript
async function cleanupOldSnapshots() {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  // 删除3天前的镜像记录
  await BinanceSquarePostSnapshot.destroy({
    where: {
      snapshotTime: { [Op.lt]: threeDaysAgo },
    },
  });

  // 清理3天前的爬取日志
  await BinanceSquareCrawlLog.destroy({
    where: {
      createdAt: { [Op.lt]: threeDaysAgo },
    },
  });
}
```

---

## 6. 反爬与稳定性策略

### 6.1 API 请求策略

| 策略 | 实现 |
|------|------|
| 请求间隔 | 每次API调用后 500-1200ms 随机延迟 |
| 分页大小 | 固定20（接口限制） |
| 超时重试 | 单请求超时10秒，失败重试3次，指数退避 |
| 并发控制 | 关注列表同步：串行执行（避免被封） |
| User-Agent | 使用真实浏览器UA |
| Cookie/Session | **TODO**：当前阶段不使用，后续按需加入 |

**说明**：关注列表API当前测试为公开接口，无需Cookie即可访问。后续如遇到限流或需要更高权限，再加入Cookie配置。

### 6.2 错误处理

```javascript
// 分级重试策略
async function apiRequestWithRetry(url, body, options = {}) {
  const maxRetries = options.maxRetries || 3;
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiClient.post(url, body, { timeout: 10000 });
    } catch (error) {
      lastError = error;

      // 429 限速：等待更长时间
      if (error.response?.status === 429) {
        const waitMs = (i + 1) * 5000 + Math.random() * 3000;
        await sleep(waitMs);
        continue;
      }

      // 5xx 错误：指数退避
      if (error.response?.status >= 500) {
        const waitMs = Math.pow(2, i) * 1000 + Math.random() * 1000;
        await sleep(waitMs);
        continue;
      }

      // 4xx 错误（除429外）：不再重试
      if (error.response?.status >= 400) {
        throw error;
      }
    }
  }

  throw lastError;
}
```

### 6.3 状态监控（Redis）

```javascript
const REDIS_KEYS = {
  // 爬虫状态
  STATUS: "binance_square:status",           // idle / running / paused
  // 当前任务
  CURRENT_TASK: "binance_square:current_task",
  // 上次执行时间
  LAST_FOLLOWING_SYNC: "binance_square:last_following_sync",
  LAST_TARGET_CALC: "binance_square:last_target_calc",
  LAST_POST_CRAWL: "binance_square:last_post_crawl",
  // 统计
  STATS: "binance_square:stats",
};
```

### 6.4 Cookie 管理

> **当前状态**：帖子接口和关注列表接口均为公开接口（`/friendly/` 路径），**当前阶段不需要Cookie**。
>
> 如后续遇到限流或接口变更需要登录态，再加入Cookie配置。

```bash
# TODO: 如需要则加入环境变量
# BINANCE_SQUARE_COOKIE="..."
```

---

## 7. 定时任务调度

使用 `node-schedule` 复用现有调度器模式。

**自动任务（配置驱动）**：
```javascript
const schedule = require("node-schedule");

class BinanceSquareScheduler {
  constructor(taskManager, configService) {
    this.taskManager = taskManager;
    this.configService = configService;
    this.jobs = {};
  }

  async start() {
    await this._schedulePostCrawl();
    await this._scheduleCleanup();
  }

  async _schedulePostCrawl() {
    // 从数据库读取配置（支持动态调控）
    const hours = await this.configService.getFloat("post_crawl_interval_hours", 2);
    const cron = this._hoursToCron(hours); // 0.5h→*/30, 1h→0, 2h→0 */2, 4h→0 */4

    this.jobs.postCrawl = schedule.scheduleJob(cron, async () => {
      await this.taskManager.runPostCrawl();
      // 每次执行后重新调度（支持间隔动态变化）
      this.jobs.postCrawl.cancel();
      await this._schedulePostCrawl();
    });
  }

  async _scheduleCleanup() {
    // 清理任务固定每天凌晨4点执行
    this.jobs.cleanup = schedule.scheduleJob("0 4 * * *", async () => {
      const days = await this.configService.getInt("snapshot_retention_days", 3);
      await this.taskManager.cleanupOldSnapshots(days);
    });
  }

  _hoursToCron(hours) {
    // 支持 0.5→*/30, 1→0, 2→0 */2, 4→0 */4
    if (hours === 0.5) return "*/30 * * * *";
    if (hours === 1) return "0 * * * *";
    return `0 */${Math.floor(hours)} * * *`;
  }

  stop() {
    Object.values(this.jobs).forEach(job => job?.cancel());
  }
}
```

> **动态调控机制**：
> 1. 调度器每次执行任务后，重新读取数据库配置，按新间隔重新调度
> 2. 管理后台修改配置后**即时生效**（下次任务执行时读取新配置）
> 3. 配置范围限制：帖子间隔 `0.5~4` 小时，保留天数 `1~7` 天
> 4. 前端slider控件限制输入范围，后端校验兜底

**手动触发接口**：
- `POST /following/sync` — 同步关注列表
- `POST /following/sync/:username` — 同步单个用户关注列表
- `POST /target/calculate` — 计算Top50
- `POST /crawl/posts` — 手动触发帖子抓取

---

## 8. 数据库迁移文件

### 8.1 迁移文件命名
`migrations-pg/20260507000000-create-binance-square-tables.js`

> **注意**：迁移文件必须放在 `migrations-pg/` 目录下，使用 `config-pg.json` 中的 `rootdatapro` 数据库配置。

### 8.2 迁移内容
包含**8张表**的 `createTable` 和 `addIndex` 操作：
- `BinanceSquareUsers`
- `BinanceSquareFollowings`
- `BinanceSquareSeedConfigs`
- `BinanceSquareTargetRanks`
- `BinanceSquarePosts`
- `BinanceSquarePostSnapshots`
- `BinanceSquareCrawlLogs`
- `BinanceSquareConfigs`

**注意**：**不写入初始种子用户数据**，种子名单通过 `/seed/init` API 手动导入。

---

## 9. 配置项

新增环境变量（`.env-dev` / `.env-pro`）：

```bash
# 币安广场爬虫配置
BINANCE_SQUARE_ENABLED=true

# 动态调控项已迁移到数据库 BinanceSquareConfigs 表，不再使用环境变量
# 如需初始化默认值，在迁移文件中 bulkInsert

# TODO: 后续如需要Cookie再加入
# BINANCE_SQUARE_COOKIE="..."
```

---

## 10. 后续待补充事项（TODO）

| 序号 | 事项 | 状态 | 说明 |
|------|------|------|------|
| 1 | ~~帖子抓取方式~~ | ✅ 已确认 | 接口已明确，纯API调用，不需要Puppeteer |
| 2 | **Cookie管理** | 🟢 当前不用 | 关注列表和帖子接口均为公开接口，暂不需要 |
| 3 | ~~帖子详情抓取~~ | ✅ 已确认 | 纯API即可，接口返回完整帖子数据 |
| 4 | ~~镜像对比逻辑~~ | ✅ **已确认** | 全量diff：文本严格对比 + 数字delta |
| 5 | **数据展示** | 🔴 待定 | 是否需要前端管理界面查看Top50列表、帖子对比等 |

---

## 11. 已确认事项

| 序号 | 问题 | 决策 |
|------|------|------|
| 1 | Cookie是否需要 | 当前阶段**不需要**，后续按需加入 |
| 2 | 初始名单导入方式 | **API手动导入**，不在迁移文件硬编码 |
| 3 | Top50计算策略 | **手动触发**，不自动执行 |
| 4 | 镜像保存策略 | **全量存储 + 全量diff**，每次抓取都存镜像并计算差异 |
| 5 | ~~帖子抓取~~ | ✅ **已确认**，接口和分页逻辑已明确 |

---

## 12. 第一阶段实现范围

**当前确定要实现的内容**：

1. ✅ 6张数据库表（迁移文件）
2. ✅ 种子用户管理API（`/seed/init`, `/seed/list`, `/seed/add`, `/seed/remove`）
3. ✅ 关注列表同步API（`/following/sync`, `/following/sync/:username`）
4. ✅ Top50计算API（`/target/calculate`, `/target/list`）
5. ✅ 爬虫状态查询API（`/crawl/status`）
6. ✅ 基础API HTTP客户端（调用币安关注列表接口）
7. ✅ 数据库存储逻辑（用户、关注关系、排名）
8. ✅ 帖子抓取（每2小时自动 + 手动触发，ALL+REPLY，7天时间窗口）
9. ✅ 镜像管理（全量存储 + 全量diff + 3天滚动清理）
10. ✅ 定时清理任务（3天滚动删除镜像）

**暂不实现**：
- ❌ 数据展示前端（等后续确认）

---

## 13. 实现与测试步骤规划

> **原则**：每一步完成后必须验证+测试，确认无误后再进行下一步。

### Step 1: 数据库迁移 + 模型定义

**实现内容**：
- 迁移文件：`migrations-pg/20260507000000-create-binance-square-tables.js`
- 模型文件：`src/binance-square/models/` 下7个模型 + `index.js`

**验证方法**：
```bash
# 1. 运行迁移
yarn db:migrate:pg

# 2. 检查表是否创建
psql -d rootdatapro -c "\dt" | grep BinanceSquare
```

**测试方法**：
```javascript
// 3. 用Sequelize写入测试数据，验证字段约束
const db = require("./src/binance-square/models")(sequelize);
await db.BinanceSquareUser.create({ username: "test_user" }); // 应成功
await db.BinanceSquareUser.create({}); // 应失败（username not null）

// 4. 验证API字段允许null
await db.BinanceSquareUser.create({
  username: "test2",
  squareUid: null,  // 应成功
  totalFollowerCount: null,  // 应成功
});

// 5. 验证唯一索引
await db.BinanceSquareSeedConfig.create({ username: "CZ" });
await db.BinanceSquareSeedConfig.create({ username: "CZ" }); // 应失败（unique冲突）
```

**通过标准**：8张表创建成功，字段约束符合2.2节设计原则，唯一索引生效。

---

### Step 2: 币安API HTTP客户端

**实现内容**：
- `src/binance-square/scraper/api-client.js`
- 实现 `fetchFollowingList(targetUsername)` — 关注列表（分页）
- 实现 `fetchUserPosts(squareUid, filterType)` — 帖子（分页，timeOffset控制）

**验证方法**：
```bash
# 直接运行测试脚本，观察原始返回
node -e "
  const client = require('./src/binance-square/scraper/api-client');
  client.fetchFollowingList('CZ').then(r => console.log('CZ关注数:', r.data.total));
"
```

**测试方法**：
```javascript
// 1. 关注列表分页测试
const result = await client.fetchFollowingList('CZ');
console.assert(result.data.followers.length > 0, '应返回关注列表');
console.assert(result.data.total > 0, 'total应大于0');

// 2. 帖子接口测试（ALL）
const posts = await client.fetchUserPosts('dxCeCLOM7uOFJKX8EnS3Kw', 'ALL');
console.assert(posts.data.contents.length > 0, '应返回帖子列表');
console.assert(typeof posts.data.timeOffset === 'number', '应返回timeOffset');

// 3. 帖子接口测试（REPLY）
const replies = await client.fetchUserPosts('dxCeCLOM7uOFJKX8EnS3Kw', 'REPLY');
console.assert(replies.data.contents.every(c => c.isReplyPost === true), 'REPLY返回的应全是回复帖');

// 4. 错误重试测试（模拟断网）
// 5. 超时测试（模拟慢响应）
```

**通过标准**：能成功获取CZ的关注列表（>0条），能获取帖子内容（ALL和REPLY都有数据），分页逻辑正确，错误重试生效。

---

### Step 3: 种子用户管理API

**实现内容**：
- `src/binance-square/api/binance-square.js` 中的 seed 相关路由
- `/seed/init`, `/seed/list`, `/seed/add`, `/seed/remove`

**验证方法**：
```bash
# 1. 初始化种子用户
curl -X POST http://localhost:8090/api/binance-square/internal/seed/init \
  -H "Content-Type: application/json" \
  -d '{"seeds": [{"username": "CZ", "displayName": "CZ"}]}'

# 2. 检查数据库
psql -d rootdatapro -c "SELECT * FROM \"BinanceSquareSeedConfigs\";"
psql -d rootdatapro -c "SELECT * FROM \"BinanceSquareUsers\" WHERE \"isSeedUser\" = true;"
```

**测试方法**：
```javascript
// 3. 重复初始化应幂等（不报错，更新或忽略）
// 4. 添加重复username应失败
// 5. 移除后再添加应成功
// 6. 检查BinanceSquareUser表的isSeedUser标记是否正确
```

**通过标准**：种子用户写入SeedConfig表，同时同步到User表（isSeedUser=true），增删改查正常。

---

### Step 4: 关注列表同步

**实现内容**：
- `/following/sync`, `/following/sync/:username`
- 关注列表解析器：`src/binance-square/scraper/parsers/followingParser.js`
- 数据库存储逻辑（bulkCreate用户 + 关注关系）

**验证方法**：
```bash
# 1. 同步CZ的关注列表
curl -X POST http://localhost:8090/api/binance-square/internal/following/sync/CZ

# 2. 检查数据库
psql -d rootdatapro -c "SELECT COUNT(*) FROM \"BinanceSquareFollowings\" WHERE \"followerUsername\" = 'CZ';"
psql -d rootdatapro -c "SELECT COUNT(*) FROM \"BinanceSquareUsers\";"
```

**测试方法**：
```javascript
// 3. 验证关注数量与API返回的total一致
// 4. 重复同步应幂等（不重复插入关注关系）
// 5. 验证被关注者也写入了User表
// 6. 测试批量写入性能（25个种子用户全部同步）
// 7. 测试CrawlLog记录
```

**通过标准**：CZ的关注列表完整入库（数量与API一致），关注关系无重复，被关注者自动创建User记录。

---

### Step 5: Top50计算

**实现内容**：
- `/target/calculate`, `/target/list`
- 聚合查询：按followingUsername分组COUNT

**验证方法**：
```bash
# 1. 先确保已同步所有种子用户关注
# 2. 计算Top50
curl -X POST http://localhost:8090/api/binance-square/internal/target/calculate

# 3. 检查结果
psql -d rootdatapro -c "SELECT * FROM \"BinanceSquareTargetRanks\" ORDER BY rank LIMIT 10;"
psql -d rootdatapro -c "SELECT * FROM \"BinanceSquareUsers\" WHERE \"isTargetUser\" = true;"
```

**测试方法**：
```javascript
// 4. 验证Top1的被关注次数等于实际COUNT
// 5. 验证seedFollowers JSONB字段包含正确的种子用户列表
// 6. 验证User表的isTargetUser标记（Top50=true，其他=false）
// 7. 重新计算后旧排名应被清空，新排名写入
// 8. 测试只有活跃种子用户(isActive=true)参与计算
```

**通过标准**：Top50排名准确，被关注次数统计正确，isTargetUser标记正确更新。

---

### Step 6: 帖子抓取

**实现内容**：
- `/crawl/posts`
- 帖子解析器：`src/binance-square/scraper/parsers/postParser.js`
- 帖子入库逻辑（upsert）

**验证方法**：
```bash
# 1. 确保Top50已计算，获取一个目标用户的squareUid
# 2. 手动触发帖子抓取
curl -X POST http://localhost:8090/api/binance-square/internal/crawl/posts

# 3. 检查数据库
psql -d rootdatapro -c "SELECT COUNT(*) FROM \"BinanceSquarePosts\";"
psql -d rootdatapro -c "SELECT \"postType\", COUNT(*) FROM \"BinanceSquarePosts\" GROUP BY \"postType\";"
```

**测试方法**：
```javascript
// 4. 验证只抓取了7天内的帖子（latestReleaseTime > now - 7d）
// 5. 验证ALL和REPLY都有数据
// 6. 验证postId唯一（upsert生效，不重复）
// 7. 验证rawData字段有完整JSON
// 8. 验证isReplyPost=true的帖子parentContentId已存入rawData
// 9. 验证contentStatus映射到isDeleted（如contentStatus=2表示删除）
// 10. 测试分页：一个用户有>20篇帖子时，timeOffset是否正确传递
```

**通过标准**：帖子正确入库，7天时间窗口生效，ALL和REPLY都抓取到，upsert不重复，rawData完整。

---

### Step 7: 镜像管理

**实现内容**：
- 镜像生成 + diff计算逻辑
- `/posts/:postId/snapshots`, `/posts/snapshot-compare`

**验证方法**：
```bash
# 1. 连续触发两次帖子抓取（间隔几分钟，让互动数据变化）
curl -X POST http://localhost:8090/api/binance-square/internal/crawl/posts
# 等几分钟...
curl -X POST http://localhost:8090/api/binance-square/internal/crawl/posts

# 2. 检查镜像表
psql -d rootdatapro -c "SELECT COUNT(*) FROM \"BinanceSquarePostSnapshots\";"

# 3. 查询某帖子的镜像
curl http://localhost:8090/api/binance-square/internal/posts/12345/snapshots
```

**测试方法**：
```javascript
// 4. 验证同一帖子有两条镜像记录（snapshotId不同）
// 5. 验证第二次镜像的diffFromPrev不为null（有likeCount变化）
// 6. 验证diffFromPrev格式：{ likeCount: { old: 100, new: 150, delta: 50 } }
// 7. 测试内容修改diff：手动构造title变化的数据，验证diff记录
// 8. 测试对比接口：/posts/snapshot-compare?postId=xxx&snapshotId1=...&snapshotId2=...
// 9. 验证3天前的镜像被自动清理（调系统时间或手动插入旧数据测试）
```

**通过标准**：每次抓取都生成镜像，diff正确计算（数字有delta，文本有old/new），对比接口正常返回差异。

---

### Step 8: 定时调度 + 清理

**实现内容**：
- `src/binance-square/services/scheduler.js`
- `/crawl/start`, `/crawl/pause`, `/crawl/status`

**验证方法**：
```bash
# 1. 启动调度器（通过API或重启服务）
curl -X POST http://localhost:8090/api/binance-square/internal/crawl/start

# 2. 查看状态
curl http://localhost:8090/api/binance-square/internal/crawl/status

# 3. 暂停
curl -X POST http://localhost:8090/api/binance-square/internal/crawl/pause
```

**测试方法**：
```javascript
// 4. 验证调度器启动后Redis状态为running
// 5. 验证默认2小时触发一次帖子抓取（观察CrawlLog记录时间）
// 6. 管理后台修改间隔为0.5小时，验证下次任务按新间隔执行
// 7. 管理后台修改间隔为4小时，验证下次任务按新间隔执行
// 8. 验证每天凌晨4点触发清理（观察3天前的镜像是否被删除）
// 9. 验证暂停后不再触发新任务
// 10. 验证重启服务后调度器自动恢复（如配置了自动启动）
```

**通过标准**：调度器正常启停，定时任务按配置值执行，间隔修改后自动生效，清理任务正确删除过期数据。

---

### Step 9: 管理后台页面

**实现内容**：
- `src/binance-square/views/binance-square-tab.ejs` — 主Tab框架（嵌入stats.ejs）
- `src/binance-square/views/seed-users.ejs` — 种子用户管理子面板
- `src/binance-square/views/target-users.ejs` — Top50目标用户子面板
- `src/binance-square/views/posts-list.ejs` — 帖子列表子面板
- `src/binance-square/views/post-detail.ejs` — 帖子详情+镜像对比
- 在 `src/xhunt/views/stats.ejs` 中添加侧边栏入口和Tab页

**管理后台功能清单**：

| 功能 | 页面元素 | 调用的API |
|------|---------|----------|
| **总览看板** | 爬虫状态卡片、上次抓取时间、最近24h统计数字、调控面板（间隔slider/保留天数slider）、快捷操作按钮 | `GET /crawl/status` + `GET /config` + `POST /config` + `POST /following/sync` + `POST /target/calculate` + `POST /crawl/posts` |
| **种子用户管理** | 25人表格（username/displayName/isActive）、增删改按钮、同步按钮 | `GET /seed/list` + `POST /seed/add` + `POST /seed/remove` + `POST /following/sync/:username` |
| **目标用户查看** | Top50排名表格（rank/username/followerCount/seedFollowers）、重新计算按钮 | `GET /target/list` + `POST /target/calculate` |
| **帖子列表** | 筛选（用户名/类型/时间）、分页表格、查看详情按钮 | `GET /posts` |
| **帖子详情** | 帖子内容、镜像时间轴（可选两个时间点）、diff对比展示 | `GET /posts/:postId` + `GET /posts/:postId/snapshots` + `GET /posts/snapshot-compare` |
| **日志查看** | CrawlLog表格（时间/类型/状态/耗时/数量）、按类型筛选 | 需新增 `GET /crawl/logs` API |

**验证方法**：
```bash
# 1. 登录管理后台，确认侧边栏出现"币安广场"入口
# 2. 点击进入，确认加载币安广场Tab页
# 3. 确认6个子面板（总览/种子/目标/帖子/详情/日志）切换正常
```

**测试方法**：
```javascript
// 4. 在总览页点击"同步关注"按钮，确认触发API并显示loading状态
// 5. 在总览页查看爬虫状态，确认数据实时刷新
// 6. 在总览页拖动间隔slider改为0.5小时，确认保存成功，调度器按新间隔执行
// 7. 在总览页拖动间隔slider改为4小时，确认保存成功，调度器按新间隔执行
// 8. 在总览页修改保留天数，确认3天前的数据被清理
// 9. 在种子用户页点击"添加种子"，确认弹窗→输入→保存→表格更新
// 10. 在目标用户页点击"重新计算"，确认排名刷新
// 11. 在帖子列表页筛选某个用户，确认只显示该用户的帖子
// 12. 在帖子详情页选择两个镜像时间点，确认diff正确展示（绿色新增/红色删除/蓝色修改）
// 13. 测试未登录访问管理后台，确认跳转到登录页
// 14. 测试无权限用户访问，确认返回403
```

**通过标准**：管理后台所有操作（触发爬取、查看数据、对比镜像）均通过页面交互完成，无需手动调API。

---

### Step 10: 集成测试（端到端）

**完整流程**：
```
1. 管理后台 → 种子用户页 → 导入25人
2. 管理后台 → 总览页 → 点击"同步关注"
3. 管理后台 → 目标用户页 → 点击"重新计算" → 查看Top50
4. 管理后台 → 总览页 → 点击"抓取帖子"
5. 等当前配置间隔时间（默认2小时），观察自动触发（检查CrawlLog）
6. 管理后台 → 帖子列表 → 查看帖子 → 对比镜像
7. 等3天后观察自动清理（或手动插入旧数据测试）
```

**测试场景**：
| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 正常全流程（管理后台） | 通过页面点击完成全部操作 | 数据完整，页面实时刷新 |
| API限流 | 模拟429响应 | 指数退避重试，最终成功，页面提示重试中 |
| 网络中断 | 模拟超时/断网 | 记录失败日志，页面显示错误提示，不影响其他用户 |
| 数据缺失 | API返回部分字段为null | 正常写入，缺失字段显示"-"或"未知" |
| 重复抓取 | 连续点击"同步关注"两次 | 幂等，不重复插入，第二次提示"已是最新" |
| Top50变动 | 管理后台禁用某个种子用户→重新计算 | 排名自动更新，禁用用户的关系被排除 |
| 权限控制 | 未登录访问/admin | 跳转登录页 |
| 权限控制 | 普通用户访问币安广场Tab | 不显示入口或返回403 |

---

### Step 11: 路由挂载 + 最终文档

**实现内容**：
- 在 `src/apiServer.js` 挂载 `/api/binance-square/internal`
- 在 `src/xhunt/views/stats.ejs` 添加币安广场Tab
- 更新 `AGENTS.md`

**验证方法**：
```bash
# 1. 确认API路由正常
curl -H "Cookie: xh_admin_session=$TOKEN" \
  http://localhost:8090/api/binance-square/internal/crawl/status

# 2. 确认管理后台页面正常
open http://localhost:8090/admin
# 侧边栏应有"币安广场"入口
```

**通过标准**：API接口adminAuth保护正常，管理后台页面可正常访问和操作，AGENTS.md已更新币安广场模块说明。
