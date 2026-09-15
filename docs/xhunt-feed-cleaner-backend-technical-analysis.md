# XHunt 智能信息流净化 (X-Cleaner) 后端技术分析与架构设计方案

> **文档版本**：v1.0.0  
> **归档路径**：`docs/xhunt-feed-cleaner-backend-technical-analysis.md`  
> **关联前端规范**：`tweet-hunt-extension/docs/xhunt-feed-cleaner-design.md`  
> **涉及子系统**：  
> - `enterprise-admin` (后端 API Server / PostgreSQL / Redis / Nacos Client)  
> - `admin-web` (管理后台 React 前端)  
> - `nginx` (公网代理层 `kb.xhunt.ai` / `kb.cryptohunt.ai`)  
> - `tweet-hunt-extension` (浏览器插件客户端)

---

## 一、 背景与核心诉求拆解

### 1.1 现状与背景
前端插件（`tweet-hunt-extension`）已完成智能信息流净化（X-Cleaner）的客户端检测管线：
1. **纯前端本地拦截/标注**：DOM 滚动监听、抗混淆清洗、KOL 豁免检测、黄推及灰产引流判定已在客户端闭环。
2. **规则动态化诉求**：黑产对抗演进极快，前端规则引擎设计为基于 Nacos（`dataId: xhunt_cleaner_rules`）进行热更新。
3. **用户偏好诉求**：用户在插件中配置了开关、过滤模式（标注/隐藏）、个人加白博主列表、自定义关键词列表。

### 1.2 核心问题与定性分析

#### 诉求 1：用户的配置设置需要保持，不单单是这次的，而是整个配置
- **现状痛点**：当前 XHunt 插件的大量用户偏好（包括本次 Cleaner 的 4 项设置，以及历史累积的 50+ 个 UI 显示开关、语言偏好、数据面板开关等）全部仅存储在浏览器的本地 `chrome.storage.local` 中。用户在多台电脑切换、重装浏览器或清理扩展数据时，所有设置直接丢失，体验割裂。
- **架构定调**：**严禁针对 Cleaner 单独做孤立配置表**，必须设计并实现**「XHunt 全量用户云端配置同步中心（User Settings Sync Center）」**。采用以 `userId` 为主键、模块化命名空间的 JSONB 弹性存储结构，本次 Cleaner 作为其一级命名空间接入，同时为插件现存及未来的所有用户设置提供跨端漫游能力。

#### 诉求 2：Nacos 的配置需要在管理后台编辑，是否在 admin-web 单独新开一页？
- **明确结论**：**必须在 `admin-web` 单独新开专有管理页面（`/cleaner-config`）**。
- **深度原因**：
  1. **规则复杂度高**：Cleaner 规则包含多业务组（色情引流、灰产博彩）、强词、高级正则、意向词、精确/模糊弱词、字数阈值及全局白名单。
  2. **手工 JSON 风险极高**：若仅在现有的通用 `/nacos-admin` 裸 JSON 编辑器中由运营或开发直接改写 JSON，一旦出现 JSON 语法错误或未转义的正则表达式，会导致数十万客户端拉取到脏配置从而解析崩溃。
  3. **正则安全防爆（防 ReDoS）**：专有页面可提供正则语法静态校验与 ReDoS 灾难性回溯检查。
  4. **推文清洗沙箱模拟器（核心能力）**：专有页面集成沙箱测试器，运营人员可在发布前粘贴推文样例，即时测试是否会命中规则、命中哪一条特征，确认无误后再发布到生产环境。

---

## 二、 方案设计一：全量用户云端配置同步中心

