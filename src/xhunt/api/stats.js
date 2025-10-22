const express = require("express");
const path = require("path");
const { getFullStats, getSimpleStats } = require("../services/statsService");
const expressStatic = require("express");
const XLSX = require("xlsx");
const fs = require("fs").promises;
const os = require("os");

const router = express.Router();

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
 * 最简单的用户名密码验证
 */
function basicAuth(req, res, next) {
  // 从环境变量获取认证信息，如果没有则使用默认值
  const STATS_USERNAME = process.env.STATS_USERNAME || "admin";
  const STATS_PASSWORD = process.env.STATS_PASSWORD || "xhunt2024";

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
  if (username === STATS_USERNAME && password === STATS_PASSWORD) {
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
    res.status(500).json({ error: "获取统计数据失败" });
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
 * 日志搜索接口（需要认证）
 */
router.get("/log-search", basicAuth, async (req, res) => {
  try {
    const { query, contextLines = 3, limit = 100 } = req.query;

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

    // 过滤和检查日志文件
    for (const file of files) {
      // 只处理 .log 文件
      if (file.endsWith(".log")) {
        const filePath = path.join(pm2LogsDir, file);

        try {
          const stats = await fs.stat(filePath);
          const fileSizeMB = stats.size / (1024 * 1024); // 转换为MB

          // 跳过大于200MB的文件或0MB的空文件
          if (fileSizeMB > 200 || fileSizeMB === 0) {
            continue;
          }

          logFiles.push({
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
    logFiles.sort((a, b) => b.mtime - a.mtime);

    const results = [];
    const contextLinesNum = parseInt(contextLines);
    const limitNum = parseInt(limit);
    let totalMatches = 0;

    // 搜索每个日志文件
    for (const file of logFiles) {
      if (totalMatches >= limitNum) break;

      try {
        const content = await fs.readFile(file.path, "utf8");
        const lines = content.split("\n");

        // 从文件底部开始往前搜索（最新的日志在底部）
        for (let i = lines.length - 1; i >= 0; i--) {
          if (totalMatches >= limitNum) break;

          const line = lines[i];
          if (line.toLowerCase().includes(query.toLowerCase())) {
            // 获取上下文行
            const startLine = Math.max(0, i - contextLinesNum);
            const endLine = Math.min(lines.length - 1, i + contextLinesNum);

            const context = [];
            for (let j = startLine; j <= endLine; j++) {
              context.push({
                lineNumber: j + 1,
                content: lines[j],
                isMatch: j === i,
              });
            }

            results.push({
              file: file.name,
              lineNumber: i + 1,
              context: context,
              matchLine: line,
              timestamp: file.mtime,
            });

            totalMatches++;
          }
        }
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

module.exports = router;
