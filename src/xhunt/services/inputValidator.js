// utils/inputValidator.js

const xss = require('xss');

const PLAIN_TEXT_XSS_OPTIONS = {
	whiteList: {},
	stripIgnoreTag: true,
	stripIgnoreTagBody: ['script']
};

const ALLOWED_RICH_TEXT_CLASS = /^(ql-size-(small|large|huge)|ql-align-(center|right|justify))$/;
const RICH_TEXT_WHITELIST = {
	a: ['href', 'title', 'target', 'rel', 'style', 'class'],
	b: ['style', 'class'],
	blockquote: ['style', 'class'],
	br: [],
	code: ['style', 'class'],
	div: ['style', 'class'],
	em: ['style', 'class'],
	i: ['style', 'class'],
	li: ['style', 'class'],
	ol: ['style', 'class'],
	p: ['style', 'class'],
	pre: ['style', 'class'],
	s: ['style', 'class'],
	small: ['style', 'class'],
	span: ['style', 'class'],
	strong: ['style', 'class'],
	sub: ['style', 'class'],
	sup: ['style', 'class'],
	u: ['style', 'class'],
	ul: ['style', 'class']
};

const RICH_TEXT_XSS_OPTIONS = {
	whiteList: RICH_TEXT_WHITELIST,
	stripIgnoreTag: true,
	stripIgnoreTagBody: ['script', 'style'],
	css: {
		whiteList: {
			'background-color': true,
			color: true,
			'font-size': true,
			'font-style': true,
			'font-weight': true,
			'text-align': true,
			'text-decoration': true
		}
	},
	onTagAttr(tag, name, value, isWhiteAttr) {
		if (!isWhiteAttr) return undefined;
		if (name === 'class') {
			const cleaned = String(value || '')
				.split(/\s+/)
				.map((item) => item.trim())
				.filter((item) => ALLOWED_RICH_TEXT_CLASS.test(item))
				.join(' ');
			if (!cleaned) return '';
			return `class="${xss.escapeAttrValue(cleaned)}"`;
		}
		if (name === 'target') {
			const normalized = String(value || '').trim().toLowerCase();
			if (normalized === '_blank' || normalized === '_self') {
				return `target="${xss.escapeAttrValue(normalized)}"`;
			}
			return '';
		}
		if (name === 'rel') {
			return 'rel="noopener noreferrer"';
		}
		return undefined;
	}
};

/**
 * 计算标签字符长度（中文按 4 字符计算）
 */
function calculateTagCharLength(tag) {
	if (typeof tag !== 'string') return 0;
	let length = 0;
	for (let i = 0; i < tag.length; i++) {
		const charCode = tag.charCodeAt(i);
		// 判断是否是汉字或宽字符（CJK Unicode）
		if ((charCode >= 0x4e00 && charCode <= 0x9fa5) || // 中文
			charCode === 0x300c || charCode === 0x300d || // 「」
			charCode === 0x300e || charCode === 0x300f || // 《》
			charCode === 0x3010 || charCode === 0x3011) { // 【】
			length += 4;
		} else if (charCode > 127 || charCode === 94) { // 其他宽字符或 ^
			length += 2;
		} else {
			length += 1;
		}
	}
	return length;
}

/**
 * 校验单个 tag 是否合法
 */
function isValidTag(tag) {
	if (typeof tag !== 'string') return false;
	
	const cleanTag = tag.trim();
	
	if (!cleanTag) return false;
	if (calculateTagCharLength(cleanTag) > 30) return false;
	
	// 可选：添加正则限制（如不允许特殊符号开头/结尾）
	const invalidChars = /[<>\\]/g;
	if (invalidChars.test(cleanTag)) return false;
	
	return true;
}

/**
 * 清理并校验 note 内容
 */
function sanitizeNote(note) {
	if (!note || typeof note !== 'string') return '';
	const trimmed = note.trim().substring(0, 1000); // 截断
	return xss(trimmed);
}

