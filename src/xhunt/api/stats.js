const express = require("express");
const path = require("path");
const { getFullStats, getSimpleStats } = require("../services/statsService");
const {
  adminAuth,
  requirePermission,
} = require("../../admin/middleware/adminAuth");
const axios = require("axios");
const expressStatic = require("express");
const XLSX = require("xlsx");
const fs = require("fs").promises;
const fsSync = require("fs");
const os = require("os");
const { createReadStream } = require("fs");
const readline = require("readline");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { XhuntAdminAuditLog } = require("../../models/postgres-start");

const router = express.Router();

// -------------------- Nacos Config Admin (with auth) --------------------
const NACOS_BASE_URL = process.env.NACOS_BASE_URL || "http://127.0.0.1:8848";
const NACOS_USERNAME = process.env.NACOS_USERNAME || "nacos";
const NACOS_PASSWORD = process.env.NACOS_PASSWORD || "nacos";

let nacosTokenCache = { token: null, expireAt: 0 };

async function getNacosAccessToken() {
  const now = Date.now();
  if (nacosTokenCache.token && now < nacosTokenCache.expireAt - 10_000) {
    return nacosTokenCache.token;
  }

  // Nacos 登录 API：POST /nacos/v1/auth/users/login
  // 返回结构通常包含：{ accessToken, tokenTtl }
  const url = `${NACOS_BASE_URL}/nacos/v1/auth/users/login`;

  const resp = await axios.post(
    url,
    new URLSearchParams({
      username: NACOS_USERNAME,
      password: NACOS_PASSWORD,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8000,
      validateStatus: () => true,
    }
  );

  if (resp.status !== 200 || !resp.data) {
    throw new Error(`Nacos 登录失败: status=${resp.status}`);
  }

  const token =
    resp.data.accessToken || resp.data.token || resp.data.access_token;
  const ttlSec = Number(resp.data.tokenTtl || resp.data.token_ttl || 1800);

  if (!token) {
    throw new Error("Nacos 登录失败: 未返回 accessToken");
  }

  nacosTokenCache = {
    token,
    expireAt: now + ttlSec * 1000,
  };

  return token;
}

async function nacosRequest(method, path, { params, data, headers } = {}) {
  const token = await getNacosAccessToken();
  const url = `${NACOS_BASE_URL}${path}`;

  // 多数 Nacos 版本支持 accessToken 作为 query 参数
  const finalParams = { ...(params || {}), accessToken: token };

  const resp = await axios({
    method,
    url,
    params: finalParams,
    data,
    headers,
    timeout: 10000,
    validateStatus: () => true,
  });

  // token 过期/无效：尝试刷新一次 token 再重试
  if (resp.status === 403 || resp.status === 401) {
    nacosTokenCache = { token: null, expireAt: 0 };
    const token2 = await getNacosAccessToken();
    const resp2 = await axios({
      method,
      url,
      params: { ...(params || {}), accessToken: token2 },
      data,
      headers,
      timeout: 10000,
      validateStatus: () => true,
    });
    return resp2;
  }

  return resp;
}

// 文件缓存，避免重复读取
const fileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/**
 * 高效搜索日志文件 - 优化版本
 */
async function searchLogFile(filePath, query, contextLines, limit) {
  // 检查缓存
  const cacheKey = `${filePath}-${query}-${contextLines}`;
  const cached = fileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results.slice(0, limit);
  }

  try {
    // 直接读取文件内容（对于日志文件，这通常是最快的方法）
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");

    const results = [];
    let matchCount = 0;

    // 从文件底部开始往前搜索（最新的日志在底部）
    for (let i = lines.length - 1; i >= 0; i--) {
      if (matchCount >= limit) break;

      const line = lines[i];
      if (line.toLowerCase().includes(query.toLowerCase())) {
        // 获取上下文行
        const startLine = Math.max(0, i - contextLines);
        const endLine = Math.min(lines.length - 1, i + contextLines);

        const context = [];
        for (let j = startLine; j <= endLine; j++) {
          context.push({
            lineNumber: j + 1,
            content: lines[j],
            isMatch: j === i,
          });
        }
        results.push({
          lineNumber: i + 1,
          context: context,
          matchLine: line,
        });

        matchCount++;
      }
    }

    // 缓存结果
    fileCache.set(cacheKey, {
      results: results,
      timestamp: Date.now(),
    });

    // 清理旧缓存
    if (fileCache.size > 50) {
      const now = Date.now();
      for (const [key, value] of fileCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          fileCache.delete(key);
        }
      }
    }

    return results;
  } catch (error) {
    console.error(`Error reading log file ${filePath}:`, error);
    return [];
  }
}

/**
 * 格式化数字（添加千分位分隔符）
 */
function formatNumber(num) {
  // 处理 null、undefined 和非数字值
  if (num === null || num === undefined || isNaN(num)) {
    return "0";
  }
  return num.toLocaleString();
}

/**
 * 格式化日期时间（中国时区）
 */
function formatDateTime(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// 旧版 basicAuth 和 /logout 已废弃，改为基于 adminAuth 的 JWT Cookie 方案

// 管理员审计日志记录辅助函数（仅记录危险操作或登录/登出，由各路由调用）
async function logAdminAction(req, { action, success, message }) {
  try {
    const admin = req.adminUser;
    if (!admin) return;
    await XhuntAdminAuditLog.create({
      adminId: admin.id,
      email: admin.email,
      action,
      route: req.originalUrl || req.path || "",
      method: req.method || "",
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      payload: req.method === "GET" ? null : JSON.stringify(req.body || {}),
      success: !!success,
      message: message || null,
    });
  } catch (e) {
    // 静默失败，避免影响主流程
  }
}

/**
 * GET /stats
 * 获取产品数据统计（需要认证）
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    // 设置静态文件服务（在每次请求时设置）
    const app = req.app;
    const staticPath = path.join(__dirname, "../../public/static");
    app.use("/static", expressStatic.static(staticPath));

    // 获取统计数据
    const stats = await getFullStats(req.redisClient);

    // 将统计数据传递给前端JavaScript（用于下载功能）
    const statsDataScript = `<script>window.statsData = ${JSON.stringify(
      stats
    )};</script>`;

    // 设置 EJS 模板引擎
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "../views"));

    // 渲染模板，传递所有需要的辅助函数和数据
    const renderedHtml = await new Promise((resolve, reject) => {
      app.render(
        "stats",
        {
          stats,
          formatNumber,
          formatDateTime,
          user: req.user, // 传递用户信息
        },
        (err, html) => {
          if (err) reject(err);
          else resolve(html);
        }
      );
    });

    // 在HTML中注入统计数据脚本与权限
    const permsScript = `<script>window.adminPermissions = ${JSON.stringify(
      req.user?.permissions || []
    )};</script><script>window.__adminRole=${JSON.stringify(
      req.user?.role || ""
    )};window.__isSuperAdmin=${JSON.stringify(
      req.user?.role === "super"
    )};</script>`;
    const finalHtml = renderedHtml.replace(
      "</body>",
      `${statsDataScript}${permsScript}</body>`
    );

    res.send(finalHtml);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      error: "获取统计数据失败",
      message: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /stats/json
 * 获取JSON格式的统计数据（用于API调用，也需要认证）
 */
router.get("/json", adminAuth, async (req, res) => {
  try {
    const stats = await getSimpleStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching JSON stats:", error);
    res.status(500).json({
      success: false,
      error: "获取统计数据失败",
    });
  }
});

/**
 * GET /dau-details
 * 获取指定日期的详细日活数据（需要认证）
 */
router.get(
  "/dau-details",
  adminAuth,
  requirePermission("dau-details"),
  async (req, res) => {
    try {
      const { date } = req.query;

      // 如果没有指定日期，使用今天
      let targetDate = date;
      if (!targetDate) {
        const beijingTime = new Date().toLocaleString("en-US", {
          timeZone: "Asia/Shanghai",
        });
        targetDate = new Date(beijingTime).toISOString().split("T")[0];
      }

      // 验证日期格式
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return res.status(400).json({
          success: false,
          error: "日期格式错误，请使用 YYYY-MM-DD 格式",
        });
      }

      const dauKey = `dau:${targetDate}`;
      const dauMembers = await req.redisClient.sMembers(dauKey);

      // 解析每个成员，提取 fingerprint 和 x-user-id
      const dauDetails = dauMembers.map((member) => {
        const parts = member.split(",");
        if (parts.length === 2) {
          return {
            fingerprint: parts[0],
            userId: parts[1],
          };
        } else {
          // 兼容旧格式（只有fingerprint）
          return {
            fingerprint: member,
            userId: "未知",
          };
        }
      });

      res.json({
        success: true,
        data: {
          date: targetDate,
          totalCount: dauDetails.length,
          details: dauDetails,
        },
      });
    } catch (error) {
      console.error("Error fetching DAU details:", error);
      res.status(500).json({
        success: false,
        error: "获取日活详情失败",
      });
    }
  }
);

/**
 * GET /online-users
 * 获取最近10分钟内的在线用户列表（需要认证）
 */
