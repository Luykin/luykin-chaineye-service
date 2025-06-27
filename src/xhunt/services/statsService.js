const { Op, fn, col } = require('sequelize');
const { XHuntUser, XHuntUserToken, XReviewForAccount, XAccount, XPointRecord } = require('../../models/postgres-start');

/**
 * 获取中国时区的今日开始时间（UTC）
 * 中国时间 00:00:00 对应 UTC 时间 16:00:00（前一天）
 */
function getTodayStartChina() {
	const now = new Date();
	// 获取中国时间的今日开始
	const chinaToday = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	chinaToday.setHours(0, 0, 0, 0);
	
	// 转换为 UTC 时间（减去8小时）
	const utcTodayStart = new Date(chinaToday.getTime() - 8 * 60 * 60 * 1000);
	return utcTodayStart;
}

/**
 * 获取中国时区的昨日开始时间（UTC）
 */
function getYesterdayStartChina() {
	const todayStart = getTodayStartChina();
	const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
	return yesterdayStart;
}

/**
 * 获取中国时区的本周开始时间（周一 UTC）
 */
function getWeekStartChina() {
	const now = new Date();
	// 获取中国时间
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	const dayOfWeek = chinaTime.getDay();
	const diff = chinaTime.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
	const monday = new Date(chinaTime.setDate(diff));
	monday.setHours(0, 0, 0, 0);
	
	// 转换为 UTC 时间
	const utcMondayStart = new Date(monday.getTime() - 8 * 60 * 60 * 1000);
	return utcMondayStart;
}

/**
 * 获取中国时区的本月开始时间（UTC）
 */
function getMonthStartChina() {
	const now = new Date();
	// 获取中国时间
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	const monthStart = new Date(chinaTime.getFullYear(), chinaTime.getMonth(), 1);
	monthStart.setHours(0, 0, 0, 0);
	
	// 转换为 UTC 时间
	const utcMonthStart = new Date(monthStart.getTime() - 8 * 60 * 60 * 1000);
	return utcMonthStart;
}

/**
 * 获取中国时区的今日结束时间（UTC）
 */
function getTodayEndChina() {
	const todayStart = getTodayStartChina();
	const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
	return todayEnd;
}

/**
 * 获取中国时区的昨日结束时间（UTC）
 */
function getYesterdayEndChina() {
	const yesterdayStart = getYesterdayStartChina();
	const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000);
	return yesterdayEnd;
}

/**
 * 计算增长率
 */
function calculateGrowthRate(current, previous) {
	if (previous === 0) return current > 0 ? 100 : 0;
	return Math.round(((current - previous) / previous) * 100);
}

/**
 * 获取完整的统计数据
 */
