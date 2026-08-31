"use strict";

const COLUMN_COMMENTS = {
  "EchohuntSocialListeningSnapshots": {
    "id": "聚合快照 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "rangeKey": "时间范围：24H/7D/30D",
    "bucketSize": "聚合桶粒度：hour/day",
    "windowStartAt": "聚合窗口开始时间",
    "windowEndAt": "聚合窗口结束时间",
    "processedThrough": "生成快照时看板已处理到的时间游标",
    "metrics": "概览指标 JSON：讨论量、参与账号、曝光、互动、历史不足等",
    "volumeSeries": "讨论量趋势序列",
    "sentimentSeries": "情绪趋势序列",
    "sentimentComposition": "情绪占比与样本数统计",
    "topics": "主题榜聚合结果",
    "wordCloud": "词云聚合结果",
    "accountSummary": "关键账号动态摘要",
    "alertSummary": "预警摘要统计",
    "generatedAt": "快照生成时间",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningKeyEvents": {
    "id": "用户关键事件 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "authCenterUserId": "事件所属 AuthCenter 用户 ID，用于用户隔离",
    "xhuntUserId": "兼容关联旧 XHuntUsers.id",
    "tweetUrl": "用户录入的 X 帖子链接或标准化链接",
    "tweetId": "关键事件关联 tweet id；同一用户同一看板唯一",
    "eventType": "关键事件类型，由前端/产品枚举定义",
    "title": "用户自定义事件标题",
    "authorTwitterId": "事件帖子作者 Twitter user id 快照",
    "authorHandle": "事件帖子作者 handle 快照",
    "authorName": "事件帖子作者展示名快照",
    "authorAvatar": "事件帖子作者头像 URL 快照",
    "authorGlobalRank": "事件帖子作者全球 KOL 排名快照",
    "eventAt": "事件发生/帖子发布时间",
    "metadata": "事件扩展信息，例如备注、前端标签、原始解析结果",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningAlerts": {
    "id": "预警记录 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "alertType": "预警类型：influential_mention/negative_content/volume_spike/negative_share_spike",
    "severity": "预警严重程度：high/medium/info",
    "dedupeKey": "预警去重键，同一看板内唯一，用于合并连续异常",
    "triggeredAt": "首次触发时间",
    "lastSeenAt": "最近一次命中该预警的时间",
    "titleZh": "中文预警标题",
    "messageZh": "中文预警描述",
    "currentValue": "当前异常值 JSON",
    "baselineValue": "历史基线值 JSON",
    "sampleSize": "触发预警时参与计算的样本量",
    "reason": "预警触发原因说明",
    "evidenceTweetIds": "证据 tweet id 列表",
    "status": "技术状态：active/merged/expired；V1 前台不做处置态",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningBoards": {
    "id": "Social Listening 看板 ID，每个被监控官方 X 账号对应一个看板",
    "officialTwitterId": "被监控官方账号的 Twitter user id；账号解析成功后写入",
    "officialHandle": "被监控官方账号 handle，去 @ 后统一小写；未删除看板内唯一",
    "projectName": "项目或品牌展示名称，用于前台看板标题和 AI 项目态度输入",
    "projectDescription": "项目简介快照，来自官方 X profile 或运营手动维护",
    "projectAvatar": "项目头像 URL 快照，来自官方 X profile",
    "verified": "官方账号认证状态快照，可能来自 verified 或 is_blue_verified",
    "followersCount": "官方账号粉丝数快照",
    "globalRank": "官方账号全球 KOL 排名快照；优先 feature.rank.kolGlobalRank/kolRank",
    "cnRank": "官方账号华语 KOL 排名快照；优先 feature.rank.kolCnRank",
    "brandColor": "看板品牌色，十六进制或前端约定色值",
    "status": "看板状态：initializing/monitoring/paused/deleting/deleted/failed",
    "coverageStartAt": "当前已覆盖的最早帖子发布时间，用于判断 7D/30D 历史是否完整",
    "processedThrough": "后台任务已处理到的时间游标；增量任务从该时间附近重叠扫描",
    "lastSuccessAt": "最近一次任务成功完成时间",
    "lastFailureAt": "最近一次任务失败时间",
    "lastFailureReason": "最近一次任务失败原因，前台/后台用于提示和排查",
    "createdByAdminId": "创建该看板的管理员 ID",
    "updatedByAdminId": "最近更新该看板配置的管理员 ID",
    "metadata": "扩展配置：keywords/aliases/token/notes/profileSnapshot/rankSource 等",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningPosts": {
    "id": "帖子事实记录 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "tweetId": "X/Twitter tweet id；同一看板内唯一去重",
    "authorTwitterId": "帖子作者 Twitter user id",
    "authorHandle": "帖子作者 handle 快照",
    "authorName": "帖子作者展示名快照",
    "authorAvatar": "帖子作者头像 URL 快照",
    "authorFollowersCount": "帖子作者粉丝数快照",
    "authorGlobalRank": "帖子作者全球 KOL 排名快照",
    "authorCnRank": "帖子作者华语 KOL 排名快照",
    "authorIsCn": "帖子作者是否华语账号快照，来自 dev.twitter_user.ai.is_cn",
    "postCreatedAt": "帖子发布时间，来自 dev.tweet.create_time",
    "text": "帖子原文",
    "normalizedText": "归一化正文，用于关键词匹配和 AI 输入",
    "source": "召回来源：mention/quote/reply/comment",
    "conversationId": "会话根 tweet id",
    "quoteId": "引用目标 tweet id",
    "replyId": "回复目标 tweet id",
    "retweetId": "转推原 tweet id；V1 默认不单独纳入但保留快照",
    "viewsCount": "浏览量快照，来自 dev.tweet.statistic.views",
    "likesCount": "点赞数快照，来自 dev.tweet.statistic.likes",
    "repostsCount": "转推数快照，来自 dev.tweet.statistic.retweet_count",
    "quotesCount": "引用数快照，来自 dev.tweet.statistic.quote_count",
    "repliesCount": "回复数快照，来自 dev.tweet.statistic.reply_count",
    "sentiment": "项目态度情绪：positive/neutral/negative/unknown",
    "projectAttitudeScore": "项目态度 AI 分数，旧口径 score < 4 为负面",
    "sentimentScore": "兼容情绪分数字段，默认等同 projectAttitudeScore",
    "sentimentSummaryZh": "项目态度中文摘要/原因",
    "topics": "主题标签 JSON，优先复用 dev.tweet.ai.domain_tag/crypto_sub_tags/ai_sub_tags",
    "keywords": "热词与命中关键词 JSON，用于词云和命中原因",
    "summaryZh": "中文摘要，优先复用 dev.tweet.ai.summary_cn",
    "summaryEn": "英文摘要，优先复用 dev.tweet.ai.summary_en",
    "titleZh": "中文标题，优先复用 dev.tweet.ai.title_cn",
    "titleEn": "英文标题，优先复用 dev.tweet.ai.title_en",
    "abstractZh": "中文长摘要，优先复用 dev.tweet.ai.abstract_cn",
    "abstractEn": "英文长摘要，优先复用 dev.tweet.ai.abstract_en",
    "tagStatus": "标签处理状态：reused/generated/pending/failed/skipped",
    "summaryStatus": "摘要处理状态：reused/generated/pending/failed/skipped",
    "attitudeStatus": "项目态度处理状态：pending/succeeded/failed/skipped",
    "aiStatus": "AI 总状态，汇总 tag/summary/attitude 状态",
    "aiAnalyzedAt": "最近一次 AI 分析完成或尝试时间",
    "aiError": "AI 处理错误摘要，不保存 prompt 或敏感上下文",
    "aiSource": "AI 字段来源：dev_tweet_ai/social_listening_generated/project_attitude/mixed",
    "rawTweet": "原始推文必要片段快照，避免前台实时扫 dev.tweet",
    "rawAuthor": "作者资料必要片段快照，避免前台实时扫 dev.twitter_user",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningJobs": {
    "id": "后台任务 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "jobType": "任务类型：history_backfill/incremental/manual_refresh/reanalyze",
    "status": "任务状态：pending/running/succeeded/failed/skipped/cancelled",
    "rangeStartAt": "本任务处理时间范围开始",
    "rangeEndAt": "本任务处理时间范围结束",
    "progress": "任务进度 JSON：stage/window/counters/warnings/heartbeat 等",
    "metadata": "任务参数 JSON：stage、overlap、触发来源详情等",
    "startedAt": "任务开始执行时间",
    "finishedAt": "任务结束时间",
    "errorCode": "任务失败错误码",
    "errorMessage": "任务失败错误信息摘要",
    "triggeredBy": "触发方：system/admin/user",
    "triggeredByAdminId": "后台触发任务的管理员 ID",
    "triggeredByAuthCenterUserId": "前台触发任务的 AuthCenter 用户 ID",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningAccessAuditLogs": {
    "id": "Social Listening 操作审计日志 ID",
    "boardId": "关联看板 ID；导出等全局操作可为空",
    "accessId": "关联授权记录 ID；非授权类操作可为空",
    "adminId": "后台操作管理员 ID；前台用户操作为空",
    "authCenterUserId": "前台操作 AuthCenter 用户 ID；后台操作可为空",
    "action": "操作类型：board_create/board_update/access_grant/export 等",
    "targetTwitterHandle": "操作目标 X handle，例如被授权用户 handle",
    "targetAuthCenterUserId": "操作目标 AuthCenter 用户 ID，例如被授权用户 ID",
    "payload": "审计详情 JSON；只记录安全白名单字段，不写密钥/Token",
    "createdAt": "记录创建时间"
  },
  "EchohuntSocialListeningAccountSignals": {
    "id": "关键账号动态记录 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "twitterId": "动态相关账号 Twitter user id",
    "handle": "动态相关账号 handle 快照",
    "name": "动态相关账号展示名快照",
    "avatar": "动态相关账号头像 URL 快照",
    "followersCount": "动态相关账号粉丝数快照",
    "globalRank": "动态相关账号全球 KOL 排名快照",
    "cnRank": "动态相关账号华语 KOL 排名快照",
    "signalType": "动态类型：高排名提及/关注/取关等",
    "occurredAt": "动态发生时间",
    "mentionCount": "相关账号在窗口内提及次数",
    "viewsCount": "相关帖子曝光量合计",
    "engagementCount": "相关帖子互动量合计",
    "sentiment": "相关动态主要情绪",
    "topics": "相关动态主题摘要",
    "postIds": "相关 Social Listening post id 或 tweet id 列表",
    "summaryZh": "动态中文摘要",
    "rankSnapshot": "排名快照与来源详情",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  },
  "EchohuntSocialListeningBoardAccesses": {
    "id": "看板授权记录 ID",
    "boardId": "关联 EchohuntSocialListeningBoards.id",
    "twitterId": "被授权 EchoHunt 用户的 Twitter user id；用户已登录过时写入",
    "twitterHandle": "被授权 EchoHunt 用户 X handle，去 @ 后统一小写；支持先按 handle 授权",
    "authCenterUserId": "关联 AuthCenterXhuntUsers.id；用户登录匹配后自动回填",
    "xhuntUserId": "兼容关联旧 XHuntUsers.id，不作为主要授权依据",
    "status": "授权状态：active/revoked；撤销后前台即时失效",
    "grantedByAdminId": "授予授权的管理员 ID",
    "revokedByAdminId": "撤销授权的管理员 ID",
    "grantedAt": "授权生效时间",
    "revokedAt": "授权撤销时间；为空表示未撤销",
    "metadata": "授权扩展信息：来源、运营备注、首次匹配信息等",
    "createdAt": "记录创建时间",
    "updatedAt": "记录更新时间"
  }
}
;

