const QUOTA_TIMEZONE = "Asia/Shanghai";
const AI_QUOTA_BUCKET = "aiMatch";
const FILTER_QUOTA_BUCKET = "filterSearch";
const STRATEGY_CACHE_PREFIX = "echohunt:kol-match:strategy";
const IDEMPOTENCY_CACHE_PREFIX = "echohunt:kol-match:idempotency";
const STRATEGY_TTL_SECONDS = 30 * 60;
const INTERNAL_TWITTER_USER_LOOKUP_URL = "https://data.cryptohunt.ai/fetch/twitter/user";
const INTERNAL_TWITTER_USER_LOOKUP_TIMEOUT_MS = 7000;
const DEFAULT_AI_DAILY_LIMIT = 3;
const DEFAULT_FILTER_DAILY_LIMIT = 10;
const DEFAULT_AI_RESULT_LIMIT = 50;
const DEFAULT_AI_RECALL_TOP_K = 100;
const DEFAULT_FILTER_RESULT_LIMIT = 200;
const DEFAULT_FILTER_CANDIDATE_SCAN_LIMIT = 2000;
const GENERIC_PUBLIC_PROGRESS_ZH = "当前阶段已完成，系统正在继续生成 KOL 推荐名单。";
const GENERIC_PUBLIC_PROGRESS_EN = "This stage is complete; EchoHunt is continuing to build the KOL shortlist.";
const AI_SCORE_WEIGHTS = {
  semantic: 0.7,
  traffic: 0.15,
  influence: 0.1,
  soul: 0.05,
};

const AI_STRATEGY_SEMANTIC_ONLY_FILTER_KEYS = [
  "keywords",
  "cooperationTypes",
  "marketingGoals",
  "projectStages",
  "identityTier",
];

const BRIEF_VOCABULARY = [
  "BNB Chain", "Ethereum", "Solana", "Base", "Bitcoin", "RWA", "DeFi", "AI Agent", "AI", "DEX",
  "Perps", "永续合约", "合约", "链上交易", "交易", "积分", "空投", "钱包", "安全", "开发者",
  "公链", "Layer2", "NFT", "Meme", "GameFi", "社区", "研究", "教程", "工具", "KOL", "influencer",
];

const CAPABILITY_ALIASES = {
  ai: ["AI", "人工智能"],
  rwa: ["RWA"],
  security: ["Security", "安全"],
  defi: ["DeFi"],
  trading: ["Trading", "交易"],
  meme: ["MEME", "Meme"],
  airdrop: ["Airdrop", "空投"],
  layer1: ["Layer1", "Layer 1"],
  ethereum: ["Ethereum", "以太坊"],
  perps: ["Perps", "永续合约", "合约"],
  arbitrage: ["Arbitrage", "套利"],
  bitcoin: ["Bitcoin", "比特币"],
  macro: ["Macro", "宏观"],
  "prediction-market": ["Prediction Market", "预测市场"],
};

const TOPIC_EN_SIGNALS = [
  [/以太坊|ethereum/i, "Ethereum"],
  [/比特币|bitcoin/i, "Bitcoin"],
  [/人工智能|\bai\b|大语言模型|\bllm\b|智能体|模型|算力|机器人/i, "AI"],
  [/\brwa\b|代币化资产|资产代币化/i, "RWA"],
  [/\bdefi\b|去中心化金融/i, "DeFi"],
  [/交易|市场|流动性|套利|衍生品/i, "Trading"],
  [/监管|合规|法律|政策/i, "Regulation"],
  [/公链|layer\s?1|区块链基础设施|协议|链上基础设施/i, "Blockchain infrastructure"],
  [/安全|隐私|密码学|零知识|\bzk\b|审计/i, "Security & privacy"],
  [/\bnft\b|数字艺术|生成艺术|艺术|收藏/i, "NFT & digital culture"],
  [/社区|社群|\bmeme\b|迷因/i, "Community & culture"],
  [/宏观|地缘政治|金融/i, "Macro & finance"],
  [/开发者|开源|工程|软件|编程/i, "Developer ecosystem"],
  [/支付|稳定币|结算/i, "Payments"],
  [/创业|创投|风险投资|投资/i, "Venture & startups"],
  [/\bweb3\b|加密|链上|区块链/i, "Web3"],
];

