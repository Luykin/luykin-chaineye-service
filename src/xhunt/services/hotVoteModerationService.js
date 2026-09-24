/**
 * XHunt 热点投票 - 留言评论 AI 内容安全审核服务
 *
* 审核规则：
* 1. 本地敏感词快速拦截 (钓鱼短链、诈骗话术、涉黄涉政关键词库)
 * 2. AI 大模型语义审计 (宽松包容模式，重点拦截：涉政敏感、黄色色情、违规引流/导流广告；放宽案情推测与观点辩论)
 */

const { structuredChat } = require("../../lib/llm");
const { containsSensitiveWord } = require("./sensitiveWordFilter");

const MODERATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    passed: {
      type: "boolean",
      description: "内容是否通过安全合规审核。若包含涉政敏感、黄色色情、违规引流导流等红线违规内容则为 false；正常讨论发言、立场站队、案情推测必须为 true",
    },
    category: {
      type: "string",
      enum: ["none", "politics", "pornography", "spam", "violence", "abuse", "extremism"],
      description: "违规类别枚举: none(合规通过), politics(涉政敏感/政治反动), pornography(黄色色情/低俗淫秽), spam(违规引流/导流广告/带单欺诈), violence(极端现实暴恐威胁), abuse(恶性人身攻击), extremism(极端仇恨言论)",
    },
    reason: {
      type: "string",
      description: "若未通过审核，用简洁的中文给出违规原因（限20字内，例如：'包含违规引流与导流广告'、'包含黄色色情低俗内容'、'包含涉政违规内容'等）；通过则为空字符串",
    },
  },
  required: ["passed", "category", "reason"],
});

const MODERATION_SYSTEM_PROMPT = `你是热点议题投票评论的内容安全审核助手。
审核原则：宽松包容，鼓励观点交锋与自由表达。除极少数现实直接暴恐威胁（violence）外，仅严格拦截以下三大红线：

【拦截红线（命中则 passed=false）】：
1. politics（涉政违规）：攻击国家政权制度/领导人、反动分裂言论、涉政谣言。
2. pornography（色情低俗）：露骨色情、性暗示、招嫖卖淫、淫秽色情低俗用语。
3. spam（违规引流）：诱导私聊、加微信/QQ/TG、进群、带单理财兼职欺诈、广告外链。

【放行规则（必须判定 passed=true）】：
- 案情推测与死因观点（如“他杀”、“自杀”、“谋杀”、“意外”等）属于正当讨论，绝不判定为违规。
- 观点争辩、调侃吐槽、情绪宣泄、立场单字/短语（如“他杀”、“自杀”、“支持”、“反对”等）一律放行。
- 宽松原则：宁可放过边缘争议，绝不误伤正常投票评论。

严格按 JSON Schema 输出结构化结果，严禁多余文字。`;

/**
 * 使用 AI 大模型对热点投票留言进行合规性审核
 * @param {string} text 待审核评论文本
 * @param {object} [context] 议题上下文信息
 * @param {string} [context.topicTitle] 议题标题
 * @param {string} [context.optionName] 用户所选选项名称
 * @returns {Promise<{ passed: boolean, category: string, reason: string }>}
 */
async function auditCommentContentWithAI(text, context = {}) {
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
      reason: "留言内容包含违规引流、敏感词汇或钓鱼链接",
    };
  }

  // 2. 调用 AI 大模型进行深度语义审核（默认模型）
  try {
    let userPrompt = "请审核以下热点投票下的用户留言：\n\n";
    if (context && typeof context === "object") {
      const topicTitle = typeof context.topicTitle === "string" ? context.topicTitle.trim() : "";
      const optionName = typeof context.optionName === "string" ? context.optionName.trim() : "";
      if (topicTitle) {
        userPrompt += `【投票议题】：${topicTitle}\n`;
      }
      if (optionName) {
        userPrompt += `【所选选项】：${optionName}\n`;
      }
    }
    userPrompt += `【用户留言评论】：${cleanText}\n\n`;
    userPrompt += "请结合议题背景宽松审核：若属于观点表达、案情推测（如“他杀”、“自杀”）或正常讨论，且不涉及涉政、色情、引流，必须判定为 passed: true。";

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
          reason: result.reason || "留言内容未通过安全合规审核（涉政/色情/违规引流）",
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