router.get(
  "/online-users",
  adminAuth,
  requirePermission("online-users"),
  async (req, res) => {
    try {
      const { page = 1, limit = 100 } = req.query;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // 计算10分钟前的时间
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      // 获取在线用户数据
      const postgresModels = require("../../models/postgres-start");
      const XHuntUserToken = postgresModels.XHuntUserToken;
      const XHuntUser = postgresModels.XHuntUser;
      const { Op } = require("sequelize");

      // 查询最近10分钟内有活动的用户
      const onlineUsers = await XHuntUserToken.findAll({
        where: {
          lastUsed: {
            [Op.gte]: tenMinutesAgo,
          },
          isRevoked: false,
        },
        include: [
          {
            model: XHuntUser,
            as: "user",
            attributes: ["id", "twitterId", "username", "displayName"],
          },
        ],
        attributes: ["id", "lastUsed"],
        order: [["lastUsed", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      // 获取总数
      const totalCount = await XHuntUserToken.count({
        where: {
          lastUsed: {
            [Op.gte]: tenMinutesAgo,
          },
          isRevoked: false,
        },
      });

      // 格式化数据
      const formattedUsers = onlineUsers.map((token) => ({
        id: token.user.id,
        twitterId: token.user.twitterId,
        username: token.user.username || token.user.twitterId,
        displayName:
          token.user.displayName || token.user.username || token.user.twitterId,
        lastUsed: token.lastUsed,
      }));

      res.json({
        success: true,
        data: {
          users: formattedUsers,
          pagination: {
            currentPage: pageNum,
            pageSize: limitNum,
            totalCount: totalCount,
            totalPages: Math.ceil(totalCount / limitNum),
          },
        },
      });
    } catch (error) {
      console.error("Error fetching online users:", error);
      res.status(500).json({
        success: false,
        error: "获取在线用户失败",
      });
    }
  }
);

/**
 * GET /export/users/excel
 * 导出所有已登录用户数据为Excel文件（需要认证，仅 luykin 用户）
 */
router.get(
  "/export/users/excel",
  adminAuth,
  requirePermission("export:users"),
  async (req, res) => {
    try {
      console.log(`[数据导出] ✅ 权限验证通过: 用户=${req.user.username}`);

      // 获取PostgreSQL模型
      const postgresModels = require("../../models/postgres-start");
      const XHuntUser = postgresModels.XHuntUser;

      // 查询所有用户数据
      const users = await XHuntUser.findAll({
        attributes: ["twitterId", "username", "displayName"],
        order: [["createdAt", "DESC"]],
      });

      // 准备Excel数据
      const excelData = users.map((user, index) => ({
        序号: index + 1,
        "Twitter ID": user.twitterId,
        用户名: user.username || "",
        显示名称: user.displayName || "",
      }));

      // 创建工作簿
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // 设置列宽
      const colWidths = [
        { wch: 8 }, // 序号
        { wch: 20 }, // Twitter ID
        { wch: 25 }, // 用户名
        { wch: 25 }, // 显示名称
      ];
      worksheet["!cols"] = colWidths;

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(workbook, worksheet, "用户数据");

      // 生成Excel文件
      const excelBuffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      // 设置响应头
      const fileName = `XHunt用户数据_${
        new Date().toISOString().split("T")[0]
      }.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileName)}"`
      );
      res.setHeader("Content-Length", excelBuffer.length);

      // 发送文件
      res.send(excelBuffer);

      console.log(`✅ 用户数据Excel导出完成: ${users.length} 个用户`);
    } catch (error) {
      console.error("Error exporting users Excel:", error);
      res.status(500).json({
        success: false,
        error: "导出用户数据失败",
      });
    }
  }
);

/**
 * GET /export/active-users/js
 * 导出所有活跃用户名为 JavaScript 文件（需要认证，仅 luykin 用户）
 */
router.get("/export/active-users/js", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以执行数据导出操作
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[数据导出] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "权限不足",
      });
    }

    console.log(
      `[数据导出] ✅ 权限验证通过: 用户=${req.user.username}, 角色=${req.user.role}`
    );

    // 获取PostgreSQL模型
    const postgresModels = require("../../models/postgres-start");
    const DailyActiveUser = postgresModels.DailyActiveUser;

    // 查询所有活跃用户记录并在内存中去重
    // 注意：DailyActiveUser.userId 存储的直接就是 username，不需要查询 XHuntUser 表
    const allActiveUsers = await DailyActiveUser.findAll({
      attributes: ["userId"],
      raw: true,
    });

    // 直接从 userId 提取用户名并去重（过滤 null/undefined/空字符串）
    const usernames = [
      ...new Set(
        allActiveUsers
          .map((record) => record.userId)
          .filter(
            (username) =>
              username && typeof username === "string" && username.trim() !== ""
          )
      ),
    ].sort(); // 排序以便查看

    console.log(
      `[数据导出] 找到 ${allActiveUsers.length} 条活跃记录，${usernames.length} 个唯一用户名（去重后）`
    );

    if (usernames.length === 0) {
      return res.status(404).json({
        success: false,
        error: "没有找到活跃用户数据",
      });
    }

    console.log(
      `[数据导出] 最终获得 ${usernames.length} 个有效用户名（去重后）`
    );

    // 生成 JavaScript 文件内容
    // 注意：使用 exports.allActiveUserName 而不是 exports allActiveUserName
    const jsContent = `exports.allActiveUserName = [\n${usernames
      .map((username) => `  "${username.replace(/"/g, '\\"')}"`)
      .join(",\n")}\n];\n`;

    // 设置响应头
    const fileName = `allActiveUserName_${
      new Date().toISOString().split("T")[0]
    }.js`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    res.setHeader("Content-Length", Buffer.byteLength(jsContent, "utf8"));

    // 禁用缓存
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // 发送文件
    res.send(jsContent);

    console.log(
      `✅ 活跃用户名JS导出完成: ${usernames.length} 个用户名（去重后）`
    );
  } catch (error) {
    console.error("[数据导出] ❌ 导出活跃用户名JS失败:", error);
    console.error("[数据导出] 错误堆栈:", error.stack);
    res.status(500).json({
      success: false,
      error: "导出活跃用户数据失败",
      message: error.message || "未知错误",
    });
  }
});

/**
 * GET /log-search
 * 日志搜索接口（需要认证，仅 luykin 用户）- 优化版本
 */
router.get(
  "/log-search",
  adminAuth,
  requirePermission("log-search:read"),
  async (req, res) => {
    try {
      console.log(`[日志搜索] ✅ 权限验证通过: 用户=${req.user.username}`);

      const { query, contextLines = 3, limit = 5 } = req.query;

      if (!query || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "搜索关键词不能为空",
        });
      }

      // 获取 PM2 日志目录
      const homeDir = os.homedir();
      const pm2LogsDir = path.join(homeDir, ".pm2", "logs");

      // 检查日志目录是否存在
      try {
        await fs.access(pm2LogsDir);
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: "PM2 日志目录不存在",
        });
      }

      // 获取所有日志文件
      const files = await fs.readdir(pm2LogsDir);
      const logFiles = [];

      // 并行过滤和检查日志文件
      const fileCheckPromises = files
        .filter((file) => file.endsWith(".log"))
        .map(async (file) => {
          const filePath = path.join(pm2LogsDir, file);
          try {
            const stats = await fs.stat(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            // 跳过大于200MB的文件或0MB的空文件
            if (fileSizeMB > 200 || fileSizeMB === 0) {
              return null;
            }

            return {
              name: file,
              path: filePath,
              mtime: stats.mtime.getTime(),
              size: fileSizeMB,
            };
          } catch (error) {
            console.error(`Error checking file ${file}:`, error);
            return null;
          }
        });

      const fileResults = await Promise.all(fileCheckPromises);
      logFiles.push(...fileResults.filter((file) => file !== null));

      // 按修改时间排序（最新的在前）
      logFiles.sort((a, b) => b.mtime - a.mtime);

      const results = [];
      const contextLinesNum = parseInt(contextLines);
      const limitNum = parseInt(limit);
      let totalMatches = 0;

      // 串行搜索日志文件（安全稳定）
      for (const file of logFiles) {
        if (totalMatches >= limitNum) break;

        try {
          const fileResults = await searchLogFile(
            file.path,
            query,
            contextLinesNum,
            limitNum - totalMatches
          );

          const formattedResults = fileResults.map((result) => ({
            ...result,
            file: file.name,
            timestamp: file.mtime,
          }));

          results.push(...formattedResults);
          totalMatches += formattedResults.length;
        } catch (error) {
          console.error(`Error reading log file ${file.name}:`, error);
          continue;
        }
      }

      res.json({
        success: true,
        data: {
          query: query,
          totalMatches: totalMatches,
          results: results,
          searchedFiles: logFiles.length,
          totalFiles: logFiles.length,
          fileSizes: logFiles.map((f) => ({
            name: f.name,
            size: f.size,
          })),
        },
      });
    } catch (error) {
      console.error("Error searching logs:", error);
      res.status(500).json({
        success: false,
        error: "日志搜索失败",
      });
    }
  }
);

/**
 * GET /error-logs
 * 获取最新API错误日志（需要认证）
 */
router.get(
  "/error-logs",
  adminAuth,
  requirePermission("error-logs:read"),
  async (req, res) => {
    try {
      const { lines = 1000 } = req.query;
      const linesNum = parseInt(lines);

      // 获取 PM2 日志目录
      const homeDir = os.homedir();
      const pm2LogsDir = path.join(homeDir, ".pm2", "logs");

      // 检查日志目录是否存在
      try {
        await fs.access(pm2LogsDir);
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: "PM2 日志目录不存在",
        });
      }

      // 获取所有API错误日志文件
      const files = await fs.readdir(pm2LogsDir);
      const errorLogFiles = [];

      // 过滤API错误日志文件
      for (const file of files) {
        if (file.endsWith(".log") && file.includes("api-error")) {
          const filePath = path.join(pm2LogsDir, file);

          try {
            const stats = await fs.stat(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            // 跳过空文件
            if (fileSizeMB === 0) {
              continue;
            }

            errorLogFiles.push({
              name: file,
              path: filePath,
              mtime: stats.mtime.getTime(),
              size: fileSizeMB,
            });
          } catch (error) {
            console.error(`Error checking file ${file}:`, error);
            continue;
          }
        }
      }

      // 按修改时间排序（最新的在前）
      errorLogFiles.sort((a, b) => b.mtime - a.mtime);

      const allLogs = [];
      let totalLines = 0;

      // 读取每个错误日志文件的最新内容
      for (const file of errorLogFiles) {
        if (totalLines >= linesNum) break;

        try {
          const content = await fs.readFile(file.path, "utf8");
          const lines = content
            .split("\n")
            .filter((line) => line.trim().length > 0);

          // 从文件底部开始取最新的行
          const remainingLines = linesNum - totalLines;
          const startIndex = Math.max(0, lines.length - remainingLines);
          const recentLines = lines.slice(startIndex);

          // 为每行添加文件信息
          recentLines.forEach((line) => {
            allLogs.push(`[${file.name}] ${line}`);
          });

          totalLines += recentLines.length;
        } catch (error) {
          console.error(`Error reading log file ${file.name}:`, error);
          continue;
        }
      }

      // 按时间倒序排列（最新的在前）
      allLogs.reverse();

      res.json({
        success: true,
        data: {
          logs: allLogs,
          totalLines: allLogs.length,
          files: errorLogFiles.map((f) => ({
            name: f.name,
            size: f.size,
          })),
        },
      });
    } catch (error) {
      console.error("Error loading error logs:", error);
      res.status(500).json({
        success: false,
        error: "加载错误日志失败",
      });
    }
  }
);

/**
 * GET /notes
 * 获取指定日期的用户备注数据（需要认证）
 */
router.get("/notes", adminAuth, async (req, res) => {
  try {
    const { date, page = 1, limit = 50 } = req.query;

    // 如果没有指定日期，使用今天
    let targetDate = date;
    if (!targetDate) {
      const beijingTime = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Shanghai",
      });
      targetDate = new Date(beijingTime).toISOString().split("T")[0];
    }

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({
        success: false,
        error: "日期格式错误，请使用 YYYY-MM-DD 格式",
      });
    }

    // 计算日期范围（北京时间）
    const startDate = new Date(targetDate + "T00:00:00+08:00");
    const endDate = new Date(targetDate + "T23:59:59+08:00");

    // 获取PostgreSQL模型
    const postgresModels = require("../../models/postgres-start");
    const XPrivateNote = postgresModels.XPrivateNote;
    const XHuntUser = postgresModels.XHuntUser;
    const XAccount = postgresModels.XAccount;
    const { Op } = require("sequelize");

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // 查询备注数据
    const notes = await XPrivateNote.findAll({
      where: {
        createdAt: {
          [Op.gte]: startDate,
          [Op.lte]: endDate,
        },
      },
      include: [
        {
          model: XHuntUser,
          as: "xHuntUser",
          attributes: ["id", "username", "displayName"],
        },
        {
          model: XAccount,
          as: "xAccount",
          attributes: ["id", "handle", "displayName"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: offset,
    });

    // 获取总数
    const totalCount = await XPrivateNote.count({
      where: {
        createdAt: {
          [Op.gte]: startDate,
          [Op.lte]: endDate,
        },
      },
    });

    // 获取统计信息
    const stats = await Promise.all([
      // 总备注数
      XPrivateNote.count({
        where: {
          createdAt: {
            [Op.gte]: startDate,
            [Op.lte]: endDate,
          },
        },
      }),
      // 独立用户数
      XPrivateNote.count({
        where: {
          createdAt: {
            [Op.gte]: startDate,
            [Op.lte]: endDate,
          },
        },
        distinct: true,
        col: "xHuntUserId",
      }),
      // 独立账号数
      XPrivateNote.count({
        where: {
          createdAt: {
            [Op.gte]: startDate,
            [Op.lte]: endDate,
          },
        },
        distinct: true,
        col: "xAccountId",
      }),
    ]);

    // 格式化数据
    const formattedNotes = notes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt,
      userUsername: note.xHuntUser?.username,
      userDisplayName: note.xHuntUser?.displayName,
      accountHandle: note.xAccount?.handle,
      accountDisplayName: note.xAccount?.displayName,
    }));

    res.json({
      success: true,
      data: {
        notes: formattedNotes,
        stats: {
          totalNotes: stats[0],
          uniqueUsers: stats[1],
          uniqueAccounts: stats[2],
        },
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalCount: totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
        date: targetDate,
      },
    });
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).json({
      success: false,
      error: "获取备注数据失败",
    });
  }
});

/**
 * POST /send-messages
 * 批量发送私信（需要认证，仅 luykin 用户）
 */
router.post("/send-messages", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以执行批量发送私信操作
    if (!req.user || req.user.role !== "super") {
      await logAdminAction(req, {
        action: "send-messages",
        success: false,
        message: "forbidden",
      });
      console.log(
        `[批量发送私信] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "权限不足",
      });
    }

    console.log(
      `[批量发送私信] ✅ 权限验证通过: 用户=${req.user.username}, 角色=${req.user.role}`
    );

    const { campaignId, title, content, handlers, reportUrls } = req.body;

    // 验证必需参数
    if (
      !campaignId ||
      !title ||
      !content ||
      !handlers ||
      !Array.isArray(handlers) ||
      handlers.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "缺少必需参数：campaignId, title, content, handlers",
      });
    }

    // 获取PostgreSQL模型
    const postgresModels = require("../../models/postgres-start");
    const XPrivateMessage = postgresModels.XPrivateMessage;
    const XHuntUser = postgresModels.XHuntUser;
    const { Op } = require("sequelize");

    const results = {
      success: [],
      notFound: [],
      alreadySent: [],
      errors: [],
    };

    // 处理每个用户
    for (let i = 0; i < handlers.length; i++) {
      const username = handlers[i];
      const reportUrl = reportUrls && reportUrls[i] ? reportUrls[i] : "";

      try {
        console.log(`处理用户: ${username}`);

        // 查找用户（大小写不敏感）
        const user = await XHuntUser.findOne({
          where: {
            username: {
              [Op.iLike]: username,
            },
          },
        });

        if (!user) {
          console.log(`用户 ${username} 未找到`);
          results.notFound.push(username);
          continue;
        }

        // 检查是否已经发送过相同活动的消息
        const existingMessage = await XPrivateMessage.findOne({
          where: {
            receiverId: user.id,
            campaignId: campaignId,
          },
        });

        if (existingMessage) {
          console.log(`用户 ${username} 已经收到过活动 ${campaignId} 的消息`);
          results.alreadySent.push(username);
          continue;
        }

        // 个性化内容（替换占位符）
        const personalizedContent = content
          .replace(/\{\{\s*username\s*\}\}/g, username)
          .replace(/\{\{\s*reportUrl\s*\}\}/g, reportUrl);

        // 创建私信记录
        const message = await XPrivateMessage.create({
          senderId: "6666666d-cc11-8888-8888-034d3e9a8888",
          receiverId: user.id,
          title: title,
          content: personalizedContent,
          displayAt: new Date(),
          sentAt: new Date(),
          isRead: false,
          campaignId: campaignId,
        });

        console.log(`✅ 成功发送私信给用户 ${username} (ID: ${user.id})`);
        results.success.push({
          username: username,
          userId: user.id,
          messageId: message.id,
        });
      } catch (error) {
        console.error(`❌ 处理用户 ${username} 时出错:`, error.message);
        results.errors.push({
          username: username,
          error: error.message,
        });
      }
    }

    // 输出结果统计
    console.log("\n=== 私信发送结果统计 ===");
    console.log(`✅ 成功发送: ${results.success.length} 条`);
    console.log(`❓ 用户未找到: ${results.notFound.length} 个`);
    console.log(`🔄 已发送过: ${results.alreadySent.length} 个`);
    console.log(`❌ 发送失败: ${results.errors.length} 个`);

    res.json({
      success: true,
      data: results,
      message: `私信发送完成：成功 ${results.success.length} 条，失败 ${results.errors.length} 条`,
    });
  } catch (error) {
    console.error("Error sending messages:", error);
    res.status(500).json({
      success: false,
      error: "发送私信失败",
    });
  }
});

