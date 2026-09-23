/**
 * XHunt 信息流净化规则 - AI 正则表达式推荐服务
 * 
 * 核心功能：
 * 1. 接收运营/管理员输入的违规推文样本、引流话术或垃圾评论句子。
 * 2. 结合规则组上下文（如色情/擦边引流、灰产博彩/暗语），由大模型分析违规特征。
 * 3. 产出 2~4 条不同粒度（高精度、均衡、广谱）的高质量 JavaScript 正则表达式。
 * 4. 内置 ReDoS 安全筛查、语法校验、去重和启发式兜底保护。
 */

const { structuredChat } = require("../../lib/llm");

const REGEX_SUGGESTION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    analysis: {
      type: "string",
      description: "简要分析该样本的核心违规特征、引流套路或暗语变体（60字以内）",
    },
    suggestions: {
      type: "array",
      description: "推荐的正则表达式列表（2-4条不同侧重点的模式）",
      items: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "JavaScript 正则表达式 pattern 字符串。严禁带首尾斜杠 /，严禁带修饰符（统一按 /i 运行），严禁产生嵌套量词如 (a+)+ 等 ReDoS 回溯漏洞",
          },
          title: {
            type: "string",
            description: "规则简短标题（例如：'微信联系方式提取'、'私信看置顶话术'）",
          },
          description: {
            type: "string",
            description: "详细说明该正则匹配的逻辑、变体覆盖范围与防误伤思路",
          },
          matchedSample: {
            type: "string",
            description: "在提供的样本语句中预期命中的文本片段示例",
          },
          strictness: {
            type: "string",
            enum: ["precise", "balanced", "broad"],
            description: "严格程度: precise(高精度防误伤), balanced(均衡推荐), broad(广谱拦截)",
          },
          recommended: {
            type: "boolean",
            description: "是否为系统重点推荐的规则",
          },
        },
        required: ["pattern", "title", "description", "strictness", "recommended"],
      },
    },
  },
  required: ["suggestions"],
});

const SYSTEM_PROMPT = `你是一名网络安全与社交网络（X / Twitter）信息流反垃圾、反引流领域的正则表达式高级专家。
你的任务是：根据管理员提供的社交媒体违规评论样本、引流话术或黑灰产垃圾信息，生成适合在 JavaScript 中运行的正则表达式规则。

【核心原则与安全性规范】：
1. 纯净模式输出：pattern 字符串切勿包含首尾斜线 / 和修饰符标志（系统统一会自动以 i 标志不区分大小写运行）。例如输出 "(?:加|微)[：:\\s]*[a-zA-Z0-9_-]{5,20}" 而不是 "/(?:加|微)... /i"。
2. 绝对禁止 ReDoS（灾难性回溯）：严禁出现可变贪婪嵌套量词，如 (.*)+、(a+)+、(\\w+)* 等。优先使用有限长度量词（如 {1,30}），优先使用非捕获组 (?:...)，避免过度使用贪婪通配 .*。
3. 中文社交网络对抗变体识别：
   - 联系方式变体：微、威、薇、🛰️、vx、wx、v、➕v、＋v、扣扣、企鹅、TG、纸飞机、t.me 等；
   - 动作诱导变体：私信、私聊、私我、置顶、看置顶、主页置顶、看简界、进群、门槛群、吃瓜合集、高清无码、看片、福利、自取、安排等；
   - 干扰字符：中间常被插入空格、下划线、句号、冒号、emoji 表情符号等。
4. 梯度建议（生成 2~4 条不同颗粒度候选）：
   - precise (高精度)：紧扣样本关键诱导词或特定联系方式结构，误伤率极低；
   - balanced (均衡推荐)：兼顾常见同音变体、标点/空格间隔，平衡误伤与漏报；
   - broad (广谱模式)：拦截同类引导句型结构（如“看置顶/主页 + 进群/自取”）。
5. 必须确保每个生成的 pattern 在 JavaScript RegExp 中语法合法。`;

/**
 * 启发式正则生成兜底（当 LLM 不可用或异常时保障服务可用）
 */
