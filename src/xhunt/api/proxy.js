const express = require('express');
const { securityMiddleware } = require('../middleware/security');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// URL映射配置
const URL_MAPPINGS = {
	'kota': 'https://kota.chaineye.tools',
	'kb': 'https://kb.cryptohunt.ai'
};

// 默认目标服务器
const DEFAULT_TARGET = 'kota';

// 代理请求处理函数
async function proxyRequest(req, res, targetUrl) {
	try {
		// 构建请求选项
		const options = {
			method: req.method,
			headers: {
				'Content-Type': 'application/json',
			}
		};
		
		// 如果有请求体，添加到选项中
		if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
			options.body = JSON.stringify(req.body);
		}
		// 发送请求到目标服务器
		const response = await fetch(targetUrl, options);
		const data = await response.json();
		
		// 返回响应
		res.status(response.status).json(data);
	} catch (error) {
		console.error('Proxy request error:', error);
		res.status(500).json({ error: '请求失败' });
	}
}

// 获取目标URL
function getTargetUrl(req) {
	// 提取并删除 target 参数
	const originalQuery = { ...req.query };
	const target = originalQuery.target || DEFAULT_TARGET;
	delete originalQuery.target;
	
	// 获取目标基础 URL 并确保无多余空格
	const baseUrl = (URL_MAPPINGS[target] || URL_MAPPINGS[DEFAULT_TARGET]).trim();
	
	// 提取路径（去除 /auth/ 或 /public/ 前缀）
	const targetPath = req.path.replace(/^\/(auth|public)\//, '');
	
	// 将剩余查询参数转换为查询字符串
	const search = new URLSearchParams(originalQuery).toString();
	
	// 拼接完整的目标 URL
	let fullPath = targetPath;
	if (search) {
		fullPath += `?${search}`;
	}
	return `${baseUrl}/${fullPath}`;
}

// 代理路由 - 需要认证
router.all('/auth/*', authenticateToken, securityMiddleware, async (req, res) => {
	const targetUrl = getTargetUrl(req);
	await proxyRequest(req, res, targetUrl);
});

// 代理路由 - 无需认证
router.all('/public/*', securityMiddleware, async (req, res) => {
	const targetUrl = getTargetUrl(req);
	await proxyRequest(req, res, targetUrl);
});

module.exports = router;

// // Default (kota)
// await fetch('/api/proxy/public/some-endpoint');
//
// // Specific target
// await fetch('/api/proxy/public/some-endpoint?target=kb');

