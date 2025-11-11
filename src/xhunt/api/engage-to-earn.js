const express = require('express');
const axios = require('axios');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { EngageToEarnActivity, EngageToEarnSignup, XHuntUser, XHuntUserProSubscription } = require('../../models/postgres-start');
const { Op } = require('sequelize');

const router = express.Router();

// 1) 获取活动列表（支持翻页）
router.get('/activities', [
  authenticateTokenOptional,
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('status').optional().isString().trim(),
  validateRequest
], async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status) {
      where.status = req.query.status;
    }

    // 简单缓存策略：10分钟
    res.setHeader('Cache-Control', 'public, max-age=600');

    const { rows, count } = await EngageToEarnActivity.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      attributes: [
        'id', 'activitySlug', 'externalId', 'avatarImage', 'tweetLink',
        'rewardLabel', 'rewardAmountUsd', 'title', 'description',
        'startAt', 'endAt', 'limitProOnly', 'limitByFollowers', 'minFollowers', 'status',
        'participantCount', 'createdAt', 'updatedAt'
      ]
    });

    // 如果用户已登录，查询用户对每个活动的报名状态
    let activitiesWithSignupStatus = rows;
    if (req.user && req.user.id) {
      const activityIds = rows.map(activity => activity.id);
      
      // 批量查询用户对这些活动的报名记录
      const signups = await EngageToEarnSignup.findAll({
        where: {
          userId: req.user.id,
          activityId: { [Op.in]: activityIds }
        },
        attributes: ['activityId', 'status', 'signupAt']
      });

      // 创建报名状态映射
      const signupMap = new Map();
      signups.forEach(signup => {
        signupMap.set(signup.activityId, {
          hasSignedUp: true,
          signupStatus: signup.status,
          signupAt: signup.signupAt
        });
      });

      // 为每个活动添加报名状态
      activitiesWithSignupStatus = rows.map(activity => {
        const activityData = activity.toJSON();
        const signupInfo = signupMap.get(activity.id);
        
        return {
          ...activityData,
          hasSignedUp: signupInfo ? signupInfo.hasSignedUp : false,
          signupStatus: signupInfo ? signupInfo.signupStatus : null,
          signupAt: signupInfo ? signupInfo.signupAt : null
        };
      });
    } else {
      // 未登录用户，所有活动都标记为未报名
      activitiesWithSignupStatus = rows.map(activity => ({
        ...activity.toJSON(),
        hasSignedUp: false,
        signupStatus: null,
        signupAt: null
      }));
    }

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: activitiesWithSignupStatus,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// 2) 用户报名活动接口
router.post('/signups', [
  authenticateToken,
  body('activityId').isUUID().withMessage('activityId must be a valid UUID'), // 活动ID必须是有效的UUID
  validateRequest
], async (req, res) => {
  try {
    const { activityId } = req.body;

    // 8秒频率限制（按用户）
    if (req.redisClient) {
      try {
        const cooldownKey = `engage:signup:cd:${req.user.id}`;
        let ttl = await req.redisClient.ttl(cooldownKey);
        if (typeof ttl === 'number' && ttl > 0) {
          return res.status(429).json({
            error: `Too frequent requests, please try again in ${ttl}s`
          });
        }
        await req.redisClient.setEx(cooldownKey, 8, '1');
      } catch (cdErr) {
        console.warn('Redis cooldown warn (signup):', cdErr);
        // Redis 出错则不阻断
      }
    }

    // 确认活动存在
    const activity = await EngageToEarnActivity.findByPk(activityId, {
      attributes: [
        'id', 'title', 'tweetLink',
        'limitProOnly', 'limitByFollowers', 'minFollowers', 'requiresEvmBound'
      ]
    });
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' }); // 活动不存在
    }

    // 读取用户信息（用于校验 Pro / EVM / 粉丝数）
    const user = await XHuntUser.findByPk(req.user.id, {
      attributes: ['id', 'twitterId', 'evmAddresses']
    });
    if (!user) {
      return res.status(401).json({ error: 'User not found or unauthorized' }); // 用户未登录或不存在
    }

    // 校验：Pro 限制
    if (activity.limitProOnly) {
      const now = new Date();
      const activePro = await XHuntUserProSubscription.findOne({
        where: {
          userId: user.id,
          startTime: { [Op.lte]: now },
          endTime: { [Op.gte]: now }
        }
      });
      if (!activePro) {
        return res.status(403).json({ error: 'Pro subscription required' }); // 该活动仅限 Pro 用户报名
      }
    }

    // 校验：EVM 绑定
    if (activity.requiresEvmBound) {
      const evms = Array.isArray(user.evmAddresses) ? user.evmAddresses : [];
      if (evms.length === 0) {
        return res.status(400).json({ error: 'EVM address binding required' }); // 该活动要求先绑定 EVM 地址
      }
    }

    // 校验：粉丝数限制（外部 API）
    if (activity.limitByFollowers) {
      try {
        const apiUrl = 'https://data.cryptohunt.ai/pro/api/inner/profile_by_userid';
        const payload = { user_id: String(user.twitterId) };
        const response = await axios.post(apiUrl, payload, { timeout: 7000 });
        const data = response && response.data ? response.data : null;

        if (!data || typeof data.followers_count !== 'number') {
          return res.status(502).json({ error: 'External validation failed: incomplete response' }); // 外部数据校验失败：返回数据不完整
        }

        if (data.followers_count < (activity.minFollowers || 0)) {
          return res.status(400).json({ error: `Followers requirement not met: at least ${activity.minFollowers}` }); // 不满足条件：粉丝数量需不少于
        }
      } catch (apiErr) {
        console.error('Signup profile check error:', apiErr?.message || apiErr);
        return res.status(502).json({ error: 'External validation request failed' }); // 外部数据校验请求失败
      }
    }

    // 防重复报名
    const existing = await EngageToEarnSignup.findOne({
      where: { xHuntUserId: req.user.id, activityId: activity.id }
    });
    if (existing) {
      return res.status(409).json({ error: 'Already signed up for this activity' }); // 您已报名该活动
    }

    // 创建报名记录
    await EngageToEarnSignup.create({
      xHuntUserId: req.user.id,
      xHuntUserName: req.user.displayName || req.user.username || '',
      activityId: activity.id,
      activityTitle: activity.title,
      tweetLink: activity.tweetLink
    });

    // 更新活动的报名人数
    await activity.increment('participantCount', { by: 1 });

    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error creating signup:', error);
    res.status(500).json({ error: 'Failed to sign up' });
  }
});