/**
 * 清理并校验 comment 内容
 */
function sanitizeComment(comment) {
	if (!comment || typeof comment !== 'string') return '';
	const trimmed = comment.trim().substring(0, 3000); // 截断
	return xss(trimmed);
}

function sanitizePlainText(text, maxLength = 255) {
	if (text == null) return '';
	const normalized = String(text).trim().substring(0, maxLength);
	return xss(normalized, PLAIN_TEXT_XSS_OPTIONS);
}

/**
 * 严格过滤纯文本留言评论（彻底防范 XSS 攻击，禁止存储和返回任何 HTML/富文本标签）
 * 存储入库与接口返回时均必须调用，确保全链路只传输与展示安全的纯文本。
 *
 * 1. 移除非打印控制字符与空字符
 * 2. 解码常见实体，防止以实体编码形式混淆绕过标签检测（如 &lt;script&gt;）
 * 3. 递归剥离 HTML 注释与 CDATA
 * 4. 递归剥离所有危险块级标签（含其内部脚本代码和样式）
 * 5. 剥离所有 HTML/XML 标签（包含未闭合残片）
 * 6. 清理 javascript:, vbscript:, data: 等危险伪协议
 * 7. 清理独立事件属性残片（如 onclick=...）
 * 8. 规范化空格并截断到指定长度（默认 200 字符）
 *
 * @param {unknown} input 待过滤的留言文本
 * @param {number} [maxLength=200] 最大长度
 * @returns {string} 纯文本字符串
 */
