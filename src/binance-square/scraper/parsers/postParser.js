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
function resolvePostType(contentType, rawData) {
  // 优先级：isReplyPost → quoteContent → contentType映射
  if (rawData.isReplyPost === true) {
    return "reply";
  }
  if (rawData.quoteContent && rawData.quoteContent !== null) {
    return "quote";
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
    likeCount: content.likeCount ?? null,
    shareCount: content.shareCount ?? null,
    commentCount: content.commentCount ?? null,
    viewCount: content.viewCount ?? null,
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