/**
 * GET /weekly-cohorts
 * 获取周级活跃cohort分析数据（需要认证）
 */
router.get("/weekly-cohorts", adminAuth, async (req, res) => {
  try {
    const postgresModels = require("../../models/postgres-start");
    const DailyActiveUser = postgresModels.DailyActiveUser;
    const { Op } = require("sequelize");

    // 获取所有活跃记录，按用户和日期分组
    const allRecords = await DailyActiveUser.findAll({
      attributes: ["userId", "date"],
      order: [["date", "ASC"]],
      raw: true,
    });

    // 计算每个用户的首次活跃日期
    const userFirstActiveDate = new Map();
    for (const record of allRecords) {
      const { userId, date } = record;
      if (!userFirstActiveDate.has(userId)) {
        userFirstActiveDate.set(userId, date);
      }
    }

    // 按周分组计算cohort
    const cohorts = new Map(); // key: weekStart, value: {users: Set, weekDates: Map}

    for (const [userId, firstDate] of userFirstActiveDate.entries()) {
      const firstDateObj = new Date(firstDate);

      // 计算第一周的周一开始日期（中国时区）
      const dayOfWeek = firstDateObj.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const firstMonday = new Date(firstDateObj);
      firstMonday.setDate(firstMonday.getDate() + mondayOffset);

      // 格式化为 YYYY-MM-DD
      const weekStart = firstMonday.toISOString().split("T")[0];

      if (!cohorts.has(weekStart)) {
        cohorts.set(weekStart, {
          weekStart: weekStart,
          users: new Set(),
          activeDates: new Set(), // 该cohort在哪些日期活跃
        });
      }

      cohorts.get(weekStart).users.add(userId);

      // 找出该用户活跃的所有日期，加入到cohort的活跃日期集合中
      for (const record of allRecords) {
        if (record.userId === userId) {
          cohorts.get(weekStart).activeDates.add(record.date);
        }
      }
    }

    // 计算每个cohort在后续周的活跃情况
    const cohortResults = [];
    for (const [weekStart, cohort] of cohorts.entries()) {
      const weekStartDate = new Date(weekStart);
      const cohortUsers = cohort.users;
      const totalUsers = cohortUsers.size;

      // 计算第2周、第3周、第4周的日期范围
      const week2Start = new Date(weekStartDate);
      week2Start.setDate(weekStartDate.getDate() + 7);
      const week2StartStr = week2Start.toISOString().split("T")[0];

      const week3Start = new Date(weekStartDate);
      week3Start.setDate(weekStartDate.getDate() + 14);
      const week3StartStr = week3Start.toISOString().split("T")[0];

      const week4Start = new Date(weekStartDate);
      week4Start.setDate(weekStartDate.getDate() + 21);
      const week4StartStr = week4Start.toISOString().split("T")[0];

      // 计算每周的活跃用户数
      const week2Users = new Set();
      const week3Users = new Set();
      const week4Users = new Set();

      for (const record of allRecords) {
        if (!cohortUsers.has(record.userId)) continue;

        const recordDate = record.date;

        // 检查是否在第2周
        if (recordDate >= week2StartStr && recordDate < week3StartStr) {
          week2Users.add(record.userId);
        }

        // 检查是否在第3周
        if (recordDate >= week3StartStr && recordDate < week4StartStr) {
          week3Users.add(record.userId);
        }

        // 检查是否在第4周
        if (recordDate >= week4StartStr) {
          week4Users.add(record.userId);
        }
      }

      // 计算留存率
      const week2Retention =
        totalUsers > 0 ? ((week2Users.size / totalUsers) * 100).toFixed(1) : 0;
      const week3Retention =
        totalUsers > 0 ? ((week3Users.size / totalUsers) * 100).toFixed(1) : 0;
      const week4Retention =
        totalUsers > 0 ? ((week4Users.size / totalUsers) * 100).toFixed(1) : 0;

      cohortResults.push({
        weekStart: weekStart,
        newUsers: totalUsers,
        week2Active: week2Users.size,
        week2Retention: week2Retention,
        week3Active: week3Users.size,
        week3Retention: week3Retention,
        week4Active: week4Users.size,
        week4Retention: week4Retention,
      });
    }

    // 按周开始日期倒序排列
    cohortResults.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    // 只返回最近8周的数据
    const recentCohorts = cohortResults.slice(0, 8);

    res.json({
      success: true,
      data: {
        cohorts: recentCohorts,
        totalCohorts: recentCohorts.length,
      },
    });
  } catch (error) {
    console.error("Error fetching weekly cohorts:", error);
    res.status(500).json({
      success: false,
      error: "获取周级cohort数据失败",
    });
  }
});

/**
 * GET /daily-cohorts
 * 获取天级活跃cohort分析数据（需要认证）
 */
