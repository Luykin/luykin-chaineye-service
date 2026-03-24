const express = require("express");
const { Op, literal } = require("sequelize");
const axios = require("axios");
const { adminAuth } = require("../../admin/middleware/adminAuth");
const router = express.Router();

// 爬虫队列服务（双重验证机制）
const crawlerQueue = require("../services/RootdataCrawlerQueue");

// Redis 缓存时间：1分钟 = 60 秒
const CACHE_TTL_ROOTDATA = 60;
// HTTP 缓存时间：100分钟 = 6000 秒
const HTTP_CACHE_TTL = 6000;

// Rootdata API 配置
const ROOTDATA_API_BASE = "https://api.rootdata.com/open";
const ROOTDATA_API_KEY = "0TpF08MLXdb50VCGx1H8buExoMwgADbR";

/**
 * Rootdata API 服务类
 */
class RootdataAPIService {
  /**
   * 根据项目URL提取 project_id
   */
  static extractProjectId(projectLink) {
    if (!projectLink) return null;

    // 从 URL 中提取参数，如: ?k=MTE3
    const match = projectLink.match(/[?&]k=([^&]+)/);
    if (!match) return null;

    try {
      // 先进行 URL 解码（将 %3D 转换为 =），然后再进行 Base64 解码
      const urlDecoded = decodeURIComponent(match[1]);
      const decoded = Buffer.from(urlDecoded, "base64").toString("utf-8");
      return decoded;
    } catch (error) {
      console.error("Failed to decode project_id:", error);
      return null;
    }
  }

  /**
   * 调用 Rootdata API - 获取项目详情（含 team_members）
   */
  static async getProjectItemInfo(projectId) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/get_item`,
        {
          project_id: projectId,
          include_team: true,
        },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response.data?.result === 200) {
        return response.data.data;
      }
      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error(
        `[rootdata api 失败] ❌ ${error.message} , api: ${ROOTDATA_API_BASE}/get_item project_id=${projectId}`
      );
      return null;
    }
  }

  /**
   * 调用 Rootdata API - 获取个人(Member)信息（含投资）
   * @param {number|string} peopleId - 个人ID
   */
  static async getPeopleInfo(peopleId) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/get_people`,
        { people_id: peopleId },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      console.log(
        `[rootdata api 请求] ${ROOTDATA_API_BASE}/get_people peopleId: ${peopleId} response: ${JSON.stringify(
          response.data?.result
        )}`
      );

