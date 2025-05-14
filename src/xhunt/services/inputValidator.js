// utils/inputValidator.js

const xss = require('xss');

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

module.exports = {
	isValidTag,
	sanitizeNote,
};
