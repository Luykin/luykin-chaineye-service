const { XHuntUser, DailyActiveUser } = require("../../models/postgres-start");
const { Sequelize } = require("sequelize");
const { getRedisClient } = require("../../lib/redisClient");

// 积分赠送 API 配置
const ADD_CREDITS_API_URL = "https://data.cryptohunt.ai/pro/admin/user/addCredits";

/**
 * 计算用户应赠送的积分
 * @param {string} username - 用户用户名（twitter username）
 * @returns {Promise<number>} - 计算后的积分
 */
async function calculateGiftCredits(username) {
  try {
    // 1. 基础额度
    const baseCredits = 200;

    // 2. 查询用户过去30天登录天数
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeDaysCount = await DailyActiveUser.count({
      where: {
        userId: username,
        date: {
          [Sequelize.Op.gte]: thirtyDaysAgo.toISOString().split('T')[0],
        },
      },
    });

    // 登录奖励：每天50，上限800
    const loginBonus = Math.min(activeDaysCount * 50, 800);

    // 3. 查询用户排名
    const user = await XHuntUser.findOne({
      where: { username },
      attributes: ['kolRank20W'],
    });

    const kolRank = user?.kolRank20W;

    // 排名奖励（三档互斥，取最高档）
    let rankBonus = 0;
    if (kolRank && kolRank <= 10000) {
      rankBonus = 1000; // 前1万
    } else if (kolRank && kolRank <= 50000) {
      rankBonus = 600;  // 前5万
    } else if (kolRank && kolRank <= 100000) {
      rankBonus = 200;  // 前10万
    }

    // 总积分 = 基础 + 登录奖励 + 排名奖励
    const totalCredits = baseCredits + loginBonus + rankBonus;

    console.log(`[GiftCredits] User: ${username}, Base: ${baseCredits}, LoginDays: ${activeDaysCount}, LoginBonus: ${loginBonus}, Rank: ${kolRank || 'N/A'}, RankBonus: ${rankBonus}, Total: ${totalCredits}`);

    return totalCredits;
  } catch (error) {
    console.error(`[GiftCredits] Error calculating credits for ${username}:`, error);
    // 出错时返回基础额度
    return 200;
  }
}

/**
 * 调用积分赠送接口
 * @param {Object} params - 参数对象
 * @param {string} params.address - 用户钱包地址
 * @param {string} params.tx - 交易标识（x-user-id + x-request-id）
 * @param {number} params.credits - 积分数量
 */
async function callAddCreditsApi({ address, tx, credits }) {
  try {
    const response = await fetch(ADD_CREDITS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "admin": "cuegod_shuai",
      },
      body: JSON.stringify({
        address,
        tx,
        credits,
        operation: "gift",
      }),
    });

    // 仅状态码 200 视为成功
    if (response.status !== 200) {
      const errorText = await response.text();
      console.error(`[GiftCredits] API error: ${response.status} ${response.statusText}`, errorText);
      return false;
    }

    console.log(`[GiftCredits] Successfully added ${credits} credits to ${address}`);
    return true;
  } catch (error) {
    console.error(`[GiftCredits] API call failed:`, error);
    return false;
  }
}

/**
 * 获取用户积分赠送的 Redis Key
 * @param {string} userId - 用户ID（Twitter用户名或twitterId）
 * @returns {string} - Redis Key
 */
function getGiftCreditsKey(userId) {
  return `gift:credits:user:${userId}`;
}

/**
 * 获取用户积分赠送的 Redis Key（使用 twitterId，新的推荐方式）
 * @param {string} twitterId - Twitter用户ID
 * @returns {string} - Redis Key
 */
function getGiftCreditsKeyByTwitterId(twitterId) {
  return `gift:credits:twitter:${twitterId}`;
}

/**
 * 检查用户是否已赠送过积分（使用Redis SET NX实现幂等性）
 * 以userId为维度，一旦赠送过，无论换什么EVM地址都不再赠送
 * 
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} - true表示已赠送过（应跳过），false表示未赠送过
 */
async function checkAndMarkGiftCredits(userId) {
  const redisKey = getGiftCreditsKey(userId);
  const redisClient = await getRedisClient();
  
  // 使用 SET NX（Only set the key if it does not already exist）
  // 返回 'OK' 表示设置成功（之前不存在），返回 null 表示已存在
  const result = await redisClient.set(redisKey, "1", {
    NX: true, // Only if Not eXists
  });
  
  // result === 'OK' 表示这是第一次设置，未赠送过
  // result === null 表示key已存在，已赠送过
  const alreadyGifted = result === null;
  
  if (alreadyGifted) {
    console.log(`[GiftCredits] Skip: user ${userId} has already received gift credits`);
  } else {
    console.log(`[GiftCredits] Mark: user ${userId} marked as gifted (permanent)`);
  }
  
  return alreadyGifted;
}

/**
 * 检查用户是否已赠送过积分（兼容旧数据，优先使用twitterId）
 * 以 twitterId 为维度做终身防重，同时兼容检查旧数据（username）
 * 
 * @param {Object} params - 参数对象
 * @param {string} params.twitterId - Twitter用户ID（优先使用）
 * @param {string} params.username - Twitter用户名（兼容旧数据）
 * @returns {Promise<{alreadyGifted: boolean, keyUsed: string|null}>} - alreadyGifted: true表示已赠送过，keyUsed: 使用的key类型
 */