      if (response.data?.result === 200) {
        return response.data.data;
      }

      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error(
        `[rootdata api 失败] ❌ ${error.message} , peopleId: ${peopleId}, api: ${ROOTDATA_API_BASE}/get_people`
      );
      throw error;
    }
  }

  /**
   * 调用 Rootdata API - 获取项目融资信息
   * @param {string} projectId - 项目ID
   */
  static async getFundingInfo(projectId, projectLink) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/get_fac`,
        {
          project_id: projectId,
          include_team: true,
        },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      console.log(
        `[rootdata api 请求] ${ROOTDATA_API_BASE}/get_fac projectId: ${projectId} projectLink:${projectLink} response: ${JSON.stringify(
          response.data?.result
        )}`
      );

      if (response.data?.result === 200) {
        return response.data.data;
      }

      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error(
        `[rootdata api 失败] ❌ ${
          error.message
        } , projectId: ${projectId} projectIdNumber: ${Number(
          projectId
        )}, api: ${ROOTDATA_API_BASE}/get_fac, projectLink:${projectLink}`
      );
      throw error;
    }
  }

  /**
   * 获取 ID 映射表
   * type: 1 Project, 2 VC, 3 People
   */
  static async getIdMap(type) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/id_map`,
        { type },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );
      if (response.data?.result === 200 && Array.isArray(response.data?.data)) {
        return response.data.data; // [{id, name}]
      }
      throw new Error(`id_map result=${response.data?.result}`);
    } catch (e) {
      console.error(`[rootdata id_map] ❌ type=${type} error:`, e.message);
      throw e;
    }
  }

  // 内存缓存（避免每次请求）
  static _idMapCache = {
    fetchedAt: 0,
    ttlMs: 240 * 60 * 60 * 1000, // 240 小时
    byType: {
      1: new Map(),
      2: new Map(),
      3: new Map(),
    },
  };

  // Redis 持久缓存 TTL（秒）
  static _IDMAP_REDIS_TTL_SEC = 240 * 60 * 60;

  static async _getIdMapFromRedis(type) {
    try {
      const client = global.__xhuntRedis;
      if (!client) return null;
      const key = `rootdata:id_map:${type}`;
      const cached = await client.get(key);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.error(
        `[rootdata id_map redis] get fail type=${type}:`,
        e.message
      );
      return null;
    }
  }

  static async _setIdMapToRedis(type, data) {
    try {
      const client = global.__xhuntRedis;
      if (!client) return;
      const key = `rootdata:id_map:${type}`;
      await client.setEx(
        key,
        this._IDMAP_REDIS_TTL_SEC,
        JSON.stringify(data || [])
      );
    } catch (e) {
      console.error(
        `[rootdata id_map redis] set fail type=${type}:`,
        e.message
      );
    }
  }

  static async ensureIdMaps() {
    const now = Date.now();
    if (now - this._idMapCache.fetchedAt < this._idMapCache.ttlMs) return;
    // 优先读取 Redis；缺失则回源 API 并写回 Redis
    let [proj, vc, people] = await Promise.all([
      this._getIdMapFromRedis(1),
      this._getIdMapFromRedis(2),
      this._getIdMapFromRedis(3),
    ]);
    const needFetch1 = !Array.isArray(proj) || proj.length === 0;
    const needFetch2 = !Array.isArray(vc) || vc.length === 0;
    const needFetch3 = !Array.isArray(people) || people.length === 0;
    if (needFetch1) {
      try {
        proj = await this.getIdMap(1);
        await this._setIdMapToRedis(1, proj);
      } catch (_) {}
    }
    if (needFetch2) {
      try {
        vc = await this.getIdMap(2);
        await this._setIdMapToRedis(2, vc);
      } catch (_) {}
    }
    if (needFetch3) {
      try {
        people = await this.getIdMap(3);
        await this._setIdMapToRedis(3, people);
      } catch (_) {}
    }
    const toMap = (arr) => {
      const m = new Map();
      for (const it of arr || []) {
        if (it && it.id !== undefined)
          m.set(String(it.id), String(it.name || "").trim());
      }
      return m;
    };
    this._idMapCache.byType[1] = toMap(proj);
    this._idMapCache.byType[2] = toMap(vc);
    this._idMapCache.byType[3] = toMap(people);
    this._idMapCache.fetchedAt = now;
    console.log(
      `[rootdata id_map] ✅ cached: proj=${proj?.length || 0} vc=${
        vc?.length || 0
      } people=${people?.length || 0}`
    );
  }

  /**
   * 基于 id+name 反推实体类型，并生成相对与完整链接
   */
  static async resolveLinkByIdName(id, name, options = {}) {
    await this.ensureIdMaps();
    const idStr = String(id);
    const nm = String(name || "").trim();
    const maps = this._idMapCache.byType;
    const matches = [];
    if (maps[1].has(idStr)) matches.push(1);
    if (maps[2].has(idStr)) matches.push(2);
    if (maps[3].has(idStr)) matches.push(3);
    let type = matches.length === 1 ? matches[0] : null;
    const forceType =
      options &&
      (options.forceType === 1 ||
        options.forceType === 2 ||
        options.forceType === 3)
        ? options.forceType
        : null;
    if (forceType) type = forceType;
    if (!type) type = 1; // 默认按 Project 处理，保证回退

    const encoded = encodeURIComponent(
      Buffer.from(String(idStr), "utf-8").toString("base64")
    );
    const encodedName = encodeURIComponent(nm);

    const prefix =
      type === 1
        ? "/Projects/detail"
        : type === 2
        ? "/Investors/detail"
        : "/member";
    const relativeLink = `${prefix}/${encodedName}?k=${encoded}`;
    const fullLink = `https://www.rootdata.com${relativeLink}`;
    return { type, relativeLink, fullLink, encodedName, encoded };
  }

  /**
   * 调用 Rootdata API - 获取机构(VC)信息（含团队与投资）
   * @param {number|string} orgId - 机构ID
   * @param {Object} options
   * @param {boolean} options.includeTeam - 是否返回团队信息，默认 true
   * @param {boolean} options.includeInvestments - 是否返回投资信息，默认 true
   */
  static async getOrgInfo(
    orgId,
    { includeTeam = true, includeInvestments = true } = {}
  ) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/get_org`,
        {
          org_id: orgId,
          include_team: includeTeam,
          include_investments: includeInvestments,
        },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      console.log(
        `[rootdata api 请求] ${ROOTDATA_API_BASE}/get_org orgId: ${orgId} response: ${JSON.stringify(
          response.data?.result
        )}`
      );

      if (response.data?.result === 200) {
        return response.data.data;
      }

      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error(
        `[rootdata api 失败] ❌ ${error.message} , orgId: ${orgId}, api: ${ROOTDATA_API_BASE}/get_org`
      );
      throw error;
    }
  }

  /**
   * 根据 projectLink 获取完整的融资信息
   */
  static async getProjectFundingData(projectLink, entityType = "project") {
    const projectId = this.extractProjectId(projectLink);

    if (!projectId) {
      throw new Error("Failed to extract project_id from projectLink");
    }

    if (entityType === "vc") {
      // 机构 VC
      return await this.getOrgInfo(projectId);
    } else if (entityType === "member") {
      // 个人 Member
      return await this.getPeopleInfo(projectId);
    }
    // 普通项目
    return await this.getFundingInfo(projectId, projectLink);
  }
}

// 轻量管理员操作日志（类外的顶层函数）
async function logAdminAction(req, { action, success, message }) {
  try {
    const { XhuntAdminAuditLog } = require("../../models/postgres-start");
    const email = req.user?.username || req.adminUser?.email || "unknown";
    await XhuntAdminAuditLog.create({
      email,
      action,
      method: req.method,
      route: req.originalUrl || req.url,
      success: !!success,
      message:
        typeof message === "string"
          ? message.slice(0, 1000)
          : JSON.stringify(message || {}).slice(0, 1000),
      ip: req.headers["x-forwarded-for"] || req.ip || "",
    });
  } catch (e) {
    console.error("[admin-audit] log failed:", e.message);
  }
}

/**
 * 数据修正服务
 * 通过 Rootdata API 验证和修复本地数据库的投资关系数据
 */
class RootdataDataFixService {
  /**
   * 验证和修复项目数据
   * @param {Object} project - 项目对象
   * @param {Object} Fundraising - Fundraising 模型
   * @param {Object} redisClient - Redis 客户端
   * @param {string} searchCacheKey - 搜索结果的缓存key（修正后需要清除）
   */
  static async verifyAndFixProject(
    project,
    Fundraising,
    redisClient,
    searchCacheKey = null,
    updateProgram = "auto_api_fix"
  ) {
    try {
      const projectLink = project.projectLink;

      // 只验证项目链接，不验证投资者链接
      if (!projectLink) {
        console.log(`⏭️ 跳过验证（空链接）: ${projectLink}`);
        return null;
      }
      // if(!verifyMoreType && !projectLink.includes("/Projects/detail")) {
      //   console.log(`⏭️ 跳过验证（非项目链接,未开启verifyMoreType验证）: ${projectLink}`);
      //   return null;
      // }
      if (
        !projectLink.includes("/Investors/detail") &&
        !projectLink.includes("/Projects/detail") &&
        !projectLink.includes("/member")
      ) {
        console.log(
          `⏭️ 跳过验证（非VC链接/非项目链接/非member）: ${projectLink}`
        );
        return null;
      }

      // 实体类型：vc / member / project
      const entityType = projectLink.includes("/Investors/detail")
        ? "vc"
        : projectLink.includes("/member")
        ? "member"
        : "project";
      console.log(
        `[rootdata verify] entityType=${entityType} link=${projectLink}`
      );

      const cacheKey = `rootdata_verified:${projectLink}`;

      // 1. 检查20天内是否已修正
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`[rootdata verify] cache hit, skip verify`);
        return JSON.parse(cached);
      }

      // 2. 调用 Rootdata API
      console.log(`🔍 验证项目数据: ${projectLink}`);

      const apiData = await RootdataAPIService.getProjectFundingData(
        projectLink,
        entityType
      );

      // 3a. 职位关系同步（vc/project 的 team_members）
      try {
        await this.syncTeamPositions(
          project,
          apiData,
          Fundraising,
          entityType,
          updateProgram
        );
      } catch (e) {
        console.warn(`[rootdata team_positions] 同步失败: ${e.message}`);
      }

      // 根据是否为 VC 判断返回数据结构
      const noData =
        entityType === "vc" || entityType === "member"
          ? !apiData ||
            !Array.isArray(apiData.investments) ||
            apiData.investments.length === 0
          : !apiData ||
            !Array.isArray(apiData.items) ||
            apiData.items.length === 0;

      if (noData) {
        console.log(`⚠️ 未找到API数据，跳过修正: ${projectLink}`);

        // 缓存"未找到"状态（1天），避免重复请求
        const notFoundCache = {
          verified: false,
          notFound: true,
          checkedAt: Date.now(),
        };
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(notFoundCache)); // 1天 = 24 * 3600
        console.log(`📝 已缓存"未找到"状态（1天）: ${projectLink}`);

        return null;
      }

      const count =
        entityType === "vc" || entityType === "member"
          ? apiData.investments?.length || 0
          : apiData.items?.length || 0;
      console.log(
        `[rootdata verify] fetched count=${count} entityType=${entityType}`
      );

      // 3b. 修正数据（显式传入 entityType，内部按类型分支处理）
      await this.fixProjectData(
        project,
        apiData,
        Fundraising,
        entityType,
        updateProgram
      );

      // 4. 清除搜索结果缓存，让下次请求获取修正后的数据
      if (searchCacheKey) {
        try {
          await redisClient.del(searchCacheKey);
        } catch (error) {
          console.error("清除缓存失败:", error);
        }
      }

      // 5. 缓存验证结果（20天）- 只存储标记，不存储具体数据
      const cacheData = {
        verified: true,
        verifiedAt: Date.now(),
      };
      await redisClient.setEx(cacheKey, 1728000, JSON.stringify(cacheData)); // 20天 = 20 * 24 * 3600

      console.log(`✅ 数据修正完成并已缓存: ${projectLink}`);
      return cacheData;
    } catch (error) {
      console.error("❌ 数据修正失败:", error.message);
      return null;
    }
  }

  /**
   * 修正项目数据
   */
  static async fixProjectData(
    project,
    apiData,
    Fundraising,
    entityType = "project",
    updateProgram = "auto_api_fix"
  ) {
    const fundedProjectId = project.id;

    // 获取项目的 Twitter URL（用于验证）
    const projectTwitterUrl = project.twitterUrl || project.socialLinks?.x;
    const roundsCount =
      entityType === "vc" || entityType === "member"
        ? apiData?.investments?.length || 0
        : apiData?.items?.length || 0;
    if (entityType === "project" && !projectTwitterUrl) {
      console.log(
        `[rootdata 对比起效] ⚠️ 无Twitter URL跳过: ${project.projectName} | 轮次:${roundsCount}`
      );
      return;
    }

    console.log(
      `{rootdata 对比起效} 🔍 开始: ${
        project.projectName
      } | API返回:${roundsCount}轮次${
        projectTwitterUrl ? ` | Twitter:${projectTwitterUrl}` : ""
      }`
    );

    let totalProcessed = 0; // 统计处理的投资者数量
    let totalSkipped = 0; // 统计跳过的轮次数量
    let totalMatched = 0; // 统计匹配成功的轮次数量

    // 兼容 VC 机构返回的数据结构（apiData.investments）
    if (entityType === "vc" && Array.isArray(apiData?.investments)) {
      const vcProjectId = project.id;

      // 预处理：生成所有候选链接，批量查询已存在项目，减少 N+1 查询
      const vcItems = await Promise.all(
        apiData.investments.map(async (inv) => {
          const rawName = String(inv.name || "").trim();
          const { relativeLink, fullLink, encodedName, encoded } =
            await RootdataAPIService.resolveLinkByIdName(
              inv.project_id,
              rawName
            );
          const shortRelative = `/detail/${encodedName}?k=${encoded}`;
          const shortRelativeUnencoded = `/detail/${rawName}?k=${encoded}`;
          return {
            inv,
            rawName,
            encodedName,
            encoded,
            relativeLink,
            fullLink,
            shortRelative,
            shortRelativeUnencoded,
          };
        })
      );

      const linkKeys = Array.from(
        new Set(
          vcItems
            .flatMap((it) => [it.shortRelative, it.shortRelativeUnencoded])
            .filter(Boolean)
        )
      );

      const existingRows = linkKeys.length
        ? await Fundraising.Project.findAll({
            where: { projectLink: { [Op.in]: linkKeys } },
            attributes: ["id", "projectLink", "projectName", "logo"],
            raw: true,
          })
        : [];

      const existingMap = new Map();
      for (const row of existingRows) {
        existingMap.set(row.projectLink, row);
      }

      for (const item of vcItems) {
        const { inv, fullLink, shortRelative, shortRelativeUnencoded } = item;
        try {
          // 3) 使用批量查询结果映射，避免逐条查库
          let target =
            existingMap.get(shortRelative) ||
            existingMap.get(shortRelativeUnencoded);

          // 4) 如未找到则创建（使用 findOrCreate 防止竞态与唯一冲突）
          if (!target) {
            const [instance, created] = await Fundraising.Project.findOrCreate({
              where: { projectLink: fullLink },
              defaults: {
                projectName: inv.name,
                projectLink: fullLink,
                logo: inv.logo,
                description: inv.name,
                isInitial: true,
                socialLinks: null,
                detailFailuresNumber: 0,
                detailFetchedAt: null,
                updateProgram,
              },
            });
            const plain = instance.get
              ? instance.get({ plain: true })
              : instance;
            target = plain;
            // 缓存到映射，避免后续重复创建
            existingMap.set(shortRelative, plain);
            if (shortRelativeUnencoded) {
              existingMap.set(shortRelativeUnencoded, plain);
            }
          }

          // 5) 建立投资关系（VC -> 被投项目）
          await this.findOrCreateRelationship(
            {
              investorProjectId: vcProjectId,
              fundedProjectId: target.id,
              round: null,
              amount: null,
              formattedAmount: 0,
              date: null,
              lead: false,
              updateProgram,
            },
            Fundraising
          );
          totalProcessed++;
        } catch (error) {
          const details = error?.errors
            ? JSON.stringify(
                error.errors.map((e) => ({
                  path: e.path,
                  message: e.message,
                  type: e.type,
                  validatorKey: e.validatorKey,
                }))
              )
            : "";
          console.error(
            `[rootdata VC 处理] ❌ 处理失败: ${error.name || "Error"} ${
              error.message
            } ${details}`
          );
        }
      }

      console.log(
        `[rootdata 对比起效] ✨ VC完成: ${project.projectName} | 处理被投项目:${apiData.investments.length}个`
      );
      return;
    }

    // 兼容 Member 个人返回的数据结构（apiData.investments）
    if (entityType === "member" && Array.isArray(apiData?.investments)) {
      const memberProjectId = project.id;
      for (const inv of apiData.investments) {
        try {
          // 优先根据 Twitter URL 查项目（兼容带/与不带/）
          const twitterUrl = inv.X || inv.x || "";
          let target = null;
          if (twitterUrl) {
            const withSlash = twitterUrl.endsWith("/")
              ? twitterUrl
              : `${twitterUrl}/`;
            const withoutSlash = twitterUrl.endsWith("/")
              ? twitterUrl.slice(0, -1)
              : twitterUrl;
            target = await Fundraising.Project.findOne({
              where: { twitterUrl: { [Op.iLike]: withoutSlash } },
              raw: true,
            });
            if (!target) {
              target = await Fundraising.Project.findOne({
                where: { twitterUrl: { [Op.iLike]: withSlash } },
                raw: true,
              });
            }
          }

          // 如未找到，则以 id 生成标准链接创建（使用 findOrCreate 防止唯一约束冲突）
          if (!target) {
            const nm = String(inv.name || "").trim();
            const { relativeLink, fullLink } =
              await RootdataAPIService.resolveLinkByIdName(inv.id, nm);
            const [instance] = await Fundraising.Project.findOrCreate({
              where: { projectLink: fullLink },
              defaults: {
                projectName: inv.name,
                projectLink: fullLink,
                logo: inv.logo,
                description: inv.one_liner || inv.name,
                isInitial: true,
                socialLinks: twitterUrl ? { x: twitterUrl } : null,
                twitterUrl: twitterUrl || null,
                detailFailuresNumber: 0,
                detailFetchedAt: null,
                updateProgram,
              },
            });
            target = instance.get ? instance.get({ plain: true }) : instance;
          }

          await this.findOrCreateRelationship(
            {
              investorProjectId: memberProjectId,
              fundedProjectId: target.id,
              round: null,
              amount: null,
              formattedAmount: 0,
              date: null,
              lead: false,
              updateProgram,
            },
            Fundraising
          );
          totalProcessed++;
        } catch (error) {
          console.error(`[rootdata Member 处理] ❌ 处理失败: ${error.message}`);
        }
      }

      console.log(
        `[rootdata 对比起效] ✨ Member完成: ${project.projectName} | 处理被投项目:${apiData.investments.length}个`
      );
      return;
    }

    if (entityType !== "project") {
      return;
    }

    for (const round of apiData.items) {
      if (!round.invests || round.invests.length === 0) {
        totalSkipped++;
        continue;
      }

      // ✅ 数据验证：确保 API 返回的是我们查询的项目数据
      if (round.X) {
        const normalizeUrl = (url) => {
          if (!url) return "";
          return url.toLowerCase().replace(/\/$/, "");
        };

        const apiTwitterUrl = normalizeUrl(round.X);
        const expectedTwitterUrl = normalizeUrl(projectTwitterUrl);

        if (apiTwitterUrl !== expectedTwitterUrl) {
          console.log(
            `[rootdata 对比起效] ❌ Twitter不匹配跳过: ${round.rounds} | API:${apiTwitterUrl} vs 期望:${expectedTwitterUrl}`
          );
          totalSkipped++;
          continue;
        }

        console.log(
          `[rootdata 对比起效] ✅ Twitter匹配: ${round.rounds} | 投资者:${round.invests.length}个`
        );
        totalMatched++;
      }

      for (const investor of round.invests) {
        try {
          const investorProject = await this.findOrCreateInvestor(
            investor,
            Fundraising,
            updateProgram
          );

          if (!investorProject) continue;

          await this.findOrCreateRelationship(
            {
              investorProjectId: investorProject.id,
              fundedProjectId: fundedProjectId,
              round: round.rounds || null,
              amount: round.amount || null,
              formattedAmount: round.amount || null,
              date: this.parseDate(round.published_time),
              lead: investor.lead_investor === 1,
              updateProgram,
            },
            Fundraising
          );

          totalProcessed++;
        } catch (error) {
          console.error(`[rootdata 对比起效] ❌ 处理失败: ${error.message}`);
        }
      }
    }

    console.log(
      `[rootdata 对比起效] ✨ 完成: ${project.projectName} | 匹配:${totalMatched}轮次 跳过:${totalSkipped}轮次 投资者:${totalProcessed}个`
    );
  }

  /**
   * 同步职位关系（VC/Project 的 team_members）
   */
  static async syncTeamPositions(
    project,
    apiData,
    Fundraising,
    entityType = "project",
    updateProgram = "auto_api_fix"
  ) {
    try {
      if (!apiData) {
        console.log("[team_positions] skip: no apiData");
        return;
      }
      if (entityType !== "vc" && entityType !== "project") {
        console.log(`[team_positions] skip: unsupported type=${entityType}`);
        return;
      }
      let members = Array.isArray(apiData.team_members)
        ? apiData.team_members
        : [];
      // 当为 project 且 API 数据无 team_members 时，回源 /get_item 或使用本地爬虫数据作为兜底
      if (entityType === "project" && members.length === 0) {
        try {
          const projectId = RootdataAPIService.extractProjectId(
            project.projectLink
          );
          if (projectId) {
            console.log("[team_positions] fetch /get_item for team_members");
            const itemData = await RootdataAPIService.getProjectItemInfo(
              projectId
            );
            if (itemData && Array.isArray(itemData.team_members)) {
              members = itemData.team_members;
            }
          }
        } catch (_) {}
        // if (members.length === 0 && Array.isArray(project.teamMembers)) {
        //   console.log('[team_positions] fallback to project.teamMembers');
        //   members = project.teamMembers;
        // }
      }
      if (members.length === 0) {
        console.log("[team_positions] skip: no members");
        return;
      }

      const objectProjectId = project.id;
      console.log(
        `[team_positions] start type=${entityType} object=${objectProjectId} members=${members.length}`
      );

      for (const m of members) {
        try {
          const rawName = String(m.name || "").trim();
          if (!rawName || !m.people_id) continue;
          // 通过 people_id + name 生成标准的 member 详情链接
          const { fullLink } = await RootdataAPIService.resolveLinkByIdName(
            m.people_id,
            rawName,
            { forceType: 3 }
          );

          const xUrl = m.X || m.x || null;

          // 成员 Project
          const [memberProj, createdMember] =
            await Fundraising.Project.findOrCreate({
              where: { projectLink: fullLink },
              defaults: {
                projectName: rawName,
                projectLink: fullLink,
                logo: m.head_img || null,
                description: rawName,
                isInitial: true,
                socialLinks: xUrl ? { x: xUrl } : null,
                twitterUrl: xUrl || null,
                detailFailuresNumber: 0,
                detailFetchedAt: null,
                updateProgram,
              },
            });
          if (createdMember) {
            console.log(
              `[team_positions] member created id=${memberProj.id} name=${rawName}`
            );
          }

          // 职位关系（成员 -> 当前对象 VC/Project）
          await Fundraising.PositionRelationships.findOrCreate({
            where: {
              subjectProjectId: memberProj.id,
              objectProjectId,
              position: m.position || null,
            },
            defaults: {
              subjectProjectId: memberProj.id,
              objectProjectId,
              position: m.position || null,
              source: entityType,
              updateProgram,
            },
          });
          console.log(
            `[team_positions] link ${memberProj.id}->${objectProjectId} pos=${
              m.position || ""
            }`
          );
        } catch (e) {
          console.warn(`[syncTeamPositions] 单个成员处理失败: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`[syncTeamPositions] 失败: ${e.message}`);
    }
  }

  /**
   * 标准化 URL - 统一编码格式
   * 处理 RootData URL 中的空格和 Base64 参数值中的特殊字符
   * 例如: "Amber Group?k=NDA4Nw==" -> "Amber%20Group?k=NDA4Nw%3D%3D"
   */
  static normalizeUrl(url) {
    if (!url) return url;

    try {
      // 分离基础 URL 和查询参数
      const questionMarkIndex = url.indexOf("?");
      if (questionMarkIndex === -1) {
        // 没有查询参数，只处理路径中的空格
        return url.replace(/ /g, "%20");
      }

      const baseUrl = url.substring(0, questionMarkIndex);
      const queryString = url.substring(questionMarkIndex + 1);

      // 对路径部分的空格进行编码
      const encodedBaseUrl = baseUrl.replace(/ /g, "%20");

      // 对查询参数进行处理
      // 格式: k=value，其中 value 可能包含 = (Base64)
      const params = queryString.split("&");
      const encodedParams = params.map((param) => {
        const equalIndex = param.indexOf("=");
        if (equalIndex === -1) return param;

        const key = param.substring(0, equalIndex);
        const value = param.substring(equalIndex + 1);

        // 对参数值中的 = 进行编码（Base64 值中的 =）
        const encodedValue = value.replace(/=/g, "%3D");

        return `${key}=${encodedValue}`;
      });

      return `${encodedBaseUrl}?${encodedParams.join("&")}`;
    } catch (error) {
      console.warn("URL 标准化失败:", url, error);
      // 失败时返回原 URL
      return url;
    }
  }

  /**
   * 查找或创建投资者项目
   */
  static async findOrCreateInvestor(
    investor,
    Fundraising,
    updateProgram = "auto_api_fix"
  ) {
    // 提取 projectLink
    const projectLink = investor.rootdataurl;
    if (!projectLink) return null;

    // 从 rootdataurl 构建完整的 projectLink
    // 例如: https://www.rootdata.com/Investors/detail/Polychain?k=MTQ2
    let originalProjectLink = projectLink;
    if (!projectLink.includes("http")) {
      originalProjectLink = `https://www.rootdata.com${projectLink}`;
    }

    // 标准化 URL 格式（统一编码）
    const normalizedProjectLink = this.normalizeUrl(originalProjectLink);

    // 同时使用两种 URL 格式查找（防止重复创建）
    // 先查标准化的，再查原始的
    let existing = await Fundraising.Project.findOne({
      where: {
        [Op.or]: [
          { projectLink: normalizedProjectLink },
          { projectLink: originalProjectLink },
        ],
      },
      raw: true,
    });

    if (existing) {
      // 如果找到的记录使用的是未标准化的 URL，更新为标准化格式
      if (existing.projectLink !== normalizedProjectLink) {
        try {
          await Fundraising.Project.update(
            { projectLink: normalizedProjectLink },
            { where: { id: existing.id } }
          );
          console.log(`📝 更新项目 URL 为标准化格式: ${existing.projectName}`);
          existing.projectLink = normalizedProjectLink;
        } catch (error) {
          console.warn("更新 URL 格式失败:", error.message);
        }
      }
      return existing;
    }

    // 创建新项目（使用标准化后的 URL）
    const newProject = await Fundraising.Project.create({
      projectName: investor.name,
      projectLink: normalizedProjectLink,
      logo: investor.logo,
      description: investor.name, // 使用名称作为描述
      isInitial: normalizedProjectLink.includes("/Projects/detail"), // ✅ 包含详情页链接则为初始项目
      socialLinks: investor.X ? { x: investor.X } : null,
      detailFailuresNumber: 0, // ✅ 初始化失败次数为 0
      detailFetchedAt: null, // ✅ 初始化抓取时间为 null，等待爬虫抓取
      updateProgram,
    });

    console.log(`✨ 创建新投资者项目: ${investor.name} (待爬虫抓取详情)`);
    return newProject;
  }

  /**
   * 查找或创建投资关系
   */
  static async findOrCreateRelationship(relationshipData, Fundraising) {
    const { investorProjectId, fundedProjectId } = relationshipData;
    // 归一化轮次：与模型 hooks(beforeCreate/Update/BulkCreate)保持一致，空或空白字符串统一为 '--'
    const normRound =
      !relationshipData.round || String(relationshipData.round).trim() === ""
        ? "--"
        : relationshipData.round;

    // 检查是否存在（兼容历史数据：round 可能为 null 或 '--'）
    const existing = await Fundraising.InvestmentRelationships.findOne({
      where: {
        investorProjectId,
        fundedProjectId,
        [Op.or]: [
          { round: normRound },
          { round: null },
          { round: "" },
          { round: " " },
        ],
      },
      raw: true,
    });

    if (existing) {
      // 如命中 legacy(null) 轮次，做一次就地修复为规范值，避免后续重复
      if (
        (existing.round === null ||
          existing.round === "" ||
          existing.round === " ") &&
        normRound
      ) {
        try {
          await Fundraising.InvestmentRelationships.update(
            { round: normRound },
            {
              where: {
                investorProjectId,
                fundedProjectId,
                round: { [Op.in]: [null, "", " "] },
              },
            }
          );
        } catch (_) {}
      }
      return;
    }

    // 创建新关系（使用归一化后的轮次）
    try {
      await Fundraising.InvestmentRelationships.create({
        ...relationshipData,
        round: normRound,
      });
      console.log(
        `✨ 创建投资关系: ${investorProjectId} -> ${fundedProjectId} (${normRound})`
      );
    } catch (err) {
      const name = err && err.name ? String(err.name) : "";
      // 兼容并发/历史数据导致的重复创建，忽略唯一/校验错误
      if (name.includes("UniqueConstraint") || name.includes("Validation")) {
        console.warn(
          `⚠️ 关系已存在或校验失败(忽略): ${investorProjectId} -> ${fundedProjectId} (${normRound})`
        );
        return;
      }
      throw err;
    }
  }

  /**
   * 解析日期字符串为时间戳
   */
  static parseDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr).getTime();
  }
}

