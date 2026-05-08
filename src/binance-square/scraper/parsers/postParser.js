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

function resolvePostType(contentType, rawData) {
  // 优先级：isReplyPost → quoteContent → contentType映射
  if (rawData.isReplyPost === true) {
    return "reply";
  }
  // 判断是否为引用：quoteContent 必须有实质性的 id（不为 null/undefined/0/空字符串）
  // 币安API普通帖也会返回 quoteContent={} 空对象，空对象是 truthy 的，需要额外检查
  const qc = rawData.quoteContent;
  if (qc && qc !== null) {
    const qcId = qc.id;
    if (qcId !== null && qcId !== undefined && qcId !== 0 && qcId !== "" && qcId !== "0") {
      return "quote";
    }
  }
  // contentType映射（兜底）
  const typeMap = {
    0: "article",
    1: "quote",
    2: "reply",
  };
  return typeMap[contentType] || "article";
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

  return {
    // 关键字段（程序传入）
    postId: String(content.id),
    username: content.username || null,
    postType,
    isDeleted: false,

    // API返回的内容字段
    title: resolveTitle(content.title),
    content: content.body || null,
    contentText: content.bodyTextOnly || null,
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
};
