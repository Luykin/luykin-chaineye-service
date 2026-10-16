const express = require("express");
// 从 PostgreSQL 导入 Fundraising 模型
const { Fundraising } = require("../models/postgres-fundraising");
// 从 SQLite 导入爬取状态管理
const { NewCrawlState, C_STATE_TYPE } = require("../models/sqlite-start");
const axios = require("axios");

const router = express.Router();

function convertUTCToBeijingTime(utcDateString) {
  const date = new Date(utcDateString); // 将字符串转换为 Date 对象
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }); // 使用北京时间格式
}

/**
 * 兼容https://www.cryptohunt.ai/旧版数据格式的查询接口
 */
router.get("/search/legacy", async (req, res) => {
  try {
    const { keyword } = req.query;

    // 内部请求新接口
    const baseUrl = req.protocol + "://" + req.get("host");
    const newApiUrl = `${baseUrl}/api/rootdata/search?keyword=${encodeURIComponent(
      keyword
    )}`;

    const response = await axios.get(newApiUrl, {
      headers: {
        // 传递 Redis 客户端需要的请求头（如果有的话）
        "x-forwarded-for": req.get("x-forwarded-for") || req.ip,
      },
      timeout: 30000, // 30 秒超时
    });

    // 添加标识，表示这是从 legacy 接口代理过来的
    res.set("X-Proxied-From", "legacy");
    res.set("X-Data-Source", "PostgreSQL");

    // 返回新接口的响应
    res.json(response.data);
  } catch (error) {
    console.error("Error in legacy search (proxy):", error.message);

    // 如果新接口返回了错误响应，直接返回
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    // 其他错误
    res.status(500).json({
      error: "Failed to search project (legacy)",
      message: error.message,
    });
  }
});

// Get crawl status
router.get("/status", async (req, res) => {
  try {
    const [full, quick, detail, detail2, spare] = await Promise.all([
      NewCrawlState.findOne({ where: C_STATE_TYPE.full }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.quick }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.detail }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.detail2 }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.spare }),
    ]);

    // 初始化 projectDetails 为 null
    let projectDetails = null;
    let projectDetails2 = null;

    // 如果 detail 存在，则根据 projectLink 查询 Project 的 projectLink, projectName 和 originalPageNumber
    if (detail && detail?.otherInfo?.projectLink) {
      const project = await Fundraising.Project.findOne({
        where: { projectLink: detail?.otherInfo?.projectLink },
        attributes: [
          "projectLink",
          "projectName",
          "originalPageNumber",
          "detailFailuresNumber",
        ],
      });
      projectDetails = project
        ? {
            projectLink: project.projectLink,
            projectName: project.projectName,
            originalPageNumber: project.originalPageNumber,
            detailFailuresNumber: project.detailFailuresNumber,
          }
        : null;
    }
    if (detail2 && detail2?.otherInfo?.projectLink) {
      const project = await Fundraising.Project.findOne({
        where: { projectLink: detail2?.otherInfo?.projectLink },
        attributes: [
          "projectLink",
          "projectName",
          "originalPageNumber",
          "detailFailuresNumber",
        ],
      });
      projectDetails2 = project
        ? {
            projectLink: project.projectLink,
            projectName: project.projectName,
            originalPageNumber: project.originalPageNumber,
            detailFailuresNumber: project.detailFailuresNumber,
          }
        : null;
    }

    res.json({
      full: full
        ? {
            status: full.status,
            lastUpdate: convertUTCToBeijingTime(full.lastUpdateTime),
            error: full.error,
            otherInfo: full?.otherInfo,
          }
        : null,
      quick: quick
        ? {
            status: quick.status,
            lastUpdate: convertUTCToBeijingTime(quick.lastUpdateTime),
            error: quick.error,
            otherInfo: quick?.otherInfo,
          }
        : null,
      detail: detail
        ? {
            status: detail.status,
            lastUpdate: convertUTCToBeijingTime(detail.lastUpdateTime),
            error: detail.error,
            otherInfo: detail?.otherInfo,
            projectDetails: projectDetails,
            quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(
              projectDetails?.projectName
            )}`,
          }
        : null,
      detail2: detail2
        ? {
            status: detail2.status,
            lastUpdate: convertUTCToBeijingTime(detail2.lastUpdateTime),
            error: detail2.error,
            otherInfo: detail2?.otherInfo,
            projectDetails: projectDetails2,
            quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(
              projectDetails2?.projectName
            )}`,
          }
        : null,
      spare: spare
        ? {
            status: spare.status,
            lastUpdate: convertUTCToBeijingTime(spare.lastUpdateTime),
            error: spare.error,
            otherInfo: spare?.otherInfo,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching crawl status:", error);
    res.status(500).json({ error: "Failed to fetch crawl status" });
  }
});

module.exports = router;