function sanitizeCommentPlainText(input, maxLength = 200) {
	if (input == null) return '';
	let str = String(input);

	// 1. 移除非打印控制字符与空字符 (\0, \x01-\x08, \x0B, \x0C, \x0E-\x1F, \x7F)
	str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

	// 2. 解码常见实体，防止以实体编码形式混淆绕过标签检测（如 &lt;script&gt;）
	str = str
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => {
			try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
		})
		.replace(/&#([0-9]{1,7});/g, (_, dec) => {
			try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ''; }
		});

	// 3. 递归剥离 HTML 注释与 CDATA
	str = str.replace(/<!--[\s\S]*?-->/g, '');
	str = str.replace(/<!--[\s\S]*$/g, '');
	str = str.replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

	// 4. 递归剥离所有危险块级标签（含其内部脚本代码和样式）与普通 HTML 标签
	let prev;
	do {
		prev = str;
		str = str.replace(/<\s*(script|style|iframe|object|embed|svg|math|textarea|noembed|noframes|form|input|button|select|video|audio|marquee|details|dialog)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
		str = str.replace(/<\s*(script|style|iframe|object|embed|svg|math|textarea|noembed|noframes|form|input|button|select|video|audio|marquee|details|dialog)\b[^>]*>/gi, '');
		str = str.replace(/<\/?([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>?/gi, '');
		str = str.replace(/<[a-zA-Z][^>]*$/g, '');
	} while (str !== prev && /<[a-zA-Z\/]/i.test(str));

	// 5. 清除残留的伪协议
	str = str.replace(/(?:javascript|vbscript|data):[^\s]*/gi, '');

	// 6. 清除孤立的事件属性模式
	str = str.replace(/\bon[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

	// 7. 规范化空格并截断
	str = str.replace(/\s+/g, ' ').trim();
	if (maxLength && str.length > maxLength) {
		str = str.substring(0, maxLength).trim();
	}
	return str;
}

function isSafeHttpUrl(value) {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch (error) {
		return false;
	}
}

function sanitizeSafeUrl(url, maxLength = 2048) {
	if (url == null) return '';
	const trimmed = String(url).trim().substring(0, maxLength);
	if (!trimmed) return '';
	if (!isSafeHttpUrl(trimmed)) return '';
	return trimmed;
}

function sanitizeRichTextHtml(html, maxLength = 20000) {
	if (html == null) return '';
	const normalized = String(html).trim().substring(0, maxLength);
	if (!normalized) return '';
	return xss(normalized, RICH_TEXT_XSS_OPTIONS);
}

function sanitizeJsonStringsDeep(input, keyHint = '') {
	if (Array.isArray(input)) {
		return input.map((item) => sanitizeJsonStringsDeep(item, keyHint));
	}
	if (input && typeof input === 'object') {
		return Object.fromEntries(
			Object.entries(input).map(([key, value]) => [key, sanitizeJsonStringsDeep(value, key)])
		);
	}
	if (typeof input === 'string') {
		if (/(^|_)(url|link|avatar|image|icon|logo|src|href)$/i.test(keyHint)) {
			return sanitizeSafeUrl(input, 4096);
		}
		return sanitizePlainText(input, 5000);
	}
	return input;
}


const VOTE_TITLE_WHITELIST = {
	a: ['href', 'target', 'rel', 'title', 'class', 'style'],
	b: ['style', 'class'],
	strong: ['style', 'class'],
	i: ['style', 'class'],
	em: ['style', 'class'],
	u: ['style', 'class'],
	s: ['style', 'class'],
	del: ['style', 'class'],
	strike: ['style', 'class'],
	span: ['style', 'class'],
	p: ['style', 'class'],
	div: ['style', 'class'],
	br: [],
	ul: ['style', 'class'],
	ol: ['style', 'class'],
	li: ['style', 'class'],
	blockquote: ['style', 'class'],
	code: ['style', 'class'],
	pre: ['style', 'class'],
	h1: ['style', 'class'],
	h2: ['style', 'class'],
	h3: ['style', 'class'],
	h4: ['style', 'class'],
	img: ['src', 'alt', 'class', 'style', 'width', 'height']
};

const VOTE_TITLE_XSS_OPTIONS = {
	whiteList: VOTE_TITLE_WHITELIST,
	stripIgnoreTag: true,
	stripIgnoreTagBody: ['script', 'style', 'iframe', 'textarea'],
	css: {
		whiteList: {
			'background-color': true,
			color: true,
			'font-size': true,
			'font-weight': true,
			'font-style': true,
			'text-decoration': true,
			'text-align': true,
			'line-height': true,
			'margin': true,
			'margin-top': true,
			'margin-bottom': true,
			'padding': true
		}
	},
	onTagAttr: (tag, name, value) => {
		if (tag === 'img' && name === 'src') {
			const trimmed = String(value || '').trim();
			if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:image/')) return '';
			return `src="${xss.escapeAttrValue(trimmed)}"`;
		}
		if (tag === 'a' && name === 'href') {
			const trimmed = String(value || '').trim();
			if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('mailto:')) return '';
			return `href="${xss.escapeAttrValue(trimmed)}"`;
		}
		if (tag === 'a' && name === 'target') {
			return 'target="_blank"';
		}
		if (tag === 'a' && name === 'rel') {
			return 'rel="noopener noreferrer"';
		}
		if (name === 'class') {
			const safeClass = String(value || '')
				.replace(/[^a-zA-Z0-9_\-\s]/g, '')
				.trim();
			return safeClass ? `class="${xss.escapeAttrValue(safeClass)}"` : '';
		}
		return undefined;
	}
};

function sanitizeVoteTitleHtml(html, maxLength = 5000) {
	if (html == null) return '';
	const normalized = String(html).trim().substring(0, maxLength);
	if (!normalized) return '';
	return xss(normalized, VOTE_TITLE_XSS_OPTIONS);
}

module.exports = {
	sanitizeVoteTitleHtml,
	isValidTag,
	sanitizeNote,
	sanitizeComment,
	sanitizePlainText,
	sanitizeCommentPlainText,
	sanitizeSafeUrl,
	sanitizeRichTextHtml,
	sanitizeJsonStringsDeep,
	isSafeHttpUrl
};
