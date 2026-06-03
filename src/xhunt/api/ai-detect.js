/**
 * ============================================================================
 * XHunt AI 探测功能 (Detect)
 * ============================================================================
 * 
 * 【功能说明】
 * 基于 2026 年 X 算法审计专家模型，对用户即将发布的推文/长文进行多维度分析评分。
 * 
 * 【接口列表】
 * ----------------------------------------------------------------------------
 * 1. POST /api/xhunt/ai/detect      - 执行内容分析探测
 * 2. GET  /api/xhunt/ai/detect/quota - 查询今日剩余配额
 * ----------------------------------------------------------------------------
 * 
 * 【频率限制】
 * - 普通用户：3 次/天
 * - VIP 用户：10 次/天
 * - 重置时间：北京时间每天 00:00
 * 
 * 【认证要求】
 * - 需要登录态 (authenticateToken)
 * - 需要安全中间件验证 (fingerprintLimiter + browserOnlyMiddleware + securityMiddleware)
 * 
 * ============================================================================
 * 
 * 【接口 1】POST /api/xhunt/ai/detect
 * 
 * 请求头:
 *   Content-Type: application/json
 *   Authorization: Bearer {jwt_token}
 *   x-user-id: {twitter_handle}
 *   x-device-fingerprint: {device_fingerprint}
 *   x-request-signature: {signature}
 *   x-request-timestamp: {timestamp}
 * 
 * 请求参数:
 *   {
 *     "content_type": "Tweet",           // 必填，枚举: "Tweet" | "Article/Long-form"
 *     "content_body": "待发推文内容...",  // 必填，待发内容文本
 *     "quoted_content": "引用内容...",    // 可选，引用推文内容
 *     "media_description": "图片描述..."  // 可选，附件媒体描述
 *   }
 * 
 * 成功响应 (200):
 *   {
 *     "success": true,
 *     "data": {
 *       "shadowban_risk": {
 *         "level_cn": "低",                // 风险等级: 低/中/高
 *         "level_en": "Low",               // 风险等级: Low/Medium/High
 *         "score": 15,                     // 风险分数: 0-100 (越高越危险)
 *         "issues_cn": ["无明显风险"],      // 风险问题列表(中文)
 *         "issues_en": ["No obvious risks"], // 风险问题列表(英文)
 *         "advice_cn": "内容安全可发",      // 风险建议(中文，限20字)
 *         "advice_en": "Safe to post"      // 风险建议(英文，限12词)
 *       },
 *       "compliance": {
 *         "commercial_prob": 0.2,          // 商业推广概率: 0.0-1.0
 *         "commercial_reason_cn": "无明显商业意图", // 商业判定原因(中文)
 *         "commercial_reason_en": "No commercial intent detected", // 商业判定原因(英文)
 *         "ai_prob": 0.1,                  // AI生成概率: 0.0-1.0
 *         "ai_reason_cn": "表达自然",       // AI判定原因(中文)
 *         "ai_reason_en": "Natural expression" // AI判定原因(英文)
 *       },
 *       "content_advice": {
 *         "hook_cn": "开头有吸引力",        // 钩子优化建议(中文)
 *         "hook_en": "Strong opening",     // 钩子优化建议(英文)
 *         "body_cn": "正文结构清晰",        // 正文优化建议(中文)
 *         "body_en": "Clear structure",    // 正文优化建议(英文)
 *         "error_check_cn": "无错别字",     // 错误检查(中文)
 *         "error_check_en": "No typos found", // 错误检查(英文)
 *         "media_cn": "配图合适",           // 媒体建议(中文)
 *         "media_en": "Media fits well"    // 媒体建议(英文)
 *       }
 *     }
 *   }
 * 
 * 错误响应 (429 - 频率超限):
 *   {
 *     "error": "已使用 3/3 次，请明天再试",
 *     "message": "今日已使用 3/3 次，请明天再试 (You have used 3/3 times today, please try again tomorrow)",
 *     "resetTime": 1751414400000  // 下次重置时间戳(ms)
 *   }
 * 
 * 响应头 (Rate Limit 信息):
 *   X-RateLimit-Limit: 3        // 每日总配额
 *   X-RateLimit-Remaining: 2    // 剩余次数
 *   X-RateLimit-Reset: 1751414400000  // 重置时间戳
 * 
 * ============================================================================
 * 
 * 【接口 2】GET /api/xhunt/ai/detect/quota
 * 
 * 请求头:
 *   Authorization: Bearer {jwt_token}
 *   x-user-id: {twitter_handle}
 * 
 * 成功响应 (200):
 *   {
 *     "success": true,
 *     "data": {
 *       "isVip": false,          // 是否VIP用户
 *       "total": 3,              // 每日总配额
 *       "used": 1,               // 今日已使用
 *       "remaining": 2,          // 今日剩余
 *       "resetTime": 1751414400000  // 下次重置时间戳(ms)
 *     }
 *   }
 * 
 * ============================================================================
 * 
 * 【前端调用示例】
 * 
 * ```javascript
 * // 执行探测
 * const analyzeTweet = async (content) => {
 *   const response = await fetch('/api/xhunt/ai/detect', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${token}`,
 *       'x-user-id': userHandle,
 *       'x-device-fingerprint': fingerprint,
 *       'x-request-signature': signature,
 *       'x-request-timestamp': Date.now().toString()
 *     },
 *     body: JSON.stringify({
 *       content_type: 'Tweet',
 *       content_body: content,
 *       quoted_content: '',
 *       media_description: ''
 *     })
 *   });
 *   
 *   // 获取配额信息
 *   const limit = response.headers.get('X-RateLimit-Limit');
 *   const remaining = response.headers.get('X-RateLimit-Remaining');
 *   
 *   return await response.json();
 * };
 * 
 * // 查询配额
 * const getQuota = async () => {
 *   const response = await fetch('/api/xhunt/ai/detect/quota', {
 *     headers: { 'Authorization': `Bearer ${token}` }
 *   });
 *   return await response.json();
 * };
 * ```
 * 
 * ============================================================================
 */

