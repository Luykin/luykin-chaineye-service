const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const { XHuntUser, XHuntUserToken, XReviewForAccount, XAccount, XPointRecord } = require('../../models/postgres-start');

const router = express.Router();

/**
 * 基础认证中间件
 * 最简单的用户名密码验证
 */
function basicAuth(req, res, next) {
	// 从环境变量获取认证信息，如果没有则使用默认值
	const STATS_USERNAME = process.env.STATS_USERNAME || 'admin';
	const STATS_PASSWORD = process.env.STATS_PASSWORD || 'xhunt2024';
	
	const authHeader = req.headers.authorization;
	
	if (!authHeader || !authHeader.startsWith('Basic ')) {
		// 返回401状态码，浏览器会自动弹出登录框
		res.setHeader('WWW-Authenticate', 'Basic realm="XHunt Stats"');
		return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>需要认证</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>🔐 访问受限</h2>
				<p>请输入用户名和密码访问统计页面</p>
				<p style="color: #666; font-size: 14px;">默认账号: admin / xhunt2024</p>
			</body>
			</html>
		`);
	}
	
	// 解码 Base64 编码的用户名密码
	const base64Credentials = authHeader.split(' ')[1];
	const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
	const [username, password] = credentials.split(':');
	
	// 验证用户名密码
	if (username === STATS_USERNAME && password === STATS_PASSWORD) {
		next(); // 认证成功，继续处理请求
	} else {
		// 认证失败
		res.setHeader('WWW-Authenticate', 'Basic realm="XHunt Stats"');
		return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>认证失败</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>❌ 认证失败</h2>
				<p>用户名或密码错误，请重试</p>
				<button onclick="window.location.reload()">重新登录</button>
			</body>
			</html>
		`);
	}
}

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
	const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // 调整为周一开始
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
 * GET /stats
 * 获取产品数据统计（需要认证）
 */
router.get('/', basicAuth, async (req, res) => {
	try {
		const todayStart = getTodayStart();
		const yesterdayStart = getYesterdayStart();
		const weekStart = getWeekStart();
		const monthStart = getMonthStart();

		// 并行执行所有统计查询
		const [
			// 1. 日活统计（今日活跃的token数量）
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
			userActivityDistribution
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
			})
		]);

		// 计算增长率
		const dailyActiveGrowth = calculateGrowthRate(todayActiveTokens, yesterdayActiveTokens);
		const dailyReviewsGrowth = calculateGrowthRate(todayReviews, yesterdayReviews);
		const dailyUsersGrowth = calculateGrowthRate(todayNewUsers, yesterdayNewUsers);
		const dailyReviewUsersGrowth = calculateGrowthRate(todayReviewUsers, yesterdayReviewUsers);

		// 构建统计数据
		const stats = {
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

		// 生成HTML响应
		const html = generateStatsHTML(stats);
		
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(html);

	} catch (error) {
		console.error('Error fetching stats:', error);
		res.status(500).json({ error: '获取统计数据失败' });
	}
});

/**
 * 生成统计数据的HTML页面
 */
