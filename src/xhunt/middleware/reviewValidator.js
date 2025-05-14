const { body } = require('express-validator');
const { isValidTag, sanitizeNote } = require('../services/inputValidator');

const validateTags = body('tags')
	.isArray({ min: 1 })
	.withMessage('至少需要一个标签')
	.custom((tags) => {
		if (!Array.isArray(tags)) throw new Error('标签必须是数组');
		for (const tag of tags) {
			if (!isValidTag(tag)) {
				throw new Error(`标签 "${tag}" 不符合规范`);
			}
		}
		return true;
	});

const validateNote = body('note')
	.optional()
	.isString()
	.trim()
	.customSanitizer(sanitizeNote)
	.custom((note) => {
		if (note.length > 1000) {
			throw new Error('备注内容不能超过 1000 字符');
		}
		return true;
	});

module.exports = {
	validateTags,
	validateNote
};