function generateHeuristicSuggestions(text, groupKey = "adult_traffic") {
  const suggestions = [];
  const normalizedText = String(text || "").trim();

  // 1. 微信号 / 联系方式提取
  if (/[微薇威vxwx]/i.test(normalizedText) || /加[vV微]/.test(normalizedText)) {
    suggestions.push({
      pattern: "(?:加|私|看|找)[微薇威vVvxWX\\s:：+＋]*[a-zA-Z0-9_-]{5,20}",
      title: "微信号/社交账号引流识别",
      description: "匹配包含'加微'、'加v'及同音字、空格分隔的社交账号引流模式",
      matchedSample: "加微: 示例",
      strictness: "balanced",
      recommended: true,
    });
  }

  // 2. 置顶 / 主页 / 私信 诱导
  if (/(主页|置顶|私信|私聊|私我|简界)/.test(normalizedText)) {
    suggestions.push({
      pattern: "(?:看|戳|点|移步)?(?:主页|置顶|私信|私聊|简界).{0,10}(?:看|领|自取|福利|完整|资源|进群)",
      title: "主页/置顶导流句型",
      description: "拦截引导用户查看主页、置顶推文或私信获取福利的典型引流句式",
      matchedSample: "看主页置顶自取",
      strictness: "precise",
      recommended: true,
    });
  }

  // 3. TG / 电报 / 群组引流
  if (/(tg|telegram|电报|纸飞机|门槛群|进群)/i.test(normalizedText)) {
    suggestions.push({
      pattern: "(?:t\\.me\\/|电报|TG|纸飞机|门槛群|进群)[\\s:：@]*[a-zA-Z0-9_+/-]{3,30}",
      title: "Telegram群组/门槛群引流",
      description: "拦截 Telegram 链接、纸飞机暗语以及门槛群邀请",
      matchedSample: "进门槛群",
      strictness: "balanced",
      recommended: false,
    });
  }

  // 4. 通用同城/空降/约/擦边
  if (/(同城|约|空降|品茶|修车|福利|看片|吃瓜)/.test(normalizedText) || groupKey === "adult_traffic") {
    suggestions.push({
      pattern: "(?:同城|全国)?(?:可约|空降|品茶|修车|看片|吃瓜资源).{0,8}(?:加|私|看|v|微)",
      title: "同城约拍/空降诱导模式",
      description: "匹配同城、空降、品茶等招嫖与擦边黑产专有暗号及引流动作",
      matchedSample: "同城可约加微",
      strictness: "broad",
      recommended: false,
    });
  }

  // 兜底至少保留一条针对样本关键词的组合正则
  if (suggestions.length === 0 && normalizedText.length >= 2) {
    const escaped = normalizedText.slice(0, 15).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    suggestions.push({
      pattern: escaped,
      title: "样本关键词直配模式",
      description: "针对样本前序特征词的精准匹配规则",
      matchedSample: normalizedText.slice(0, 15),
      strictness: "precise",
      recommended: true,
    });
  }

  return suggestions;
}

/**
 * 清洗并验证单条正则
 */
function sanitizeAndValidatePattern(rawPattern, sampleText) {
  if (!rawPattern || typeof rawPattern !== "string") return null;

  // 剥离可能存在的首尾斜线和 flags
  let cleaned = rawPattern.trim();
  cleaned = cleaned.replace(/^\/+/, "");
  cleaned = cleaned.replace(/\/([a-z]*)$/i, "");
  cleaned = cleaned.trim();

  if (!cleaned) return null;

  // 检验 JavaScript 正则合法性
  let regex;
  try {
    regex = new RegExp(cleaned, "i");
  } catch (e) {
    console.warn("[cleanerAiRegex] Invalid regex syntax generated:", cleaned, e.message);
    return null;
  }

  // 简易 ReDoS 风险检测（嵌套量词：例如 (a+)+、(a*)*）
  if (/\([^)]*(\+|\*|\{[0-9,]+\})[^)]*\)(\+|\*|\{[0-9,]+\})/.test(cleaned)) {
    console.warn("[cleanerAiRegex] Potential ReDoS pattern skipped or flagged:", cleaned);
  }

  // 检查在 sampleText 中的真实匹配情况
  let actualMatched = null;
  if (sampleText) {
    try {
      const match = sampleText.match(regex);
      if (match && match[0]) {
        actualMatched = match[0];
      }
    } catch (_) {}
  }

  return {
    pattern: cleaned,
    actualMatched,
  };
}

