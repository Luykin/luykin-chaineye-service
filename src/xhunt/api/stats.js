const express = require("express");
const path = require("path");
const { getFullStats, getSimpleStats } = require("../services/statsService");
const expressStatic = require("express");
const XLSX = require("xlsx");
const fs = require("fs").promises;
const fsSync = require("fs");
const os = require("os");
const { createReadStream } = require("fs");
const readline = require("readline");

const router = express.Router();

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

/**
 * 基础认证中间件
 * 支持多用户角色验证
 */
function basicAuth(req, res, next) {
  // 定义用户角色
  const users = {
    admin: {
      password: process.env.STATS_ADMIN_PASSWORD || "d&sja6kl=8!u90%1i@admin",
      role: "admin",
      name: "管理员",
    },
    luykin: {
      password: process.env.STATS_LUYKIN_PASSWORD || "wtf.0813",
      role: "luykin",
      name: "Luykin",
    },
  };

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    // 返回401状态码，浏览器会自动弹出登录框
    res.setHeader("WWW-Authenticate", 'Basic realm="XHunt Stats"');
    return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>需要认证</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>🔐 访问受限</h2>
				<p>请输入用户名和密码访问统计页面</p>
			</body>
			</html>
		`);
  }

  // 解码 Base64 编码的用户名密码
  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString(
    "ascii"
  );
  const [username, password] = credentials.split(":");

  // 验证用户名密码
  const user = users[username];
  if (user && user.password === password) {
    // 将用户信息附加到请求对象上
    req.user = {
      username: username,
      role: user.role,
      name: user.name,
    };
    next(); // 认证成功，继续处理请求
  } else {
    // 认证失败
    res.setHeader("WWW-Authenticate", 'Basic realm="XHunt Stats"');
    return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>认证失败</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>❌ 认证失败</h2>
				<p>用户名或密码错误，请重试</p>
				<button onclick="window.location.reload()">重新登录</button>
			</body>
			</html>
		`);
  }
}

/**
 * 退出登录接口
 * 通过返回401状态码来清除浏览器的认证缓存
 */
router.get("/logout", (req, res) => {
  // 设置WWW-Authenticate头来触发浏览器清除认证
  res.setHeader("WWW-Authenticate", 'Basic realm="XHunt Stats"');
  res.status(401).send(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>已退出登录</title>
			<meta charset="UTF-8">
			<meta http-equiv="refresh" content="2;url=/api/xhunt/stats">
		</head>
		<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
			<h2>✅ 已成功退出登录</h2>
			<p>正在跳转到登录页面...</p>
			<p><a href="/api/xhunt/stats">点击这里立即跳转</a></p>
		</body>
		</html>
	`);
});

/**
 * GET /stats
 * 获取产品数据统计（需要认证）
 */
router.get("/", basicAuth, async (req, res) => {
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

    // 在HTML中注入统计数据脚本
    const finalHtml = renderedHtml.replace(
      "</body>",
      `${statsDataScript}</body>`
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
router.get("/json", basicAuth, async (req, res) => {
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
router.get("/dau-details", basicAuth, async (req, res) => {
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
});

/**
 * GET /online-users
 * 获取最近20分钟内的在线用户列表（需要认证）
 */
router.get("/online-users", basicAuth, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // 计算20分钟前的时间
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

    // 获取在线用户数据
    const postgresModels = require("../../models/postgres-start");
    const XHuntUserToken = postgresModels.XHuntUserToken;
    const XHuntUser = postgresModels.XHuntUser;
    const { Op } = require("sequelize");

    // 查询最近20分钟内有活动的用户
    const onlineUsers = await XHuntUserToken.findAll({
      where: {
        lastUsed: {
          [Op.gte]: twentyMinutesAgo,
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
          [Op.gte]: twentyMinutesAgo,
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
});

/**
 * GET /export/users/excel
 * 导出所有已登录用户数据为Excel文件（需要认证）
 */
router.get("/export/users/excel", basicAuth, async (req, res) => {
  try {
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
});

/**
 * GET /log-search
 * 日志搜索接口（需要认证）- 优化版本
 */
router.get("/log-search", basicAuth, async (req, res) => {
  try {
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
});

/**
 * GET /error-logs
 * 获取最新API错误日志（需要认证）
 */
router.get("/error-logs", basicAuth, async (req, res) => {
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
});

/**
 * GET /notes
 * 获取指定日期的用户备注数据（需要认证）
 */
router.get("/notes", basicAuth, async (req, res) => {
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
 * 批量发送私信（需要认证）
 */
router.post("/send-messages", basicAuth, async (req, res) => {
  try {
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
router.get("/weekly-cohorts", basicAuth, async (req, res) => {
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
router.get("/daily-cohorts", basicAuth, async (req, res) => {
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
router.get("/rootdata-quota", basicAuth, async (req, res) => {
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
 * GET /health
 * 健康检查接口（无需认证）
 */
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
router.get("/rootdata-daily", basicAuth, async (req, res) => {
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
router.post("/rootdata-daily/set-initial", basicAuth, async (req, res) => {
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

/**
 * GET /api/stats/device-status
 * 获取设备状态信息（CPU、内存、PM2、Redis、PostgreSQL等）
 */
router.get("/device-status", basicAuth, async (req, res) => {
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
      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
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

    res.json(deviceStatus);
  } catch (error) {
    console.error("获取设备状态失败:", error.message);
    res.status(500).json({
      error: "Failed to fetch device status",
      message: error.message,
    });
  }
});

module.exports = router;
