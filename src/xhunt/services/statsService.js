const { Op, fn, col } = require("sequelize");
const {
  XHuntUser,
  XReviewForAccount,
  XAccount,
  XPointRecord,
  DailyActiveUser,
} = require("../../models/postgres-start");
const {
  getTodayStartChina,
  getTodayEndChina,
  getChinaDateString,
} = require("../utils/date");

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_ACTIVE_RANGE_DAYS = 30;
const MAX_ACTIVE_RANGE_DAYS = 366;

function isValidDateOnly(value) {
  if (!DATE_ONLY_PATTERN.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getInclusiveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function normalizeActiveDateRange(params = {}) {
  const today = getChinaDateString();
  let endDate = isValidDateOnly(params.endDate) ? params.endDate : today;
  let startDate = isValidDateOnly(params.startDate)
    ? params.startDate
    : addDays(endDate, -(DEFAULT_ACTIVE_RANGE_DAYS - 1));

  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  const selectedDays = getInclusiveDays(startDate, endDate);
  if (selectedDays > MAX_ACTIVE_RANGE_DAYS) {
    startDate = addDays(endDate, -(MAX_ACTIVE_RANGE_DAYS - 1));
  }

  return {
    startDate,
    endDate,
    days: getInclusiveDays(startDate, endDate),
    maxDays: MAX_ACTIVE_RANGE_DAYS,
  };
}

function eachDateInRange(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function getWeekStartDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function formatShortDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * 获取指定日期范围的日活数据（基于 PostgreSQL DailyActiveUsers 历史表）
 * @param {{startDate?: string, endDate?: string}} params
 * @returns {Promise<{range: object, data: Array}>}
 */
async function getDailyActiveUsers(params = {}) {
  const range = normalizeActiveDateRange(params);
  try {
    const rows = await DailyActiveUser.findAll({
      attributes: ["date", [fn("COUNT", col("userId")), "activeUsers"]],
      where: {
        date: { [Op.between]: [range.startDate, range.endDate] },
      },
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true,
    });

    const countByDate = new Map(
      rows.map((row) => [row.date, Number(row.activeUsers || 0)])
    );

    const data = eachDateInRange(range.startDate, range.endDate).map((date) => ({
      date,
      activeUsers: countByDate.get(date) || 0,
      displayDate: formatDisplayDate(date),
    }));

    return { range, data };
  } catch (error) {
    console.error("Error fetching daily active users:", error);
    const data = eachDateInRange(range.startDate, range.endDate).map((date) => ({
      date,
      activeUsers: 0,
      displayDate: formatDisplayDate(date),
    }));
    return { range, data };
  }
}

/**
 * 获取指定日期范围的周活数据：按自然周（周一到周日）汇总去重 userId。
 * 选择范围不是完整自然周时，只统计范围内实际覆盖的日期。
 * @param {{startDate?: string, endDate?: string}} params
 * @returns {Promise<Array>}
 */
async function getWeeklyActiveUsers(params = {}) {
  const range = normalizeActiveDateRange(params);
  try {
    const records = await DailyActiveUser.findAll({
      attributes: ["userId", "date"],
      where: {
        date: { [Op.between]: [range.startDate, range.endDate] },
      },
      order: [["date", "ASC"]],
      raw: true,
    });

    const usersByWeek = new Map();
    for (const record of records) {
      const weekStart = getWeekStartDate(record.date);
      if (!usersByWeek.has(weekStart)) {
        usersByWeek.set(weekStart, new Set());
      }
      usersByWeek.get(weekStart).add(record.userId);
    }

    const weeklyData = [];
    const firstWeekStart = getWeekStartDate(range.startDate);
    for (
      let weekStart = firstWeekStart;
      weekStart <= range.endDate;
      weekStart = addDays(weekStart, 7)
    ) {
      const weekEnd = addDays(weekStart, 6);
      weeklyData.push({
        weekStart,
        weekEnd,
        displayDate: `${formatShortDate(weekStart)}-${formatShortDate(weekEnd)}`,
        activeUsers: usersByWeek.get(weekStart)?.size || 0,
      });
    }

    return weeklyData;
  } catch (error) {
    console.error("Error fetching weekly active users:", error);
    return [];
  }
}

// 使用统一的时区处理函数，已从 utils/date.js 导入

/**
 * 获取中国时区的本周开始时间（北京时间周一 00:00:00 对应的 UTC）
 */
function getWeekStartChina() {
  // 获取当前时间
  const now = new Date();

  // 使用UTC方法计算北京时间（UTC+8）
  const utcHours = now.getUTCHours();
  const beijingHours = utcHours + 8;

  let beijingDate = new Date(now);
  if (beijingHours >= 24) {
    beijingDate.setUTCDate(beijingDate.getUTCDate() + 1);
    beijingDate.setUTCHours(beijingHours - 24);
  } else {
    beijingDate.setUTCHours(beijingHours);
  }

  const year = beijingDate.getUTCFullYear();
  const month = beijingDate.getUTCMonth();
  const day = beijingDate.getUTCDate();

  // 计算本周一的日期
  const dayOfWeek = beijingDate.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周日为0，需要回到上周一

  const beijingMondayStart = new Date(
    year,
    month,
    day + daysToMonday,
    0,
    0,
    0,
    0
  );

  // 计算UTC时间：北京时间减去8小时
  const utcMondayStart = new Date(
    beijingMondayStart.getTime() - 8 * 60 * 60 * 1000
  );
  return utcMondayStart;
}

/**
 * 获取中国时区的本月开始时间（北京时间1号 00:00:00 对应的 UTC）
 */
function getMonthStartChina() {
  // 获取当前时间
  const now = new Date();

  // 使用UTC方法计算北京时间（UTC+8）
  const utcHours = now.getUTCHours();
  const beijingHours = utcHours + 8;

  let beijingDate = new Date(now);
  if (beijingHours >= 24) {
    beijingDate.setUTCDate(beijingDate.getUTCDate() + 1);
    beijingDate.setUTCHours(beijingHours - 24);
  } else {
    beijingDate.setUTCHours(beijingHours);
  }

  const year = beijingDate.getUTCFullYear();
  const month = beijingDate.getUTCMonth();

  // 设置为北京时间本月1日 00:00:00
  const beijingMonthStart = new Date(year, month, 1, 0, 0, 0, 0);

  // 计算UTC时间：北京时间减去8小时
  const utcMonthStart = new Date(
    beijingMonthStart.getTime() - 8 * 60 * 60 * 1000
  );
  return utcMonthStart;
}

/**
 * 获取完整的统计数据
 * @param {Object} redisClient - Redis客户端实例（可选）
 * @param {{startDate?: string, endDate?: string}} activeRangeParams - 活跃数据日期范围
 */
async function getFullStats(redisClient = null, activeRangeParams = {}) {
  // 使用中国时区的时间范围
  const todayStart = getTodayStartChina();
  const todayEnd = getTodayEndChina();
  const weekStart = getWeekStartChina();
  const monthStart = getMonthStartChina();
  const todayDate = getChinaDateString();
  const currentWeekStartDate = getWeekStartDate(todayDate);

  // 获取基于 DailyActiveUsers 历史表的日活 / 周活数据。
  // 之前首页只展示 7 天，是因为读的是 Redis dau:* 临时集合且只保留 8 天；
  // 这里改为读取 PostgreSQL，才能覆盖历史数据并支持自定义日期范围。
  const dailyActiveUsersResult = await getDailyActiveUsers(activeRangeParams);
  const dailyActiveUsersData = dailyActiveUsersResult.data;
  const weeklyActiveUsersData = await getWeeklyActiveUsers(dailyActiveUsersResult.range);

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
    weeklyActiveUsers,

    // 7. KOL用户统计
    totalKOLUsers,
    todayKOLReviews,

    // 7.1 KOL按排名分档统计
    kolWithin200k,
    kolWithin50k,
    kolWithin20k,
    kolWithin5k,

    // 8. 平均评分统计
    averageRating,

    // 9. 热门标签统计
    popularTags,

    // 10. 用户活跃度分布（修复SQL查询）
    userActivityDistribution,

    // // 11. 🔥有灵魂的KOL 标签专业统计
    // kolTagAnalytics,
    //
    // // 12. 特定用户统计
    // specificUsersAnalytics,
    //
    // // 13. 🆕 设备指纹重复分析
    // fingerprintDuplicateAnalysis
  ] = await Promise.all([
    // 1. 日活统计（中国时区）
    DailyActiveUser.count({
      where: {
        date: todayDate,
      },
    }),

    // 2. 评论统计（中国时区）
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
      distinct: true,
      col: "xHuntUserId",
    }),

    // 3. 用户注册统计（中国时区）
    XHuntUser.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),
    XHuntUser.count(),

    // 4. 账号统计（中国时区）
    XAccount.count(),
    XAccount.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),

    // 5. 积分统计（中国时区）
    XPointRecord.sum("points", {
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),
    XPointRecord.sum("points"),

    // 6. 周/月统计（中国时区）
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: weekStart } },
    }),
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: monthStart } },
    }),
    XHuntUser.count({
      where: { createdAt: { [Op.gte]: weekStart } },
    }),
    XHuntUser.count({
      where: { createdAt: { [Op.gte]: monthStart } },
    }),
    DailyActiveUser.count({
      where: {
        date: { [Op.gte]: currentWeekStartDate, [Op.lte]: todayDate },
      },
      distinct: true,
      col: "userId",
    }),

    // 7. KOL用户统计（中国时区）
    XHuntUser.count({
      where: { kolRank20W: { [Op.ne]: null } },
    }),
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
      include: [
        {
          model: XHuntUser,
          as: "xHuntUser",
          where: { kolRank20W: { [Op.ne]: null } },
          required: true,
        },
      ],
    }),

    // 7.1 KOL按排名分档统计（基于 kolRank20W 数值越小排名越高）
    XHuntUser.count({
      where: { kolRank20W: { [Op.ne]: null, [Op.lte]: 200000 } },
    }),
    XHuntUser.count({
      where: { kolRank20W: { [Op.ne]: null, [Op.lte]: 50000 } },
    }),
    XHuntUser.count({
      where: { kolRank20W: { [Op.ne]: null, [Op.lte]: 20000 } },
    }),
    XHuntUser.count({
      where: { kolRank20W: { [Op.ne]: null, [Op.lte]: 5000 } },
    }),

    // 8. 平均评分
    XReviewForAccount.findOne({
      attributes: [[fn("AVG", col("rating")), "avgRating"]],
      raw: true,
    }),

    // 9. 热门标签（前10个） - 已注释
    // XReviewForAccount.findAll({
    //   attributes: [
    //     [fn("unnest", col("tags")), "tag"],
    //     [fn("COUNT", "*"), "count"],
    //   ],
    //   group: [fn("unnest", col("tags"))],
    //   order: [[fn("COUNT", "*"), "DESC"]],
    //   limit: 10,
    //   raw: true,
    // }),
    Promise.resolve([]), // 返回空数组

    // 10. 修复用户活跃度分布查询 - 已注释
    // 使用两步查询来避免复杂的子查询问题
    // (async () => {
    //   try {
    //     // 先获取有评论的用户ID和评论数量
    //     const userReviewCounts = await XReviewForAccount.findAll({
    //       attributes: ["xHuntUserId", [fn("COUNT", "*"), "reviewCount"]],
    //       group: ["xHuntUserId"],
    //       order: [[fn("COUNT", "*"), "DESC"]],
    //       limit: 20,
    //       raw: true,
    //     });

    //     // 如果没有评论数据，返回空数组
    //     if (!userReviewCounts || userReviewCounts.length === 0) {
    //       return [];
    //     }

    //     // 获取用户ID列表
    //     const userIds = userReviewCounts.map((item) => item.xHuntUserId);

    //     // 再查询用户详细信息
    //     const users = await XHuntUser.findAll({
    //       where: {
    //         id: { [Op.in]: userIds },
    //       },
    //       attributes: [
    //         "id",
    //         "username",
    //         "displayName",
    //         "kolRank20W",
    //         "classification",
    //       ],
    //       raw: true,
    //     });

    //     // 合并数据
    //     const result = userReviewCounts.map((reviewData) => {
    //       const user = users.find((u) => u.id === reviewData.xHuntUserId);
    //       return {
    //         id: user?.id || reviewData.xHuntUserId,
    //         username: user?.username || null,
    //         displayName: user?.displayName || null,
    //         kolRank20W: user?.kolRank20W || null,
    //         classification: user?.classification || null,
    //         reviewCount: parseInt(reviewData.reviewCount),
    //       };
    //     });

    //     return result;
    //   } catch (error) {
    //     console.error("Error fetching user activity distribution:", error);
    //     return []; // 返回空数组而不是抛出错误
    //   }
    // })(),
    Promise.resolve([]), // 返回空数组

    // // 11. 🔥有灵魂的KOL 标签专业统计
    // (async () => {
    // 	try {
    // 		const targetTags = ['🔥有灵魂的KOL', '有灵魂的KOL']; // 支持两种标签
    //
    // 		// 11.1 统计使用该标签的评论者（按评论次数排序）
    // 		const kolTagReviewers = await XReviewForAccount.findAll({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag] // PostgreSQL 数组包含查询
    // 					}
    // 				}))
    // 			},
    // 			attributes: [
    // 				'xHuntUserId',
    // 				[fn('COUNT', '*'), 'tagUsageCount']
    // 			],
    // 			include: [{
    // 				model: XHuntUser,
    // 				as: 'xHuntUser',
    // 				attributes: ['username', 'displayName', 'avatar', 'kolRank20W', 'classification'],
    // 				required: true
    // 			}],
    // 			group: ['xHuntUserId', 'xHuntUser.id'],
    // 			order: [[fn('COUNT', '*'), 'DESC']],
    // 			raw: false
    // 		});
    //
    // 		// 11.2 统计被打该标签的账号（按被评论次数排序）
    // 		const kolTagReceivers = await XReviewForAccount.findAll({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag]
    // 					}
    // 				}))
    // 			},
    // 			attributes: [
    // 				'xAccountId',
    // 				[fn('COUNT', '*'), 'receivedTagCount']
    // 			],
    // 			include: [{
    // 				model: XAccount,
    // 				as: 'xAccount',
    // 				attributes: ['handle', 'displayName', 'avatar'],
    // 				required: true
    // 			}],
    // 			group: ['xAccountId', 'xAccount.id'],
    // 			order: [[fn('COUNT', '*'), 'DESC']],
    // 			raw: false
    // 		});
    //
    // 		// 11.3 统计今日该标签的使用情况
    // 		const todayKolTagUsage = await XReviewForAccount.count({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag]
    // 					}
    // 				})),
    // 				createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd }
    // 			}
    // 		});
    //
    // 		// 11.4 统计该标签的总使用次数
    // 		const totalKolTagUsage = await XReviewForAccount.count({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag]
    // 					}
    // 				}))
    // 			}
    // 		});
    //
    // 		// 11.5 统计使用该标签的独立用户数
    // 		const uniqueKolTagUsers = await XReviewForAccount.count({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag]
    // 					}
    // 				}))
    // 			},
    // 			distinct: true,
    // 			col: 'xHuntUserId'
    // 		});
    //
    // 		// 11.6 统计被打该标签的独立账号数
    // 		const uniqueKolTagAccounts = await XReviewForAccount.count({
    // 			where: {
    // 				[Op.or]: targetTags.map(tag => ({
    // 					tags: {
    // 						[Op.contains]: [tag]
    // 					}
    // 				}))
    // 			},
    // 			distinct: true,
    // 			col: 'xAccountId'
    // 		});
    //
    // 		return {
    // 			targetTags,
    // 			reviewers: kolTagReviewers.map(item => ({
    // 				userId: item.xHuntUserId,
    // 				username: item.xHuntUser?.username,
    // 				displayName: item.xHuntUser?.displayName,
    // 				avatar: item.xHuntUser?.avatar,
    // 				kolRank20W: item.xHuntUser?.kolRank20W,
    // 				classification: item.xHuntUser?.classification,
    // 				tagUsageCount: parseInt(item.get('tagUsageCount')),
    // 				isKOL: item.xHuntUser?.kolRank20W !== null
    // 			})),
    // 			receivers: kolTagReceivers.map(item => ({
    // 				accountId: item.xAccountId,
    // 				handle: item.xAccount?.handle,
    // 				displayName: item.xAccount?.displayName,
    // 				avatar: item.xAccount?.avatar,
    // 				receivedTagCount: parseInt(item.get('receivedTagCount'))
    // 			})),
    // 			stats: {
    // 				todayUsage: todayKolTagUsage,
    // 				totalUsage: totalKolTagUsage,
    // 				uniqueUsers: uniqueKolTagUsers,
    // 				uniqueAccounts: uniqueKolTagAccounts
    // 			}
    // 		};
    // 	} catch (error) {
    // 		console.error('Error fetching KOL tag statistics:', error);
    // 		return {
    // 			targetTags: ['🔥有灵魂的KOL', '有灵魂的KOL'],
    // 			reviewers: [],
    // 			receivers: [],
    // 			stats: {
    // 				todayUsage: 0,
    // 				totalUsage: 0,
    // 				uniqueUsers: 0,
    // 				uniqueAccounts: 0
    // 			}
    // 		};
    // 	}
    // })(),
    //
    // // 12. 特定用户统计
    // (async () => {
    // 	try {
    // 		// 目标用户列表（数据库中没有@符号）
    // 		const targetUsernames = [
    // 			'0x0xFeng', 'BTW0205', 'Alvin0617', 'DtDt666', 'BroLeonAus',
    // 			'Paris13Jeanne', 'momochenming', 'zohanlin', 'qqzsss', 'tmel0211'
    // 		];
    //
    // 		// 12.1 查找目标用户的账号ID
    // 		const targetAccounts = await XAccount.findAll({
    // 			where: {
    // 				handle: {
    // 					[Op.in]: targetUsernames.map(username => username.toLowerCase())
    // 				}
    // 			},
    // 			attributes: ['id', 'handle', 'displayName']
    // 		});
    //
    // 		const targetAccountIds = targetAccounts.map(account => account.id);
    //
    // 		if (targetAccountIds.length === 0) {
    // 			return {
    // 				targetUsernames,
    // 				reviewers: [],
    // 				receivers: [],
    // 				stats: {
    // 					todayReviews: 0,
    // 					totalReviews: 0,
    // 					uniqueReviewers: 0,
    // 					targetUsersFound: 0
    // 				}
    // 			};
    // 		}
    //
    // 		// 12.2 统计评论过这些用户的人（按评论次数排序）
    // 		const specificUsersReviewers = await XReviewForAccount.findAll({
    // 			where: {
    // 				xAccountId: { [Op.in]: targetAccountIds }
    // 			},
    // 			attributes: [
    // 				'xHuntUserId',
    // 				[fn('COUNT', '*'), 'reviewCount']
    // 			],
    // 			include: [{
    // 				model: XHuntUser,
    // 				as: 'xHuntUser',
    // 				attributes: ['username', 'displayName', 'avatar', 'kolRank20W', 'classification'],
    // 				required: true
    // 			}],
    // 			group: ['xHuntUserId', 'xHuntUser.id'],
    // 			order: [[fn('COUNT', '*'), 'DESC']],
    // 			raw: false
    // 		});
    //
    // 		// 12.3 统计这些特定用户被评论的情况
    // 		const specificUsersReceivers = await XReviewForAccount.findAll({
    // 			where: {
    // 				xAccountId: { [Op.in]: targetAccountIds }
    // 			},
    // 			attributes: [
    // 				'xAccountId',
    // 				[fn('COUNT', '*'), 'reviewCount']
    // 			],
    // 			include: [{
    // 				model: XAccount,
    // 				as: 'xAccount',
    // 				attributes: ['handle', 'displayName', 'avatar'],
    // 				required: true
    // 			}],
    // 			group: ['xAccountId', 'xAccount.id'],
    // 			order: [[fn('COUNT', '*'), 'DESC']],
    // 			raw: false
    // 		});
    //
    // 		// 12.4 统计今日对这些用户的评论数
    // 		const todaySpecificReviews = await XReviewForAccount.count({
    // 			where: {
    // 				xAccountId: { [Op.in]: targetAccountIds },
    // 				createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd }
    // 			}
    // 		});
    //
    // 		// 12.5 统计总评论数
    // 		const totalSpecificReviews = await XReviewForAccount.count({
    // 			where: {
    // 				xAccountId: { [Op.in]: targetAccountIds }
    // 			}
    // 		});
    //
    // 		// 12.6 统计参与评论的独立用户数
    // 		const uniqueSpecificReviewers = await XReviewForAccount.count({
    // 			where: {
    // 				xAccountId: { [Op.in]: targetAccountIds }
    // 			},
    // 			distinct: true,
    // 			col: 'xHuntUserId'
    // 		});
    //
    // 		return {
    // 			targetUsernames,
    // 			reviewers: specificUsersReviewers.map(item => ({
    // 				userId: item.xHuntUserId,
    // 				username: item.xHuntUser?.username,
    // 				displayName: item.xHuntUser?.displayName,
    // 				avatar: item.xHuntUser?.avatar,
    // 				kolRank20W: item.xHuntUser?.kolRank20W,
    // 				classification: item.xHuntUser?.classification,
    // 				reviewCount: parseInt(item.get('reviewCount')),
    // 				isKOL: item.xHuntUser?.kolRank20W !== null
    // 			})),
    // 			receivers: specificUsersReceivers.map(item => ({
    // 				accountId: item.xAccountId,
    // 				handle: item.xAccount?.handle,
    // 				displayName: item.xAccount?.displayName,
    // 				avatar: item.xAccount?.avatar,
    // 				reviewCount: parseInt(item.get('reviewCount'))
    // 			})),
    // 			stats: {
    // 				todayReviews: todaySpecificReviews,
    // 				totalReviews: totalSpecificReviews,
    // 				uniqueReviewers: uniqueSpecificReviewers,
    // 				targetUsersFound: targetAccounts.length
    // 			}
    // 		};
    // 	} catch (error) {
    // 		console.error('Error fetching specific users statistics:', error);
    // 		return {
    // 			targetUsernames: ['0x0xFeng', 'BTW0205', 'Alvin0617', 'DtDt666', 'BroLeonAus', 'Paris13Jeanne', 'momochenming', 'zohanlin', 'qqzsss', 'tmel0211'],
    // 			reviewers: [],
    // 			receivers: [],
    // 			stats: {
    // 				todayReviews: 0,
    // 				totalReviews: 0,
    // 				uniqueReviewers: 0,
    // 				targetUsersFound: 0
    // 			}
    // 		};
    // 	}
    // })(),

    // // 13. 🆕 设备指纹重复分析
    // (async () => {
    // 	try {
    // 		// Step 1: 获取所有有效token，按创建时间降序
    // 		const allTokens = await XHuntUserToken.findAll({
    // 			where: {
    // 				fingerprint: { [Op.ne]: null },
    // 				isRevoked: false
    // 			},
    // 			attributes: ['userId', 'fingerprint', 'createdAt'],
    // 			order: [['createdAt', 'DESC']],
    // 			raw: true
    // 		});
    //
    // 		// Step 2: 每个用户只保留最新的指纹
    // 		const userLatestFingerprints = new Map();
    // 		allTokens.forEach(token => {
    // 			if (!userLatestFingerprints.has(token.userId)) {
    // 				userLatestFingerprints.set(token.userId, token.fingerprint);
    // 			}
    // 		});
    //
    // 		// Step 3: 统计指纹出现次数
    // 		const fingerprintCounts = new Map();
    // 		userLatestFingerprints.forEach(fingerprint => {
    // 			fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) || 0) + 1);
    // 		});
    //
    // 		// Step 4: 找出重复的指纹（出现次数 > 1）
    // 		const duplicateFingerprints = [];
    // 		fingerprintCounts.forEach((count, fingerprint) => {
    // 			if (count > 1) {
    // 				duplicateFingerprints.push({
    // 					fingerprint: fingerprint.substring(0, 8) + '...', // 只显示前8位
    // 					count: count
    // 				});
    // 			}
    // 		});
    //
    // 		// Step 5: 计算统计数据
    // 		const totalFingerprints = fingerprintCounts.size; // 总指纹数（去重后）
    // 		const duplicateCount = duplicateFingerprints.length; // 重复指纹数量
    // 		const duplicateRate = totalFingerprints > 0 ? (duplicateCount / totalFingerprints * 100) : 0;
    //
    // 		// Step 6: 按重复次数排序，取TOP 10
    // 		const topDuplicates = duplicateFingerprints
    // 			.sort((a, b) => b.count - a.count)
    // 			.slice(0, 10);
    //
    // 		return {
    // 			totalFingerprints,
    // 			duplicateCount,
    // 			duplicateRate: Number(duplicateRate.toFixed(2)),
    // 			topDuplicates
    // 		};
    // 	} catch (error) {
    // 		console.error('Error fetching fingerprint duplicate analysis:', error);
    // 		return {
    // 			totalFingerprints: 0,
    // 			duplicateCount: 0,
    // 			duplicateRate: 0,
    // 			topDuplicates: []
    // 		};
    // 	}
    // })(),
  ]);

  // 构建统计数据
  return {
    // 核心指标（移除昨日对比）
    coreMetrics: {
      dailyActiveUsers: {
        value: todayActiveTokens,
      },
      dailyReviews: {
        value: todayReviews,
      },
      dailyReviewUsers: {
        value: todayReviewUsers,
      },
      dailyNewUsers: {
        value: todayNewUsers,
      },
    },

    // 累计数据
    totalMetrics: {
      totalUsers,
      totalAccounts,
      totalKOLUsers,
      kolBuckets: {
        within200k: kolWithin200k,
        within50k: kolWithin50k,
        within20k: kolWithin20k,
        within5k: kolWithin5k,
      },
      totalPointsAwarded: totalPointsAwarded || 0,
      averageRating: Number(averageRating?.avgRating || 0).toFixed(2),
    },

    // 周期统计
    periodMetrics: {
      weekly: {
        reviews: weeklyReviews,
        newUsers: weeklyNewUsers,
        activeUsers: weeklyActiveUsers,
      },
      monthly: {
        reviews: monthlyReviews,
        newUsers: monthlyNewUsers,
      },
    },

    // 今日详细数据
    todayDetails: {
      newAccounts: todayNewAccounts,
      pointsAwarded: todayPointsAwarded || 0,
      kolReviews: todayKOLReviews,
    },

    // 热门标签
    popularTags: popularTags.map((tag) => ({
      name: tag.tag,
      count: parseInt(tag.count),
    })),

    // 用户活跃度分布（显示用户名）
    userDistribution: userActivityDistribution || [],

    // 🔥有灵魂的KOL 标签专业统计
    kolTagAnalytics: {
      targetTags: ["🔥有灵魂的KOL", "有灵魂的KOL"],
      reviewers: [],
      receivers: [],
      stats: {
        todayUsage: 0,
        totalUsage: 0,
        uniqueUsers: 0,
        uniqueAccounts: 0,
      },
    },

    // 特定用户统计
    specificUsersAnalytics: {
      targetUsernames: [
        "0x0xFeng",
        "BTW0205",
        "Alvin0617",
        "DtDt666",
        "BroLeonAus",
        "Paris13Jeanne",
        "momochenming",
        "zohanlin",
        "qqzsss",
        "tmel0211",
      ],
      reviewers: [],
      receivers: [],
      stats: {
        todayReviews: 0,
        totalReviews: 0,
        uniqueReviewers: 0,
        targetUsersFound: 0,
      },
    },

    // 基于 DailyActiveUsers 表的活跃身份统计
    activeUsersRange: dailyActiveUsersResult.range,
    dailyActiveUsersData: dailyActiveUsersData || [],
    weeklyActiveUsersData: weeklyActiveUsersData || [],

    // 🆕 设备指纹重复分析
    fingerprintDuplicateAnalysis: {
      totalFingerprints: 0,
      duplicateCount: 0,
      duplicateRate: 0,
      topDuplicates: [],
    },
  };
}

/**
 * 获取简化的统计数据（用于 JSON API）
 */
async function getSimpleStats() {
  const todayStart = getTodayStartChina();
  const todayEnd = getTodayEndChina();
  const todayDate = getChinaDateString();

  const [
    todayActiveTokens,
    todayReviews,
    todayNewUsers,
    totalUsers,
    totalAccounts,
  ] = await Promise.all([
    DailyActiveUser.count({
      where: {
        date: todayDate,
      },
    }),
    XReviewForAccount.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),
    XHuntUser.count({
      where: { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
    }),
    XHuntUser.count(),
    XAccount.count(),
  ]);

  return {
    dailyActiveUsers: todayActiveTokens,
    dailyReviews: todayReviews,
    dailyNewUsers: todayNewUsers,
    totalUsers,
    totalAccounts,
    timezone: "Asia/Shanghai (UTC+8)",
    chinaTime: new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    }),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getFullStats,
  getSimpleStats,
  // 导出时区相关函数用于测试
  getTodayStartChina,
  getTodayEndChina,
  getWeekStartChina,
  getMonthStartChina,
};
