const express = require("express");
const { body } = require("express-validator");
const { validateRequest } = require("../middleware/validate-request");
const { securityMiddleware } = require("../middleware/security");

const router = express.Router();

// /**
//  * 检测用户是否使用代理
//  * @param {Object} req - 请求对象
//  * @param {Object} ipInfo - IP信息对象
//  * @returns {Object} - 代理检测结果
//  */
// function detectProxy(req, ipInfo) {
//   const proxyIndicators = [];
//   let proxyScore = 0;

//   // 1. 检查代理相关的请求头
//   const proxyHeaders = [
//     "x-forwarded-for",
//     "x-real-ip",
//     "x-forwarded-proto",
//     "x-forwarded-host",
//     "x-forwarded-port",
//     "x-original-forwarded-for",
//     "x-cluster-client-ip",
//     "cf-connecting-ip", // Cloudflare
//     "true-client-ip",
//     "x-client-ip",
//     "forwarded",
//     "via",
//   ];

//   const foundProxyHeaders = proxyHeaders.filter(
//     (header) => req.headers[header]
//   );
//   if (foundProxyHeaders.length > 0) {
//     proxyIndicators.push(`Headers: ${foundProxyHeaders.join(", ")}`);
//     proxyScore += foundProxyHeaders.length * 10;
//   }

//   // 2. 检查 X-Forwarded-For 是否包含多个IP
//   const xForwardedFor = req.headers["x-forwarded-for"];
//   if (xForwardedFor && xForwardedFor.includes(",")) {
//     const ips = xForwardedFor.split(",").map((ip) => ip.trim());
//     proxyIndicators.push(`XFF Chain: ${ips.length} IPs`);
//     proxyScore += ips.length * 5;
//   }

//   // 3. 检查 Via 头（代理服务器标识）
//   const viaHeader = req.headers["via"];
//   if (viaHeader) {
//     proxyIndicators.push(`Via: ${viaHeader.substring(0, 50)}`);
//     proxyScore += 20;
//   }

//   // 4. 检查 User-Agent 是否包含代理特征
//   const userAgent = req.headers["user-agent"] || "";
//   const proxyUAPatterns = [
//     /proxy/i,
//     /squid/i,
//     /nginx/i,
//     /apache/i,
//     /cloudflare/i,
//     /fastly/i,
//     /varnish/i,
//   ];

//   const foundUAPatterns = proxyUAPatterns.filter((pattern) =>
//     pattern.test(userAgent)
//   );
//   if (foundUAPatterns.length > 0) {
//     proxyIndicators.push("UA: Proxy signatures");
//     proxyScore += 15;
//   }

//   // 5. 检查IP信息中的ISP是否为已知代理服务商
//   if (ipInfo?.isp) {
//     const proxyISPs = [
//       /cloudflare/i,
//       /fastly/i,
//       /amazon/i,
//       /google/i,
//       /microsoft/i,
//       /digitalocean/i,
//       /linode/i,
//       /vultr/i,
//       /ovh/i,
//       /hetzner/i,
//       /proxy/i,
//       /vpn/i,
//       /hosting/i,
//       /datacenter/i,
//       /server/i,
//       /cloud/i,
//     ];

//     const foundISPPatterns = proxyISPs.filter((pattern) =>
//       pattern.test(ipInfo.isp)
//     );
//     if (foundISPPatterns.length > 0) {
//       proxyIndicators.push(`ISP: ${ipInfo.isp}`);
//       proxyScore += 25;
//     }
//   }

//   // 6. 检查IP地址类型（私有IP、本地IP等）
//   const clientIP =
//     req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
//     req.headers["x-real-ip"] ||
//     req.connection.remoteAddress ||
//     req.socket.remoteAddress ||
//     req.ip ||
//     "unknown";

//   // 检查是否为私有IP或本地IP
//   const privateIPPatterns = [
//     /^10\./,
//     /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
//     /^192\.168\./,
//     /^127\./,
//     /^::1$/,
//     /^fc00:/,
//     /^fe80:/,
//   ];

//   if (privateIPPatterns.some((pattern) => pattern.test(clientIP))) {
//     proxyIndicators.push(`Private IP: ${clientIP}`);
//     proxyScore += 30;
//   }

//   // 7. 检查端口信息
//   const forwardedPort = req.headers["x-forwarded-port"];
//   if (forwardedPort && forwardedPort !== "80" && forwardedPort !== "443") {
//     proxyIndicators.push(`Port: ${forwardedPort}`);
//     proxyScore += 10;
//   }

//   // 判断代理可能性
//   let proxyLikelihood = "No";
//   if (proxyScore >= 50) {
//     proxyLikelihood = "High";
//   } else if (proxyScore >= 25) {
//     proxyLikelihood = "Medium";
//   } else if (proxyScore >= 10) {
//     proxyLikelihood = "Low";
//   }

//   return {
//     isProxy: proxyScore >= 10,
//     likelihood: proxyLikelihood,
//     score: proxyScore,
//     indicators: proxyIndicators,
//     clientIP,
//   };
// }