router.get("/daily-cohorts", adminAuth, async (req, res) => {
  try {
    const postgresModels = require("../../models/postgres-start");
    const DailyActiveUser = postgresModels.DailyActiveUser;
    const { Op } = require("sequelize");

    // 获取查询参数
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // 如果没有指定日期范围，默认显示最近8天
    let defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 8);
    const defaultStartStr = defaultStartDate.toISOString().split("T")[0];
    const defaultEndDate = new Date().toISOString().split("T")[0];

    const queryStartDate = startDate || defaultStartStr;
    const queryEndDate = endDate || defaultEndDate;

    // 🔥 关键修复：获取所有历史记录来正确计算首次活跃日期
    // 不能只查询指定日期范围的记录，否则会错误计算首次活跃日期
    const allRecords = await DailyActiveUser.findAll({
      attributes: ["userId", "date"],
      order: [["date", "ASC"]],
      raw: true,
    });

    // 计算每个用户的真实首次活跃日期（基于全部历史数据）
    const userFirstActiveDate = new Map();
    for (const record of allRecords) {
      const { userId, date } = record;
      if (!userFirstActiveDate.has(userId)) {
        userFirstActiveDate.set(userId, date);
      }
    }

    // 按天分组计算cohort（只包含指定日期范围内首次活跃的用户）
    const cohorts = new Map(); // key: cohortDate, value: {users: Set}

    for (const [userId, firstDate] of userFirstActiveDate.entries()) {
      const cohortDate = firstDate; // 使用首次活跃日期作为cohort标识

      // 🔥 只统计首次活跃日期在查询范围内的cohort
      if (cohortDate < queryStartDate || cohortDate > queryEndDate) {
        continue;
      }

      if (!cohorts.has(cohortDate)) {
        cohorts.set(cohortDate, {
          cohortDate: cohortDate,
          users: new Set(),
        });
      }

      cohorts.get(cohortDate).users.add(userId);
    }

    // 🔥 计算每个日期的总日活数（用于在日期旁边显示）
    const dailyActiveUsersCount = new Map();
    for (const record of allRecords) {
      const date = record.date;
      if (!dailyActiveUsersCount.has(date)) {
        dailyActiveUsersCount.set(date, new Set());
      }
      dailyActiveUsersCount.get(date).add(record.userId);
    }

    // 计算每个cohort在后续天的活跃情况
    const cohortResults = [];
    for (const [cohortDate, cohort] of cohorts.entries()) {
      const cohortUsers = cohort.users;
      const totalUsers = cohortUsers.size;

      // 获取当日总日活数
      const dailyActiveCount = dailyActiveUsersCount.has(cohortDate)
        ? dailyActiveUsersCount.get(cohortDate).size
        : 0;

      // 计算第2天、第3天、第4天、第5天、第6天、第7天、第8天的日期
      const cohortDateObj = new Date(cohortDate);
      const day2Date = new Date(cohortDateObj);
      day2Date.setDate(cohortDateObj.getDate() + 1);
      const day2Str = day2Date.toISOString().split("T")[0];

      const day3Date = new Date(cohortDateObj);
      day3Date.setDate(cohortDateObj.getDate() + 2);
      const day3Str = day3Date.toISOString().split("T")[0];

      const day4Date = new Date(cohortDateObj);
      day4Date.setDate(cohortDateObj.getDate() + 3);
      const day4Str = day4Date.toISOString().split("T")[0];

      const day5Date = new Date(cohortDateObj);
      day5Date.setDate(cohortDateObj.getDate() + 4);
      const day5Str = day5Date.toISOString().split("T")[0];

      const day6Date = new Date(cohortDateObj);
      day6Date.setDate(cohortDateObj.getDate() + 5);
      const day6Str = day6Date.toISOString().split("T")[0];

      const day7Date = new Date(cohortDateObj);
      day7Date.setDate(cohortDateObj.getDate() + 6);
      const day7Str = day7Date.toISOString().split("T")[0];

      const day8Date = new Date(cohortDateObj);
      day8Date.setDate(cohortDateObj.getDate() + 7);
      const day8Str = day8Date.toISOString().split("T")[0];

      const day9Date = new Date(cohortDateObj);
      day9Date.setDate(cohortDateObj.getDate() + 8);
      const day9Str = day9Date.toISOString().split("T")[0];

      const day10Date = new Date(cohortDateObj);
      day10Date.setDate(cohortDateObj.getDate() + 9);
      const day10Str = day10Date.toISOString().split("T")[0];

      // 计算每天的活跃用户数
      const day2Users = new Set();
      const day3Users = new Set();
      const day4Users = new Set();
      const day5Users = new Set();
      const day6Users = new Set();
      const day7Users = new Set();
      const day8Users = new Set();
      const day9Users = new Set();
      const day10Users = new Set();

      for (const record of allRecords) {
        if (!cohortUsers.has(record.userId)) continue;

        const recordDate = record.date;

        if (recordDate === day2Str) {
          day2Users.add(record.userId);
        } else if (recordDate === day3Str) {
          day3Users.add(record.userId);
        } else if (recordDate === day4Str) {
          day4Users.add(record.userId);
        } else if (recordDate === day5Str) {
          day5Users.add(record.userId);
        } else if (recordDate === day6Str) {
          day6Users.add(record.userId);
        } else if (recordDate === day7Str) {
          day7Users.add(record.userId);
        } else if (recordDate === day8Str) {
          day8Users.add(record.userId);
        } else if (recordDate === day9Str) {
          day9Users.add(record.userId);
        } else if (recordDate === day10Str) {
          day10Users.add(record.userId);
        }
      }

      // 计算留存率
      const day2Retention =
        totalUsers > 0 ? ((day2Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day3Retention =
        totalUsers > 0 ? ((day3Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day4Retention =
        totalUsers > 0 ? ((day4Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day5Retention =
        totalUsers > 0 ? ((day5Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day6Retention =
        totalUsers > 0 ? ((day6Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day7Retention =
        totalUsers > 0 ? ((day7Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day8Retention =
        totalUsers > 0 ? ((day8Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day9Retention =
        totalUsers > 0 ? ((day9Users.size / totalUsers) * 100).toFixed(1) : 0;
      const day10Retention =
        totalUsers > 0 ? ((day10Users.size / totalUsers) * 100).toFixed(1) : 0;

      cohortResults.push({
        cohortDate: cohortDate,
        newUsers: totalUsers,
        dailyActiveUsers: dailyActiveCount, // 🔥 当日总日活数
        day2Active: day2Users.size,
        day2Retention: day2Retention,
        day3Active: day3Users.size,
        day3Retention: day3Retention,
        day4Active: day4Users.size,
        day4Retention: day4Retention,
        day5Active: day5Users.size,
        day5Retention: day5Retention,
        day6Active: day6Users.size,
        day6Retention: day6Retention,
        day7Active: day7Users.size,
        day7Retention: day7Retention,
        day8Active: day8Users.size,
        day8Retention: day8Retention,
        day9Active: day9Users.size,
        day9Retention: day9Retention,
        day10Active: day10Users.size,
        day10Retention: day10Retention,
      });
    }

    // 按日期倒序排列
    cohortResults.sort((a, b) => b.cohortDate.localeCompare(a.cohortDate));

    res.json({
      success: true,
      data: {
        cohorts: cohortResults,
        totalCohorts: cohortResults.length,
        dateRange: {
          startDate: queryStartDate,
          endDate: queryEndDate,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching daily cohorts:", error);
    res.status(500).json({
      success: false,
      error: "获取天级cohort数据失败",
    });
  }
});

/**
 * GET /rootdata-quota
 * 获取 Rootdata API 配额信息
 */
router.get("/rootdata-quota", adminAuth, async (req, res) => {
  try {
    const axios = require("axios");

    const response = await axios.post(
      "https://api.rootdata.com/open/quotacredits",
      {},
      {
        headers: {
          apikey: "0TpF08MLXdb50VCGx1H8buExoMwgADbR",
          language: "en",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.data?.result === 200 && response.data?.data) {
      const data = response.data.data;

      // 计算使用率
      const used = data.total_credits - data.credits;
      const usagePercent = ((used / data.total_credits) * 100).toFixed(2);

      res.json({
        success: true,
        data: {
          level: data.level,
          credits: data.credits, // 剩余额度
          totalCredits: data.total_credits, // 总额度
          used: used, // 已使用
          usagePercent: parseFloat(usagePercent), // 使用率百分比
          lastMonthCredits: data.last_mo_credits,
          periodStart: new Date(data.start).toISOString(),
          periodEnd: new Date(data.end).toISOString(),
        },
      });
    } else {
      throw new Error("Invalid API response");
    }
  } catch (error) {
    console.error("获取 Rootdata 配额失败:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch Rootdata quota",
      message: error.message,
    });
  }
});

/**
 * -------------------- Nacos 配置管理（公告等） --------------------
 * 权限：nacos_config（super 或被授予该权限的 admin）
 */

// 读取配置（返回 content 字符串）
router.get(
  "/nacos/config",
  adminAuth,
  requirePermission("nacos_config"),
  async (req, res) => {
    try {
      const { dataId, group = "DEFAULT_GROUP", tenant } = req.query;
      if (!dataId) {
        return res.status(400).json({ success: false, error: "缺少 dataId" });
      }

      const resp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
        params: { dataId, group, ...(tenant ? { tenant } : {}) },
      });

      if (resp.status !== 200) {
        return res.status(resp.status).json({
          success: false,
          error: "读取 Nacos 配置失败",
          status: resp.status,
          data: resp.data,
        });
      }

      // Nacos GET configs 返回 body 直接是 content 字符串（不是 JSON）
      res.json({
        success: true,
        data: {
          dataId,
          group,
          tenant: tenant || null,
          content:
            typeof resp.data === "string"
              ? resp.data
              : JSON.stringify(resp.data),
        },
      });
    } catch (e) {
      console.error("[nacos_config] read error:", e);
      res.status(500).json({ success: false, error: e.message || "读取失败" });
    }
  }
);

// 发布/更新配置（覆盖式写入）
router.post(
  "/nacos/config",
  adminAuth,
  requirePermission("nacos_config"),
  async (req, res) => {
    try {
      const {
        dataId,
        group = "DEFAULT_GROUP",
        tenant,
        content,
        type = "json",
      } = req.body || {};

      if (!dataId) {
        return res.status(400).json({ success: false, error: "缺少 dataId" });
      }
      if (typeof content !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "content 必须是字符串" });
      }

      // 轻量校验：如果声明 type=json，则必须是合法 JSON
      if (String(type).toLowerCase() === "json") {
        try {
          JSON.parse(content);
        } catch (e) {
          return res.status(400).json({
            success: false,
            error: "content 不是合法 JSON（type=json）",
          });
        }
      }

      const form = new URLSearchParams({
        dataId,
        group,
        content,
        type,
      });
      if (tenant) form.set("tenant", tenant);

      const resp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
        data: form.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (resp.status !== 200) {
        return res.status(resp.status).json({
          success: false,
          error: "发布 Nacos 配置失败",
          status: resp.status,
          data: resp.data,
        });
      }

      // Nacos 返回通常是 'true'
      const ok = resp.data === true || resp.data === "true";
      if (!ok) {
        return res.status(500).json({
          success: false,
          error: "发布失败（Nacos 未返回 true）",
          data: resp.data,
        });
      }

      res.json({
        success: true,
        data: { dataId, group, tenant: tenant || null, published: true },
      });
    } catch (e) {
      console.error("[nacos_config] publish error:", e);
      res.status(500).json({ success: false, error: e.message || "发布失败" });
    }
  }
);

/**
 * GET /health
 * 健康检查接口（无需认证）
 */
/**
 * -------------------- Feature Flags Config Admin (xhunt_config) --------------------
 * 权限：feature_flags或被授予该权限的 admin）
 */

// 读取 xhunt_config
router.get(
  "/feature-flags",
  adminAuth,
  requirePermission("feature_flags_config"),
  async (req, res) => {
    try {
      const dataId = "xhunt_config";
      const group = "DEFAULT_GROUP";

      const resp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
        params: { dataId, group },
      });

      if (resp.status !== 200) {
        return res.status(resp.status).json({
          success: false,
          error: "读取 Nacos xhunt_config 失败",
          status: resp.status,
          data: resp.data,
        });
      }

      res.json({
        success: true,
        data: {
          dataId,
          group,
          content:
            typeof resp.data === "string"
              ? resp.data
              : JSON.stringify(resp.data),
        },
      });
    } catch (e) {
      console.error("[feature_flags_config] read error:", e);
      res.status(500).json({ success: false, error: e.message || "读取失败" });
    }
  }
);

// 发布/更新 xhunt_config
router.post(
  "/feature-flags",
  adminAuth,
  requirePermission("feature_flags_config"),
  async (req, res) => {
    try {
      const { content } = req.body || {};
      const dataId = "xhunt_config";
      const group = "DEFAULT_GROUP";
      const type = "json";

      if (typeof content !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "content 必须是字符串" });
      }

      try {
        JSON.parse(content);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: "content 不是合法 JSON",
        });
      }

      const form = new URLSearchParams({
        dataId,
        group,
        content,
        type,
      });

      const resp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
        data: form.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (resp.status !== 200 || (resp.data !== true && resp.data !== "true")) {
        return res.status(resp.status || 500).json({
          success: false,
          error: "发布 Nacos xhunt_config 失败",
          status: resp.status,
          data: resp.data,
        });
      }

      res.json({
        success: true,
        data: { dataId, group, published: true },
      });
    } catch (e) {
      console.error("[feature_flags_config] publish error:", e);
      res.status(500).json({ success: false, error: e.message || "发布失败" });
    }
  }
);

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "xhunt-stats-api",
  });
});

/**
 * GET /api/stats/rootdata-daily
 * 获取指定日期新增的 Rootdata 项目和投资关系
 */
router.get("/rootdata-daily", adminAuth, async (req, res) => {
  try {
    const { date, page = 1, limit = 50 } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Missing date parameter",
        message: "Please provide a date in YYYY-MM-DD format",
      });
    }

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    // 获取 PostgreSQL Fundraising 模型
    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({
        success: false,
        error: "Database model not initialized",
      });
    }

    // 计算日期范围（UTC 时间）
    const startDate = new Date(date + "T00:00:00.000Z");
    const endDate = new Date(date + "T23:59:59.999Z");

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // 查询新增的项目（分页）
    const [newProjects, totalProjects] = await Promise.all([
      Fundraising.Project.findAll({
        where: {
          createdAt: {
            [require("sequelize").Op.gte]: startDate,
            [require("sequelize").Op.lte]: endDate,
          },
        },
        attributes: [
          "id",
          "projectName",
          "projectLink",
          "logo",
          "description",
          "twitterUrl",
          "socialLinks",
          "fundedAt",
          "detailFailuresNumber",
          "detailFetchedAt",
          "isInitial",
          "createdAt",
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: offset,
        raw: true,
      }),
      Fundraising.Project.count({
        where: {
          createdAt: {
            [require("sequelize").Op.gte]: startDate,
            [require("sequelize").Op.lte]: endDate,
          },
        },
      }),
    ]);

    // 查询新增的投资关系（分页）
    const [newRelationships, totalRelationships] = await Promise.all([
      Fundraising.InvestmentRelationships.findAll({
        where: {
          createdAt: {
            [require("sequelize").Op.gte]: startDate,
            [require("sequelize").Op.lte]: endDate,
          },
        },
        include: [
          {
            model: Fundraising.Project,
            as: "investorProject",
            attributes: ["id", "projectName", "projectLink", "logo"],
          },
          {
            model: Fundraising.Project,
            as: "fundedProject",
            attributes: ["id", "projectName", "projectLink", "logo"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: offset,
      }),
      Fundraising.InvestmentRelationships.count({
        where: {
          createdAt: {
            [require("sequelize").Op.gte]: startDate,
            [require("sequelize").Op.lte]: endDate,
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        date,
        projects: newProjects,
        relationships: newRelationships,
        summary: {
          projectsCount: totalProjects,
          relationshipsCount: totalRelationships,
        },
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalProjects,
          totalRelationships,
          totalProjectPages: Math.ceil(totalProjects / limitNum),
          totalRelationshipPages: Math.ceil(totalRelationships / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("获取 Rootdata 每日数据失败:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch Rootdata daily data",
      message: error.message,
    });
  }
});

/**
 * POST /api/stats/rootdata-daily/set-initial
 * 将指定日期新增的项目的 isInitial 设置为 true
 */
router.post("/rootdata-daily/set-initial", adminAuth, async (req, res) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Missing date parameter",
        message: "Please provide a date in YYYY-MM-DD format",
      });
    }

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    // 获取 PostgreSQL Fundraising 模型
    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({
        success: false,
        error: "Database model not initialized",
      });
    }

    // 计算日期范围（UTC 时间）
    const startDate = new Date(date + "T00:00:00.000Z");
    const endDate = new Date(date + "T23:59:59.999Z");

    // 批量更新项目的 isInitial 为 true
    const [updatedCount] = await Fundraising.Project.update(
      { isInitial: true },
      {
        where: {
          createdAt: {
            [require("sequelize").Op.gte]: startDate,
            [require("sequelize").Op.lte]: endDate,
          },
        },
      }
    );

    res.json({
      success: true,
      data: {
        date,
        updatedCount,
        message: `成功将 ${updatedCount} 个项目的 isInitial 设置为 true`,
      },
    });
  } catch (error) {
    console.error("设置 isInitial 失败:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to set isInitial",
      message: error.message,
    });
  }
});

const extractRedisKeyPrefix = (key) => {
  if (typeof key !== "string" || key.length === 0) {
    return "(unknown)";
  }
  const colonIndex = key.indexOf(":");
  if (colonIndex > 0) {
    return `${key.slice(0, colonIndex + 1)}`;
  }
  const underscoreIndex = key.indexOf("_");
  if (underscoreIndex > 0) {
    return `${key.slice(0, underscoreIndex + 1)}`;
  }
  return key.length > 30 ? `${key.slice(0, 27)}...` : key;
};

const collectRedisKeyDistribution = async (
  redisClient,
  {
    maxSampledKeys = 10000,
    countPerScan = 1000,
    maxGroups = 10,
    totalKeys,
  } = {}
) => {
  const prefixCounts = new Map();
  let sampled = 0;
  let iterations = 0;
  let truncated = false;
  const processKey = (key) => {
    const keyStr = typeof key === "string" ? key : key?.toString();
    if (!keyStr) {
      return true;
    }
    const prefix = extractRedisKeyPrefix(keyStr);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    sampled += 1;
    if (sampled >= maxSampledKeys) {
      truncated = true;
      return false;
    }
    return true;
  };

  try {
    if (typeof redisClient.scanIterator === "function") {
      for await (const key of redisClient.scanIterator({
        MATCH: "*",
        COUNT: countPerScan,
      })) {
        iterations += 1;
        if (!processKey(key)) {
          break;
        }
      }
    } else {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redisClient.scan(cursor, {
          MATCH: "*",
          COUNT: countPerScan,
        });
        cursor = nextCursor;
        for (const key of keys || []) {
          if (!processKey(key)) {
            cursor = "0";
            break;
          }
        }
        iterations += 1;
        if (cursor === "0") {
          break;
        }
      } while (cursor !== "0" && sampled < maxSampledKeys);
    }
  } catch (error) {
    console.error("collectRedisKeyDistribution error:", error);
    return {
      sampled,
      sampleLimit: maxSampledKeys,
      truncated,
      scanIterations: iterations,
      totalKeys,
      groups: [],
      error: error.message,
    };
  }

  const groups = Array.from(prefixCounts.entries())
    .map(([prefix, count]) => ({
      prefix,
      count,
      percent: sampled ? Number(((count / sampled) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxGroups);

  return {
    sampled,
    sampleLimit: maxSampledKeys,
    truncated,
    scanIterations: iterations,
    totalKeys,
    groups,
  };
};

/**
 * GET /api/stats/device-status
 * 获取设备状态信息（CPU、内存、PM2、Redis、PostgreSQL等）
 */
router.get(
  "/device-status",
  adminAuth,
  requirePermission("device-status:read"),
  async (req, res) => {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      // 格式化字节大小
      const formatBytes = (bytes) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (
          Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
        );
      };

      // 格式化运行时间
      const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${days}天 ${hours}小时 ${minutes}分钟`;
      };

      const deviceStatus = {
        timestamp: new Date().toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
        }),
      };

      // 1. 系统信息
      deviceStatus.system = {
        platform: `${os.type()} ${os.release()}`,
        hostname: os.hostname(),
        uptime: formatUptime(os.uptime()),
        arch: os.arch(),
      };

      // 2. CPU 信息
      const cpus = os.cpus();
      const loadAvg = os.loadavg();

      // 计算 CPU 使用率
      let totalIdle = 0;
      let totalTick = 0;
      cpus.forEach((cpu) => {
        for (let type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      const cpuUsagePercent = (100 - ~~((100 * totalIdle) / totalTick)).toFixed(
        2
      );

      deviceStatus.cpu = {
        cores: cpus.length,
        model: cpus[0].model,
        usage: `${cpuUsagePercent}%`,
        loadAverage: `${loadAvg[0].toFixed(2)} / ${loadAvg[1].toFixed(
          2
        )} / ${loadAvg[2].toFixed(2)}`,
      };

      // 3. 内存信息
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(2);

      deviceStatus.memory = {
        total: formatBytes(totalMem),
        used: formatBytes(usedMem),
        free: formatBytes(freeMem),
        usagePercent: `${memUsagePercent}%`,
      };

      // 4. PM2 状态
      try {
        const { stdout: pm2Output } = await execPromise("pm2 jlist");
        const pm2List = JSON.parse(pm2Output);
        deviceStatus.pm2 = pm2List.map((app) => ({
          name: app.name,
          status: app.pm2_env.status,
          cpu: `${app.monit.cpu}%`,
          memory: formatBytes(app.monit.memory),
          restarts: app.pm2_env.restart_time,
          uptime: formatUptime(
            Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1000)
          ),
        }));
      } catch (error) {
        console.error("获取 PM2 状态失败:", error.message);
        deviceStatus.pm2 = [];
      }

      // 5. Redis 状态
      deviceStatus.redis = {
        connected: false,
      };
      try {
        const redisClient = req.redisClient;
        if (redisClient && redisClient.isReady) {
          // 获取Redis INFO信息
          const info = await redisClient.info();
          const lines = info.split("\r\n");
          const redisInfo = {};
          lines.forEach((line) => {
            if (line && !line.startsWith("#")) {
              const [key, value] = line.split(":");
              if (key && value) {
                redisInfo[key] = value.trim();
              }
            }
          });

          // 获取所有key数量
          const dbKeys = await redisClient.dbSize();

          // 计算内存使用率
          let memoryUsagePercent = "-";
          const usedMemory = parseInt(redisInfo.used_memory);
          const maxMemory = parseInt(redisInfo.maxmemory);

          if (maxMemory > 0 && usedMemory > 0) {
            // 如果设置了maxmemory，计算使用率
            memoryUsagePercent =
              ((usedMemory / maxMemory) * 100).toFixed(2) + "%";
          } else if (usedMemory > 0) {
            // 如果没有设置maxmemory，显示提示
            memoryUsagePercent = "未设置限制";
          }

          deviceStatus.redis = {
            connected: true,
            memory: redisInfo.used_memory_human || "-",
            maxMemory: redisInfo.maxmemory_human || "未设置",
            memoryUsagePercent: memoryUsagePercent,
            keys: dbKeys || 0,
            uptime: redisInfo.uptime_in_days
              ? `${redisInfo.uptime_in_days} 天`
              : "-",
            version: redisInfo.redis_version || "-",
          };

          deviceStatus.redis.keyDistribution =
            await collectRedisKeyDistribution(redisClient, {
              totalKeys: dbKeys || 0,
            });
        }
      } catch (error) {
        console.error("获取 Redis 状态失败:", error.message);
      }

      // 6. PostgreSQL 状态
      deviceStatus.postgresql = {
        connected: false,
      };
      try {
        const { Fundraising } = require("../../models/postgres-fundraising");
        if (Fundraising && Fundraising.Project.sequelize) {
          const sequelize = Fundraising.Project.sequelize;

          // 测试连接
          await sequelize.authenticate();

          // 获取版本
          const [versionResult] = await sequelize.query("SELECT version()");
          const version = versionResult[0].version.split(" ")[1];

          // 获取数据库大小
          const [sizeResult] = await sequelize.query(
            "SELECT pg_size_pretty(pg_database_size(current_database())) as size"
          );
          const size = sizeResult[0].size;

          // 获取活跃连接数
          const [connResult] = await sequelize.query(
            "SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'"
          );
          const connections = connResult[0].count;

          deviceStatus.postgresql = {
            connected: true,
            version: version,
            size: size,
            connections: connections,
          };
        }
      } catch (error) {
        console.error("获取 PostgreSQL 状态失败:", error.message);
      }

      // 7. 磁盘信息
      deviceStatus.disk = [];
      try {
        const { stdout: dfOutput } = await execPromise("df -h");
        const lines = dfOutput.split("\n").slice(1); // 跳过表头
        lines.forEach((line) => {
          if (line.trim()) {
            const parts = line.split(/\s+/);
            if (
              parts.length >= 6 &&
              !parts[0].includes("tmpfs") &&
              !parts[0].includes("devfs")
            ) {
              deviceStatus.disk.push({
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usePercent: parts[4],
                mounted: parts[5],
              });
            }
          }
        });
      } catch (error) {
        console.error("获取磁盘信息失败:", error.message);
      }

      // 8. SSE 连接状态
      deviceStatus.sse = {
        available: false,
      };
      try {
        const { connectionManager } = require("./sse");
        if (connectionManager) {
          const sseStats = await connectionManager.getStats(true); // 聚合所有进程的统计信息
          deviceStatus.sse = {
            available: true,
            ...sseStats,
          };
        }
      } catch (error) {
        console.error("获取 SSE 状态失败:", error.message);
      }

      res.json(deviceStatus);
    } catch (error) {
      console.error("获取设备状态失败:", error.message);
      res.status(500).json({
        error: "Failed to fetch device status",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/xhunt/stats/clear-cache
 * 清除指定的 Redis 缓存（先精确删除，再模糊匹配）
 */
router.post("/clear-cache", adminAuth, async (req, res) => {
  const requestId = Date.now().toString(36);
  const logPrefix = `[redis 手动清除][${requestId}]`;
  try {
    // 权限检查：只有 luykin 用户可以执行清除缓存操作
    if (!req.user || req.user.role !== "super") {
      console.log(
        `${logPrefix} ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      try {
        await logAdminAction(req, {
          action: "clear-cache",
          success: false,
          message: "forbidden",
        });
      } catch (e) {}
      return res.status(403).json({
        error: "权限不足",
        message: "权限不足",
      });
    }

    console.log(
      `${logPrefix} ✅ 权限验证通过: 用户=${req.user.username}, 角色=${req.user.role}`
    );

    const { prefix } = req.body;
    console.log(`${logPrefix} 📥 收到清除缓存请求: prefix="${prefix}"`);

    if (!prefix || typeof prefix !== "string") {
      console.log(`${logPrefix} ❌ 参数无效`);
      return res.status(400).json({ error: "缺少有效的 prefix 参数" });
    }

    // 验证前缀格式，防止误删除
    if (prefix.trim().length === 0) {
      console.log(`${logPrefix} ❌ prefix 为空`);
      return res.status(400).json({ error: "prefix 不能为空" });
    }

    // 防止删除所有键
    if (prefix === "*" || prefix === "**") {
      console.log(`${logPrefix} ❌ 不允许使用通配符`);
      return res.status(403).json({ error: "不允许使用通配符删除所有键" });
    }

    const redisClient = req.redisClient;
    if (!redisClient) {
      console.log(`${logPrefix} ❌ Redis 客户端未初始化`);
      return res.status(500).json({ error: "Redis 客户端未初始化" });
    }

    const startTime = Date.now();
    let deletedCount = 0;
    const deletedKeys = [];

    // 1. 先尝试精确删除（传入的可能是完整的键名）
    console.log(`${logPrefix} 🔍 步骤1: 检查精确键是否存在...`);
    try {
      const exactExists = await redisClient.exists(prefix);
      console.log(
        `${logPrefix} 🔍 精确键检查结果: ${exactExists ? "存在" : "不存在"}`
      );
      if (exactExists) {
        await redisClient.del(prefix);
        deletedCount++;
        deletedKeys.push(prefix);
        console.log(`${logPrefix} 🎯 精确删除键: ${prefix}`);
      }
    } catch (exactError) {
      console.error(`${logPrefix} ❌ 精确删除失败:`, exactError);
    }

    // 2. 模糊匹配删除（删除所有以此为前缀的键）
    const pattern = `${prefix}*`;
    console.log(`${logPrefix} 🔍 步骤2: 开始扫描匹配键，模式="${pattern}"`);
    let cursor = "0";
    const allMatchedKeys = [];
    let scanCount = 0;
    const scanStartTime = Date.now();
    const MAX_SCAN_TIME = 50000; // 最大扫描时间 50 秒
    const MAX_SCAN_COUNT = 10000; // 最大扫描次数 10000 次
    let isTimeout = false;

    // 先扫描所有匹配的键
    do {
      scanCount++;
      const scanStart = Date.now();

      // 检查是否超时
      if (scanStart - scanStartTime > MAX_SCAN_TIME) {
        console.log(
          `${logPrefix} ⚠️ SCAN 超时（已扫描 ${scanCount} 次，耗时 ${
            scanStart - scanStartTime
          }ms），提前终止`
        );
        isTimeout = true;
        break;
      }

      // 检查扫描次数是否过多
      if (scanCount > MAX_SCAN_COUNT) {
        console.log(
          `${logPrefix} ⚠️ SCAN 次数超限（已扫描 ${scanCount} 次），提前终止`
        );
        isTimeout = true;
        break;
      }

      const reply = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      cursor = reply.cursor;
      const keys = reply.keys;

      const scanDuration = Date.now() - scanStart;
      console.log(
        `${logPrefix} 🔄 SCAN #${scanCount}: cursor=${cursor}, 找到=${keys.length}个键, 耗时=${scanDuration}ms`
      );

      if (keys && keys.length > 0) {
        // 过滤掉已经删除的精确键
        const newKeys = keys.filter((k) => k !== prefix);
        allMatchedKeys.push(...newKeys);
      }

      // 每10次扫描输出一次进度
      if (scanCount % 10 === 0) {
        console.log(
          `${logPrefix} 📊 扫描进度: 已扫描${scanCount}次, 累计找到=${
            allMatchedKeys.length
          }个匹配键, 已耗时=${Date.now() - scanStartTime}ms`
        );
      }
    } while (cursor !== "0");

    const totalKeys = allMatchedKeys.length;
    const scanDuration = Date.now() - startTime;

    if (isTimeout) {
      console.log(
        `${logPrefix} ⚠️ 扫描未完成（超时/超限）: 共扫描${scanCount}次, 找到${totalKeys}个匹配键, 耗时=${scanDuration}ms`
      );
    } else {
      console.log(
        `${logPrefix} ✅ 扫描完成: 共扫描${scanCount}次, 找到${totalKeys}个匹配键, 耗时=${scanDuration}ms`
      );
    }

    // 如果扫描超时，立即返回已找到的结果
    if (isTimeout && totalKeys === 0 && deletedCount === 0) {
      const resp = {
        success: true,
        input: prefix,
        deletedCount: 0,
        message: `未找到匹配的缓存键（扫描了 ${scanCount} 次后超时）`,
        timeout: true,
        scanCount: scanCount,
        sync: true,
      };
      try {
        await logAdminAction(req, {
          action: "clear-cache",
          success: false,
          message: "timeout",
        });
      } catch (e) {}
      return res.json(resp);
    }

    // 如果匹配的键数量较少（< 500），同步删除并返回结果
    if (totalKeys < 500) {
      console.log(`${logPrefix} 📝 匹配键数量 < 500，使用同步模式删除...`);
      if (totalKeys > 0) {
        console.log(`${logPrefix} 🗑️ 开始批量删除 ${totalKeys} 个键...`);
        const deleteStart = Date.now();
        // 批量删除
        await redisClient.del(allMatchedKeys);
        const deleteDuration = Date.now() - deleteStart;
        deletedCount += totalKeys;
        deletedKeys.push(...allMatchedKeys.slice(0, 10)); // 只记录前10个
        console.log(`${logPrefix} ✅ 批量删除完成，耗时=${deleteDuration}ms`);
      }

      const duration = Date.now() - startTime;
      console.log(
        `${logPrefix} ✅ 清除缓存完成: 输入="${prefix}", 删除数量=${deletedCount}, 总耗时=${duration}ms`
      );

      const resp2 = {
        success: true,
        input: prefix,
        deletedCount: deletedCount,
        samples: deletedKeys.slice(0, 10), // 返回前10个被删除的键作为示例
        message: isTimeout
          ? `成功清除 ${deletedCount} 个缓存键（扫描提前终止，可能还有未删除的键）`
          : `成功清除 ${deletedCount} 个缓存键`,
        timeout: isTimeout,
        scanCount: scanCount,
        sync: true,
      };
      try {
        await logAdminAction(req, {
          action: "clear-cache",
          success: true,
          message: JSON.stringify(resp2),
        });
      } catch (e) {}
      return res.json(resp2);
    }

    // 如果匹配的键数量很多（>= 500），异步处理
    console.log(`${logPrefix} 📝 匹配键数量 >= 500，使用异步模式处理...`);
    console.log(`${logPrefix} 📤 立即返回响应给客户端`);

    const resp3 = {
      success: true,
      input: prefix,
      deletedCount: deletedCount, // 已删除的精确键数量
      estimatedTotal: totalKeys + deletedCount,
      message: `已删除 ${deletedCount} 个精确键，正在后台删除约 ${totalKeys} 个匹配键`,
      status: "processing",
      sync: false,
    };
    try {
      await logAdminAction(req, {
        action: "clear-cache",
        success: true,
        message: JSON.stringify(resp3),
      });
    } catch (e) {}
    res.json(resp3);

    // 异步批量删除大量键
    console.log(`${logPrefix} 🔄 开始后台异步删除任务...`);
    setImmediate(async () => {
      try {
        let asyncDeleted = 0;
        // 每次删除100个键
        for (let i = 0; i < allMatchedKeys.length; i += 100) {
          const batch = allMatchedKeys.slice(i, i + 100);
          await redisClient.del(batch);
          asyncDeleted += batch.length;

          if (asyncDeleted % 500 === 0) {
            console.log(
              `${logPrefix} 🔄 清除进度: 输入="${prefix}", 已删除=${
                deletedCount + asyncDeleted
              }/${deletedCount + totalKeys}`
            );
          }
        }

        const duration = Date.now() - startTime;
        console.log(
          `${logPrefix} ✅ 异步清除缓存完成: 输入="${prefix}", 删除数量=${
            deletedCount + asyncDeleted
          }, 总耗时=${duration}ms`
        );
      } catch (error) {
        console.error(
          `${logPrefix} ❌ 异步清除缓存失败: 输入="${prefix}"`,
          error
        );
      }
    });
  } catch (error) {
    console.error(`${logPrefix} ❌ 清除缓存失败:`, error);
    res.status(500).json({
      error: "清除缓存失败",
      message: error.message,
    });
  }
});

/**
 * POST /grant-pro
 * 手动开通 Pro 权限（需要认证，仅 luykin 用户）
 */
router.post("/grant-pro", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以执行手动开通 Pro 操作
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[手动开通Pro] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      try {
        await logAdminAction(req, {
          action: "grant-pro",
          success: false,
          message: "forbidden",
        });
      } catch (e) {}
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以执行此操作",
      });
    }

    console.log(
      `[手动开通Pro] ✅ 权限验证通过: 用户=${req.user.username}, 角色=${req.user.role}`
    );

    const { username, durationDays, reason } = req.body;

    // 验证必需参数
    if (!username || !durationDays) {
      return res.status(400).json({
        success: false,
        error: "缺少必需参数",
        message: "请提供 username 和 durationDays",
      });
    }

    // 验证时长参数
    const duration = parseInt(durationDays);
    if (isNaN(duration) || duration <= 0) {
      return res.status(400).json({
        success: false,
        error: "无效的时长参数",
        message: "durationDays 必须是正整数",
      });
    }

    // 获取PostgreSQL模型
    const postgresModels = require("../../models/postgres-start");
    const XHuntUser = postgresModels.XHuntUser;
    const XHuntUserProSubscription = postgresModels.XHuntUserProSubscription;
    const { Op } = require("sequelize");

    // 查找用户（大小写不敏感）
    const user = await XHuntUser.findOne({
      where: {
        username: {
          [Op.iLike]: username,
        },
      },
    });

    if (!user) {
      console.log(`[手动开通Pro] ❌ 用户未找到: ${username}`);
      return res.status(404).json({
        success: false,
        error: "用户未找到",
        message: `未找到用户名为 "${username}" 的用户`,
      });
    }

    // 计算开通时间
    const startTime = new Date();
    const endTime = new Date(
      startTime.getTime() + duration * 24 * 60 * 60 * 1000
    );

    // 创建 Pro 订阅记录
    const subscription = await XHuntUserProSubscription.create({
      userId: user.id,
      startTime: startTime,
      endTime: endTime,
      planType: "vip-base",
      reason: reason || "manual",
      reasonDetail: `由 ${req.user.username} 手动开通，时长 ${duration} 天`,
    });

    console.log(
      `[手动开通Pro] ✅ 成功为用户 ${username} (ID: ${user.id}) 开通 Pro，时长 ${duration} 天，过期时间: ${endTime}`
    );

    res.json({
      success: true,
      message: `成功为用户 "${username}" 开通 Pro ${duration} 天`,
      data: {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        subscriptionId: subscription.id,
        startTime: subscription.startTime,
        endTime: subscription.endTime,
        durationDays: duration,
      },
    });
  } catch (error) {
    console.error("[手动开通Pro] ❌ 开通失败:", error);
    res.status(500).json({
      success: false,
      error: "开通 Pro 失败",
      message: error.message,
    });
  }
});