// 3) 获取某个活动的报名用户（不用翻页）
router.get('/activities/:activityId/signups', [
  authenticateTokenOptional,
  param('activityId').isUUID().withMessage('activityId 必须是有效的 UUID'),
  validateRequest
], async (req, res) => {
  try {
    const activityId = req.params.activityId;

    // 确认活动存在（可选）
    const activity = await EngageToEarnActivity.findByPk(activityId, { attributes: ['id'] });
    if (!activity) {
      return res.status(404).json({ error: '活动不存在' });
    }

    // 简单缓存策略：10分钟
    res.setHeader('Cache-Control', 'public, max-age=600');

    const signups = await EngageToEarnSignup.findAll({
      where: { activityId },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'xHuntUserId', 'xHuntUserName', 'signedAt', 'createdAt'],
      include: [{
        model: XHuntUser,
        as: 'xHuntUser',
        attributes: ['id', 'username', 'displayName', 'avatar', 'evmAddresses']
      }]
    });

    const users = signups.map(s => ({
      id: s.xHuntUser?.id,
      username: s.xHuntUser?.username,
      displayName: s.xHuntUser?.displayName || s.xHuntUserName,
      avatar: s.xHuntUser?.avatar,
      evmAddresses: s.xHuntUser?.evmAddresses || []
    }));

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching activity signups:', error);
    res.status(500).json({ error: 'Failed to fetch activity signups' });
  }
});

module.exports = router;
