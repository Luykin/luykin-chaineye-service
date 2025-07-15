const { Op, fn, col } = require('sequelize');
const { XHuntUser, XHuntUserToken, XReviewForAccount, XAccount, XPointRecord } = require('../../models/postgres-start');

/**
 * 获取中国时区的今日开始时间（UTC）
 * 中国时间今日 00:00:00 对应的 UTC 时间
 */
function getTodayStartChina() {
	// 获取当前中国时间
	const now = new Date();
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	
	// 设置为中国时间今日 00:00:00
	const chinaToday = new Date(chinaTime.getFullYear(), chinaTime.getMonth(), chinaTime.getDate(), 0, 0, 0, 0);
	
	// 转换为 UTC 时间：中国时间减去8小时得到UTC时间
	const utcTime = new Date(chinaToday.getTime() - 8 * 60 * 60 * 1000);
	return utcTime;
}

/**
 * 获取中国时区的今日结束时间（UTC）
 * 中国时间今日 23:59:59 对应的 UTC 时间
 */
function getTodayEndChina() {
	// 获取当前中国时间
	const now = new Date();
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	
	// 设置为中国时间今日 23:59:59.999
	const chinaTodayEnd = new Date(chinaTime.getFullYear(), chinaTime.getMonth(), chinaTime.getDate(), 23, 59, 59, 999);
	
	// 转换为 UTC 时间：中国时间减去8小时得到UTC时间
	const utcTime = new Date(chinaTodayEnd.getTime() - 8 * 60 * 60 * 1000);
	return utcTime;
}

/**
 * 获取中国时区的本周开始时间（周一 UTC）
 */
function getWeekStartChina() {
	// 获取当前中国时间
	const now = new Date();
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	
	// 计算本周一的日期
	const dayOfWeek = chinaTime.getDay();
	const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周日为0，需要回到上周一
	
	const monday = new Date(chinaTime.getFullYear(), chinaTime.getMonth(), chinaTime.getDate() + daysToMonday, 0, 0, 0, 0);
	
	// 转换为 UTC 时间：中国时间减去8小时得到UTC时间
	const utcMondayStart = new Date(monday.getTime() - 8 * 60 * 60 * 1000);
	return utcMondayStart;
}

/**
 * 获取中国时区的本月开始时间（UTC）
 */
function getMonthStartChina() {
	// 获取当前中国时间
	const now = new Date();
	const chinaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
	
	// 设置为中国时间本月1日 00:00:00
	const monthStart = new Date(chinaTime.getFullYear(), chinaTime.getMonth(), 1);
	
	// 转换为 UTC 时间：中国时间减去8小时得到UTC时间
	const utcMonthStart = new Date(monthStart.getTime() - 8 * 60 * 60 * 1000);
	return utcMonthStart;
}

/**
 * 获取完整的统计数据
 */