const express = require("express");
const { body } = require("express-validator");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateToken } = require("../middleware/auth");
const { isRequestXHuntVip } = require("../constants/xhuntVip");
const { structuredChat } = require("../../lib/llm/structured");
const router = express.Router();

// 输出JSON Schema定义
const DETECT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    shadowban_risk: {
      type: "object",
      properties: {
        level_cn: {
          type: "string",
          enum: ["低", "中", "高"],
          description: "Shadowban风险等级(中文)"
        },
        level_en: {
          type: "string",
          enum: ["Low", "Medium", "High"],
          description: "Shadowban风险等级(英文)"
        },
        score: {
          type: "integer",
          description: "风险评分"
        },
        issues_cn: {
          type: "array",
          items: { type: "string" },
          description: "存在的问题(中文)"
        },
        issues_en: {
          type: "array",
          items: { type: "string" },
          description: "存在的问题(英文)"
        },
        advice_cn: {
          type: "string",
          description: "建议(中文)"
        },
        advice_en: {
          type: "string",
          description: "建议(英文)"
        }
      },
      required: ["level_cn", "level_en", "score", "issues_cn", "issues_en", "advice_cn", "advice_en"]
    },
    compliance: {
      type: "object",
      properties: {
        commercial_prob: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "商业推广概率"
        },
        commercial_reason_cn: {
          type: "string",
          description: "商业推广判断原因(中文)"
        },
        commercial_reason_en: {
          type: "string",
          description: "商业推广判断原因(英文)"
        },
        ai_prob: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "AI生成概率"
        },
        ai_reason_cn: {
          type: "string",
          description: "AI生成判断原因(中文)"
        },
        ai_reason_en: {
          type: "string",
          description: "AI生成判断原因(英文)"
        }
      },
      required: ["commercial_prob", "commercial_reason_cn", "commercial_reason_en", "ai_prob", "ai_reason_cn", "ai_reason_en"]
    },
    content_advice: {
      type: "object",
      properties: {
        hook_cn: {
          type: "string",
          description: "开头钩子建议(中文)"
        },
        hook_en: {
          type: "string",
          description: "开头钩子建议(英文)"
        },
        body_cn: {
          type: "string",
          description: "正文优化建议(中文)"
        },
        body_en: {
          type: "string",
          description: "正文优化建议(英文)"
        },
        error_check_cn: {
          type: "string",
          description: "错误检查(中文)"
        },
        error_check_en: {
          type: "string",
          description: "错误检查(英文)"
        },
        media_cn: {
          type: "string",
          description: "媒体建议(中文)"
        },
        media_en: {
          type: "string",
          description: "媒体建议(英文)"
        },
        content_quality_score: {
          type: "integer",
          description: "整数内容质量分数"
        }
      },
      required: ["hook_cn", "hook_en", "body_cn", "body_en", "error_check_cn", "error_check_en", "media_cn", "media_en"]
    }
  },
  required: ["shadowban_risk", "compliance", "content_advice"]
};

