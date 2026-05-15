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

module.exports = {
	isValidTag,
	sanitizeNote,
	sanitizeComment,
	sanitizePlainText,
	sanitizeSafeUrl,
	sanitizeRichTextHtml,
	sanitizeJsonStringsDeep,
	isSafeHttpUrl
};
