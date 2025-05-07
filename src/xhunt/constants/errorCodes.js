/**
 * 错误码定义
 *
 * 错误码格式：AABBB
 * AA: 错误类型
 *   10: 系统级错误
 *   20: 认证相关错误
 *   30: 用户相关错误
 *   40: 业务相关错误
 *   50: 第三方服务错误
 * BBB: 具体错误编号
 */

const ErrorCodes = {
	// 系统级错误 (10XXX)
	SYSTEM_ERROR: {
		code: 10000,
		message: '系统内部错误',
		status: 500
	},
	INVALID_PARAMS: {
		code: 10001,
		message: '无效的请求参数',
		status: 400
	},
	RATE_LIMIT_EXCEEDED: {
		code: 10002,
		message: '请求频率超限',
		status: 429
	},
	INVALID_REQUEST_SIGNATURE: {
		code: 10003,
		message: '无效的请求签名',
		status: 401
	},
	REQUEST_EXPIRED: {
		code: 10004,
		message: '请求已过期',
		status: 400
	},
	
	// 认证相关错误 (20XXX)
	UNAUTHORIZED: {
		code: 20000,
		message: '未经授权的访问',
		status: 401
	},
	TOKEN_EXPIRED: {
		code: 20001,
		message: '访问令牌已过期',
		status: 401
	},
	TOKEN_INVALID: {
		code: 20002,
		message: '无效的访问令牌',
		status: 401
	},
	TOKEN_REQUIRED: {
		code: 20003,
		message: '缺少访问令牌',
		status: 401
	},
	TOKEN_REVOKED: {
		code: 20004,
		message: '令牌已被撤销',
		status: 401
	},
	REFRESH_TOKEN_EXPIRED: {
		code: 20005,
		message: '刷新令牌已过期',
		status: 401
	},
	PERMISSION_DENIED: {
		code: 20006,
		message: '权限不足',
		status: 403
	},
	
	// 用户相关错误 (30XXX)
	USER_NOT_FOUND: {
		code: 30000,
		message: '用户不存在',
		status: 404
	},
	USER_ALREADY_EXISTS: {
		code: 30001,
		message: '用户已存在',
		status: 409
	},
	USER_BANNED: {
		code: 30002,
		message: '用户已被封禁',
		status: 403
	},
	INVALID_CREDENTIALS: {
		code: 30003,
		message: '无效的登录凭证',
		status: 401
	},
	ACCOUNT_LOCKED: {
		code: 30004,
		message: '账号已被锁定',
		status: 403
	},
	
	// 业务相关错误 (40XXX)
	REVIEW_NOT_FOUND: {
		code: 40000,
		message: '点评不存在',
		status: 404
	},
	DUPLICATE_REVIEW: {
		code: 40001,
		message: '已经点评过该账号',
		status: 409
	},
	INVALID_RATING: {
		code: 40002,
		message: '无效的评分',
		status: 400
	},
	REVIEW_PERMISSION_DENIED: {
		code: 40003,
		message: '无权操作该点评',
		status: 403
	},
	ACCOUNT_NOT_FOUND: {
		code: 40004,
		message: 'Twitter账号不存在',
		status: 404
	},
	
	// 第三方服务错误 (50XXX)
	TWITTER_API_ERROR: {
		code: 50000,
		message: 'Twitter API调用失败',
		status: 502
	},
	TWITTER_RATE_LIMIT: {
		code: 50001,
		message: 'Twitter API调用频率限制',
		status: 429
	},
	TWITTER_AUTH_FAILED: {
		code: 50002,
		message: 'Twitter认证失败',
		status: 401
	},
	EXTERNAL_SERVICE_ERROR: {
		code: 50003,
		message: '外部服务调用失败',
		status: 502
	},
	DATABASE_ERROR: {
		code: 50004,
		message: '数据库操作失败',
		status: 500
	}
};

// 错误响应生成器
function createErrorResponse(errorCode, details = null) {
	const error = ErrorCodes[errorCode];
	if (!error) {
		throw new Error(`未定义的错误码: ${errorCode}`);
	}
	
	return {
		error: {
			code: error.code,
			message: error.message,
			details: details
		}
	};
}

module.exports = {
	ErrorCodes,
	createErrorResponse
};
