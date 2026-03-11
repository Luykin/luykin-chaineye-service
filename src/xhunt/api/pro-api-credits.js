const express = require("express");
const { securityMiddleware } = require("../middleware/security");
const {
  authenticateToken,
} = require("../middleware/auth");
const {
  calculateGiftCreditsByTwitterId,
  callAddCreditsApi,
  checkGiftCreditsStatus,
  markGiftCreditsAsGifted,
} = require("../services/giftCreditsService");
const { XHuntUser } = require("../../models/postgres-start");

const router = express.Router();

// 目标服务器配置（k8s_kota）
const TARGET_BASE_URL = "https://data.cryptohunt.ai";

/**
 * 查询外部 Pro API 用户信息
 * @param {string} address - 钱包地址
 * @returns {Promise<{exists: boolean, data?: Object}>} - exists: 是否存在, data: 用户数据
 */
async function queryProUser(address) {
  try {
    const url = `${TARGET_BASE_URL}/pro/user/${address}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    // 尝试解析 JSON
    try {
      const data = JSON.parse(text);
      // 如果有 active 字段，说明用户存在
      if (data && typeof data.active === "boolean") {
        return { exists: true, data };
      }
      return { exists: false };
    } catch {
      // 不是 JSON，检查是否包含 "Cannot find the user"
      if (text.includes("Cannot find the user")) {
        return { exists: false };
      }
      // 其他未知情况，视为不存在
      console.error(`[ProApiCredits] Unexpected response from pro/user: ${text}`);
      return { exists: false };
    }
  } catch (error) {
    console.error("[ProApiCredits] Error querying pro user:", error);
    return { exists: false };
  }
}

/**
 * 在外部 Pro API 创建用户
 * @param {string} address - 钱包地址
 * @param {string} username - 用户名
 * @returns {Promise<boolean>} - 是否创建成功
 */
async function createProUser(address, username) {
  try {
    const url = `${TARGET_BASE_URL}/pro/admin/user/create`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "admin": "cuegod_shuai",
      },
      body: JSON.stringify({
        address,
        username,
      }),
    });

    // 状态码 200 视为成功
    return response.status === 200;
  } catch (error) {
    console.error("[ProApiCredits] Error creating pro user:", error);
    return false;
  }
}

/**
 * POST /api/xhunt/pro-api/credits-claim
 * 领取积分接口
 *
 * 请求体：
 * - address: 用户钱包地址（必填）
 *
 * 逻辑：
 * 1. 查询外部 Pro API 用户是否存在
 * 2. 如果不存在，先创建账户（使用当前登录用户的 username）
 * 3. 如果未赠送过积分，则赠送（防重）
 */
router.post(
  "/credits-claim",
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const { address } = req.body || {};
      const username = req.user?.username;

      // 参数校验
      if (!address) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: address",
        });
      }

      if (!username) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const normalizedAddress = address.toLowerCase().trim();
      const normalizedUsername = username.toLowerCase().trim();

      // 1. 查询外部 Pro API 用户是否存在
      const { exists: userExists, data: userData } = await queryProUser(normalizedAddress);
      let isNewUser = false;

      // 2. 用户不存在，需要创建
      if (!userExists) {
        console.log(`[CreditsClaim] Pro user ${normalizedAddress} not found, creating...`);
        
        const created = await createProUser(normalizedAddress, normalizedUsername);
        
        if (!created) {
          return res.status(500).json({
            success: false,
            message: "Failed to create user account",
          });
        }

        isNewUser = true;
        console.log(`[CreditsClaim] Pro user ${normalizedAddress} created successfully`);
      }

      // 3. 检查是否已赠送过积分（优先使用 twitterId，兼容 username）
      const twitterId = req.user?.twitterId;
      const { alreadyGifted } = await checkGiftCreditsStatus({
        twitterId,
        username: username,
      });
      
      if (alreadyGifted) {
        return res.json({
          success: true,
          message: "User already claimed credits",
          isNewUser,
          credited: false,
          alreadyGifted: true,
        });
      }
      
      // 标记为已赠送（使用 twitterId，更稳定）
      await markGiftCreditsAsGifted(twitterId);

      // 4. 计算并赠送积分（使用 twitterId 查询登录天数）
      const credits = await calculateGiftCreditsByTwitterId(twitterId);
      const tx = `${normalizedUsername}_${Date.now()}`;

      const addSuccess = await callAddCreditsApi({
        address: normalizedAddress,
        tx,
        credits,
      });

      if (!addSuccess) {
        // 赠送失败，但标记已经被设置了，保留标记避免重复赠送风险
        return res.status(500).json({
          success: false,
          message: "Failed to add credits, please contact support",
          isNewUser,
          credited: false,
        });
      }

      console.log(`[CreditsClaim] Success: user ${normalizedUsername} received ${credits} credits`);

      return res.json({
        success: true,
        message: isNewUser ? "Account created and credits claimed" : "Credits claimed",
        isNewUser,
        credited: true,
        credits,
        alreadyGifted: false,
      });
    } catch (error) {
      console.error("[CreditsClaim] Unexpected error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/xhunt/pro-api/credits-user/:address
 * 查询用户积分信息
 *
 * 老用户兼容处理：
 * - 如果 alreadyGifted === true 且 keyUsed === 'username'（旧用户标记）
 * - 优先用当前 XHuntUser 绑定的 evmAddresses 查询外部信息
 * - 如果查到，返回绑定地址的信息；查不到再回退查 normalizedAddress
 *
 * 返回：
 * - exists: 用户是否存在于 Pro API
 * - alreadyGifted: 是否已被赠送过积分（我们的系统记录）
 * - balance: 该地址的积分余额（来自 Pro API）
 * - proUserData: 完整的 Pro API 用户数据
 */
router.get(
  "/credits-user/:address",
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const { address } = req.params;

      if (!address) {
        return res.status(400).json({
          success: false,
          message: "Address is required",
        });
      }

      const normalizedAddress = address.toLowerCase().trim();
      const currentUsername = req.user?.username?.toLowerCase().trim();
      const twitterId = req.user?.twitterId;

      // 1. 先检查是否已赠送过积分（用于老用户兼容判断）
      const { alreadyGifted, keyUsed } = await checkGiftCreditsStatus({
        twitterId,
        username: req.user?.username,
      });

      let proUserData = null;
      let queryAddress = normalizedAddress;
      let foundFromBoundAddress = false;

      // 2. 老用户兼容处理：如果 alreadyGifted 且是用 username 标记的
      if (alreadyGifted && keyUsed === 'username' && twitterId) {
        // 获取当前用户绑定的 evmAddresses（使用 twitterId 查询）
        const user = await XHuntUser.findOne({
          where: { twitterId },
          attributes: ['evmAddresses'],
        });

        const boundAddresses = user?.evmAddresses || [];
        
        // 遍历绑定的地址，优先查询第一个有效的外部信息
        if (boundAddresses.length > 0) {
          for (const boundAddr of boundAddresses) {
            const addr = String(boundAddr || '').trim().toLowerCase();
            if (!addr) continue;
            
            const result = await queryProUser(addr);
            if (result.exists) {
              proUserData = result.data;
              queryAddress = addr;
              foundFromBoundAddress = true;
              console.log(`[CreditsUser] 老用户兼容: ${currentUsername} 使用绑定地址 ${addr} 查询到信息`);
              break;
            }
          }
        }
      }

      // 3. 如果没从绑定地址查到，查传入的 normalizedAddress
      if (!proUserData) {
        const result = await queryProUser(normalizedAddress);
        if (result.exists) {
          proUserData = result.data;
        }
      }

      // 4. 用户不存在于 Pro API
      if (!proUserData) {
        return res.json({
          success: true,
          data: {
            address: normalizedAddress,
            exists: false,
            alreadyGifted: false,
            keyUsed: null,
            balance: null,
            proUserData: null,
            foundFromBoundAddress: false,
          },
        });
      }

      // 5. 提取余额（Pro API 返回的是 credits 字段，字符串类型）
      const balance = proUserData.credits ? parseFloat(proUserData.credits) : null;

      return res.json({
        success: true,
        data: {
          address: normalizedAddress,
          queryAddress,  // 实际查询到的地址（老用户可能是绑定的地址）
          exists: true,
          username: currentUsername,
          twitterId,
          alreadyGifted,
          keyUsed,
          balance,
          proUserData,
          foundFromBoundAddress,
        },
      });
    } catch (error) {
      console.error("[CreditsUser] Unexpected error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

module.exports = router;