/**
 * 辅助函数：按日期分组投资记录
 * 使用天数作为分组key，避免时区差异导致同一天的融资被分到不同组
 * 差距在24小时内的时间戳会被分到相邻的组（相差小于0.5天会被分到同一组）
 */
const groupInvestmentsByDate = (investmentsReceived) => {
  // 先按时间戳排序
  const sorted = [...investmentsReceived].sort(
    (a, b) => (a.date || 0) - (b.date || 0)
  );

  const groups = [];
  let currentGroup = null;

  sorted.forEach((investment) => {
    const timestamp = investment.date;

    // 跳过日期为 null 或 undefined 的记录
    if (!timestamp) {
      return;
    }

    // 如果是第一条记录，或者与当前组的时间差超过24小时，创建新组
    if (
      !currentGroup ||
      timestamp - currentGroup.minTimestamp > 24 * 60 * 60 * 1000
    ) {
      currentGroup = {
        round: investment.round,
        amount: investment.amount,
        valuation: investment.valuation,
        formattedAmount: investment.formattedAmount,
        formattedValuation: investment.formattedValuation,
        investors: [],
        minTimestamp: timestamp,
        maxTimestamp: timestamp,
      };
      groups.push(currentGroup);
    } else {
      // 更新当前组的最大时间戳
      currentGroup.maxTimestamp = Math.max(
        currentGroup.maxTimestamp,
        timestamp
      );
    }

    currentGroup.investors.push({
      lead: investment.lead,
      projectName: investment.investorProject?.projectName,
      projectLink: investment.investorProject?.projectLink,
      socialLinks: investment.investorProject?.socialLinks,
      logo: investment.investorProject?.logo,
    });
  });

  // 转换为以时间戳为key的对象格式（保持原有API兼容性）
  return groups.reduce((acc, group, index) => {
    // 使用组的最小时间戳作为key
    acc[group.minTimestamp] = group;
    return acc;
  }, {});
};

