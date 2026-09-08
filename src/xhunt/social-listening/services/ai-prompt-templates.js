const PROMPT_FIELDS = Object.freeze({
  TWEET_ANALYSIS: "tweetAnalysis",
});

const STRICT_DOMAIN_TAG_VERSION = "tweet_tag_v2_domain_filter_v5";
const STRICT_DOMAIN_TAGS = Object.freeze(["crypto", "ai", "科技", "金融", "内容创作", "其他", "抽奖"]);
const STRICT_CRYPTO_SUB_TAGS = Object.freeze([
  "DeFi",
  "Layer1",
  "Layer2",
  "Meme",
  "NFT",
  "GameFi",
  "DePIN",
  "CeFi",
  "Wallet",
  "Stablecoin",
  "RWA",
  "Mining",
  "Airdrop",
  "Exchange",
  "Infra",
  "Security",
  "DAO",
  "Bridge",
  "Derivatives",
  "Lending",
  "Staking",
  "Oracle",
  "Payment",
  "Launchpad",
]);
const STRICT_AI_SUB_TAGS = Object.freeze(["LLM", "Agent", "Infra", "Model", "Data", "App", "Robotics", "Inference", "Training", "Chip"]);

const PROMPT_ALIASES = Object.freeze({
  [PROMPT_FIELDS.TWEET_ANALYSIS]: ["tweetAnalysis", "tweetAnalysisPrompt"],
});

const DEFAULT_LOCAL_AI_PROMPTS = Object.freeze({
  [PROMPT_FIELDS.TWEET_ANALYSIS]: `一次分析下方推文，按 Schema 输出标签、摘要和项目态度 JSON；不要翻译/复述全文，不添加原文没有的事实。

- 标签只能使用 Schema 枚举；无关或无法判断时 domain_tag=其他，子标签和 hot_tags 为空。
- hot_tags 优先 2-6 个核心词（最多 12）：只取原文出现的核心实体、事件、动作、争议或叙事词；不要用 crypto、Web3、AI 等泛类目凑数。
- hot_tags 不要重复：大小写、空格或 @/#/$ 前缀不同但实际相同的词只保留一个（如 BSC 与 bsc）。
- 词云排除词：{keywordExclusions}；即使原文出现，也不得放入 hot_tags。
- summary_cn 不超过 {words} 个词/短语；summary_en 为短句。
- 当前项目：{project}；可识别名称/别名/官方 Handle：{projectAliases}。命中任一名称或 @Handle 才可视为讨论当前项目；不要把行业词、其他项目或歧义词归入当前项目。
- 先判断评价对象：提到项目名、账号或相关人物，不等于在评价当前项目。若评价的是文章、转发内容、其他项目、人物，或只是提到项目相关人物，relevant_to_project=false、sentiment=unknown。
- score、sentiment、attitude_summary 只判断对当前项目的态度，不判断大盘、宏观或其他项目。0-3.9=negative，4-6=neutral，6.1-10=positive；只有确认相关但无褒贬才为 neutral。
- 不可只按负面词打分：😂、😆 等笑脸、玩笑、夸张或反讽语气，如无对当前项目明确且严肃的风险、损失、指控或抵制，应为 neutral（确认相关）或 unknown（评价对象不明）。“差评😆”“违反投资条款😂”这类调侃不能仅凭关键词判 negative。

发布时间：{createdAt}
推文：{text}
媒体：{media}`,
});

module.exports = {
  PROMPT_FIELDS,
  PROMPT_ALIASES,
  STRICT_DOMAIN_TAG_VERSION,
  STRICT_DOMAIN_TAGS,
  STRICT_CRYPTO_SUB_TAGS,
  STRICT_AI_SUB_TAGS,
  DEFAULT_LOCAL_AI_PROMPTS,
};