### 2.1 架构设计

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   XHunt 浏览器插件 (Client Extension)                   │
├────────────────────────────────────────────────────────────────────────┤
│  1. 本地优先 (Local-first): 读写直达 Plasmo Storage，保证 UI 零延迟    │
│  2. 启动/登录拉取 (Pull on Init): 登录或启动时拉取云端，与本地合并     │
│  3. 防抖增量推送 (Debounced Push): 用户切换开关时 300ms 防抖同步后端    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP Bearer JWT (authenticateToken)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               enterprise-admin API Server (后端中心)                   │
├────────────────────────────────────────────────────────────────────────┤
│  路由: /api/xhunt/user/settings (GET / PUT / POST reset)               │
│  缓存层: Redis (Key: user:settings:{userId}, TTL: 10min)               │
│  数据层: PostgreSQL 表 XHuntUserSettings (JSONB 深度合并 + 版本控制)   │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据库模型设计 (`XHuntUserSettings`)

在 PostgreSQL 中建立独立配置表，避免将高频修改的偏好配置直接耦合在用户核心表 `XHuntUsers` 中。

```javascript
// src/xhunt/models/XHuntUserSettings.js
const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntUserSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 XHuntUsers.id",
      },
      category: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "all",
        comment: "配置类别：all(全量大对象) / cleaner / display / features",
      },
      settings: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: "具体配置数据大对象 (JSONB)",
      },
      version: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 1,
        comment: "乐观并发版本号，每次成功修改递增",
      },
      clientUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "客户端提交修改的时间戳",
      },
    },
    {
      tableName: "XHuntUserSettings",
      timestamps: true,
      indexes: [
        {
          name: "uq_user_settings_user_category",
          unique: true,
          fields: ["userId", "category"],
        },
        {
          name: "idx_user_settings_user_id",
          fields: ["userId"],
        },
      ],
    }
  );
};
```

### 2.3 用户配置数据规范 (Settings Schema)

`settings` 字段内的数据结构采用模块化大对象，本次功能作为 `cleaner` 子对象收敛，同时全面兼容插件既有偏好：

```json
{
  "version": 1,
  "updatedAt": "2026-09-15T12:00:00.000Z",
  "cleaner": {
    "enabled": true,
    "mode": "mark",
    "whitelist": ["elonmusk", "vitalikbuterin"],
    "customKeywords": ["买粉", "同城约v", "门槛群"]
  },
  "display": {
    "language": "zh",
    "avatarRankMode": "web3",
    "showSidebarIcon": true,
    "showAvatarRank": true,
    "showTokenAnalysis": true,
    "showTweetAIAnalysis": true,
    "showSearchPanel": true,
    "showHotTrendingWeb3": true,
    "showHotTrendingAi": true,
    "showAnnualReport": true
  },
  "features": {
    "showHunterCampaign": true,
    "showOfficialTags": true,
    "showNotes": true,
    "showRealtimeSubscription": false,
    "showEngageToEarn": true,
    "enableBnbFeeds": true,
    "enableGossip": true,
    "enableListing": true
  },
  "sidebars": {
    "showProjectMembers": true,
    "showInvestors": true,
    "showPortfolio": true,
    "show90dMention": true,
    "showReviews": true
  }
}
```

### 2.4 后端 API 接口定义

挂载路由：`/api/xhunt/user/settings`，使用 `authenticateToken` 中间件强制鉴权。

#### 1. 获取用户配置
- **Method / Path**: `GET /api/xhunt/user/settings`
- **Headers**: `Authorization: Bearer <token>`
- **Query 参数**: `category` (可选，默认 `all`)
- **逻辑流程**:
  1. 读取 Redis 缓存 `user:settings:${req.user.id}:${category}`；
  2. 若未命中，从 `XHuntUserSettings` 查询对应记录；
  3. 若数据库无记录，返回各模块的系统默认初始配置对象（Default Profile）；
  4. 写入 Redis（TTL 10 分钟）；
  5. 返回响应。
- **返回示例**:
  ```json
  {
    "success": true,
    "data": {
      "version": 2,
      "updatedAt": "2026-09-15T10:30:00.000Z",
      "settings": {
        "cleaner": {
          "enabled": true,
          "mode": "mark",
          "whitelist": ["cz_binance"],
          "customKeywords": ["兼职刷单"]
        },
        "display": { ... }
      }
    }
  }
  ```