/**
 * 辅助函数：从 Twitter URL 中提取用户名
 */
const extractUsername = (url) => {
  if (!url) return null;
  const match = url.match(/x\.com\/([^/]+)/i);
  return match ? match[1] : null;
};

/**
 * 辅助函数：批量更新项目 Logo 到数据库
 * @param {Object} avatarMap - 用户名到头像 URL 的映射
 * @param {Object} Fundraising - Fundraising 模型对象
 */
async function batchUpdateProjectLogos(avatarMap, Fundraising) {
  if (!avatarMap || Object.keys(avatarMap).length === 0) {
    return;
  }

  try {
    const usernames = Object.keys(avatarMap);

    // 构建 CASE WHEN 语句进行批量更新
    const caseWhenClauses = usernames
      .map((username) => {
        const avatar = avatarMap[username];
        const twitterUrl = `https://x.com/${username}`;
        const twitterUrlWithSlash = `https://x.com/${username}/`;

        return `
          WHEN (LOWER("socialLinks"->>'x') = LOWER('${twitterUrl}') OR
                LOWER("socialLinks"->>'x') = LOWER('${twitterUrlWithSlash}'))
          THEN '${avatar}'
        `;
      })
      .join("");

    const updateQuery = `
      UPDATE "Projects"
      SET logo = CASE ${caseWhenClauses}
                  ELSE logo
                  END
      WHERE "socialLinks"->>'x' IS NOT NULL
    `;

    await Fundraising.Project.sequelize.query(updateQuery);
    console.log(`✅ 批量更新了 ${usernames.length} 个项目的 Logo`);
  } catch (error) {
    console.error("❌ 批量更新 Logo 失败:", error);
    throw error;
  }
}