/**
 * 对外主接口：根据用户语句提供 AI 正则表达式建议
 * 
 * @param {Object} options
 * @param {string} options.text - 用户输入的待拦截样本或语句（必填）
 * @param {string} [options.groupKey] - 规则组 key，如 'adult_traffic' | 'gray_promotion'
 * @param {string} [options.groupName] - 规则组中文名
 * @param {string} [options.notes] - 运营补充说明或特殊需求
 * @returns {Promise<{ analysis: string, suggestions: Array, source: string }>}
 */
async function suggestCleanerRegex({ text, groupKey = "adult_traffic", groupName = "色情/擦边引流", notes = "" }) {
  const sampleText = String(text || "").trim();
  if (!sampleText) {
    throw new Error("请输入待分析的违规样本语句或引流话术");
  }

  const groupContext = `当前规则组：${groupName || groupKey}（${groupKey}）`;
  const notesContext = notes?.trim() ? `\n管理员补充需求：${notes.trim()}` : "";
  const userMessage = `${groupContext}${notesContext}\n\n请针对以下社交网络违规/引流样本语句，分析并生成建议的 JavaScript 正则表达式：\n"""\n${sampleText}\n"""`;

  let llmResult = null;
  let llmError = null;

  try {
    llmResult = await structuredChat(userMessage, REGEX_SUGGESTION_SCHEMA, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.2,
      timeout: 30000,
    });
  } catch (err) {
    llmError = err;
    console.warn("[cleanerAiRegex] LLM structuredChat failed, falling back to heuristic:", err.message);
  }

  let rawSuggestions = [];
  let analysis = "";
  let source = "llm";

  if (llmResult && Array.isArray(llmResult.suggestions) && llmResult.suggestions.length > 0) {
    rawSuggestions = llmResult.suggestions;
    analysis = llmResult.analysis || `针对输入样本完成了违规特征提取与对抗变体建模。`;
  } else {
    source = "heuristic_fallback";
    rawSuggestions = generateHeuristicSuggestions(sampleText, groupKey);
    analysis = `基于内置引流特征库提取出的推荐模式（LLM 暂时降级：${llmError?.message || "未返回结果"}）。`;
  }

  // 后处理清洗、语法验证与去重
  const validSuggestions = [];
  const seenPatterns = new Set();

  for (const item of rawSuggestions) {
    const validated = sanitizeAndValidatePattern(item.pattern, sampleText);
    if (!validated) continue;

    if (seenPatterns.has(validated.pattern)) continue;
    seenPatterns.add(validated.pattern);

    validSuggestions.push({
      pattern: validated.pattern,
      title: item.title || "自定义过滤模式",
      description: item.description || "匹配典型引流变体特征",
      matchedSample: validated.actualMatched || item.matchedSample || "",
      strictness: item.strictness || "balanced",
      recommended: Boolean(item.recommended),
    });
  }

  // 兜底保障：如果 LLM 返回的全部正则因语法原因被过滤，启动启发式规则
  if (validSuggestions.length === 0) {
    source = "heuristic_fallback";
    const fallbacks = generateHeuristicSuggestions(sampleText, groupKey);
    for (const item of fallbacks) {
      const validated = sanitizeAndValidatePattern(item.pattern, sampleText);
      if (validated && !seenPatterns.has(validated.pattern)) {
        seenPatterns.add(validated.pattern);
        validSuggestions.push({
          pattern: validated.pattern,
          title: item.title,
          description: item.description,
          matchedSample: validated.actualMatched || item.matchedSample || "",
          strictness: item.strictness,
          recommended: item.recommended,
        });
      }
    }
    analysis = `因规则语法校验原因，已自动应用内置引流特征库生成的推荐模式。`;
  }

  return {
    analysis,
    suggestions: validSuggestions,
    source,
  };
}

module.exports = {
  suggestCleanerRegex,
  generateHeuristicSuggestions,
  sanitizeAndValidatePattern,
};
