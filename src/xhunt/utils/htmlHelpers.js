/**
 * 获取增长率的CSS类
 */
function getGrowthClass(growth) {
	if (growth > 0) return 'growth-positive';
	if (growth < 0) return 'growth-negative';
	return 'growth-neutral';
}

/**
 * 获取增长率的图标
 */
function getGrowthIcon(growth) {
	if (growth > 0) return '📈';
	if (growth < 0) return '📉';
	return '➖';
}

/**
 * 格式化数字（添加千分位分隔符）
 */
function formatNumber(num) {
	return num.toLocaleString();
}

/**
 * 格式化日期时间
 */
function formatDateTime(date = new Date()) {
	return date.toLocaleString('zh-CN');
}

module.exports = {
	getGrowthClass,
	getGrowthIcon,
	formatNumber,
	formatDateTime
};