#### 2. 更新/增量合并用户配置 (Patch / Upsert)
- **Method / Path**: `PUT /api/xhunt/user/settings`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
  ```json
  {
    "category": "cleaner",
    "settings": {
      "enabled": true,
      "mode": "hide",
      "customKeywords": ["兼职刷单", "日赚百万"]
    },
    "clientUpdatedAt": 1726384900000
  }
  ```
- **逻辑流程**:
  1. 校验请求体合法性（白名单字段与数据类型校验，防止非法数据注入）；
  2. 查询已有记录，若存在则使用深度合并（Deep Merge）将局部更改合并入既有配置，递增 `version`；若不存在则 `create`；
  3. 同步失效或更新 Redis 缓存 `user:settings:${req.user.id}:*`；
  4. 返回合并后的最新配置和最新版本号。

#### 3. 重置指定模块配置
- **Method / Path**: `POST /api/xhunt/user/settings/reset`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: `{ "category": "cleaner" }`
- **逻辑流程**: 将指定模块的数据重置为默认值并更新持久化。

---

## 三、 方案设计二：Nacos 规则下发与 Admin-Web 独立管理页

### 3.1 方案权衡对比

| 维度 | 方案 A：复用现有通用 `/nacos-admin` 页面 | 方案 B：在 `admin-web` 单独新开专有页面（推荐） |
| :--- | :--- | :--- |
| **操作形式** | 在一个大代码框内直接编辑数千行 JSON | 结构化分 Tab 卡片、Tag 标签增删、正则行内测试 |
| **错误容忍度** | 极低。缺一个逗号、未转义反斜杠，全量客户端失效 | 极高。前端与后端在保存前均自动校验 JSON 结构与正则表达式 |
| **安全风控** | 无法检测 ReDoS 危险正则模式 | 内置正则耗时测试与语法防爆拦截 |
| **业务验证** | 无沙箱。运营不知道某条新规则是否会误杀正常推文 | **自带推文沙箱模拟器**，直接粘贴推文即刻看是否命中及原因 |
| **权限管理** | 只能开放给超级管理员（涉及全站核心配置） | 可单独为社区运营、风控团队授予此页权限，隔离核心配置 |

**最终结论**：底层仍然注册入 Nacos 并生成快照，但在 `admin-web` **单独新开一页 `/cleaner-config`**。

### 3.2 Nacos 配置内容格式规范 (`xhunt_cleaner_rules`)

```json
{
  "version": "2026091501",
  "enabled": true,
  "description": "XHunt 信息流智能降噪与黄推/灰产引流过滤规则",
  "globalExemptHandles": [
    "elonmusk",
    "cz_binance",
    "vitalikbuterin"
  ],
  "rules": {
    "adult_traffic": {
      "name": "色情/擦边引流",
      "enabled": true,
      "maxWeakSpamLength": 80,
      "strongKeywords": [
        "门槛群", "看简界", "看置顶推文", "同城约v", "私聊看主页", "进裙看", "全套资源"
      ],
      "regexPatterns": [
        "(?:加|➕|＋|➕微|➕v|vx|微|威)[：:\\s]*[a-zA-Z0-9_-]{5,20}",
        "(?:telegram|tg|纸飞机)[：:\\s]*(?:@|https?:\\/\\/t\\.me\\/)[a-zA-Z0-9_]{4,}"
      ],
      "intentKeywords": [
        "看置顶", "看主页", "加我", "门槛", "私信", "进群", "自取"
      ],
      "exactKeywords": [
        "约", "同城", "空降", "嫩妹", "纯欲", "福利"
      ],
      "fuzzyKeywords": [
        "吃瓜", "黑料", "门槛"
      ]
    },
    "gray_promotion": {
      "name": "灰产博彩/私域暗语",
      "enabled": true,
      "maxWeakSpamLength": 80,
      "strongKeywords": [
        "内部返利", "包赢", "带单老师", "首充送", "精准计划"
      ],
      "regexPatterns": [
        "(?:菠菜|棋牌|开元|皇冠|彩票)[a-zA-Z0-9]{3,}"
      ],
      "intentKeywords": [
        "带飞", "稳赚", "回血", "上车", "跟单"
      ],
      "exactKeywords": [
        "兼职", "日结", "刷单", "挂机"
      ],
      "fuzzyKeywords": [
        "稳赚不赔"
      ]
    }
  }
}
```

