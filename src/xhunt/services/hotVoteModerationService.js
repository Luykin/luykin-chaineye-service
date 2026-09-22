/**
 * XHunt 热点投票 - 留言评论 AI 内容安全审核服务
 *
 * 审核规则：
 * 1. 本地敏感词快速拦截 (钓鱼短链、诈骗话术、涉黄涉政关键词库)
 * 2. AI 大模型深度语义审计 (默认模型，检测：反对政治、暴力言论、黄色色情、辱骂攻击、极端仇恨言论)
 */

const { structuredChat } = require("../../lib/llm");
const { containsSensitiveWord } = require("./sensitiveWordFilter");

const MODERATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    passed: {
      type: "boolean",
      description: "内容是否通过安全合规审核。若内容包含任何违规内容则必须为 false，正常讨论发言为 true",
    },
    category: {
      type: "string",
      enum: ["none", "politics", "violence", "pornography", "abuse", "extremism"],
      description: "违规类别枚举: none(合规), politics(反对政治/涉政敏感), violence(暴力恐怖/伤害他人), pornography(黄色色情/低俗), abuse(辱骂谩骂/人身攻击), extremism(极端言论/仇恨言论)",
    },
    reason: {
      type: "string",
      description: "若未通过审核，用简洁的中文给出违规原因（限20字内，例如：'包含人身攻击与辱骂言论'、'包含涉政违规内容'、'包含暴力极端言论'等）；通过则为空字符串",
    },
  },
  required: ["passed", "category", "reason"],
});

const MODERATION_SYSTEM_PROMPT = `你是一个高标准的中文与英文互联网社交评论内容安全审核专家。
你的任务是对用户在热点议题投票下的留言评论进行严格的合规性审核。

【审核红线（命中任意一条即为违规，passed 必须为 false）】：
1. 反对政治 / 涉政敏感 / 反动言论 (politics)：攻击或诋毁国家政权、政治制度、国家领导人，散布涉政谣言或反动分裂言论；
2. 暴力言论 / 暴恐危害 (violence)：宣扬暴力、支持恐怖主义、威胁或教唆伤害他人人身安全、自残自杀等；
3. 黄色色情 / 低俗淫秽 (pornography)：包含露骨色情描写、性暗示、招嫖、低俗淫秽用语；
4. 辱骂谩骂 / 人身攻击 (abuse)：直接使用脏话辱骂他人、问候直系亲属、人身攻击、恶意贬损、污言秽语；
5. 极端言论 / 仇恨言论 (extremism)：种族歧视、地域黑、宗教极端仇恨、极端性别对立、宣扬纳粹或极端反人类思想。

【合规标准（passed 为 true）】：
- 对议题正反方观点的激烈辩论、批评分析、调侃吐槽，只要不涉及上述 5 类红线，均属于合规言论，应当予以通过。
- 仅陈述客观事实、表达技术见解、加密货币/AI 市场观点的，应予以通过。

【输出要求】：
必须严格按照提供的 JSON Schema 输出结构化结果，严禁输出任何多余的解释文字或 markdown 标记。`;

/**
 * 使用 AI 大模型对热点投票留言进行合规性审核
 * @param {string} text 待审核评论文本
 * @returns {Promise<{ passed: boolean, category: string, reason: string }>}
 */
async function auditCommentContentWithAI(text) {
  if (!text || typeof text !== "string") {
    return { passed: true, category: "none", reason: "" };
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return { passed: true, category: "none", reason: "" };
  }

  // 1. 本地敏感词快速拦截（零延迟过滤违规词库与钓鱼链接）
  if (containsSensitiveWord(cleanText)) {
    return {
      passed: false,
      category: "sensitive_words",
      reason: "留言内容包含违规敏感词汇或钓鱼链接",
    };
  }

  // 2. 调用 AI 大模型进行深度语义审核（默认模型）
  try {
    const userPrompt = `请严格审核以下热点议题投票下的用户留言内容：\n\n${cleanText}`;
    const result = await structuredChat(userPrompt, MODERATION_SCHEMA, {
      systemPrompt: MODERATION_SYSTEM_PROMPT,
      temperature: 0,
      timeout: 20000,
    });

    if (result && typeof result === "object") {
      if (result.passed === false) {
        return {
          passed: false,
          category: result.category || "violation",
          reason: result.reason || "留言内容未通过安全合规审核（涉政/暴力/色情/辱骂或极端言论）",
        };
      }
      return { passed: true, category: "none", reason: "" };
    }
  } catch (err) {
    console.warn("[HotVoteModeration] AI 审核服务调用异常:", err.message);
    // 降级容灾：若 AI 服务未配置 API Key 或网络瞬时抖动，不直接崩溃业务，由本地敏感词库兜底
  }

  return { passed: true, category: "none", reason: "" };
}

module.exports = {
  auditCommentContentWithAI,
  MODERATION_SCHEMA,
  MODERATION_SYSTEM_PROMPT,
};