/**
 * GET /pro-users
 * 获取已开通 Pro 的用户列表（需要认证，仅 luykin 用户）
 */
router.get("/pro-users", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以查看 Pro 用户列表
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[Pro用户列表] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以查看此列表",
      });
    }

    const { page = 1, limit = 50, status = "all" } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // 获取PostgreSQL模型
    const postgresModels = require("../../models/postgres-start");
    const XHuntUser = postgresModels.XHuntUser;
    const XHuntUserProSubscription = postgresModels.XHuntUserProSubscription;
    const { Op } = require("sequelize");

    // 构建查询条件
    const whereConditions = {};
    if (status === "active") {
      whereConditions.endTime = { [Op.gt]: new Date() };
    } else if (status === "expired") {
      whereConditions.endTime = { [Op.lte]: new Date() };
    }

    // 查询 Pro 订阅记录
    const { count, rows: subscriptions } =
      await XHuntUserProSubscription.findAndCountAll({
        where: whereConditions,
        include: [
          {
            model: XHuntUser,
            as: "user",
            attributes: ["id", "username", "displayName", "avatar"],
          },
        ],
        order: [["endTime", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

    // 格式化数据
    const formattedSubscriptions = subscriptions.map((sub) => {
      const now = new Date();
      const isActive = sub.endTime > now;

      return {
        id: sub.id,
        userId: sub.userId,
        username: sub.user?.username || "未知",
        displayName: sub.user?.displayName || sub.user?.username || "未知用户",
        planType: sub.planType,
        startTime: sub.startTime,
        endTime: sub.endTime,
        isActive: isActive,
        reason: sub.reason || "-",
        reasonDetail: sub.reasonDetail || "-",
        createdAt: sub.createdAt,
      };
    });

    // 统计信息
    const totalActive = await XHuntUserProSubscription.count({
      where: {
        endTime: { [Op.gt]: new Date() },
      },
    });

    const totalExpired = await XHuntUserProSubscription.count({
      where: {
        endTime: { [Op.lte]: new Date() },
      },
    });

    res.json({
      success: true,
      data: {
        subscriptions: formattedSubscriptions,
        stats: {
          totalActive: totalActive,
          totalExpired: totalExpired,
          total: totalActive + totalExpired,
        },
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalCount: count,
          totalPages: Math.ceil(count / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("[Pro用户列表] ❌ 获取失败:", error);
    res.status(500).json({
      success: false,
      error: "获取 Pro 用户列表失败",
      message: error.message,
    });
  }
});

/**
 * GET /backup-status
 * 获取 PostgreSQL 备份状态（需要认证，仅 luykin 用户）
 */
router.get("/backup-status", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以查看备份状态
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[备份状态] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以查看备份状态",
      });
    }

    const pgBackupService = require("../../services/pg-backup-service");
    const backups = await pgBackupService.listBackups();

    // 计算总大小
    const totalSizeMB = backups
      .reduce((sum, backup) => sum + parseFloat(backup.sizeMB), 0)
      .toFixed(2);

    res.json({
      success: true,
      data: {
        backups: backups,
        stats: {
          totalBackups: backups.length,
          maxBackups: pgBackupService.maxBackups,
          totalSizeMB: totalSizeMB,
          backupDir: pgBackupService.backupDir,
        },
      },
    });
  } catch (error) {
    console.error("[备份状态] ❌ 获取失败:", error);
    res.status(500).json({
      success: false,
      error: "获取备份状态失败",
      message: error.message,
    });
  }
});

