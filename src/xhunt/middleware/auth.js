const jwt = require('jsonwebtoken');
const { XHuntUserToken, XHuntUser } = require('../../models/postgres-start');

async function authenticateToken(req, res, next) {
	try {
		const authHeader = req.headers['authorization'];
		const token = authHeader && authHeader.split(' ')[1];
		
		if (!token) {
			return res.status(401).json({ error: 'TOKEN_REQUIRED' });
		}
		
		// 验证 JWT
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		// 从数据库查找对应的令牌记录
		const tokenRecord = await XHuntUserToken.findOne({
			where: {
				id: decoded.tokenId,
				isRevoked: false
			},
			include: [{
				model: XHuntUser,
				as: 'user' // 确保与模型关联的 `as` 别名一致
			}]
		});
		if (!tokenRecord) {
			return res.status(419).json({ error: 'TOKEN_INVALID' });
		}
		
		// 检查令牌是否过期
		if (tokenRecord.tokenExpiry <= new Date()) {
			return res.status(419).json({ error: 'TOKEN_EXPIRED' });
		}
		
		// 更新最后使用时间
		await tokenRecord.update({ lastUsed: new Date() });
		
		// 将用户信息添加到请求对象
		req.user = tokenRecord.user;
		req.tokenRecord = tokenRecord;
		
		next();
	} catch (error) {
		if (error.name === 'JsonWebTokenError') {
			return res.status(419).json({ error: 'TOKEN_INVALID' });
		}
		if (error.name === 'TokenExpiredError') {
			return res.status(419).json({ error: 'TOKEN_EXPIRED' });
		}
		console.error('Auth middleware error:', error);
		res.status(500).json({ error: '认证失败' });
	}
}

module.exports = {
	authenticateToken
};