async function getFullStats() {
	// 使用中国时区的时间范围
	const todayStart = getTodayStartChina();
	const todayEnd = getTodayEndChina();
	const weekStart = getWeekStartChina();
	const monthStart = getMonthStartChina();

	console.log('🕐 时区调试信息:');
	console.log('中国今日开始 (UTC):', todayStart.toISOString());
	console.log('中国今日结束 (UTC):', todayEnd.toISOString());
	console.log('中国本周开始 (UTC):', weekStart.toISOString());
	console.log('中国本月开始 (UTC):', monthStart.toISOString());

	// 并行执行所有统计查询
	const [
		// 1. 日活统计（中国时区）
		todayActiveTokens,
		
		// 2. 评论统计（中国时区）
		todayReviews,
		todayReviewUsers,
		
		// 3. 用户注册统计（中国时区）
		todayNewUsers,
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
		
		// 10. 用户活跃度分布（修复SQL查询）
		userActivityDistribution,
		
		// 11. 🔥有灵魂的KOL 标签专业统计
		kolTagAnalytics
	] = await Promise.all([
		// 1. 日活统计（中国时区）
		XHuntUserToken.count({
			where: {
				lastUsed: { [Op.gte]: todayStart, [Op.lt]: todayEnd },
				isRevoked: false
			}
		}),
		
		// 2. 评论统计（中国时区）
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
		}),
		XReviewForAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
			distinct: true,
			col: 'xHuntUserId'
		}),
		
		// 3. 用户注册统计（中国时区）
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
		}),
		XHuntUser.count(),
		
		// 4. 账号统计（中国时区）
		XAccount.count(),
		XAccount.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
		}),
		
		// 5. 积分统计（中国时区）
		XPointRecord.sum('points', {
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
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
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
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
		
		// 10. 修复用户活跃度分布查询
		// 使用两步查询来避免复杂的子查询问题
		(async () => {
			try {
				// 先获取有评论的用户ID和评论数量
				const userReviewCounts = await XReviewForAccount.findAll({
					attributes: [
						'xHuntUserId',
						[fn('COUNT', '*'), 'reviewCount']
					],
					group: ['xHuntUserId'],
					order: [[fn('COUNT', '*'), 'DESC']],
					limit: 20,
					raw: true
				});
				
				// 如果没有评论数据，返回空数组
				if (!userReviewCounts || userReviewCounts.length === 0) {
					return [];
				}
				
				// 获取用户ID列表
				const userIds = userReviewCounts.map(item => item.xHuntUserId);
				
				// 再查询用户详细信息
				const users = await XHuntUser.findAll({
					where: {
						id: { [Op.in]: userIds }
					},
					attributes: ['id', 'username', 'displayName', 'kolRank20W', 'classification'],
					raw: true
				});
				
				// 合并数据
				const result = userReviewCounts.map(reviewData => {
					const user = users.find(u => u.id === reviewData.xHuntUserId);
					return {
						id: user?.id || reviewData.xHuntUserId,
						username: user?.username || null,
						displayName: user?.displayName || null,
						kolRank20W: user?.kolRank20W || null,
						classification: user?.classification || null,
						reviewCount: parseInt(reviewData.reviewCount)
					};
				});
				
				return result;
			} catch (error) {
				console.error('Error fetching user activity distribution:', error);
				return []; // 返回空数组而不是抛出错误
			}
		})(),
		
		// 11. 🔥有灵魂的KOL 标签专业统计
		(async () => {
			try {
				const targetTags = ['🔥有灵魂的KOL', '有灵魂的KOL']; // 支持两种标签
				
				// 11.1 统计使用该标签的评论者（按评论次数排序）
				const kolTagReviewers = await XReviewForAccount.findAll({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag] // PostgreSQL 数组包含查询
							}
						}))
					},
					attributes: [
						'xHuntUserId',
						[fn('COUNT', '*'), 'tagUsageCount']
					],
					include: [{
						model: XHuntUser,
						as: 'xHuntUser',
						attributes: ['username', 'displayName', 'avatar', 'kolRank20W', 'classification'],
						required: true
					}],
					group: ['xHuntUserId', 'xHuntUser.id'],
					order: [[fn('COUNT', '*'), 'DESC']],
					raw: false
				});
				
				// 11.2 统计被打该标签的账号（按被评论次数排序）
				const kolTagReceivers = await XReviewForAccount.findAll({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag]
							}
						}))
					},
					attributes: [
						'xAccountId',
						[fn('COUNT', '*'), 'receivedTagCount']
					],
					include: [{
						model: XAccount,
						as: 'xAccount',
						attributes: ['handle', 'displayName', 'avatar'],
						required: true
					}],
					group: ['xAccountId', 'xAccount.id'],
					order: [[fn('COUNT', '*'), 'DESC']],
					raw: false
				});
				
				// 11.3 统计今日该标签的使用情况
				const todayKolTagUsage = await XReviewForAccount.count({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag]
							}
						})),
						createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd }
					}
				});
				
				// 11.4 统计该标签的总使用次数
				const totalKolTagUsage = await XReviewForAccount.count({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag]
							}
						}))
					}
				});
				
				// 11.5 统计使用该标签的独立用户数
				const uniqueKolTagUsers = await XReviewForAccount.count({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag]
							}
						}))
					},
					distinct: true,
					col: 'xHuntUserId'
				});
				
				// 11.6 统计被打该标签的独立账号数
				const uniqueKolTagAccounts = await XReviewForAccount.count({
					where: {
						[Op.or]: targetTags.map(tag => ({
							tags: {
								[Op.contains]: [tag]
							}
						}))
					},
					distinct: true,
					col: 'xAccountId'
				});
				
				return {
					targetTags,
					reviewers: kolTagReviewers.map(item => ({
						userId: item.xHuntUserId,
						username: item.xHuntUser?.username,
						displayName: item.xHuntUser?.displayName,
						avatar: item.xHuntUser?.avatar,
						kolRank20W: item.xHuntUser?.kolRank20W,
						classification: item.xHuntUser?.classification,
						tagUsageCount: parseInt(item.get('tagUsageCount')),
						isKOL: item.xHuntUser?.kolRank20W !== null
					})),
					receivers: kolTagReceivers.map(item => ({
						accountId: item.xAccountId,
						handle: item.xAccount?.handle,
						displayName: item.xAccount?.displayName,
						avatar: item.xAccount?.avatar,
						receivedTagCount: parseInt(item.get('receivedTagCount'))
					})),
					stats: {
						todayUsage: todayKolTagUsage,
						totalUsage: totalKolTagUsage,
						uniqueUsers: uniqueKolTagUsers,
						uniqueAccounts: uniqueKolTagAccounts
					}
				};
			} catch (error) {
				console.error('Error fetching KOL tag statistics:', error);
				return {
					targetTags: ['🔥有灵魂的KOL', '有灵魂的KOL'],
					reviewers: [],
					receivers: [],
					stats: {
						todayUsage: 0,
						totalUsage: 0,
						uniqueUsers: 0,
						uniqueAccounts: 0
					}
				};
			}
		})()
	]);

	// 构建统计数据
	return {
		// 核心指标（移除昨日对比）
		coreMetrics: {
			dailyActiveUsers: {
				value: todayActiveTokens
			},
			dailyReviews: {
				value: todayReviews
			},
			dailyReviewUsers: {
				value: todayReviewUsers
			},
			dailyNewUsers: {
				value: todayNewUsers
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
		
		// 用户活跃度分布（显示用户名）
		userDistribution: userActivityDistribution || [],
		
		// 🔥有灵魂的KOL 标签专业统计
		kolTagAnalytics: kolTagAnalytics || {
			targetTags: ['🔥有灵魂的KOL', '有灵魂的KOL'],
			reviewers: [],
			receivers: [],
			stats: {
				todayUsage: 0,
				totalUsage: 0,
				uniqueUsers: 0,
				uniqueAccounts: 0
			}
		}
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
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
		}),
		XHuntUser.count({
			where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } }
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
	// 导出时区相关函数用于测试
	getTodayStartChina,
	getTodayEndChina,
	getWeekStartChina,
	getMonthStartChina
};