async function getFullStats() {
	// 使用中国时区的时间范围
	const todayStart = getTodayStartChina();
	const todayEnd = getTodayEndChina();
	const yesterdayStart = getYesterdayStartChina();
	const yesterdayEnd = getYesterdayEndChina();
	const weekStart = getWeekStartChina();
	const monthStart = getMonthStartChina();

	console.log('🕐 时区调试信息:');
	console.log('中国今日开始 (UTC):', todayStart.toISOString());
	console.log('中国今日结束 (UTC):', todayEnd.toISOString());
	console.log('中国昨日开始 (UTC):', yesterdayStart.toISOString());
	console.log('中国昨日结束 (UTC):', yesterdayEnd.toISOString());
	console.log('中国本周开始 (UTC):', weekStart.toISOString());
	console.log('中国本月开始 (UTC):', monthStart.toISOString());

	// 并行执行所有统计查询
	const [
		// 1. 日活统计（中国时区）
		todayActiveTokens,
		yesterdayActiveTokens,
		
		// 2. 评论统计（中国时区）
		todayReviews,
		yesterdayReviews,
		todayReviewUsers,
		yesterdayReviewUsers,
		
		// 3. 用户注册统计（中国时区）
		todayNewUsers,
		yesterdayNewUsers,
		totalUsers,
		
		// 4. 账号统计
		totalAccounts,
		todayNewAccounts,
		
		// 5. 积分统计（中国时区）
		todayPointsAwarded,
		totalPointsAwarded,
		
		// 6. 周/月统计（中国时区）
		weeklyReviews,
		monthlyReviews,
		weeklyNewUsers,
		monthlyNewUsers,
		
		// 7. KOL用户统计
		totalKOLUsers,
		todayKOLReviews,
		
		// 8. 平均评分统计
		averageRating,
		
		// 9. 热门标签统计
		popularTags,
		
		// 10. 用户活跃度分布
		userActivityDistribution
	] = await Promise.all([
		// 1. 日活统计（中国时区）
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: todayStart, [Op.lt]: todayEnd },
				isRevoked: false
			}
		}),
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: yesterdayStart, [Op.lt]: yesterdayEnd },
				isRevoked: false
			}
		}),
		
		// 2. 评论统计（中国时区）
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: yesterdayEnd } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } },
			distinct: true,
			col: 'xHuntUserId'
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: yesterdayEnd } },
			distinct: true,
			col: 'xHuntUserId'
		}),
		
		// 3. 用户注册统计（中国时区）
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: yesterdayEnd } }
		}),
		XHuntUser.count(),
		
		// 4. 账号统计（中国时区）
		XAccount.count(),
		XAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}),
		
		// 5. 积分统计（中国时区）
		XPointRecord.sum('points', {
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}) || 0,
		XPointRecord.sum('points') || 0,
		
		// 6. 周/月统计（中国时区）
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: weekStart } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: monthStart } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: weekStart } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: monthStart } }
		}),
		
		// 7. KOL用户统计（中国时区）
		XHuntUser.count({
			where: { kolRank20W: { [Op.ne]: null } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } },
			include: [{
				model: XHuntUser,
				as: 'xHuntUser',
				where: { kolRank20W: { [Op.ne]: null } },
				required: true
			}]
		}),
		
		// 8. 平均评分
		XReviewForAccount.findOne({
			attributes: [[fn('AVG', col('rating')), 'avgRating']],
			raw: true
		}),
		
		// 9. 热门标签（前10个）
		XReviewForAccount.findAll({
			attributes: [
				[fn('unnest', col('tags')), 'tag'],
				[fn('COUNT', '*'), 'count']
			],
			group: [fn('unnest', col('tags'))],
			order: [[fn('COUNT', '*'), 'DESC']],
			limit: 10,
			raw: true
		}),
		
		// 10. 用户活跃度分布
		XHuntUser.findAll({
			attributes: [
				'kolRank20W',
				[fn('COUNT', '*'), 'userCount'],
				[fn('COUNT', col('reviews.id')), 'reviewCount']
			],
			include: [{
				model: XReviewForAccount,
				as: 'reviews',
				required: false,
				attributes: []
			}],
			group: ['XHuntUser.kolRank20W'],
			order: [['kolRank20W', 'ASC']],
			raw: true
		})
	]);

	// 计算增长率
	const dailyActiveGrowth = calculateGrowthRate(todayActiveTokens, yesterdayActiveTokens);
	const dailyReviewsGrowth = calculateGrowthRate(todayReviews, yesterdayReviews);
	const dailyUsersGrowth = calculateGrowthRate(todayNewUsers, yesterdayNewUsers);
	const dailyReviewUsersGrowth = calculateGrowthRate(todayReviewUsers, yesterdayReviewUsers);

	// 构建统计数据
	return {
		// 时区信息
		timezoneInfo: {
			timezone: 'Asia/Shanghai (UTC+8)',
			todayStart: todayStart.toISOString(),
			todayEnd: todayEnd.toISOString(),
			yesterdayStart: yesterdayStart.toISOString(),
			yesterdayEnd: yesterdayEnd.toISOString(),
			chinaTime: new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"})
		},
		
		// 核心指标
		coreMetrics: {
			dailyActiveUsers: {
				value: todayActiveTokens,
				growth: dailyActiveGrowth,
				yesterday: yesterdayActiveTokens
			},
			dailyReviews: {
				value: todayReviews,
				growth: dailyReviewsGrowth,
				yesterday: yesterdayReviews
			},
			dailyReviewUsers: {
				value: todayReviewUsers,
				growth: dailyReviewUsersGrowth,
				yesterday: yesterdayReviewUsers
			},
			dailyNewUsers: {
				value: todayNewUsers,
				growth: dailyUsersGrowth,
				yesterday: yesterdayNewUsers
			}
		},
		
		// 累计数据
		totalMetrics: {
			totalUsers,
			totalAccounts,
			totalKOLUsers,
			totalPointsAwarded,
			averageRating: Number(averageRating?.avgRating || 0).toFixed(2)
		},
		
		// 周期统计
		periodMetrics: {
			weekly: {
				reviews: weeklyReviews,
				newUsers: weeklyNewUsers
			},
			monthly: {
				reviews: monthlyReviews,
				newUsers: monthlyNewUsers
			}
		},
		
		// 今日详细数据
		todayDetails: {
			newAccounts: todayNewAccounts,
			pointsAwarded: todayPointsAwarded,
			kolReviews: todayKOLReviews
		},
		
		// 热门标签
		popularTags: popularTags.map(tag => ({
			name: tag.tag,
			count: parseInt(tag.count)
		})),
		
		// 用户活跃度分布
		userDistribution: userActivityDistribution.map(item => ({
			kolRank: item.kolRank20W || 'Non-KOL',
			userCount: parseInt(item.userCount),
			reviewCount: parseInt(item.reviewCount)
		}))
	};
}

/**
 * 获取简化的统计数据（用于 JSON API）
 */
async function getSimpleStats() {
	const todayStart = getTodayStartChina();
	const todayEnd = getTodayEndChina();

	const [
		todayActiveTokens,
		todayReviews,
		todayNewUsers,
		totalUsers,
		totalAccounts
	] = await Promise.all([
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: todayStart, [Op.lt]: todayEnd },
				isRevoked: false
			}
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: todayEnd } }
		}),
		XHuntUser.count(),
		XAccount.count()
	]);

	return {
		dailyActiveUsers: todayActiveTokens,
		dailyReviews: todayReviews,
		dailyNewUsers: todayNewUsers,
		totalUsers,
		totalAccounts,
		timezone: 'Asia/Shanghai (UTC+8)',
		chinaTime: new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"}),
		timestamp: new Date().toISOString()
	};
}

module.exports = {
	getFullStats,
	getSimpleStats,
	calculateGrowthRate,
	// 导出时区相关函数用于测试
	getTodayStartChina,
	getYesterdayStartChina,
	getWeekStartChina,
	getMonthStartChina
};