/**
 * POST /trigger-backup
 * 手动触发数据库备份（需要认证）
 */
router.post(
  "/trigger-backup",
  adminAuth,
  requirePermission("backup:operate"),
  async (req, res) => {
    try {
      console.log(`[执行命令] ✅ 权限验证通过: 用户=${req.user.username}`);

      const pgBackupService = require("../../services/pg-backup-service");

      // 异步执行备份，立即返回响应
      const resp = {
        success: true,
        message: "备份任务已启动，请稍后查看备份列表",
      };
      try {
        await logAdminAction(req, {
          action: "trigger-backup",
          success: true,
          message: JSON.stringify(resp),
        });
      } catch (e) {}
      res.json(resp);

      // 在后台执行备份
      pgBackupService.manualBackup().catch((error) => {
        console.error("[手动备份] ❌ 备份失败:", error);
      });
    } catch (error) {
      console.error("[手动备份] ❌ 触发失败:", error);
      res.status(500).json({
        success: false,
        error: "触发备份失败",
        message: error.message,
      });
    }
  }
);

/**
 * GET /version-stats
 * 版本请求统计查询接口
 * @query timeRange - 时间范围：30m (最近30分钟), 2h (最近2小时), 12h (最近12小时), 2d (最近2天)
 */
router.get("/version-stats", adminAuth, async (req, res) => {
  try {
    const { timeRange = "30m" } = req.query;

    // 计算时间范围
    const now = new Date();
    let startTime;
    switch (timeRange) {
      case "30m":
        startTime = new Date(now.getTime() - 30 * 60 * 1000);
        break;
      case "2h":
        startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        break;
      case "12h":
        startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        break;
      case "2d":
        startTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: "无效的时间范围，支持: 30m, 2h, 12h, 2d",
        });
    }

    const { VersionRequestStats } = require("../../models/postgres-start");
    const { Op } = require("sequelize");

    // 查询数据
    const stats = await VersionRequestStats.findAll({
      where: {
        timeWindow: {
          [Op.gte]: startTime,
          [Op.lte]: now,
        },
      },
      order: [["timeWindow", "ASC"]],
      attributes: ["timeWindow", "version", "requestCount"],
    });

    // 按版本分组并格式化数据
    const versionMap = new Map();
    const timeLabels = new Set();

    for (const stat of stats) {
      const timeLabel = new Date(stat.timeWindow).toISOString();
      timeLabels.add(timeLabel);

      if (!versionMap.has(stat.version)) {
        versionMap.set(stat.version, []);
      }
      versionMap.get(stat.version).push({
        time: timeLabel,
        count: stat.requestCount,
      });
    }

    // 构建图表数据
    const sortedTimeLabels = Array.from(timeLabels).sort();
    const datasets = [];

    for (const [version, data] of versionMap.entries()) {
      const dataMap = new Map(data.map((d) => [d.time, d.count]));
      const counts = sortedTimeLabels.map((time) => dataMap.get(time) || 0);

      datasets.push({
        label: version,
        data: counts,
        borderColor: getVersionColor(version),
        backgroundColor: getVersionColor(version, 0.1),
        tension: 0.4,
      });
    }

    res.json({
      success: true,
      timeRange,
      labels: sortedTimeLabels,
      datasets,
      totalVersions: versionMap.size,
    });
  } catch (error) {
    console.error("版本统计查询错误:", error);
    res.status(500).json({
      success: false,
      error: "查询失败",
      message: error.message,
    });
  }
});