### 3.3 Admin-Web 独立管理页设计 (`NacosCleanerRulesPage.tsx`)

#### 1. 路由与菜单
- **路径**：`/cleaner-config`
- **组件**：`admin-web/src/pages/NacosCleanerRulesPage.tsx`
- **菜单位置**：侧边栏 `sidebarGroup: "operation"`，名称为 **“净化规则配置”**。
- **权限控制**：`"cleaner-config"`。

#### 2. 界面功能模块布局

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  信息流净化规则管理 (X-Cleaner)             [历史快照] [从线上拉取] [发布上线] │
├──────────────────────────────────────────────────────────────────────────────┤
│ 基础状态: [● 规则生效中]   版本号: 2026091501   操作人: admin@xhunt.ai       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tabs: [色情/擦边引流 (adult_traffic)] [灰产博彩 (gray_promotion)] [全局加白名单] │
│                                                                              │
│  [✓] 启用该规则组   长文保护阈值: [ 80 ] 字                                  │
│                                                                              │
│  1. 强特征词 (Strong Keywords) - 无视字数，命中立即拦截                      │
│     [看置顶推文 ✕] [同城约v ✕] [看简界 ✕] [门槛群 ✕] [+ 批量添加]             │
│                                                                              │
│  2. 正则表达式模式 (Regex Patterns) - 复杂暗语匹配                           │
│     • /(?:加|➕|＋|威)[：:\s]*[a-zA-Z0-9_-]{5,20}/i       [编辑] [测试] [删除]│
│     • /(?:tg|telegram)[：:\s]*@?[a-zA-Z0-9_]{4,}/i       [编辑] [测试] [删除]│
│     [+ 新增正则表达式]                                                       │
│                                                                              │
│  3. 弱特征词与意向确认组合 (Intent + Weak Keywords)                          │
│     • 意向动词: [看置顶 ✕] [私聊 ✕] [加我 ✕] [+ 添加]                       │
│     • 精准弱词: [同城 ✕] [约 ✕] [空降 ✕] [+ 添加]                           │
│     • 模糊弱词: [吃瓜 ✕] [黑料 ✕] [+ 添加]                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🧪 推文清洗沙箱模拟测试器 (Rule Testing Sandbox)                              │
│                                                                              │
│ 待测博主 Handle: [@some_spammer       ]                                      │
│ 待测试推文内容:                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 小哥哥加我威：xyz8899 看置顶推文有精彩完整版福利视频哦~                   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ [ 立即运行测试 ]                                                             │
│                                                                              │
│ 测试结果: 🚨 触发拦截 (Mark / Hide)                                          │
│ • 判定类别: 色情/擦边引流 (adult_traffic)                                    │
│ • 命中规则: 命中强引流特征 [看置顶推文]、命中正则 [/(?:加|威)[：:\s]*.../]  │
│ • 耗时计算: 0.6ms                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 3. 核心交互机制
1. **词条批量粘贴**：支持用户直接粘贴换行或逗号分隔的大段词汇，前端自动分词去重生成 Tag 列表。
2. **正则防爆校验**：在添加或编辑正则表达式时，客户端即时校验语法；若存在可能引发回溯的模式，给予显式警告。
3. **推文沙箱测试**：把 `tweet-hunt-extension` 中的文本清洗逻辑（`normalizeTweetText`）与判定算法复刻在前端/后端共用逻辑中，在发布前验证推文判定结果，保证无误判。
4. **版本快照与一键回滚**：每次点击“发布上线”时，强制要求输入“发布备注（Reason）”，后端自动存入 `XhuntNacosConfigSnapshot` 表，支持任意历史版本对比（Diff）与一键还原。

---

## 四、 关键技术链路与环境安全保障

