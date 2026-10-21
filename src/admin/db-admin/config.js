/**
 * 管理后台轻量 DB CRUD 配置。
 *
 * 当前按数据库 public schema 动态枚举所有基础表；这里仅保留全局安全规则和少量表级覆盖。
 * 注意：不提供任意 SQL，所有字段名/表名仍来自数据库元数据或这里的显式覆盖。
 */
const SENSITIVE_COLUMN_PATTERN = /(password|passwordHash|token|secret|privateKey|credential|publicKey|signature|nonce|accessToken|refreshToken|authorizationCode|session)/i;

const DEFAULT_READONLY_COLUMNS = ["id", "createdAt", "updatedAt", "deletedAt"];

// DB Admin 会动态列出 public schema 中的全部表；这里提供给管理员阅读的业务名称和说明。
// 新表即使暂未登记，也会由 service 层给出“未归类系统表”兜底说明。
const tableMetadata = {
  AuthCenterXhuntAuditLogs: { label: "认证中心审计日志", description: "记录统一登录、身份绑定和会话等安全操作。" },
  AuthCenterXhuntAuthorizationCodes: { label: "认证授权码", description: "OAuth/认证中心向客户端签发的一次性授权码记录。" },
  AuthCenterXhuntClients: { label: "认证接入客户端", description: "接入认证中心的业务应用与客户端配置。" },
  AuthCenterXhuntIdentities: { label: "认证登录身份", description: "认证中心用户绑定的密码、Google、X 或 EVM 等登录身份。" },
  AuthCenterXhuntPasswordCredentials: { label: "密码登录凭证", description: "认证中心账号密码的安全凭证记录。" },
  AuthCenterXhuntSessions: { label: "认证登录会话", description: "认证中心的 access token、refresh token 与登录会话记录。" },
  AuthCenterXhuntUsers: { label: "认证中心用户", description: "统一登录体系中的用户主体，可关联多种身份。" },

  BinanceSquareConfigs: { label: "Binance Square 爬取配置", description: "Binance Square 数据采集服务的运行配置。" },
  BinanceSquareCrawlLogs: { label: "Binance Square 爬取日志", description: "Binance Square 爬虫执行结果与异常记录。" },
  BinanceSquareFollowings: { label: "Binance Square 关注关系", description: "Binance Square 用户之间的关注关系快照。" },
  BinanceSquarePostSnapshots: { label: "Binance Square 帖子快照", description: "Binance Square 帖子在不同采集时点的指标快照。" },
  BinanceSquarePosts: { label: "Binance Square 帖子", description: "采集到的 Binance Square 内容与互动指标。" },
  BinanceSquareSeedConfigs: { label: "Binance Square 种子账号", description: "Binance Square 爬虫的初始种子账号配置。" },
  BinanceSquareTargetRanks: { label: "Binance Square 目标排名", description: "Binance Square 目标账号的排名与指标记录。" },
  BinanceSquareUsers: { label: "Binance Square 用户", description: "采集到的 Binance Square 用户资料。" },

  BusinessCollaborationActivities: { label: "定向合作活动", description: "项目方创建的定向 KOL 合作活动、名额、预算与邀约模板。" },
  BusinessCollaborationActivityAccesses: { label: "定向合作活动权限", description: "项目方或 Agency 成员访问、管理定向合作活动的授权。" },
  BusinessCollaborationAuditLogs: { label: "定向合作审计日志", description: "定向合作活动、邀约、预算变更的操作审计记录。" },
  BusinessCollaborationBudgetLedgers: { label: "定向合作预算流水", description: "定向合作活动的预算预留、锁定、释放与支付流水。" },
  BusinessCollaborationDeliveries: { label: "定向合作交付记录", description: "KOL 合作内容的正式发布链接和交付信息。" },
  BusinessCollaborationInvitations: { label: "定向合作邀约", description: "项目方发送给 KOL 的合作邀约、报价与接受状态。" },
  BusinessCollaborationReviewRounds: { label: "定向合作审核轮次", description: "KOL 草稿的 AI 初审与人工审核轮次记录。" },
  BusinessCollaborations: { label: "定向合作订单", description: "已确认的 KOL 合作关系与付款状态。" },

  CampaignRegistrations: { label: "活动报名记录", description: "用户参与运营活动的报名和资格信息。" },
  CollectorClientTokens: { label: "采集客户端令牌", description: "内部数据采集客户端的访问令牌与关联配置。" },
  DailyActiveUsers: { label: "日活统计", description: "按日期汇总的用户活跃统计数据。" },
  EchohuntFeatureAccesses: { label: "EchoHunt 功能权限", description: "用户对 EchoHunt 功能的开通、试用或访问授权。" },
  GenericStatEvents: { label: "通用统计事件", description: "产品行为和运营指标的通用事件记录。" },
  MantleRegistrations: { label: "Mantle 活动报名", description: "Mantle 相关运营活动的首版报名数据。" },
  MantleRegistrations2: { label: "Mantle 活动报名（二期）", description: "Mantle 相关运营活动的第二版报名数据。" },

  RootdataCrawlLogs: { label: "RootData 爬取日志", description: "RootData 融资数据采集任务的执行日志。" },
  RootdataEcosystems: { label: "RootData 生态分类", description: "RootData 项目所属生态系统分类。" },
  RootdataInvestments: { label: "RootData 融资事件", description: "项目融资轮次、金额和投资方等融资数据。" },
  RootdataInvestorCategories: { label: "RootData 投资方分类", description: "投资机构或投资人的分类字典。" },
  RootdataOrganizationInvestorCategories: { label: "RootData 机构投资方分类关联", description: "机构与投资方分类之间的关联关系。" },
  RootdataOrganizationTags: { label: "RootData 机构标签关联", description: "机构与标签之间的关联关系。" },
  RootdataOrganizationTeamMembers: { label: "RootData 机构团队成员", description: "机构与团队成员之间的关联关系。" },
  RootdataOrganizations: { label: "RootData 机构", description: "RootData 收录的投资机构和组织资料。" },
  RootdataPeople: { label: "RootData 人物", description: "RootData 收录的人物资料。" },
  RootdataProjectEcosystems: { label: "RootData 项目生态关联", description: "项目与生态系统之间的关联关系。" },
  RootdataProjectTags: { label: "RootData 项目标签关联", description: "项目与标签之间的关联关系。" },
  RootdataProjectTeamMembers: { label: "RootData 项目团队成员", description: "项目与团队成员之间的关联关系。" },
  RootdataProjects: { label: "RootData 项目", description: "RootData 收录的区块链项目基础资料。" },
  RootdataTags: { label: "RootData 标签", description: "RootData 项目和机构使用的标签字典。" },

  SecurityViolationLogs: { label: "安全违规日志", description: "风控与安全中间件识别到的异常请求和违规事件。" },
  UnregisteredUserRegistrations: { label: "未注册用户登记", description: "尚未完成注册的活动参与者登记信息。" },
  UrlRequestStats: { label: "URL 请求统计", description: "按 URL 汇总的接口访问与性能统计。" },
  VersionRequestStats: { label: "版本请求统计", description: "按客户端版本汇总的请求量统计。" },

  XAccounts: { label: "X 平台账号", description: "X（Twitter）账号基础资料、指标和头像等缓存数据。" },
  XHuntBinanceSquareBindingChallenges: { label: "Binance Square 绑定挑战", description: "绑定 Binance Square 账号时生成的一次性验证挑战。" },
  XHuntBinanceSquareBindingEvents: { label: "Binance Square 绑定事件", description: "Binance Square 账号绑定、解绑和验证过程的事件记录。" },
  XHuntBinanceSquareBindings: { label: "Binance Square 账号绑定", description: "EchoHunt 用户与 Binance Square 账号之间的绑定关系。" },
  XHuntHotVoteComments: { label: "热门投票评论", description: "热门投票话题下的用户评论内容。" },
  XHuntHotVoteRecords: { label: "热门投票记录", description: "用户对热门投票话题提交的投票记录。" },
  XHuntHotVoteTopics: { label: "热门投票话题", description: "运营创建或同步的热门投票主题。" },
  XHuntKolCollaborations: { label: "KOL 商务资料", description: "KOL 的合作意愿、报价、收款地址与商务资料。" },
  XHuntUserProSubscriptions: { label: "XHunt Pro 订阅", description: "用户付费 Pro 权益与订阅有效期记录。" },
  XHuntUserSettings: { label: "XHunt 用户设置", description: "XHunt 用户的偏好与个性化设置。" },
  XHuntUserTokens: { label: "XHunt 用户令牌", description: "旧版 XHunt 登录令牌、OAuth 信息与设备绑定记录。" },
  XHuntUsers: { label: "XHunt 用户", description: "旧版 XHunt 用户主体，主要关联 X（Twitter）身份。" },
  XHuntWebUserTokens: { label: "网站用户令牌", description: "XHunt 网站端用户的登录令牌记录。" },
  XHuntWebUsers: { label: "网站用户", description: "XHunt 网站端的独立用户主体。" },
  XHuntWebsiteCampaigns: { label: "网站活动", description: "XHunt 网站展示和参与的运营活动配置。" },
  XPointRecords: { label: "积分流水", description: "用户积分获得、消耗和调整的流水记录。" },
  XPrivateMessages: { label: "私信消息", description: "用户之间的私信内容和会话相关记录。" },
  XPrivateNotes: { label: "账号私密备注", description: "用户为 X 账号保存的私密备注。" },
  XReviewForAccounts: { label: "X 账号点评", description: "用户对 X（Twitter）账号提交的点评和评分。" },

  XhuntExternalLeaderboardAdapters: { label: "外部排行榜适配器", description: "接入第三方排行榜数据源的适配与同步配置。" },
  xhunt_admin_audit_logs: { label: "后台操作审计日志", description: "管理员在后台执行操作的安全审计记录。" },
  xhunt_admin_managers: { label: "后台管理员", description: "管理后台管理员账号、角色和权限配置。" },
  xhunt_admin_webauthn_credentials: { label: "后台通行密钥", description: "管理员 WebAuthn 指纹、Face ID 或通行密钥凭证。" },
  xhunt_nacos_config_snapshots: { label: "Nacos 配置快照", description: "Nacos 配置发布前后的内容快照与版本记录。" },
  xhunt_special_user_markers: { label: "特殊用户标记", description: "为指定用户配置的运营、测试或功能标记。" },
  xhunt_user_tags: { label: "用户标签", description: "XHunt 用户的运营标签与分组信息。" },
  xhunt_vip_test_users: { label: "VIP / 内测用户", description: "VIP 和内部测试用户的白名单配置。" },

  EchohuntSocialListeningAccessAuditLogs: { label: "社媒监听访问审计", description: "Social Listening 的访问授权与操作审计记录。" },
  EchohuntSocialListeningAccountSignals: { label: "社媒监听账号信号", description: "社媒监听识别出的账号级动态和信号。" },
  EchohuntSocialListeningAlerts: { label: "社媒监听预警", description: "社媒监听触发的异常、风险或重要变化预警。" },
  EchohuntSocialListeningBoardAccesses: { label: "社媒监听看板权限", description: "用户访问 Social Listening 看板的授权关系。" },
  EchohuntSocialListeningBoards: { label: "社媒监听看板", description: "Social Listening 项目、关键词和监控范围配置。" },
  EchohuntSocialListeningJobs: { label: "社媒监听任务", description: "Social Listening 数据处理和分析任务记录。" },
  EchohuntSocialListeningKeyEvents: { label: "社媒监听关键事件", description: "从社媒内容中提炼出的重要事件。" },
  EchohuntSocialListeningPosts: { label: "社媒监听帖子", description: "采集并分析的社媒帖子及其 AI 结果。" },
  EchohuntSocialListeningSnapshots: { label: "社媒监听快照", description: "Social Listening 看板在指定时间范围内的汇总快照。" },
  EchohuntSocialListeningTextCondensations: { label: "社媒监听文本精简", description: "社媒长文本的 AI 精简结果与模型信息。" },

  e2e: { label: "E2E 报名与排行结算", description: "用户报名参与 E2E 互动任务的记录、得分（point）、排名与奖励结算数据。" },
  e2e_list: { label: "E2E 互动任务列表", description: "E2E 互动任务主配置表，包含目标推文、奖池金额、收款钱包地址、时间与门槛设置。" },
  e2e_log: { label: "E2E 算分日志", description: "E2E 互动任务每次算分的得分明细与 AI 评分说明日志。" },
  e2e_tweet: { label: "E2E 推文审核与摘要", description: "投放推文/长文的合规审核结果、正文与中英文 AI 摘要缓存。" },
};

// 如需对某张表单独禁用新增/删除、隐藏字段、枚举字段，在这里按真实表名覆盖。
const tableOverrides = {
  AuthCenterXhuntClients: {
    hiddenColumns: ["clientSecretHash"],
    enumOptions: {
      clientType: ["public", "confidential"],
    },
  },
  xhunt_vip_test_users: {
    enumOptions: {
      listType: ["vip", "internal_test"],
    },
  },
};

module.exports = {
  DEFAULT_READONLY_COLUMNS,
  SENSITIVE_COLUMN_PATTERN,
  tableMetadata,
  tableOverrides,
};