// 为不同版本生成颜色（简单的哈希函数）
function getVersionColor(version, alpha = 1) {
  const colors = [
    `rgba(54, 162, 235, ${alpha})`, // 蓝色
    `rgba(255, 99, 132, ${alpha})`, // 红色
    `rgba(75, 192, 192, ${alpha})`, // 青色
    `rgba(255, 206, 86, ${alpha})`, // 黄色
    `rgba(153, 102, 255, ${alpha})`, // 紫色
    `rgba(255, 159, 64, ${alpha})`, // 橙色
    `rgba(199, 199, 199, ${alpha})`, // 灰色
    `rgba(83, 102, 255, ${alpha})`, // 靛蓝色
    `rgba(255, 99, 255, ${alpha})`, // 粉红色
    `rgba(99, 255, 132, ${alpha})`, // 绿色
  ];

  let hash = 0;
  for (let i = 0; i < version.length; i++) {
    hash = version.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * 获取5分钟时间窗口（向下取整到5分钟）
 */
function get5MinWindow(date) {
  const d = date || new Date();
  const minutes = d.getUTCMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const window = new Date(d);
  window.setUTCMinutes(roundedMinutes);
  window.setUTCSeconds(0);
  window.setUTCMilliseconds(0);
  return window.toISOString();
}

/**
 * 生成指定时间范围内的所有5分钟时间窗口
 */
function generateTimeWindows(startTime, endTime) {
  const windows = [];
  const start = new Date(startTime);
  const end = new Date(endTime);

  // 获取第一个窗口（向下取整）
  let current = new Date(get5MinWindow(start));

  while (current <= end) {
    windows.push(current.toISOString());
    // 增加5分钟
    current = new Date(current.getTime() + 5 * 60 * 1000);
  }

  return windows;
}

/**
 * GET /url-stats
 * URL请求统计查询接口（接口请求排行榜）
 * @query timeRange - 时间范围：30m (最近30分钟), 1h (最近1小时), 2h (最近2小时), 4h (最近4小时), 1d (最近1天), 2d (最近2天)
 */
router.get("/url-stats", adminAuth, async (req, res) => {
  try {
    const { timeRange = "30m" } = req.query;

    // 计算时间范围
    const now = new Date();
    let startTime;
    switch (timeRange) {
      case "30m":
        startTime = new Date(now.getTime() - 30 * 60 * 1000);
        break;
      case "1h":
        startTime = new Date(now.getTime() - 1 * 60 * 60 * 1000);
        break;
      case "2h":
        startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        break;
      case "4h":
        startTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        break;
      case "1d":
        startTime = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        break;
      case "2d":
        startTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: "无效的时间范围，支持: 30m, 1h, 2h, 4h, 1d, 2d",
        });
    }

    // 生成所有5分钟时间窗口
    const timeWindows = generateTimeWindows(startTime, now);

    // 从PostgreSQL读取数据
    const {
      UrlRequestStats,
      pgInstance,
    } = require("../../models/postgres-start");
    const { Op } = require("sequelize");

    const pgStartTime = new Date(timeWindows[0]);
    const pgEndTime = new Date(now);

    // 使用聚合查询，按urlPath分组求和
    const pgStats = await UrlRequestStats.findAll({
      where: {
        timeWindow: {
          [Op.gte]: pgStartTime,
          [Op.lte]: pgEndTime,
        },
      },
      attributes: [
        "urlPath",
        [
          pgInstance.fn("SUM", pgInstance.col("UrlRequestStats.request_count")),
          "totalCount",
        ],
      ],
      group: ["urlPath"],
      raw: true,
    });

    // 转换为Map并聚合数据
    const urlStatsMap = new Map(); // urlPath -> totalCount
    for (const stat of pgStats) {
      const count = parseInt(stat.totalCount || 0, 10);
      if (count > 0) {
        urlStatsMap.set(stat.urlPath, count);
      }
    }

    // 转换为数组并按请求数量降序排序
    const urlStats = Array.from(urlStatsMap.entries())
      .map(([urlPath, count]) => ({
        urlPath,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // 计算总数和百分比
    const totalRequests = urlStats.reduce((sum, item) => sum + item.count, 0);
    const urlStatsWithPercent = urlStats.map((item) => ({
      ...item,
      percent:
        totalRequests > 0
          ? ((item.count / totalRequests) * 100).toFixed(2)
          : "0.00",
    }));

    res.json({
      success: true,
      timeRange,
      data: {
        urlStats: urlStatsWithPercent,
        totalUrls: urlStats.length,
        totalRequests: totalRequests,
        timeWindows: timeWindows.length,
      },
    });
  } catch (error) {
    console.error("URL统计查询错误:", error);
    res.status(500).json({
      success: false,
      error: "查询失败",
      message: error.message,
    });
  }
});

/**
 * GET /security-violations
 * 安全校验失败日志查询（分页）
 */
router.get("/security-violations", adminAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitQuery = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(Math.max(limitQuery, 1), 100);
    const offset = (page - 1) * limit;
    const reasonCode = (req.query.reasonCode || "").trim();
    const clientIpFilter = (req.query.ip || "").trim();

    const {
      SecurityViolationLog,
      pgInstance,
    } = require("../../models/postgres-start");
    const { Op } = require("sequelize");

    const where = {};
    if (reasonCode) {
      where.reasonCode = reasonCode;
    }
    if (clientIpFilter) {
      where.clientIp = {
        [Op.iLike]: `%${clientIpFilter}%`,
      };
    }

    // 并行执行数据查询和 Top 10 IP 聚合
    const [logResult, topIps] = await Promise.all([
      // 1. 查询日志列表（分页）
      SecurityViolationLog.findAndCountAll({
        order: [["createdAt", "DESC"]],
        offset,
        limit,
        where,
      }),
      // 2. 查询 Top 10 风险 IP (仅在无 IP 筛选时计算全局 Top 10)
      !clientIpFilter
        ? SecurityViolationLog.findAll({
            attributes: [
              "clientIp",
              [pgInstance.fn("COUNT", pgInstance.col("client_ip")), "count"],
            ],
            where: {
              clientIp: { [Op.not]: null },
              // 统计最近7天的数据，避免全量扫描
              createdAt: {
                [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
            group: ["clientIp"],
            order: [[pgInstance.literal("count"), "DESC"]],
            limit: 10,
            raw: true,
          })
        : Promise.resolve([]), // 如果正在按 IP 筛选，则不计算 Top 10
    ]);

    const { rows, count } = logResult;

    res.json({
      success: true,
      data: rows.map((row) => row.toJSON()),
      topIps: topIps.map((item) => ({
        ip: item.clientIp,
        count: parseInt(item.count, 10),
      })),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(Math.ceil(count / limit), 1),
      },
    });
  } catch (error) {
    console.error("安全校验失败日志查询错误:", error);
    res.status(500).json({
      success: false,
      error: "查询失败",
      message: error.message,
    });
  }
});

/**
 * POST /execute-command
 * 执行服务器命令（需要认证，仅 luykin 用户）
 * @body {string} command - 要执行的命令
 */
router.post("/execute-command", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以执行命令
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[执行命令] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      try {
        await logAdminAction(req, {
          action: "execute-command",
          success: false,
          message: "forbidden",
        });
      } catch (e) {}
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以执行服务器命令",
      });
    }

    const { command } = req.body;

    if (!command || typeof command !== "string") {
      return res.status(400).json({
        success: false,
        error: "无效的命令",
        message: "命令不能为空",
      });
    }

    // 安全检查：禁止某些危险命令
    const dangerousCommands = [
      "rm -rf /",
      "rm -rf /*",
      "format",
      "mkfs",
      "dd if=",
      "> /dev/sd",
      ":(){ :|:& };:",
    ];

    const lowerCommand = command.toLowerCase().trim();
    for (const dangerous of dangerousCommands) {
      if (lowerCommand.includes(dangerous.toLowerCase())) {
        console.log(
          `[执行命令] 🛡️ 阻止危险命令: 用户=${req.user.username}, 命令=${command}`
        );
        try {
          await logAdminAction(req, {
            action: "execute-command",
            success: false,
            message: "blocked-dangerous",
          });
        } catch (e) {}
        return res.status(403).json({
          success: false,
          error: "命令被阻止",
          message: "该命令可能对系统造成危险，已被阻止执行",
        });
      }
    }

    // 命令长度限制
    if (command.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "命令过长",
        message: "命令长度不能超过 1000 个字符",
      });
    }

    console.log(
      `[执行命令] ✅ 执行命令: 用户=${req.user.username}, 命令=${command}`
    );

    // 执行命令，设置超时时间为 30 秒
    const timeout = 30000; // 30秒
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await Promise.race([
        execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024 * 10, // 10MB 输出缓冲区
          timeout: timeout,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("命令执行超时")), timeout)
        ),
      ]);

      const executionTime = Date.now() - startTime;

      // 获取当前工作目录
      let cwd;
      try {
        const { stdout: pwdOutput } = await execAsync("pwd");
        cwd = pwdOutput.trim();
      } catch (e) {
        cwd = process.cwd();
      }

      console.log(
        `[执行命令] ✅ 命令执行完成: 用户=${req.user.username}, 耗时=${executionTime}ms`
      );

      const resp = {
        success: true,
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: 0,
        cwd: cwd,
        executionTime: executionTime,
      };
      try {
        await logAdminAction(req, {
          action: "execute-command",
          success: true,
          message: `${command} ok ${executionTime}ms`,
        });
      } catch (e) {}
      res.json(resp);
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // 处理命令执行错误
      let exitCode = 1;
      let errorOutput = error.message || "命令执行失败";

      // 如果是超时错误
      if (error.message === "命令执行超时") {
        errorOutput = `命令执行超时（超过 ${timeout / 1000} 秒）`;
      } else if (error.code === "ETIMEDOUT" || error.signal === "SIGTERM") {
        errorOutput = `命令执行超时（超过 ${timeout / 1000} 秒）`;
      } else if (error.code) {
        exitCode = error.code;
        errorOutput = error.stderr || error.message;
      }

      // 获取当前工作目录
      let cwd;
      try {
        const { stdout: pwdOutput } = await execAsync("pwd");
        cwd = pwdOutput.trim();
      } catch (e) {
        cwd = process.cwd();
      }

      console.log(
        `[执行命令] ⚠️ 命令执行失败: 用户=${req.user.username}, 错误=${errorOutput}, 耗时=${executionTime}ms`
      );

      const respErr = {
        success: true, // 仍然返回 success，因为请求本身成功了
        stdout: error.stdout || "",
        stderr: errorOutput,
        exitCode: exitCode,
        cwd: cwd,
        executionTime: executionTime,
      };
      try {
        await logAdminAction(req, {
          action: "execute-command",
          success: false,
          message: `failed code=${exitCode}`,
        });
      } catch (e) {}
      res.json(respErr);
    }
  } catch (error) {
    console.error("[执行命令] ❌ 处理失败:", error);
    res.status(500).json({
      success: false,
      error: "处理命令失败",
      message: error.message,
    });
  }
});