### 4.1 Nginx 公网只读白名单放行

插件端调用 `https://kb.xhunt.ai/nacos-configs?dataId=xhunt_cleaner_rules&group=DEFAULT_GROUP` 拉取规则。  
在现行 `nginx/kb.cryptohunt.ai.conf` 中，Nginx 对公网只读接口设置了强制正则校验：

```nginx
# nginx/kb.cryptohunt.ai.conf
location ^~ /nacos-configs {
    # 现有的白名单限制：
    if ($arg_dataId !~ ^(xhunt_config|xhunt_i18n|xhunt_campaigns|xhunt_built_in_tag|xhunt_built_in_tag_en|xhunt_message|xhunt_message_en)$) { 
        return 404; 
    }
    if ($arg_group != "DEFAULT_GROUP") { return 404; }
    ...
}
```

⚠️ **关键环境配置**：上线前必须更新该 Nginx 配置，将 `xhunt_cleaner_rules` 加入正则白名单：
```nginx
if ($arg_dataId !~ ^(xhunt_config|xhunt_i18n|xhunt_campaigns|xhunt_built_in_tag|xhunt_built_in_tag_en|xhunt_message|xhunt_message_en|xhunt_cleaner_rules)$) { 
    return 404; 
}
```
*同时需同步更新后端自检脚本 `src/xhunt/api/stats-routes/nacos-security.js` 中的检测用例，确保自动化安全巡检保持绿标。*

### 4.2 Nacos 目录注册 (`nacos-admin.js`)

在后端 `src/xhunt/api/stats-routes/nacos-admin.js` 中将该配置正式纳管至 `NACOS_CONFIG_CATALOG`：

```javascript
{
  dataId: "xhunt_cleaner_rules",
  label: "信息流净化规则 (X-Cleaner)",
  group: DEFAULT_GROUP,
  type: "json",
  publicReadable: true,
  permissions: ["cleaner-config"],
}
```

这样即自动获得了后端的读取鉴权、写入快照记录、操作审计日志（Audit Log）以及通用备份恢复能力。

---

## 五、 项目实施计划与工时估算 (Milestones)

```text
阶段一：Nacos 注册与安全链路
  ├── 1. NACOS_CONFIG_CATALOG 添加 xhunt_cleaner_rules
  ├── 2. 初始化 Nacos 线上初始规则内容
  └── 3. Nginx 配置文件白名单扩充与安全巡检更新

阶段二：Admin-Web 专有配置页开发
  ├── 1. 新建 /cleaner-config 页面与侧边栏路由
  ├── 2. 实现 Tag 词库批量输入、正则编辑与校验
  ├── 3. 实现推文沙箱模拟器 (Rule Playground)
  └── 4. 接入快照历史查看与一键版本回滚

阶段三：用户全量配置云同步中心
  ├── 1. 编写 PostgreSQL 迁移：新建 XHuntUserSettings 表
  ├── 2. 实现 /api/xhunt/user/settings (GET / PUT / RESET)
  ├── 3. 引入 Redis 缓存与高频防击穿保护
  └── 4. 编写接口单测与数据校验逻辑

阶段四：插件端联调与平滑迁移
  ├── 1. 改造插件端 settingsManager，接入云端配置同步适配器
  ├── 2. 插件首次登录时静默将本地旧配置上报至云端
  └── 3. 跨端/换机测试与多设备一致性验证
```

---

## 六、 总结与确认项

1. **用户配置持久化**：确定建立通用的 `XHuntUserSettings`（JSONB 弹性结构），一次性彻底解决包括净化器设置在内的全量 50+ 个插件偏好设置的跨机漫游与丢失问题。
2. **管理后台界面**：确定在 `admin-web` 独立新开 `/cleaner-config` 页面，配备可视化标签录入、正则校验和推文测试沙箱，兼顾操作便利与线上安全。
3. **生产发布前置**：明确了 Nginx 白名单扩充、Nacos 目录注册、Sequelize 数据库迁移的具体变更点与顺序。

