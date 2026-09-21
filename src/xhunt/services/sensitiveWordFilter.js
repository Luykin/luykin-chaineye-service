const fs = require("fs");

/**
 * 留言敏感词过滤器
 *
 * 词表来源（按优先级合并，全部生效）：
 * 1. 内置占位词表 BUILTIN_SENSITIVE_WORDS —— 仅放少量占位示例，
 *    正式词表（涉政/色情/暴恐等）由运营通过下面两种方式扩充，勿提交真实词表到仓库；
 * 2. 环境变量 HOT_VOTE_SENSITIVE_WORDS —— 逗号分隔的追加词；
 * 3. 环境变量 HOT_VOTE_SENSITIVE_WORDS_FILE —— 指向一个纯文本文件，每行一个词，
 *    支持 # 开头的注释行，便于运营维护完整词表。
 *
 * 另内置钓鱼/诈骗链接正则（短链域名、伪装空投/验证钱包、punycode 域名等模式）。
 */

// 内置占位敏感词（运营扩充前仅占位，不代表真实词表）
const BUILTIN_SENSITIVE_WORDS = [
  "sensitive_example_1",
  "sensitive_example_2",
  "banned_word_placeholder",
];

// 钓鱼/诈骗链接特征正则
const PHISHING_PATTERNS = [
  // 常见短链域名
  /\b(bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|cutt\.ly|rebrand\.ly|shorturl\.at|t\.me\/\+)\b/i,
  // punycode 伪装域名
  /\bxn--[a-z0-9-]+\.(com|net|org|io|xyz|top)\b/i,
  // 伪装空投 / 诱导连接钱包类话术
  /(claim\s*(your\s*)?(airdrop|reward)|free\s*mint|verify\s*(your\s*)?wallet|connect\s*wallet\s*to\s*claim)/i,
  /(领取空投|空投领取|免费送|充值返利|刷单兼职)/i,
];

let cachedWordSet = null;

function loadExtraWordsFromEnv() {
  const raw = process.env.HOT_VOTE_SENSITIVE_WORDS || "";
  return raw
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

function loadExtraWordsFromFile() {
  const filePath = process.env.HOT_VOTE_SENSITIVE_WORDS_FILE;
  if (!filePath) return [];
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch (err) {
    console.warn("[SensitiveWordFilter] 读取词表文件失败:", err.message);
    return [];
  }
}

function getWordSet() {
  if (!cachedWordSet) {
    cachedWordSet = new Set(
      [
        ...BUILTIN_SENSITIVE_WORDS,
        ...loadExtraWordsFromEnv(),
        ...loadExtraWordsFromFile(),
      ].map((w) => w.toLowerCase())
    );
  }
  return cachedWordSet;
}

/**
 * 重新加载词表（运营更新环境变量/词表文件后可调用，主要用于测试或热更新场景）
 */
function reloadSensitiveWords() {
  cachedWordSet = null;
}

/**
 * 检查文本是否命中敏感词或钓鱼链接模式
 * @param {string} text
 * @returns {boolean}
 */
function containsSensitiveWord(text) {
  if (!text || typeof text !== "string") return false;
  const lowered = text.toLowerCase();
  for (const word of getWordSet()) {
    if (word && lowered.includes(word)) return true;
  }
  return PHISHING_PATTERNS.some((pattern) => pattern.test(text));
}

module.exports = {
  containsSensitiveWord,
  reloadSensitiveWords,
};
