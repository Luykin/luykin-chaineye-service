const express = require('express');
const { securityMiddleware } = require('../middleware/security');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// URL映射配置
const URL_MAPPINGS = {
	'kota': 'http://10.170.0.2:16530',
	'kb': 'http://34.146.221.115:8087'
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
		console.error(targetUrl, 'Proxy request error:', error);
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

/**
 * @swagger
 * /proxy/auth/{path}:
 *   get:
 *     tags:
 *       - Proxy Service
 *     summary: 需要认证的代理请求 (GET)
 *     description: 代理需要用户认证的GET请求到指定的后端服务
 *     security:
 *       - BearerAuth: []
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: path
 *         in: path
 *         required: true
 *         description: 目标API路径
 *         schema:
 *           type: string
 *           example: "some-endpoint"
 *       - name: target
 *         in: query
 *         required: false
 *         description: 目标服务器标识
 *         schema:
 *           type: string
 *           enum: [kota, kb]
 *           default: kota
 *           example: "kota"
 *     responses:
 *       200:
 *         description: 代理请求成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: 目标服务器返回的数据
 *       401:
 *         description: 未授权访问
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 代理请求失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     tags:
 *       - Proxy Service
 *     summary: 需要认证的代理请求 (POST)
 *     description: 代理需要用户认证的POST请求到指定的后端服务
 *     security:
 *       - BearerAuth: []
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: path
 *         in: path
 *         required: true
 *         description: 目标API路径
 *         schema:
 *           type: string
 *           example: "some-endpoint"
 *       - name: target
 *         in: query
 *         required: false
 *         description: 目标服务器标识
 *         schema:
 *           type: string
 *           enum: [kota, kb]
 *           default: kota
 *           example: "kota"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: 要发送到目标服务器的数据
 *     responses:
 *       200:
 *         description: 代理请求成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: 目标服务器返回的数据
 *       401:
 *         description: 未授权访问
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 代理请求失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// 代理路由 - 需要认证
router.all('/auth/*', authenticateToken, securityMiddleware, async (req, res) => {
	const targetUrl = getTargetUrl(req);
	await proxyRequest(req, res, targetUrl);
});

/**
 * @swagger
 * /proxy/public/{path}:
 *   get:
 *     tags:
 *       - Proxy Service
 *     summary: 公开的代理请求 (GET)
 *     description: 代理不需要用户认证的GET请求到指定的后端服务
 *     security:
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: path
 *         in: path
 *         required: true
 *         description: 目标API路径
 *         schema:
 *           type: string
 *           example: "some-endpoint"
 *       - name: target
 *         in: query
 *         required: false
 *         description: 目标服务器标识
 *         schema:
 *           type: string
 *           enum: [kota, kb]
 *           default: kota
 *           example: "kota"
 *     responses:
 *       200:
 *         description: 代理请求成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: 目标服务器返回的数据
 *       500:
 *         description: 代理请求失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     tags:
 *       - Proxy Service
 *     summary: 公开的代理请求 (POST)
 *     description: 代理不需要用户认证的POST请求到指定的后端服务
 *     security:
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: path
 *         in: path
 *         required: true
 *         description: 目标API路径
 *         schema:
 *           type: string
 *           example: "some-endpoint"
 *       - name: target
 *         in: query
 *         required: false
 *         description: 目标服务器标识
 *         schema:
 *           type: string
 *           enum: [kota, kb]
 *           default: kota
 *           example: "kota"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: 要发送到目标服务器的数据
 *     responses:
 *       200:
 *         description: 代理请求成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: 目标服务器返回的数据
 *       500:
 *         description: 代理请求失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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