/**
 * POST /errors
 * 前端错误上报接口
 * 接收前端错误信息并转发给 DataDog
 * 校验宽松，前端传什么就上报什么
 */
router.post(
  "/errors",
  [
    securityMiddleware,
    // 只做最基本的校验
    body("errors").optional().isArray(),
    body("timestamp").optional(),
    body("userAgent").optional(),
    body("url").optional(),
    body("sessionId").optional(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const reportData = req.body;
      const version = req?.securityContext?.version || "unknown";
      const fingerprint = req?.securityContext?.fingerprint || "unknown";

      // 基础标签
      const baseTags = [
        `version:${version}`,
        `fingerprint:${fingerprint.slice(0, 8)}`, // 只取前8位
      ];

      // 如果有 errors 数组，合并所有错误信息
      if (Array.isArray(reportData.errors) && reportData.errors.length > 0) {
        // 合并所有错误信息为一个大的message
        const errorMessages = reportData.errors
          .map((error, index) => {
            const parts = [];
            if (error.message) parts.push(`Message: ${error.message}`);
            if (error.errorType) parts.push(`Type: ${error.errorType}`);
            if (error.source) parts.push(`Source: ${error.source}`);
            if (error.filename) parts.push(`File: ${error.filename}`);
            if (error.lineno) parts.push(`Line: ${error.lineno}`);
            if (error.count && error.count > 1)
              parts.push(`Count: ${error.count}`);

            return `[Error ${index + 1}] ${parts.join(" | ")}`;
          })
          .join("\n");

        // 限制总长度，避免超出DataDog限制
        const maxLength = 4000;
        const finalMessage =
          errorMessages.length > maxLength
            ? errorMessages.substring(0, maxLength - 20) + "...[truncated]"
            : errorMessages;

        // 统计错误类型分布
        const errorTypes = reportData.errors.map(
          (e) => e.errorType || "unknown"
        );
        const priorityLevels = reportData.errors.map(
          (e) => e.priority || "unknown"
        );
        const totalCount = reportData.errors.reduce(
          (sum, e) => sum + (Number(e.count) || 1),
          0
        );

        const errorTags = [
          ...baseTags,
          `error_types:${[...new Set(errorTypes)].join(",")}`,
          `priorities:${[...new Set(priorityLevels)].join(",")}`,
          `total_errors:${reportData.errors.length}`,
          `total_count:${totalCount}`,
        ];

        console.log("errorTags", errorTags);
        console.log("finalMessage", finalMessage);
      }

      res.status(200).json({
        status: "success",
      });
    } catch (error) {
      console.error("Error reporting failed:", error);
      res.status(500).json({
        status: "error",
        message: "错误报告处理失败",
      });
    }
  }
);

/**
 * POST /request-delay
 * 前端请求延迟统计接口（已废弃，仅为兼容线上版本）
 * 直接返回成功状态，不做任何处理
 */
router.post(
  "/request-delay",
  [securityMiddleware, validateRequest],
  async (req, res) => {
    // 为了兼容线上版本，直接返回成功
    res.status(200).json({
      status: "success",
    });
  }
);

/**
 * 检查是否为重复上报
 * @param {Object} req - 请求对象
 * @param {string} clientIP - 客户端IP
 * @returns {Promise<boolean>} - 是否为重复上报
 */
async function isDuplicateReport(req, clientIP) {
  try {
    const cacheKey = `high_delay_report:${clientIP}`;
    const lastReportTime = await req.redisClient.get(cacheKey);

    if (lastReportTime) {
      const timeDiff = Date.now() - parseInt(lastReportTime, 10);
      const tenMinutes = 10 * 60 * 1000; // 10分钟

      if (timeDiff < tenMinutes) {
        // 记录重复上报统计
        if (req.dataDog) {
          // req.dataDog.increment("high_delay_report.duplicate", 1, [
          //   `ip:${clientIP}`,
          //   `time_since_last:${Math.round(timeDiff / 1000)}s`,
          // ]);
        }
        return true;
      }
    }

    // 设置新的上报时间（10分钟过期）
    await req.redisClient.setEx(cacheKey, 10 * 60, Date.now().toString());
    return false;
  } catch (redisError) {
    console.error("Redis error in duplicate check:", redisError);
    // Redis 出错时不阻止上报，但记录错误
    if (req.dataDog) {
      // req.dataDog.increment("high_delay_report.redis_error", 1, [
      //   `error:${redisError.message.substring(0, 50)}`,
      // ]);
    }
    return false;
  }
}

/**
 * POST /high-delay
 * 前端高延迟请求上报接口
 * ⚠️ 已废弃：直接返回 200，不执行任何处理逻辑
 */
router.post("/high-delay", async (req, res) => {
  // 废弃接口，直接返回 200
  res.status(200).json({
    status: "success",
  });
});

/**
 * GET /health
 * 健康检查接口
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "xhunt-report-api",
  });
});

module.exports = router;