async function applyColumnComments(queryInterface) {
  for (const [tableName, columns] of Object.entries(COLUMN_COMMENTS)) {
    for (const [columnName, comment] of Object.entries(columns)) {
      await queryInterface.sequelize.query(
        `COMMENT ON COLUMN "${tableName}"."${columnName}" IS ${queryInterface.sequelize.escape(comment)}`
      );
    }
  }
}


/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EchohuntSocialListeningBoards", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      officialTwitterId: { type: Sequelize.STRING(64), allowNull: true },
      officialHandle: { type: Sequelize.STRING(64), allowNull: false },
      projectName: { type: Sequelize.STRING(255), allowNull: false },
      projectDescription: { type: Sequelize.TEXT, allowNull: true },
      projectAvatar: { type: Sequelize.TEXT, allowNull: true },
      verified: { type: Sequelize.BOOLEAN, allowNull: true },
      followersCount: { type: Sequelize.BIGINT, allowNull: true },
      globalRank: { type: Sequelize.INTEGER, allowNull: true },
      cnRank: { type: Sequelize.INTEGER, allowNull: true },
      brandColor: { type: Sequelize.STRING(32), allowNull: true },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "initializing" },
      coverageStartAt: { type: Sequelize.DATE, allowNull: true },
      processedThrough: { type: Sequelize.DATE, allowNull: true },
      lastSuccessAt: { type: Sequelize.DATE, allowNull: true },
      lastFailureAt: { type: Sequelize.DATE, allowNull: true },
      lastFailureReason: { type: Sequelize.TEXT, allowNull: true },
      createdByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      updatedByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningBoardAccesses", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      twitterId: { type: Sequelize.STRING(64), allowNull: true },
      twitterHandle: { type: Sequelize.STRING(64), allowNull: false },
      authCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      xhuntUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "XHuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      grantedByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      revokedByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      grantedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningAccessAuditLogs", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      accessId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "EchohuntSocialListeningBoardAccesses", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      adminId: { type: Sequelize.INTEGER, allowNull: true },
      authCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      action: { type: Sequelize.STRING(64), allowNull: false },
      targetTwitterHandle: { type: Sequelize.STRING(64), allowNull: true },
      targetAuthCenterUserId: { type: Sequelize.UUID, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningPosts", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      tweetId: { type: Sequelize.STRING(64), allowNull: false },
      authorTwitterId: { type: Sequelize.STRING(64), allowNull: false },
      authorHandle: { type: Sequelize.STRING(128), allowNull: true },
      authorName: { type: Sequelize.STRING(255), allowNull: true },
      authorAvatar: { type: Sequelize.TEXT, allowNull: true },
      authorFollowersCount: { type: Sequelize.BIGINT, allowNull: true },
      authorGlobalRank: { type: Sequelize.INTEGER, allowNull: true },
      authorCnRank: { type: Sequelize.INTEGER, allowNull: true },
      authorIsCn: { type: Sequelize.BOOLEAN, allowNull: true },
      postCreatedAt: { type: Sequelize.DATE, allowNull: false },
      text: { type: Sequelize.TEXT, allowNull: true },
      normalizedText: { type: Sequelize.TEXT, allowNull: true },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "mention" },
      conversationId: { type: Sequelize.STRING(64), allowNull: true },
      quoteId: { type: Sequelize.STRING(64), allowNull: true },
      replyId: { type: Sequelize.STRING(64), allowNull: true },
      retweetId: { type: Sequelize.STRING(64), allowNull: true },
      viewsCount: { type: Sequelize.BIGINT, allowNull: true },
      likesCount: { type: Sequelize.BIGINT, allowNull: true },
      repostsCount: { type: Sequelize.BIGINT, allowNull: true },
      quotesCount: { type: Sequelize.BIGINT, allowNull: true },
      repliesCount: { type: Sequelize.BIGINT, allowNull: true },
      sentiment: { type: Sequelize.STRING(32), allowNull: true },
      projectAttitudeScore: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      sentimentScore: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      sentimentSummaryZh: { type: Sequelize.TEXT, allowNull: true },
      topics: { type: Sequelize.JSONB, allowNull: true },
      keywords: { type: Sequelize.JSONB, allowNull: true },
      summaryZh: { type: Sequelize.TEXT, allowNull: true },
      summaryEn: { type: Sequelize.TEXT, allowNull: true },
      titleZh: { type: Sequelize.TEXT, allowNull: true },
      titleEn: { type: Sequelize.TEXT, allowNull: true },
      abstractZh: { type: Sequelize.TEXT, allowNull: true },
      abstractEn: { type: Sequelize.TEXT, allowNull: true },
      tagStatus: { type: Sequelize.STRING(32), allowNull: true },
      summaryStatus: { type: Sequelize.STRING(32), allowNull: true },
      attitudeStatus: { type: Sequelize.STRING(32), allowNull: true },
      aiStatus: { type: Sequelize.STRING(32), allowNull: true },
      aiAnalyzedAt: { type: Sequelize.DATE, allowNull: true },
      aiError: { type: Sequelize.TEXT, allowNull: true },
      aiSource: { type: Sequelize.STRING(64), allowNull: true },
      rawTweet: { type: Sequelize.JSONB, allowNull: true },
      rawAuthor: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningSnapshots", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      rangeKey: { type: Sequelize.STRING(16), allowNull: false },
      bucketSize: { type: Sequelize.STRING(16), allowNull: false },
      windowStartAt: { type: Sequelize.DATE, allowNull: false },
      windowEndAt: { type: Sequelize.DATE, allowNull: false },
      processedThrough: { type: Sequelize.DATE, allowNull: true },
      metrics: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      volumeSeries: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      sentimentSeries: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      sentimentComposition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      topics: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      wordCloud: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      accountSummary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      alertSummary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      generatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningAccountSignals", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      twitterId: { type: Sequelize.STRING(64), allowNull: false },
      handle: { type: Sequelize.STRING(128), allowNull: true },
      name: { type: Sequelize.STRING(255), allowNull: true },
      avatar: { type: Sequelize.TEXT, allowNull: true },
      followersCount: { type: Sequelize.BIGINT, allowNull: true },
      globalRank: { type: Sequelize.INTEGER, allowNull: true },
      cnRank: { type: Sequelize.INTEGER, allowNull: true },
      signalType: { type: Sequelize.STRING(64), allowNull: false },
      occurredAt: { type: Sequelize.DATE, allowNull: false },
      mentionCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      viewsCount: { type: Sequelize.BIGINT, allowNull: true },
      engagementCount: { type: Sequelize.BIGINT, allowNull: true },
      sentiment: { type: Sequelize.STRING(32), allowNull: true },
      topics: { type: Sequelize.JSONB, allowNull: true },
      postIds: { type: Sequelize.JSONB, allowNull: true },
      summaryZh: { type: Sequelize.TEXT, allowNull: true },
      rankSnapshot: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningAlerts", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      alertType: { type: Sequelize.STRING(64), allowNull: false },
      severity: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "info" },
      dedupeKey: { type: Sequelize.STRING(255), allowNull: false },
      triggeredAt: { type: Sequelize.DATE, allowNull: false },
      lastSeenAt: { type: Sequelize.DATE, allowNull: false },
      titleZh: { type: Sequelize.STRING(255), allowNull: false },
      messageZh: { type: Sequelize.TEXT, allowNull: false },
      currentValue: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      baselineValue: { type: Sequelize.JSONB, allowNull: true },
      sampleSize: { type: Sequelize.INTEGER, allowNull: true },
      reason: { type: Sequelize.TEXT, allowNull: true },
      evidenceTweetIds: { type: Sequelize.JSONB, allowNull: true },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningKeyEvents", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      authCenterUserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      xhuntUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "XHuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      tweetUrl: { type: Sequelize.TEXT, allowNull: false },
      tweetId: { type: Sequelize.STRING(64), allowNull: false },
      eventType: { type: Sequelize.STRING(64), allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: true },
      authorTwitterId: { type: Sequelize.STRING(64), allowNull: true },
      authorHandle: { type: Sequelize.STRING(128), allowNull: true },
      authorName: { type: Sequelize.STRING(255), allowNull: true },
      authorAvatar: { type: Sequelize.TEXT, allowNull: true },
      authorGlobalRank: { type: Sequelize.INTEGER, allowNull: true },
      eventAt: { type: Sequelize.DATE, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("EchohuntSocialListeningJobs", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "EchohuntSocialListeningBoards", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      jobType: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      rangeStartAt: { type: Sequelize.DATE, allowNull: true },
      rangeEndAt: { type: Sequelize.DATE, allowNull: true },
      progress: { type: Sequelize.JSONB, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      startedAt: { type: Sequelize.DATE, allowNull: true },
      finishedAt: { type: Sequelize.DATE, allowNull: true },
      errorCode: { type: Sequelize.STRING(64), allowNull: true },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      triggeredBy: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "system" },
      triggeredByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      triggeredByAuthCenterUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await applyColumnComments(queryInterface);

    await queryInterface.addIndex("EchohuntSocialListeningBoards", ["officialHandle"], {
      unique: true,
      name: "ux_echohunt_sl_boards_active_handle",
      where: { status: { [Sequelize.Op.ne]: "deleted" } },
    });
    await queryInterface.addIndex("EchohuntSocialListeningBoards", ["status"], { name: "idx_echohunt_sl_boards_status" });
    await queryInterface.addIndex("EchohuntSocialListeningBoards", ["processedThrough"], { name: "idx_echohunt_sl_boards_processed_through" });

    await queryInterface.addIndex("EchohuntSocialListeningBoardAccesses", ["boardId", "twitterHandle"], {
      unique: true,
      name: "ux_echohunt_sl_access_board_handle_active",
      where: { status: "active" },
    });
    await queryInterface.addIndex("EchohuntSocialListeningBoardAccesses", ["twitterHandle", "status"], { name: "idx_echohunt_sl_access_handle_status" });
    await queryInterface.addIndex("EchohuntSocialListeningBoardAccesses", ["authCenterUserId", "status"], { name: "idx_echohunt_sl_access_auth_user_status" });
    await queryInterface.addIndex("EchohuntSocialListeningBoardAccesses", ["boardId", "status"], { name: "idx_echohunt_sl_access_board_status" });

    await queryInterface.addIndex("EchohuntSocialListeningAccessAuditLogs", ["boardId", "createdAt"], { name: "idx_echohunt_sl_audit_board_created" });
    await queryInterface.addIndex("EchohuntSocialListeningAccessAuditLogs", ["targetTwitterHandle", "createdAt"], { name: "idx_echohunt_sl_audit_target_handle_created" });
    await queryInterface.addIndex("EchohuntSocialListeningAccessAuditLogs", ["adminId", "createdAt"], { name: "idx_echohunt_sl_audit_admin_created" });
    await queryInterface.addIndex("EchohuntSocialListeningAccessAuditLogs", ["authCenterUserId", "createdAt"], { name: "idx_echohunt_sl_audit_auth_user_created" });

    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["boardId", "tweetId"], { unique: true, name: "ux_echohunt_sl_posts_board_tweet" });
    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["boardId", "postCreatedAt"], { name: "idx_echohunt_sl_posts_board_created" });
    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["boardId", "sentiment", "postCreatedAt"], { name: "idx_echohunt_sl_posts_board_sentiment_created" });
    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["boardId", "authorTwitterId"], { name: "idx_echohunt_sl_posts_board_author" });
    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["boardId", "authorGlobalRank"], { name: "idx_echohunt_sl_posts_board_global_rank" });

    await queryInterface.addIndex("EchohuntSocialListeningSnapshots", ["boardId", "rangeKey", "processedThrough"], { unique: true, name: "ux_echohunt_sl_snapshots_board_range_processed" });
    await queryInterface.addIndex("EchohuntSocialListeningSnapshots", ["boardId", "rangeKey", "generatedAt"], { name: "idx_echohunt_sl_snapshots_board_range_generated" });

    await queryInterface.addIndex("EchohuntSocialListeningAccountSignals", ["boardId", "signalType", "twitterId", "occurredAt"], { unique: true, name: "ux_echohunt_sl_signals_board_type_twitter_occurred" });
    await queryInterface.addIndex("EchohuntSocialListeningAccountSignals", ["boardId", "signalType", "occurredAt"], { name: "idx_echohunt_sl_signals_board_type_occurred" });
    await queryInterface.addIndex("EchohuntSocialListeningAccountSignals", ["boardId", "twitterId", "occurredAt"], { name: "idx_echohunt_sl_signals_board_twitter_occurred" });

    await queryInterface.addIndex("EchohuntSocialListeningAlerts", ["boardId", "dedupeKey"], { unique: true, name: "ux_echohunt_sl_alerts_board_dedupe" });
    await queryInterface.addIndex("EchohuntSocialListeningAlerts", ["boardId", "alertType", "triggeredAt"], { name: "idx_echohunt_sl_alerts_board_type_triggered" });

    await queryInterface.addIndex("EchohuntSocialListeningKeyEvents", ["boardId", "authCenterUserId", "tweetId"], { unique: true, name: "ux_echohunt_sl_events_board_user_tweet" });
    await queryInterface.addIndex("EchohuntSocialListeningKeyEvents", ["boardId", "authCenterUserId", "eventAt"], { name: "idx_echohunt_sl_events_board_user_event_at" });

    await queryInterface.addIndex("EchohuntSocialListeningJobs", ["boardId", "status", "createdAt"], { name: "idx_echohunt_sl_jobs_board_status_created" });
    await queryInterface.addIndex("EchohuntSocialListeningJobs", ["jobType", "status"], { name: "idx_echohunt_sl_jobs_type_status" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EchohuntSocialListeningJobs");
    await queryInterface.dropTable("EchohuntSocialListeningKeyEvents");
    await queryInterface.dropTable("EchohuntSocialListeningAlerts");
    await queryInterface.dropTable("EchohuntSocialListeningAccountSignals");
    await queryInterface.dropTable("EchohuntSocialListeningSnapshots");
    await queryInterface.dropTable("EchohuntSocialListeningPosts");
    await queryInterface.dropTable("EchohuntSocialListeningAccessAuditLogs");
    await queryInterface.dropTable("EchohuntSocialListeningBoardAccesses");
    await queryInterface.dropTable("EchohuntSocialListeningBoards");
  },
};
