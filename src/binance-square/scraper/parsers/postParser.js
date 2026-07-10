/**
 * 帖子内容解析器
 * 将币安API返回的Content对象解析为数据库结构
 */

/**
 * 解析contentType为postType
 * @param {number} contentType - API返回的contentType
 * @param {Object} rawData - 原始数据（用于判断isReplyPost/quoteContent）
 * @returns {string} article|quote|reply|following
 */
/**
 * 安全转换整数，超出 PostgreSQL INTEGER 范围时截断
 */
function safeInteger(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  if (isNaN(num)) return null;
  const MAX_INT = 2147483647;
  const MIN_INT = -2147483648;
  if (num > MAX_INT) return MAX_INT;
  if (num < MIN_INT) return MIN_INT;
  return num;
}

/**
 * 从币安API的body JSON中提取纯文本内容
 * body结构: {"layout":{...}, "hash":{uuid:{"id":"RichTextText","config":{"content":"文本"}}}}
 * @param {*} body - API返回的body（可能是JSON对象或JSON字符串）
 * @returns {string|null}
 */
function extractBodyText(body) {
  if (!body) return null;

  let bodyData = body;
  if (typeof body === "string") {
    try {
      bodyData = JSON.parse(body);
    } catch (e) {
      // 不是合法JSON，直接返回前500字符
      return body.substring(0, 500);
    }
  }

  const texts = [];

  function traverse(obj) {
    if (!obj || typeof obj !== "object") return;

    // RichTextText 节点: config.content 是纯文本
    if (obj.id === "RichTextText" && obj.config && typeof obj.config.content === "string") {
      texts.push(obj.config.content);
      return; // 已找到文本，不需要继续遍历子节点
    }

    for (const val of Object.values(obj)) {
      if (typeof val === "object") {
        traverse(val);
      }
    }
  }

  traverse(bodyData);
  return texts.length > 0 ? texts.join(" ") : null;
}

function resolvePostType(contentType, rawData) {
  // contentType 只表示帖子格式（1=短帖, 2=长文, 3=长文, 4=AMA），不表示帖子类型
  // 帖子类型（article/quote/reply）由以下字段判断：

  // 1. isReplyPost=true → 回复
  if (rawData.isReplyPost === true) {
    return "reply";
  }

  // 2. quoteContent 有有效的 id → 引用/转发
  const qc = rawData.quoteContent;
  if (qc && qc !== null) {
    const qcId = qc.id;
    if (qcId !== null && qcId !== undefined && qcId !== 0 && qcId !== "" && qcId !== "0") {
      return "quote";
    }
  }

  // 3. 其他都是普通帖（article）
  // 包括：contentType=1 的短帖、contentType=2/3 的长文章、contentType=4 的 AMA
  return "article";
}

/**
 * 解析title（处理字符串或对象类型）
 * @param {*} title - API返回的title
 * @returns {string|null}
 */
function resolveTitle(title) {
  if (title === null || title === undefined) {
    return null;
  }
  if (typeof title === "string") {
    return title;
  }
  if (typeof title === "object") {
    // 如果是对象，尝试取常见字段
    return title.text || title.value || JSON.stringify(title);
  }
  return String(title);
}

/**
 * 解析Content对象为数据库字段
 * @param {Object} content - API返回的Content对象
 * @returns {Object} 解析后的数据
 */
function parsePostContent(content) {
  if (!content || typeof content !== "object") {
    return null;
  }

  const postType = resolvePostType(content.contentType, content);

  // 优先使用币安详情/列表接口直接返回的 bodyTextOnly；没有时再从 body JSON 中提取纯文本。
  const extractedText = content.bodyTextOnly || extractBodyText(content.body);

  return {
    // 关键字段（程序传入）
    postId: String(content.id),
    username: content.username || null,
    postType,
    isDeleted: false,

    // API返回的内容字段
    title: resolveTitle(content.title),
    content: content.body || null,
    contentText: extractedText,
    mediaUrls: Array.isArray(content.imageList) ? content.imageList : null,
    likeCount: safeInteger(content.likeCount),
    shareCount: safeInteger(content.shareCount),
    commentCount: safeInteger(content.commentCount),
    viewCount: safeInteger(content.viewCount),
    publishedAt: content.latestReleaseTime
      ? new Date(content.latestReleaseTime)
      : null,
    // 统一使用标准帖子链接，避免API返回的webLink指向audio/replay等特殊页面
    sourceUrl: content.id
      ? `https://www.binance.com/zh-CN/square/post/${content.id}`
      : null,

    // 原始数据备份
    rawData: content,
  };
}

/**
 * 解析帖子列表
 * @param {Array} contents - API返回的contents数组
 * @returns {Array} 解析后的帖子数组
 */
function parsePostContents(contents) {
  if (!Array.isArray(contents)) {
    return [];
  }
  return contents.map(parsePostContent).filter(Boolean);
}

module.exports = {
  parsePostContent,
  parsePostContents,
  resolvePostType,
  resolveTitle,
  extractBodyText,
};