const GOAL_EN_SIGNALS = [
  [/品牌|曝光|声量|知名度|认知|传播|叙事/i, "Brand awareness"],
  [/产品|功能|教育|价值传递/i, "Product education"],
  [/用户增长|转化|拉新|活跃度|用户/i, "User growth"],
  [/社区|社群|共识|话题/i, "Community growth"],
  [/开发者|技术|协议|标准|开源|安全/i, "Technical credibility"],
  [/生态|集成|采用|落地|合作伙伴/i, "Ecosystem adoption"],
  [/机构|高净值|投资者|资本市场/i, "Institutional reach"],
  [/行业|权威|思想领导|影响力|背书/i, "Thought leadership"],
  [/合规|监管|政策/i, "Regulatory positioning"],
  [/流动性|交易用户|交易者/i, "Liquidity & trader acquisition"],
  [/艺术|文化|\bnft\b|创意/i, "Cultural positioning"],
];

const SENSITIVE_OUTPUT_PATTERNS = [
  /system\s*prompt/i,
  /developer\s*message/i,
  /api[_\s-]?key/i,
  /secret/i,
  /token/i,
  /jwt/i,
  /database_url/i,
  /password/i,
  /连接串|数据库密码|系统提示|开发者指令|密钥|环境变量/i,
  /select\s+.+\s+from\s+/i,
  /insert\s+into|drop\s+table|alter\s+table/i,
];

const DANGEROUS_INPUT_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above)\s+instructions[^。！？!?；;，,\n]*/gi,
  /忽略(以上|前面|之前|所有)[^。！？!?；;，,\n]*(指令|提示)[^。！？!?；;，,\n]*/gi,
  /(system\s*prompt|developer\s*message|系统提示|开发者指令|内部提示)[^。！？!?；;，,\n]*/gi,
  /(api[_\s-]?key|密钥|token|jwt|数据库密码|连接串|database_url|环境变量)[^。！？!?；;，,\n]*/gi,
  /(执行命令|shell|drop\s+table|数据库结构)[^。！？!?；;，,\n]*/gi,
  /(预测.*(币价|价格|涨跌)|投资建议|price\s+prediction|trading\s+signal)[^。！？!?；;，,\n]*/gi,
];

module.exports = {
  AI_QUOTA_BUCKET,
  AI_SCORE_WEIGHTS,
  AI_STRATEGY_SEMANTIC_ONLY_FILTER_KEYS,
  BRIEF_VOCABULARY,
  CAPABILITY_ALIASES,
  DANGEROUS_INPUT_PATTERNS,
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_AI_RECALL_TOP_K,
  DEFAULT_AI_RESULT_LIMIT,
  DEFAULT_FILTER_CANDIDATE_SCAN_LIMIT,
  DEFAULT_FILTER_DAILY_LIMIT,
  DEFAULT_FILTER_RESULT_LIMIT,
  FILTER_QUOTA_BUCKET,
  GENERIC_PUBLIC_PROGRESS_EN,
  GENERIC_PUBLIC_PROGRESS_ZH,
  GOAL_EN_SIGNALS,
  IDEMPOTENCY_CACHE_PREFIX,
  INTERNAL_TWITTER_USER_LOOKUP_TIMEOUT_MS,
  INTERNAL_TWITTER_USER_LOOKUP_URL,
  QUOTA_TIMEZONE,
  SENSITIVE_OUTPUT_PATTERNS,
  STRATEGY_CACHE_PREFIX,
  STRATEGY_TTL_SECONDS,
  TOPIC_EN_SIGNALS,
};