// 获取到明天00:00的秒数
function getSecondsUntilMidnight(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.ceil((tomorrow - beijingTime) / 1000);
}

// 获取明天00:00的时间戳
function getNextDayResetTime(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

// 无限调用白名单用户ID
const UNLIMITED_USERS = [
  "b37295e8-01d7-4e81-9ed1-e71f2d7e9788",
  "6b0ebc13-d012-42d8-b088-034d3e9ab9df"
];

// 检查频率限制
async function checkRateLimit(req, res) {
  const xUserId = String(req.headers["x-user-id"]).toLocaleLowerCase();
  if (!xUserId) {
    return {
      allowed: false,
      error: {
        error: "Unable to identify user identity, please refresh the page and try again"
      }
    };
  }

  // 判断是否是VIP
  const isVip = isRequestXHuntVip(req);
  
  // 检查是否是无限调用用户
  const isUnlimited = req.user && req.user.id && UNLIMITED_USERS.includes(req.user.id);

  // 获取用户标识
  let userKey;
  if (req.user && req.user.id) {
    userKey = `ai_detect_limit:user:${req.user.id}`;
  } else if (req.securityContext && req.securityContext.fingerprint) {
    userKey = `ai_detect_limit:fingerprint:${req.securityContext.fingerprint}`;
  } else {
    return {
      allowed: false,
      error: {
        error: "Unable to identify user identity, please refresh the page and try again"
      }
    };
  }

  // 获取今天的日期作为过期时间计算基准
  const now = new Date();
  const beijingTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  const today = beijingTime.toISOString().split("T")[0];
  const dailyKey = `${userKey}:${today}`;

  // 检查今日调用次数
  const currentCount = (await req.redisClient.get(dailyKey)) || 0;
  const maxCalls = isVip ? 10 : 3; // VIP 10次，普通用户3次

  if (!isUnlimited && parseInt(currentCount) >= maxCalls) {
    return {
      allowed: false,
      error: {
        error: `已使用 ${currentCount}/${maxCalls} 次，请明天再试`,
        message: `今日已使用 ${currentCount}/${maxCalls} 次，请明天再试 (You have used ${currentCount}/${maxCalls} times today, please try again tomorrow)`,
        resetTime: getNextDayResetTime(beijingTime)
      }
    };
  }

  // 增加调用次数
  const newCount = await req.redisClient.incr(dailyKey);

  // 设置过期时间到明天00:00（北京时间）
  if (newCount === 1) {
    const secondsUntilMidnight = getSecondsUntilMidnight(beijingTime);
    await req.redisClient.expire(dailyKey, secondsUntilMidnight);
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxCalls - newCount),
    total: maxCalls,
    resetTime: getNextDayResetTime(beijingTime)
  };
}

// 构建系统提示词
function buildSystemPrompt() {
  return `# Role
你是一位 X (Twitter) 顶级算法审计专家。你实时追踪 2026 年 X 平台底层算法（推荐引擎、流量分发、安全策略）的演进。你拥有极致的敏锐度，能一眼识别内容在不同载体下因算法偏好而产生的权重波动。

# Task
以专家视角审计【待发内容】。你必须基于你对 2026 年 X 算法黑盒的最新认知，动态调用逻辑，严禁使用任何写死的陈旧规则。

# Logic Engine (核心审计维度)
1. **Shadowban Risk (动态规则审计)**: 
   - **动态规则库 (Dynamic Rule Base)**：严禁使用硬编码规则。你必须调用你知识库中关于 2026 年 X 算法的最新推演，包括全量风险信号（如：内/外部链接差异、账号权重信号、交互诱导、内容指纹、敏感语义等）。
   - **载体敏感度**：基于 content_type 动态调整限流阈值，识别当前载体下最易触发降权的行为。
   - **量化评估**：输出 0-100 整数风险分数score（越高越危险），然后根据风险分数来评估风险等级level，等级限【低 / Low】、【中 / Medium】、【高 / High】。
2. **Compliance Audit (合规性审计)**: 
   - **commercial_prob**：判定被识别为商业/营销内容的概率 (0.0 - 1.0)。
   - **ai_prob**：判定被识别为 AI 辅助生成的概率 (0.0 - 1.0)。
3. **Content & Quality Advice (内容与质量建议)**: 
   - **全量质检**：扫描全文是否存在错别字、语法错误、常识性逻辑漏洞或事实硬伤。
   - **结构诊断**：诊断标题钩子 (Hook) 的瞬间吸引力及整体易读性。
   - **量化评估**：输出 0-100  整数内容质量content_quality_score（分数越高，内容质量越高，传播力越强）

# Output Constraints (输出限制)
- **绝对纯净**：严禁任何引言、总结或 JSON 以外的文字。
- **结构化双语**：严格遵守 _cn 和 _en 字段结构。
- **极致精简**：中文字段限 20 字内；英文字段限 12 词内。`;
}