/**
 * GET /api/rootdata/search
 * 根据 Twitter 用户名搜索项目信息
 */
router.get("/search", async (req, res) => {
  try {
    // 1. 参数验证和清理
    let { keyword } = req.query;

    if (!keyword || !keyword.trim() || String(keyword).length < 2) {
      return res.json({
        invested: null,
        investor: null,
        message: "No keyword provided or keyword too short",
      });
    }

    // const lowerKeyword = String(keyword).toLowerCase();

    // // 应用重命名映射
    // if (lowerKeyword in RENAME_MAP || keyword in RENAME_MAP) {
    //   keyword = RENAME_MAP[lowerKeyword] || RENAME_MAP[keyword];
    // }

    const sanitizedKeyword = String(keyword.trim()).toLowerCase();
    const cacheKey = `rootdata_search_${sanitizedKeyword}_1030_2`;

    // 2. 从 Redis 获取缓存
    let cachedData;
    try {
      cachedData = await req.redisClient.get(cacheKey);
      if (cachedData) {
        res.set("Cache-Control", `public, max-age=${HTTP_CACHE_TTL}`);
        res.set("X-Cache-Status", "HIT");
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      console.error("Redis Client Error (GET):", error);
    }

    // 3. 获取 Fundraising 模型（从 PostgreSQL）
    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res
        .status(500)
        .json({ error: "Database model not initialized", requestId: reqId });
    }

    // 4. 构造查询条件
    const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
    const targetTwitterUrlWithSlash = `https://x.com/${sanitizedKeyword}/`;

    // 5. 优化查询：使用 twitterUrl 字段，速度更快（带索引）
    const project = await Fundraising.Project.findOne({
      where: {
        [Op.or]: [
          {
            twitterUrl: {
              [Op.iLike]: targetTwitterUrl,
            },
          },
          {
            twitterUrl: {
              [Op.iLike]: targetTwitterUrlWithSlash,
            },
          },
        ],
      },
      order: [["id", "DESC"]],
      attributes: [
        "id",
        "projectName",
        "projectLink",
        "socialLinks",
        "logo",
        "amount",
        "twitterUrl",
        "socialLinks",
      ],
      raw: true,
    });

    if (!project) {
      const notFoundResponse = {
        invested: null,
        investor: null,
        message: "No matching project found",
      };

      try {
        await req.redisClient.setEx(
          cacheKey,
          CACHE_TTL_ROOTDATA,
          JSON.stringify(notFoundResponse)
        );
      } catch (error) {
        console.error("Redis Client Error (SET):", error);
      }

      res.set("Cache-Control", `public, max-age=${HTTP_CACHE_TTL}`);
      res.set("X-Cache-Status", "MISS");
      return res.json(notFoundResponse);
    }

    // 6. 异步验证和修正数据（双重验证机制，不影响响应速度）
    // 修正完成后会自动清除缓存，确保下次请求能获取最新数据
    setImmediate(async () => {
      try {
        // // 第一重：API验证和修正
        // await RootdataDataFixService.verifyAndFixProject(
        //   project,
        //   Fundraising,
        //   req.redisClient,
        //   cacheKey, // 传入搜索缓存key，修正后会清除
        //   "auto_api_fix"
        // );

        // 第二重：爬虫更新验证（队列化、节流、去重）
        crawlerQueue.updateCrawl(project, cacheKey);
      } catch (error) {
        console.error("数据修正失败:", error);
      }
    });

    // 7. 并行查询关联数据（性能优化）
    const [investmentsReceived, investmentsGiven] = await Promise.all([
      Fundraising.InvestmentRelationships.findAll({
        where: { fundedProjectId: project.id },
        attributes: [
          "round",
          "lead",
          "amount",
          "date",
          "formattedAmount",
          "investorProjectId",
        ],
        include: [
          {
            model: Fundraising.Project,
            as: "investorProject",
            attributes: ["projectName", "socialLinks", "logo"],
          },
        ],
        raw: true,
        nest: true,
      }),
      Fundraising.InvestmentRelationships.findAll({
        where: { investorProjectId: project.id },
        attributes: [
          "round",
          "lead",
          "amount",
          "date",
          "formattedAmount",
          "fundedProjectId",
        ],
        include: [
          {
            model: Fundraising.Project,
            as: "fundedProject",
            attributes: ["projectName", "socialLinks", "logo"],
          },
        ],
        raw: true,
        nest: true,
      }),
    ]);

    // 8. 处理 invested（收到的投资）数据
    const groupedInvestments = groupInvestmentsByDate(
      investmentsReceived || []
    );

    const totalFunding = Object.values(groupedInvestments).reduce(
      (sum, group) => sum + (group.formattedAmount || 0),
      0
    );

    // 构造 investors 数据并去重
    const rawInvestors = Object.values(groupedInvestments).flatMap((group) =>
      group.investors.map((investor) => ({
        avatar: investor?.logo || "",
        lead_investor: investor?.lead || false,
        name: investor?.projectName || "",
        twitter: investor?.socialLinks?.x || "",
      }))
    );

    const investors = Array.from(
      rawInvestors
        .reduce((map, item) => {
          if (map.has(item.name)) {
            const existing = map.get(item.name);
            if (!existing.lead_investor && item.lead_investor) {
              map.set(item.name, item);
            }
          } else {
            map.set(item.name, item);
          }
          return map;
        }, new Map())
        .values()
    );

    // 移除 grouped_investments 中每一项的 investors 字段
    const groupedInvestmentsWithoutInvestors = Object.entries(
      groupedInvestments
    ).reduce((acc, [date, group]) => {
      acc[date] = {
        round: group.round,
        amount: group.amount,
        valuation: group.valuation,
        formattedAmount: group.formattedAmount,
        formattedValuation: group.formattedValuation,
      };
      return acc;
    }, {});

    const investedData = {
      investors,
      total_funding: totalFunding,
      grouped_investments: groupedInvestmentsWithoutInvestors,
    };

    // 9. 处理 investor（投出的项目）数据
    const rawFundedProjects = (investmentsGiven || []).map((investment) => ({
      avatar: investment.fundedProject?.logo || "",
      name: investment.fundedProject?.projectName || "",
      twitter: investment.fundedProject?.socialLinks?.x || "",
      lead_investor: investment.fundedProject?.lead || false,
      amount: investment.formattedAmount || 0, // 🔧 修复：添加 amount 字段
    }));

    const fundedProjects = Array.from(
      rawFundedProjects
        .reduce((map, item) => {
          if (map.has(item.name)) {
            const existing = map.get(item.name);
            if (!existing.lead_investor && item.lead_investor) {
              map.set(item.name, item);
            }
          } else {
            map.set(item.name, item);
          }
          return map;
        }, new Map())
        .values()
    );

    // 🔧 修复：正确计算投出的总金额
    const totalInvestment = (investmentsGiven || []).reduce(
      (sum, inv) => sum + (inv.formattedAmount || 0),
      0
    );

    const investorData = {
      investors: fundedProjects,
      total_funding: totalInvestment,
    };

    // 10. 异步更新头像（优化：统一调度，避免重复）
    const scheduleAvatarRefresh = (groups) => {
      const need = new Set();
      groups.forEach((arr) => {
        (arr || []).forEach((it) => {
          if (it && it.twitter) {
            const u = extractUsername(it.twitter);
            if (
              u &&
              (!it.avatar ||
                !String(it.avatar).startsWith("https://pbs.twimg.com"))
            ) {
              need.add(u);
            }
          }
        });
      });
      if (need.size === 0) return;
      setImmediate(async () => {
        try {
          const usernames = Array.from(need);
          const apiURL = `https://data.cryptohunt.ai/fetch/twitter/users?usernames=${usernames.join(
            ","
          )}`;
          const response = await axios.get(apiURL);
          const userDataArray = response?.data?.data?.data || [];
          const avatarMap = {};
          userDataArray.forEach((user) => {
            if (user?.profile?.username && user?.profile?.profile_image_url) {
              avatarMap[String(user.profile.username).toLowerCase()] =
                user.profile.profile_image_url;
            }
          });
          groups.forEach((arr) => {
            (arr || []).forEach((it) => {
              if (it && it.twitter) {
                const k = String(extractUsername(it.twitter)).toLowerCase();
                if (k && avatarMap[k]) it.avatar = avatarMap[k];
              }
            });
          });
          await batchUpdateProjectLogos(avatarMap, Fundraising);
        } catch (error) {
          console.error("Error fetching/updating avatars:", error);
        }
      });
    };

    // 11. 查询与该项目关联的成员（职位关系）
    let members = [];
    try {
      const positions = await Fundraising.PositionRelationships.findAll({
        where: { objectProjectId: project.id },
        attributes: ["position", "subjectProjectId", "objectProjectId"],
        include: [
          {
            model: Fundraising.Project,
            as: "subjectProject",
            attributes: ["projectName", "socialLinks", "logo", "twitterUrl"],
          },
        ],
        raw: true,
        nest: true,
      });

      members = (positions || []).map((row) => ({
        name: row.subjectProject?.projectName || "",
        position: row.position || "",
        twitter:
          row.subjectProject?.twitterUrl ||
          row.subjectProject?.socialLinks?.x ||
          "",
        avatar: row.subjectProject?.logo || "",
      }));
    } catch (e) {
      console.warn("[search] 加载职位关系失败:", e.message);
    }

    // 异步更新成员/投资者/被投项目头像（统一调度）
    try {
      scheduleAvatarRefresh([investors, fundedProjects, members]);
    } catch (_) {}

    // 12. 组装最终响应
    const response = {
      invested: investedData,
      investor: investorData,
      projectLink: project?.projectLink,
      members,
    };

    // 13. 缓存结果到 Redis 10分钟
    try {
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL_ROOTDATA,
        JSON.stringify(response)
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    res.set("Cache-Control", `public, max-age=${HTTP_CACHE_TTL}`);
    res.set("X-Cache-Status", "MISS");
    res.json(response);
  } catch (error) {
    console.error("Error in rootdata search:", error);
    res.status(500).json({
      error: "Failed to search project",
      message: error.message || "Unknown error",
    });
  }
});


// 强制触发 RootdataDataFixService.verifyAndFixProject（先清缓存再执行）
// 支持三选一传参：keyword（与 /search 一样）、projectLink、twitterUrl
router.get("/force-verify", adminAuth, async (req, res) => {
  try {
    const reqId =
      req.headers["x-request-id"] ||
      `rv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    console.log(`[force-verify] ▶️ start`);
    let { keyword, projectLink, twitterUrl } = req.query;

    if (!keyword && !projectLink && !twitterUrl) {
      return res.status(400).json({
        error: "One of keyword, projectLink, or twitterUrl is required",
        requestId: reqId,
      });
    }

    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    let project = null;
    let searchCacheKey = null;

    if (projectLink) {
      project = await Fundraising.Project.findOne({
        where: { projectLink },
        raw: true,
      });
    } else {
      let handle = keyword;
      if (!handle && twitterUrl) {
        const m = String(twitterUrl).match(/x\.com\/([^/]+)/i);
        handle = m ? m[1] : null;
      }

      if (!handle || String(handle).trim().length < 2) {
        return res.json({
          success: false,
          message: "No valid identifier provided",
        });
      }

      const sanitizedKeyword = String(keyword.trim()).toLowerCase();
      searchCacheKey = `rootdata_search_${sanitizedKeyword}_1030_2`;

      const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
      const targetTwitterUrlWithSlash = `https://x.com/${sanitizedKeyword}/`;

      project = await Fundraising.Project.findOne({
        where: {
          [Op.or]: [
            { twitterUrl: { [Op.iLike]: targetTwitterUrl } },
            { twitterUrl: { [Op.iLike]: targetTwitterUrlWithSlash } },
          ],
        },
        order: [["id", "DESC"]],
        attributes: [
          "id",
          "projectName",
          "projectLink",
          "socialLinks",
          "logo",
          "amount",
          "twitterUrl",
          "socialLinks",
        ],
        raw: true,
      });
    }

    if (!project) {
      console.log(`[force-verify] 🔎 project not found`);
      if (req.admin && req.admin.id) {
        try {
          await logAdminAction(req, {
            action: "force-verify",
            success: false,
            message: "project not found",
          });
        } catch (_) {}
      }
      return res.json({
        success: false,
        message: "No matching project found",
        requestId: reqId,
      });
    }

    const isVCLink = Boolean(
      project.projectLink && project.projectLink.includes("/Investors/detail")
    );
    const isMemberLink = Boolean(
      project.projectLink && project.projectLink.includes("/member")
    );
    console.log(`[force-verify] ✅ project id=${project.id} isVC=${isVCLink}`);

    // 先删除相关缓存，确保强制触发
    const toDeleteKeys = [];
    if (searchCacheKey) toDeleteKeys.push(searchCacheKey);
    if (project.projectLink)
      toDeleteKeys.push(`rootdata_verified:${project.projectLink}`);

    try {
      for (const k of toDeleteKeys) {
        await req.redisClient.del(k);
      }
    } catch (e) {
      console.error(`Redis Client Error (DEL)`, e);
    }

    // 在强制校验前，按项目类型清空关系：VC/Member 清理其作为投资方的关系；项目清理其作为被投方的关系
    try {
      if (isVCLink || isMemberLink) {
        const delAsInvestor = await Fundraising.InvestmentRelationships.destroy(
          { where: { investorProjectId: project.id } }
        );
        console.log(
          `🧹 清理(VC/member作为投资方)=${delAsInvestor} projectId=${project.id}`
        );
      } else {
        const delAsFunded = await Fundraising.InvestmentRelationships.destroy({
          where: { fundedProjectId: project.id },
        });
        console.log(
          `🧹 清理(项目作为被投方)=${delAsFunded} projectId=${project.id}`
        );
      }
    } catch (e) {
      console.error(`清理旧投资关系失败:`, e);
    }

    // 强制触发验证与修正
    try {
      console.log(`[force-verify] 🔁 verifyAndFixProject start`);
      await RootdataDataFixService.verifyAndFixProject(
        project,
        Fundraising,
        req.redisClient,
        searchCacheKey,
        "manual_api_fix"
      );
      console.log(`[force-verify] ✅ verifyAndFixProject done`);
      if (req.admin && req.admin.id) {
        try {
          await logAdminAction(req, {
            action: "force-verify",
            success: true,
            message: `projectId=${project.id}`,
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error(`verifyAndFixProject failed:`, e);
      if (req.admin && req.admin.id) {
        try {
          await logAdminAction(req, {
            action: "force-verify",
            success: false,
            message: e.message || "verify failed",
          });
        } catch (_) {}
      }
    }

    res.json({
      success: true,
      projectId: project.id,
      projectLink: project.projectLink,
      requestId: reqId,
    });
  } catch (error) {
    console.error("Error in force-verify:", error);
    if (req.admin && req.admin.id) {
      try {
        await logAdminAction(req, {
          action: "force-verify",
          success: false,
          message: error.message || "error",
        });
      } catch (_) {}
    }
    res.status(500).json({
      error: "Failed to force verify project",
      message: error.message || "Unknown error",
      requestId: req.headers["x-request-id"] || undefined,
    });
  }
});

/**
 * DELETE /api/rootdata/relationship/:id
 * 删除单条投资关系记录
 */
router.delete("/relationship/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Missing relationship id" });
    }

    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    // 查找记录
    const relationship = await Fundraising.InvestmentRelationships.findByPk(id);
    if (!relationship) {
      return res.status(404).json({ error: "Relationship not found" });
    }

    // 删除记录
    await relationship.destroy();

    console.log(`✅ 删除投资关系记录: ID=${id}`);
    try {
      await logAdminAction(req, {
        action: "relationship-delete",
        success: true,
        message: `id=${id}`,
      });
    } catch (_) {}

    res.json({
      success: true,
      message: "删除成功",
      deletedId: id,
    });
  } catch (error) {
    console.error("删除投资关系失败:", error);
    try {
      await logAdminAction(req, {
        action: "relationship-delete",
        success: false,
        message: error.message || "delete failed",
      });
    } catch (_) {}
    res.status(500).json({
      error: "Failed to delete relationship",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/rootdata/relationships/funded-project/:fundedProjectId
 * 删除被投项目的投资关系记录（可选：仅删除指定日期范围内的）
 *
 * Query params:
 *   - date: 可选，格式 YYYY-MM-DD，只删除该日期 00:00:00 到 23:59:59 创建的记录
 */
router.delete(
  "/relationships/funded-project/:fundedProjectId",
  adminAuth,
  async (req, res) => {
    try {
      const { fundedProjectId } = req.params;
      const { date } = req.query;

      if (!fundedProjectId) {
        return res.status(400).json({ error: "Missing funded project id" });
      }

      const { Fundraising } = require("../../models/postgres-fundraising");
      if (!Fundraising) {
        return res
          .status(500)
          .json({ error: "Database model not initialized" });
      }

      // 构建删除条件
      const whereCondition = { fundedProjectId: fundedProjectId };

      // 如果提供了日期，只删除该日期范围内创建的记录
      if (date) {
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          return res.status(400).json({ error: "Invalid date format" });
        }

        // 设置日期范围：当天 00:00:00 到 23:59:59
        const startOfDay = new Date(dateObj);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(dateObj);
        endOfDay.setHours(23, 59, 59, 999);

        whereCondition.createdAt = {
          [Op.gte]: startOfDay,
          [Op.lte]: endOfDay,
        };

        console.log(
          `🗑️ 删除被投项目 (ID=${fundedProjectId}) 在 ${date} 新增的投资关系`
        );
      } else {
        console.log(
          `⚠️ 删除被投项目 (ID=${fundedProjectId}) 的所有投资关系（无日期限制）`
        );
      }

      // 删除符合条件的记录
      const result = await Fundraising.InvestmentRelationships.destroy({
        where: whereCondition,
      });

      console.log(`✅ 成功删除 ${result} 条记录`);
      try {
        await logAdminAction(req, {
          action: "relationships-delete-funded",
          success: true,
          message: `fundedProjectId=${fundedProjectId} deleted=${result} date=${
            date || "all"
          }`,
        });
      } catch (_) {}

      res.json({
        success: true,
        message: "删除成功",
        deletedCount: result,
        fundedProjectId: fundedProjectId,
        dateFilter: date || "all",
      });
    } catch (error) {
      console.error("删除被投项目投资关系失败:", error);
      try {
        await logAdminAction(req, {
          action: "relationships-delete-funded",
          success: false,
          message: error.message || "delete failed",
        });
      } catch (_) {}
      res.status(500).json({
        error: "Failed to delete relationships",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/rootdata/manual-crawl
 * 手动触发单个项目的爬取
 */
router.post("/manual-crawl", async (req, res) => {
  const startTime = Date.now();
  const { url, force } = req.body;
  const requestId = req.headers['x-request-id'] || `mc-${Date.now()}`;
  console.log(`🚀 [手动爬虫] 开始执行: ${url}, force=${force}`);

  try {
    if (!url || !url.includes("rootdata.com")) {
      return res.status(400).json({ error: "Invalid RootData URL" });
    }

    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    // 1. 查找项目
    let project = await Fundraising.Project.findOne({
      where: { projectLink: url },
    });

    // 如果项目不存在，创建新项目
    if (!project) {
      const match = url.match(/\/detail\/([^?]+)/);
      const projectName = match
        ? decodeURIComponent(match[1])
        : "Unknown Project";

      project = await Fundraising.Project.create({
        projectName,
        projectLink: url,
        isInitial: url.includes("/Projects/detail"),
        detailFailuresNumber: 0,
        detailFetchedAt: null,
        updateProgram: "manual_crawler",
      });
      console.log(`📦 [手动爬虫] 创建项目: ${projectName}`);
    }

    // 如果强制重新爬取，先清空关联关系（保留项目本身）
    if (force) {
      console.log(`🗑️ [手动爬虫] 强制模式：清空项目 ${project.projectName} (ID=${project.id}) 的关联数据`);
      
      // 删除作为投资方的关系
      const deletedAsInvestor = await Fundraising.InvestmentRelationships.destroy({
        where: { investorProjectId: project.id },
      });
      
      // 删除作为被投资方的关系
      const deletedAsInvestee = await Fundraising.InvestmentRelationships.destroy({
        where: { fundedProjectId: project.id },
      });
      
      // 删除职位关系
      const deletedPositions = await Fundraising.PositionRelationships.destroy({
        where: {
          [Op.or]: [
            { subjectProjectId: project.id },
            { objectProjectId: project.id },
          ],
        },
      });
      
      // 重置项目详情抓取状态
      await project.update({
        detailFetchedAt: null,
        detailFailuresNumber: 0,
      });
      
      console.log(`✅ [手动爬虫] 已清空: 投资方关系${deletedAsInvestor}条, 被投资方关系${deletedAsInvestee}条, 职位关系${deletedPositions}条`);
    }

    // 2. 执行爬取
    const crawler = require("../../services/rootdata-crawler");
    const { browser, page } = await crawler.initBrowserAndPage();

    try {
      await crawler.scrapeAndUpdateProjectDetails(project, page, true);

      // 3. 获取更新后的数据
      const updatedProject = await Fundraising.Project.findByPk(project.id, {
        attributes: ["id", "projectName", "projectLink", "logo", "socialLinks"],
      });

      // 4. 统计投资关系（双向）
      const [asInvestor, asInvestee] = await Promise.all([
        // 作为投资者投资的项目
        Fundraising.InvestmentRelationships.findAll({
          where: { investorProjectId: project.id },
          include: [
            {
              model: Fundraising.Project,
              as: "fundedProject",
              attributes: ["id", "projectName", "projectLink", "logo"],
            },
          ],
          attributes: ["id", "round", "amount", "valuation", "date", "lead"],
        }),
        // 作为被投资者，被谁投资
        Fundraising.InvestmentRelationships.findAll({
          where: { fundedProjectId: project.id },
          include: [
            {
              model: Fundraising.Project,
              as: "investorProject",
              attributes: ["id", "projectName", "projectLink", "logo"],
            },
          ],
          attributes: ["id", "round", "amount", "valuation", "date", "lead"],
        }),
      ]);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `✅ [手动爬虫] 完成: ${updatedProject.projectName} (${duration}秒)`
      );
      console.log(`   投资了 ${asInvestor.length} 个项目`);
      console.log(`   被 ${asInvestee.length} 个投资者投资`);

      res.json({
        success: true,
        message: "爬取成功",
        requestId,
        data: {
          duration,
          project: {
            id: updatedProject.id,
            projectName: updatedProject.projectName,
            projectLink: updatedProject.projectLink,
            logo: updatedProject.logo,
            socialLinks: updatedProject.socialLinks,
          },
          // 作为投资者投资的项目
          asInvestor: asInvestor.map((r) => ({
            id: r.id,
            project: r.fundedProject,
            round: r.round,
            amount: r.amount,
            valuation: r.valuation,
            date: r.date,
            lead: r.lead,
          })),
          // 被谁投资
          asInvestee: asInvestee.map((r) => ({
            id: r.id,
            investor: r.investorProject,
            round: r.round,
            amount: r.amount,
            valuation: r.valuation,
            date: r.date,
            lead: r.lead,
          })),
        },
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ [手动爬虫] 失败 (${duration}秒): ${error.message}`);

    res.status(500).json({
      error: "Failed to crawl project",
      message: error.message || "Unknown error",
      requestId,
    });
  }
});

/**
 * GET /api/rootdata/idmap-from-redis
 * 从 Redis 获取 ID Map 数据
 */
router.get("/idmap-from-redis-type", async (req, res) => {
  try {
    const { type } = req.query;
    if (!type || !["1", "2", "3"].includes(String(type))) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing 'type' parameter. Must be 1, 2, or 3.",
      });
    }
    const data = await RootdataAPIService._getIdMapFromRedis(type);
    res.json({ success: true, type, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to retrieve ID map from Redis",
      message: error.message,
    });
  }
});

module.exports = router;
