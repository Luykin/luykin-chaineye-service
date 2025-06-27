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
 * 格式化日期时间（中国时区）
 */
function formatDateTime(date = new Date()) {
	return date.toLocaleString('zh-CN', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
}

/**
 * 格式化中国时间（仅用于显示）
 */
function formatChinaTime(date = new Date()) {
	return date.toLocaleString('zh-CN', {
		timeZone: 'Asia/Shanghai',
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}

module.exports = {
	getGrowthClass,
	getGrowthIcon,
	formatNumber,
	formatDateTime,
	formatChinaTime
};