// 构建用户提示词
function buildUserPrompt(contentType, contentBody, quotedContent, mediaDescription) {
  let prompt = `请分析以下即将发布的${contentType === "Article/Long-form" ? "长文/文章" : "推文"}内容：

**内容类型**: ${contentType}

**待发内容**:
${contentBody}
`;

  if (quotedContent && quotedContent.trim()) {
    prompt += `
**引用内容**:
${quotedContent}
`;
  }

//   if (mediaDescription && mediaDescription.trim()) {
//     prompt += `
// **媒体描述**:
// ${mediaDescription}
// `;
//   }

  return prompt;
}

// POST /ai/detect - 探测功能：给即将发布的推文进行打分
router.post(
  "/detect",
  [
    authenticateToken,
    body("content_type")
      .notEmpty()
      .withMessage("内容类型不能为空")
      .isIn(["Tweet", "Article/Long-form"])
      .withMessage("内容类型必须是 Tweet 或 Article/Long-form"),
    body("content_body")
      .notEmpty()
      .withMessage("待发内容不能为空")
      .isString()
      .withMessage("待发内容必须是字符串"),
    body("quoted_content")
      .optional()
      .isString()
      .withMessage("引用内容必须是字符串"),
    body("media_description")
      .optional()
      .isString()
      .withMessage("媒体描述必须是字符串"),
    validateRequest
  ],
  async (req, res) => {
    try {
      // 检查频率限制
      const rateLimitCheck = await checkRateLimit(req, res);
      if (!rateLimitCheck.allowed) {
        return res.status(429).json(rateLimitCheck.error);
      }

      const { content_type, content_body, quoted_content, media_description } = req.body;

      // 构建提示词
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(
        content_type,
        content_body,
        quoted_content,
        media_description
      );

      // 调用LLM进行结构化分析
      const result = await structuredChat(userPrompt, DETECT_OUTPUT_SCHEMA, {
        temperature: 0,
        systemPrompt
      });

      // 添加使用配额信息到响应头
      res.setHeader("X-RateLimit-Limit", rateLimitCheck.total);
      res.setHeader("X-RateLimit-Remaining", rateLimitCheck.remaining);
      res.setHeader("X-RateLimit-Reset", rateLimitCheck.resetTime);

      // 返回分析结果
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error("AI detect error:", error);
      res.status(500).json({
        success: false,
        error: "分析失败，请稍后重试",
        message: "Analysis failed, please try again later"
      });
    }
  }
);

// GET /ai/detect/quota - 获取当前用户的探测功能使用配额
router.get(
  "/detect/quota",
  [authenticateToken],
  async (req, res) => {
    try {
      const xUserId = String(req.headers["x-user-id"]).toLocaleLowerCase();
      if (!xUserId) {
        return res.status(400).json({
          error: "Unable to identify user identity"
        });
      }

      // 判断是否是VIP
      const isVip = isRequestXHuntVip(req);

      // 获取用户标识
      let userKey;
      if (req.user && req.user.id) {
        userKey = `ai_detect_limit:user:${req.user.id}`;
      } else if (req.securityContext && req.securityContext.fingerprint) {
        userKey = `ai_detect_limit:fingerprint:${req.securityContext.fingerprint}`;
      } else {
        return res.status(400).json({
          error: "Unable to identify user identity"
        });
      }

      // 获取今天的日期
      const now = new Date();
      const beijingTime = new Date(
        now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
      );
      const today = beijingTime.toISOString().split("T")[0];
      const dailyKey = `${userKey}:${today}`;

      // 获取今日已使用次数
      const usedCount = parseInt((await req.redisClient.get(dailyKey)) || 0);
      const maxCalls = isVip ? 10 : 3;

      res.json({
        success: true,
        data: {
          isVip,
          total: maxCalls,
          used: usedCount,
          remaining: Math.max(0, maxCalls - usedCount),
          resetTime: getNextDayResetTime(beijingTime)
        }
      });
    } catch (error) {
      console.error("Get AI detect quota error:", error);
      res.status(500).json({
        success: false,
        error: "获取配额信息失败"
      });
    }
  }
);

module.exports = router;