async function checkGiftCreditsStatus({ twitterId, username }) {
  const redisClient = await getRedisClient();
  
  // 1. 优先检查 twitterId（新方式）
  if (twitterId) {
    const twitterKey = getGiftCreditsKeyByTwitterId(twitterId);
    const twitterFlag = await redisClient.get(twitterKey);
    if (twitterFlag) {
      console.log(`[GiftCredits] Skip: twitterId ${twitterId} has already received gift credits`);
      return { alreadyGifted: true, keyUsed: 'twitterId' };
    }
  }
  
  // 2. 兼容检查 username（旧方式）
  if (username) {
    const usernameKey = getGiftCreditsKey(username);
    const usernameFlag = await redisClient.get(usernameKey);
    if (usernameFlag) {
      console.log(`[GiftCredits] Skip: username ${username} has already received gift credits (legacy)`);
      return { alreadyGifted: true, keyUsed: 'username' };
    }
  }
  
  return { alreadyGifted: false, keyUsed: null };
}

/**
 * 标记用户已赠送积分（使用 twitterId 作为维度）
 * 
 * @param {string} twitterId - Twitter用户ID
 * @returns {Promise<void>}
 */
async function markGiftCreditsAsGifted(twitterId) {
  if (!twitterId) {
    console.error('[GiftCredits] Error: twitterId is required to mark gift credits');
    return;
  }
  
  const redisKey = getGiftCreditsKeyByTwitterId(twitterId);
  const redisClient = await getRedisClient();
  
  await redisClient.set(redisKey, "1");
  console.log(`[GiftCredits] Mark: twitterId ${twitterId} marked as gifted (permanent)`);
}

/**
 * 处理用户创建后的积分赠送
 * 当请求是 POST /pro/admin/user/create 且成功时，自动计算并赠送积分
 * 注意：此操作会同步等待积分赠送完成后再返回，但赠送失败不会影响原请求
 * 
 * 防重逻辑：
 * 1. 以 userId（Twitter用户名）为维度做终身防重
 * 2. 一旦某个用户赠送过，无论换什么EVM地址都不再赠送
 * 3. 使用Redis SET NX原子操作实现幂等性，Key永久存储
 * 
 * @param {Object} req - Express 请求对象
 * @param {string} targetUrl - 目标服务器 URL
 * @param {boolean} isSuccess - 原请求是否成功（2xx）
 */
async function handleUserCreateGiftCredits(req, targetUrl, isSuccess) {
  // 仅处理成功的 POST /pro/admin/user/create 请求
  const isUserCreateEndpoint = targetUrl.includes("/pro/admin/user/create");
  const isPostMethod = req.method === "POST";
  
  if (!isSuccess || !isUserCreateEndpoint || !isPostMethod) {
    return;
  }

  try {
    const address = req.body?.address;
    const userId = req.headers["x-user-id"] || "";
    const requestId = req.headers["x-request-id"] || "";
    const username = userId;
    
    if (!address || !username) {
      console.log("[GiftCredits] Skip: missing address or username");
      return;
    }

    // 1. 先尝试绑定地址（无论是否已赠送过积分，新地址都应该绑定）
    // 如果用户没有绑定地址，就把申请的地址绑定给这个用户
    // 但如果该地址已被其他用户绑定，则不能绑定
    try {
      const user = await XHuntUser.findOne({ where: { username } });
      if (user) {
        const normalizedAddress = address.toLowerCase().trim();
        const addresses = Array.isArray(user.evmAddresses) ? [...user.evmAddresses] : [];
        const normalizedAddresses = addresses.map(a => String(a || '').trim().toLowerCase());
        
        if (addresses.length < 3 && !normalizedAddresses.includes(normalizedAddress)) {
          // 检查该地址是否已被其他用户绑定
          const conflicts = await XHuntUser.sequelize.query(
            `
            SELECT u.id, u.username
            FROM "XHuntUsers" u
            WHERE u.id != :userId
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(u."evmAddresses"::jsonb, '[]'::jsonb)) AS a(elem)
                WHERE LOWER(a.elem) = :address
              )
            LIMIT 1
            `,
            {
              replacements: { userId: user.id, address: normalizedAddress },
              type: Sequelize.QueryTypes.SELECT,
            }
          );

          if (conflicts.length === 0) {
            // 地址未被其他用户绑定，可以绑定
            addresses.push(address);
            await user.update({ evmAddresses: addresses });
            console.log(`[GiftCredits] Bound address ${address} to user ${username}`);
          } else {
            console.log(`[GiftCredits] Address ${address} already bound to other user: ${conflicts[0].username}, skip binding`);
          }
        }
      }
    } catch (bindError) {
      // 绑定失败不影响积分赠送，只记录日志
      console.error('[GiftCredits] Error binding address:', bindError.message);
    }

    // 2. 防重检查：检查该用户是否已赠送过（终身仅一次）
    const alreadyGifted = await checkAndMarkGiftCredits(username);
    if (alreadyGifted) {
      console.log(`[GiftCredits] Skip: user ${username} has already received gift credits, but address binding processed`);
      return;
    }

    // 3. 同步计算并赠送积分（等待完成后再返回）
    const credits = await calculateGiftCredits(username);
    const tx = `${userId}${requestId}`;

    await callAddCreditsApi({ address, tx, credits });
    
    console.log(`[GiftCredits] Success: user ${username} received ${credits} credits to ${address}`);
  } catch (giftError) {
    // 积分赠送失败不应影响原请求，但需要考虑是否清除标记以便下次重试
    // 这里选择保留标记，避免重复赠送的风险，可手动处理失败情况
    console.error("[GiftCredits] Error in gift credits flow:", giftError);
  }
}

module.exports = {
  calculateGiftCredits,
  callAddCreditsApi,
  getGiftCreditsKey,
  getGiftCreditsKeyByTwitterId,
  checkAndMarkGiftCredits,
  checkGiftCreditsStatus,
  markGiftCreditsAsGifted,
  handleUserCreateGiftCredits,
};
