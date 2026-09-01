const PROMPT_FIELDS = Object.freeze({
  PROJECT_ATTITUDE: "projectAttitude",
  TWEET_TAG: "tweetTag",
  TWEET_SUMMARY: "tweetSummary",
});

const PROMPT_ALIASES = Object.freeze({
  [PROMPT_FIELDS.PROJECT_ATTITUDE]: ["projectAttitude", "projectAttitudePrompt"],
  [PROMPT_FIELDS.TWEET_TAG]: ["tweetTag", "tweetTagV2", "tweetTagPrompt"],
  [PROMPT_FIELDS.TWEET_SUMMARY]: ["tweetSummary", "tweetSummaryMedia", "tweetSummaryPrompt"],
});

const DEFAULT_LOCAL_AI_PROMPTS = Object.freeze({
  [PROMPT_FIELDS.TWEET_TAG]: `你是 Crypto/Web3 社媒内容分类器。请分析下面推文，按 tweet_tag_v2 兼容格式输出 JSON。

要求：
1. crypto_relevant：是否和 Crypto/Web3/AI/金融科技/链上生态明显相关。
2. domain_tag：一个主领域标签，优先使用 crypto、ai、macro、security、policy、business、social、other。
3. domain_tag_version：固定返回 tweet_tag_v2_local_llm_v1。
4. crypto_sub_tags：最多 8 个 Web3 子标签，例如 DeFi、Layer1、Layer2、Meme、NFT、GameFi、DePIN、CeFi、Wallet、Stablecoin、RWA、Mining、Airdrop。
5. ai_sub_tags：最多 8 个 AI 子标签，例如 LLM、Agent、Infra、Model、Data、App、Robotics。
6. hot_tags：最多 12 个可用于检索/统计的热点关键词，保留项目名、代币名、叙事词。
7. tags：补充通用标签，数量尽量少。
8. 不确定时不要臆造，返回空数组。

推文：
{text}`,

  [PROMPT_FIELDS.PROJECT_ATTITUDE]: `你是项目舆情分析助手。请判断下面推文对项目「{project}」的态度，按 project_attitude 兼容格式输出 JSON。

评分规则：
- score 范围 0-10。
- 0-3.9：负面/风险/批评/质疑/攻击/事故。
- 4-6：中性、无关、客观新闻、无法判断。
- 6.1-10：正面、支持、认可、利好、合作、增长。
- 如果推文只是提到项目但没有明显态度，给 5 左右。
- 如果推文和项目无关，给 5，并在 summary 说明无关或证据不足。
- summary 使用 {lang} 语言，简明说明判断依据。

推文：
{text}`,

  [PROMPT_FIELDS.TWEET_SUMMARY]: `你是社媒内容摘要助手。请基于下面推文生成一句 {lang} 摘要，尽量不超过 {words} 个词/中文短语，按 tweet_summary_media 兼容格式输出 JSON。

要求：
- 只保留核心事件、项目名、观点或动作。
- 不添加推文没有的信息。
- 如果媒体链接有助于理解，可以参考；无法访问媒体时忽略。

推文：
{text}

媒体：
{media}`,
});

module.exports = {
  PROMPT_FIELDS,
  PROMPT_ALIASES,
  DEFAULT_LOCAL_AI_PROMPTS,
};
