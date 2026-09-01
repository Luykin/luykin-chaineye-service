const PROMPT_FIELDS = Object.freeze({
  PROJECT_ATTITUDE: "projectAttitude",
  TWEET_TAG: "tweetTag",
  TWEET_SUMMARY: "tweetSummary",
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
  [PROMPT_FIELDS.PROJECT_ATTITUDE]: ["projectAttitude", "projectAttitudePrompt"],
  [PROMPT_FIELDS.TWEET_TAG]: ["tweetTag", "tweetTagV2", "tweetTagPrompt"],
  [PROMPT_FIELDS.TWEET_SUMMARY]: ["tweetSummary", "tweetSummaryMedia", "tweetSummaryPrompt"],
});

const DEFAULT_LOCAL_AI_PROMPTS = Object.freeze({
  [PROMPT_FIELDS.TWEET_TAG]: `你是 Crypto/Web3/AI 社媒内容严格分类器。请分析下面推文，按 tweet_tag_v2_strict 兼容格式输出 JSON。

硬性规则：
1. crypto_relevant：是否和 Crypto/Web3/AI/金融科技/链上生态明显相关。
2. domain_tag 必须且只能从以下集合选择：crypto、ai、科技、金融、内容创作、其他、抽奖。
3. domain_tag_version 固定返回 ${STRICT_DOMAIN_TAG_VERSION}。
4. crypto_sub_tags 最多 8 个，只能从以下集合选择：${STRICT_CRYPTO_SUB_TAGS.join("、")}。
5. ai_sub_tags 最多 8 个，只能从以下集合选择：${STRICT_AI_SUB_TAGS.join("、")}。
6. hot_tags 最多 12 个，只能抽取推文原文中明确出现的项目名、代币名、协议名、产品名、叙事词；不要编造原文没出现过的词。
7. tags 仅作兼容补充，必须少量、短词；如果不确定返回空数组。
8. 不确定、无关或无法判断时：domain_tag 返回 其他，子标签和 hot_tags 返回空数组。
9. 禁止输出上述集合外的 domain_tag / crypto_sub_tags / ai_sub_tags。

推文：
{text}`,
  [PROMPT_FIELDS.PROJECT_ATTITUDE]: `你是项目舆情分析助手。请判断下面推文对项目「{project}」的态度，按 project_attitude 兼容格式输出 JSON。

输出字段：
- score：范围 0-10；unknown 时为了兼容可给 5。
- sentiment：必须从 positive、neutral、negative、unknown 中选择。
- relevant_to_project：是否能确认推文在讨论项目「{project}」。
- confidence：0-1，判断置信度。
- summary：使用 {lang} 语言，简明说明判断依据。

评分与归类规则：
- 0-3.9：negative，负面/风险/批评/质疑/攻击/事故。
- 4-6：neutral，仅用于确实相关但态度中性、客观新闻、没有明显倾向的内容。
- 6.1-10：positive，正面/支持/认可/利好/合作/增长。
- 如果推文只是提到项目且能确认相关但没有明显态度，sentiment=neutral，score 给 5 左右。
- 如果推文和项目无关、证据不足、无法可靠判断是否在讨论项目或无法可靠判断态度，sentiment=unknown，relevant_to_project=false 或 confidence < 0.5；不要强行归入 neutral。

推文：
{text}`,

  [PROMPT_FIELDS.TWEET_SUMMARY]: `你是社媒内容摘要助手。请基于下面推文生成一句 {lang} 摘要，尽量不超过 {words} 个词/中文短语，按 tweet_summary_media 兼容格式输出 JSON。

要求：
- 只保留核心事件、项目名、观点或动作。
- 不添加推文没有的信息。
- 如果媒体链接有助于理解，可以参考；无法访问媒体时忽略。
- 当 {lang} 是 chinese 时，同时输出 post_zh：对推文原文做忠实中文全文翻译；不要摘要化、不要添加原文没有的信息。若原文已是中文，post_zh 返回原文清理后的中文内容。
- 当 {lang} 不是 chinese 时，post_zh 可以为空字符串。

推文：
{text}

媒体：
{media}`,
});

const LEGACY_FRONTEND_AI_PROMPTS = Object.freeze({
  [PROMPT_FIELDS.PROJECT_ATTITUDE]: "判断这条推文对 {project} 的态度。输入文本格式为 <<发布时间--推文正文>>。请输出 score、sentiment 和中文 summary/reason：score 为 0-10 分，低于 4 视为 negative，高于 6 视为 positive，其余为 neutral。",
  [PROMPT_FIELDS.TWEET_TAG]: "从推文正文中抽取加密/AI/产品/市场相关主题标签和热词。请返回 topics/domain_tags 和 keywords/hot_tags，标签要短、可聚合、适合主题榜和词云。推文正文：{text}",
  [PROMPT_FIELDS.TWEET_SUMMARY]: "请根据推文正文生成 {lang} 摘要，控制在 {words} 个词左右；如果有媒体链接可结合媒体语境，但不要编造未出现的信息。推文正文：{text}",
});

module.exports = {
  PROMPT_FIELDS,
  PROMPT_ALIASES,
  STRICT_DOMAIN_TAG_VERSION,
  STRICT_DOMAIN_TAGS,
  STRICT_CRYPTO_SUB_TAGS,
  STRICT_AI_SUB_TAGS,
  DEFAULT_LOCAL_AI_PROMPTS,
  LEGACY_FRONTEND_AI_PROMPTS,
};