function generateStatsHTML(stats) {
	const { coreMetrics, totalMetrics, periodMetrics, todayDetails, popularTags, userDistribution } = stats;
	
	return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XHunt 数据统计</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .auth-info {
            background: rgba(255,255,255,0.1);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
            backdrop-filter: blur(10px);
        }
        
        .logout-btn {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin-left: 10px;
            transition: all 0.3s ease;
        }
        
        .logout-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0,0,0,0.15);
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .stat-title {
            font-size: 0.9rem;
            color: #6b7280;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .stat-growth {
            display: flex;
            align-items: center;
            font-size: 0.85rem;
            font-weight: 500;
        }
        
        .growth-positive {
            color: #10b981;
        }
        
        .growth-negative {
            color: #ef4444;
        }
        
        .growth-neutral {
            color: #6b7280;
        }
        
        .section {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 20px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 10px;
        }
        
        .tags-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
        }
        
        .tag-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #f9fafb;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        
        .tag-name {
            font-weight: 600;
            color: #374151;
        }
        
        .tag-count {
            background: #667eea;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        
        .distribution-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
        }
        
        .distribution-item {
            padding: 16px;
            background: #f9fafb;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
        }
        
        .distribution-rank {
            font-weight: 700;
            color: #667eea;
            margin-bottom: 8px;
        }
        
        .distribution-stats {
            display: flex;
            justify-content: space-between;
            font-size: 0.9rem;
            color: #6b7280;
        }
        
        .refresh-info {
            text-align: center;
            color: white;
            margin-top: 20px;
            opacity: 0.8;
        }
        
        .icon {
            width: 24px;
            height: 24px;
            margin-right: 8px;
        }
        
        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .stat-value {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="auth-info">
            🔐 已认证访问 - 统计数据面板
            <button class="logout-btn" onclick="logout()">退出登录</button>
        </div>
        
        <div class="header">
            <h1>📊 XHunt 数据统计</h1>
            <p>实时产品数据监控面板 - ${new Date().toLocaleString('zh-CN')}</p>
        </div>
        
        <!-- 核心指标 -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">📱 日活用户(已登录X)</span>
                </div>
                <div class="stat-value">${coreMetrics.dailyActiveUsers.value.toLocaleString()}</div>
                <div class="stat-growth ${getGrowthClass(coreMetrics.dailyActiveUsers.growth)}">
                    ${getGrowthIcon(coreMetrics.dailyActiveUsers.growth)} ${coreMetrics.dailyActiveUsers.growth}% vs 昨日 (${coreMetrics.dailyActiveUsers.yesterday})
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">💬 今日评论</span>
                </div>
                <div class="stat-value">${coreMetrics.dailyReviews.value.toLocaleString()}</div>
                <div class="stat-growth ${getGrowthClass(coreMetrics.dailyReviews.growth)}">
                    ${getGrowthIcon(coreMetrics.dailyReviews.growth)} ${coreMetrics.dailyReviews.growth}% vs 昨日 (${coreMetrics.dailyReviews.yesterday})
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">👥 评论用户</span>
                </div>
                <div class="stat-value">${coreMetrics.dailyReviewUsers.value.toLocaleString()}</div>
                <div class="stat-growth ${getGrowthClass(coreMetrics.dailyReviewUsers.growth)}">
                    ${getGrowthIcon(coreMetrics.dailyReviewUsers.growth)} ${coreMetrics.dailyReviewUsers.growth}% vs 昨日 (${coreMetrics.dailyReviewUsers.yesterday})
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">🆕 新注册用户(已登录X)</span>
                </div>
                <div class="stat-value">${coreMetrics.dailyNewUsers.value.toLocaleString()}</div>
                <div class="stat-growth ${getGrowthClass(coreMetrics.dailyNewUsers.growth)}">
                    ${getGrowthIcon(coreMetrics.dailyNewUsers.growth)} ${coreMetrics.dailyNewUsers.growth}% vs 昨日 (${coreMetrics.dailyNewUsers.yesterday})
                </div>
            </div>
        </div>
        
        <!-- 累计数据 -->
        <div class="section">
            <h2 class="section-title">📈 累计数据</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-title">总用户数</div>
                    <div class="stat-value">${totalMetrics.totalUsers.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">总账号数</div>
                    <div class="stat-value">${totalMetrics.totalAccounts.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">KOL 用户数</div>
                    <div class="stat-value">${totalMetrics.totalKOLUsers.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">累计积分</div>
                    <div class="stat-value">${totalMetrics.totalPointsAwarded.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">平均评分</div>
                    <div class="stat-value">${totalMetrics.averageRating} ⭐</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">今日积分</div>
                    <div class="stat-value">${todayDetails.pointsAwarded.toLocaleString()}</div>
                </div>
            </div>
        </div>
        
        <!-- 周期统计 -->
        <div class="section">
            <h2 class="section-title">📅 周期统计</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-title">本周评论</div>
                    <div class="stat-value">${periodMetrics.weekly.reviews.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">本周新用户</div>
                    <div class="stat-value">${periodMetrics.weekly.newUsers.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">本月评论</div>
                    <div class="stat-value">${periodMetrics.monthly.reviews.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">本月新用户</div>
                    <div class="stat-value">${periodMetrics.monthly.newUsers.toLocaleString()}</div>
                </div>
            </div>
        </div>
        
        <!-- 热门标签 -->
        <div class="section">
            <h2 class="section-title">🏷️ 热门标签 TOP 10</h2>
            <div class="tags-grid">
                ${popularTags.map(tag => `
                    <div class="tag-item">
                        <span class="tag-name">${tag.name}</span>
                        <span class="tag-count">${tag.count}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- 用户分布 -->
        <div class="section">
            <h2 class="section-title">👑 用户活跃度分布</h2>
            <div class="distribution-grid">
                ${userDistribution.slice(0, 8).map(item => `
                    <div class="distribution-item">
                        <div class="distribution-rank">${item.kolRank === 'Non-KOL' ? '普通用户' : `KOL排名: ${item.kolRank}`}</div>
                        <div class="distribution-stats">
                            <span>用户数: ${item.userCount}</span>
                            <span>评论数: ${item.reviewCount}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="refresh-info">
            <p>🔄 数据每次访问时实时更新 | ⏰ 最后更新: ${new Date().toLocaleString('zh-CN')}</p>
        </div>
    </div>
    
    <script>
        // 自动刷新页面（每5分钟）
        setTimeout(() => {
            window.location.reload();
        }, 5 * 60 * 1000);
        
        // 退出登录功能
        function logout() {
            // 发送一个带有错误认证信息的请求来清除浏览器的认证缓存
            fetch(window.location.href, {
                method: 'GET',
                headers: {
                    'Authorization': 'Basic ' + btoa('logout:logout')
                }
            }).then(() => {
                // 清除认证后重新加载页面
                window.location.reload();
            }).catch(() => {
                // 即使请求失败也重新加载页面
                window.location.reload();
            });
        }
    </script>
</body>
</html>
    `;
}

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
 * GET /stats/json
 * 获取JSON格式的统计数据（用于API调用，也需要认证）
 */
router.get('/json', basicAuth, async (req, res) => {
	try {
		const todayStart = getTodayStart();
		const yesterdayStart = getYesterdayStart();

		// 简化的统计查询
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

		res.json({
			success: true,
			data: {
				dailyActiveUsers: todayActiveTokens,
				dailyReviews: todayReviews,
				dailyNewUsers: todayNewUsers,
				totalUsers,
				totalAccounts,
				timestamp: new Date().toISOString()
			}
		});

	} catch (error) {
		console.error('Error fetching JSON stats:', error);
		res.status(500).json({
			success: false,
			error: '获取统计数据失败'
		});
	}
});

/**
 * GET /health
 * 健康检查接口（无需认证）
 */
router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		service: 'xhunt-stats-api'
	});
});

module.exports = router;