/**
 * 日报邮件：手动触发发送（仅 luykin）
 */
router.post("/report/send", adminAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== "super") {
      try {
        await logAdminAction(req, {
          action: "report-send",
          success: false,
          message: "forbidden",
        });
      } catch (e) {}
      return res.status(403).json({ success: false, error: "权限不足" });
    }
    const { recipients } = req.body || {};
    const { sendDailyReport } = require("../services/dailyReportService");
    const result = await sendDailyReport(req.redisClient, recipients);
    const resp = { success: true, data: result };
    try {
      await logAdminAction(req, {
        action: "report-send",
        success: true,
        message: JSON.stringify(resp),
      });
    } catch (e) {}
    res.json(resp);
  } catch (e) {
    console.error("[DailyReport] manual send error:", e);
    try {
      await logAdminAction(req, {
        action: "report-send",
        success: false,
        message: e.message || "发送失败",
      });
    } catch (_e) {}
    res.status(500).json({ success: false, error: e.message || "发送失败" });
  }
});

/**
 * GET /admin-audit/logs
 * 获取管理员操作记录（需要认证，仅 luykin 用户）
 * @query page - 页码，默认 1
 * @query limit - 每页数量，默认 50
 * @query email - 按邮箱筛选（可选）
 * @query action - 按动作筛选（可选）
 */
router.get("/admin-audit/logs", adminAuth, async (req, res) => {
  try {
    // 权限检查：只有 luykin 用户可以查看管理员操作记录
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[管理员操作记录] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以查看管理员操作记录",
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitQuery = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(Math.max(limitQuery, 1), 100); // 限制最大 100
    const offset = (page - 1) * limit;

    const { XhuntAdminAuditLog } = require("../../models/postgres-start");
    const { Op } = require("sequelize");

    // 构建查询条件
    const where = {};
    if (req.query.email && req.query.email.trim()) {
      where.email = {
        [Op.iLike]: `%${req.query.email.trim()}%`, // 使用 iLike 进行模糊匹配（不区分大小写）
      };
    }
    if (req.query.action && req.query.action.trim()) {
      where.action = {
        [Op.iLike]: `%${req.query.action.trim()}%`,
      };
    }

    // 查询数据
    const { rows, count } = await XhuntAdminAuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]], // 按创建时间倒序
      offset,
      limit,
      attributes: [
        "id",
        "createdAt",
        "email",
        "action",
        "method",
        "route",
        "success",
        "message",
        "ip",
      ],
    });

    res.json({
      success: true,
      data: rows.map((row) => row.toJSON()),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(Math.ceil(count / limit), 1),
      },
    });
  } catch (error) {
    console.error("[管理员操作记录] ❌ 查询失败:", error);
    res.status(500).json({
      success: false,
      error: "查询失败",
      message: error.message,
    });
  }
});

module.exports = router;
