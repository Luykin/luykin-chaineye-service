const { Op, fn, col } = require('sequelize');
const { XHuntUser, XHuntUserToken, XReviewForAccount, XAccount, XPointRecord } = require('../../models/postgres-start');

/**
 * 获取今日开始时间
 */
function getTodayStart() {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return today;
}

/**
 * 获取昨日开始时间
 */
function getYesterdayStart() {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	yesterday.setHours(0, 0, 0, 0);
	return yesterday;
}

/**
 * 获取本周开始时间（周一）
 */
function getWeekStart() {
	const now = new Date();
	const dayOfWeek = now.getDay();
	const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
	const monday = new Date(now.setDate(diff));
	monday.setHours(0, 0, 0, 0);
	return monday;
}

/**
 * 获取本月开始时间
 */
function getMonthStart() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * 计算增长率
 */
function calculateGrowthRate(current, previous) {
	if (previous === 0) return current > 0 ? 100 : 0;
	return Math.round(((current - previous) / previous) * 100);
}

/**
 * 获取 DataDog 仪表板内容
 */
async function fetchDataDogDashboard() {
	try {
		const response = await fetch('https://p.us5.datadoghq.com/sb/7835f769-3710-11f0-a543-0e1c818bfb48-35c1b61a99a3f17f362065fa7c812f1f', {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Accept-Encoding': 'gzip, deflate, br',
				'DNT': '1',
				'Connection': 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
			},
			timeout: 10000 // 10秒超时
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		let html = await response.text();
		
		// 处理相对路径，转换为绝对路径
		html = html.replace(/src="\/([^"]*)/g, 'src="https://p.us5.datadoghq.com/$1');
		html = html.replace(/href="\/([^"]*)/g, 'href="https://p.us5.datadoghq.com/$1');
		html = html.replace(/url\(\/([^)]*)/g, 'url(https://p.us5.datadoghq.com/$1');
		
		// 移除可能导致跳转的脚本
		html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
		html = html.replace(/window\.location/g, '// window.location');
		html = html.replace(/document\.location/g, '// document.location');
		
		return html;
	} catch (error) {
		console.error('Failed to fetch DataDog dashboard:', error);
		return `
			<div style="padding: 40px; text-align: center; color: #666; background: #f9fafb; border-radius: 8px; border: 2px dashed #ddd;">
				<h3 style="margin-bottom: 16px; color: #ef4444;">📊 DataDog 仪表板加载失败</h3>
				<p style="margin-bottom: 12px;">无法获取实时监控数据</p>
				<p style="font-size: 14px; color: #888;">错误信息: ${error.message}</p>
				<a href="https://p.us5.datadoghq.com/sb/7835f769-3710-11f0-a543-0e1c818bfb48-35c1b61a99a3f17f362065fa7c812f1f" 
				   target="_blank" 
				   style="display: inline-block; margin-top: 16px; padding: 8px 16px; background: #667eea; color: white; text-decoration: none; border-radius: 6px;">
					🔗 直接访问 DataDog
				</a>
			</div>
		`;
	}
}

/**
 * 获取完整的统计数据
 */
async function getFullStats() {
	const todayStart = getTodayStart();
	const yesterdayStart = getYesterdayStart();
	const weekStart = getWeekStart();
	const monthStart = getMonthStart();

	// 并行执行所有统计查询
	const [
		// 1. 日活统计
		todayActiveTokens,
		yesterdayActiveTokens,
		
		// 2. 评论统计
		todayReviews,
		yesterdayReviews,
		todayReviewUsers,
		yesterdayReviewUsers,
		
		// 3. 用户注册统计
		todayNewUsers,
		yesterdayNewUsers,
		totalUsers,
		
		// 4. 账号统计
		totalAccounts,
		todayNewAccounts,
		
		// 5. 积分统计
		todayPointsAwarded,
		totalPointsAwarded,
		
		// 6. 周/月统计
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
		userActivityDistribution,
		
		// 11. DataDog 仪表板内容
		dataDogDashboard
	] = await Promise.all([
		// 1. 日活统计
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: todayStart },
				isRevoked: false
			}
		}),
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: yesterdayStart, [Op.lt]: todayStart },
				isRevoked: false
			}
		}),
		
		// 2. 评论统计
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: todayStart } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart } },
			distinct: true,
			col: 'xHuntUserId'
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: todayStart } },
			distinct: true,
			col: 'xHuntUserId'
		}),
		
		// 3. 用户注册统计
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: yesterdayStart, [Op.lt]: todayStart } }
		}),
		XHuntUser.count(),
		
		// 4. 账号统计
		XAccount.count(),
		XAccount.count({
			where: { createdAt: { [Op.gte]: todayStart } }
		}),
		
		// 5. 积分统计
		XPointRecord.sum('points', {
			where: { createdAt: { [Op.gte]: todayStart } }
		}) || 0,
		XPointRecord.sum('points') || 0,
		
		// 6. 周/月统计
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
		
		// 7. KOL用户统计
		XHuntUser.count({
			where: { kolRank20W: { [Op.ne]: null } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart } },
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
		}),
		
		// 11. DataDog 仪表板内容
		fetchDataDogDashboard()
	]);

	// 计算增长率
	const dailyActiveGrowth = calculateGrowthRate(todayActiveTokens, yesterdayActiveTokens);
	const dailyReviewsGrowth = calculateGrowthRate(todayReviews, yesterdayReviews);
	const dailyUsersGrowth = calculateGrowthRate(todayNewUsers, yesterdayNewUsers);
	const dailyReviewUsersGrowth = calculateGrowthRate(todayReviewUsers, yesterdayReviewUsers);

	// 构建统计数据
	return {
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
		})),
		
		// DataDog 仪表板内容
		dataDogDashboard
	};
}

/**
 * 获取简化的统计数据（用于 JSON API）
 */
async function getSimpleStats() {
	const todayStart = getTodayStart();

	const [
		todayActiveTokens,
		todayReviews,
		todayNewUsers,
		totalUsers,
		totalAccounts
	] = await Promise.all([
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: todayStart },
				isRevoked: false
			}
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart } }
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
		timestamp: new Date().toISOString()
	};
}

module.exports = {
	getFullStats,
	getSimpleStats,
	calculateGrowthRate,
	fetchDataDogDashboard
};