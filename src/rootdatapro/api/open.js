const express = require("express");
const db = require("../models");
const { proApiKeyAuth } = require("../middleware/proApiKey");

const router = express.Router();

const path = require("path");

function parseIntParam(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

const requiredHost = "rootdatapro.online";

router.use((req, res, next) => {
  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").toLowerCase();
  if (!forwardedHost.includes(requiredHost)) {
    return res.status(404).send("Not Found");
  }
  return next();
});

router.get("/", (req, res) => {
  const baseUrl = requiredHost;

  const app = req.app;
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));

  const clientRegion = req.get("x-client-region") || req.headers?.["x-client-region"] || null;

  return app.render(
    "open-docs",
    {
      baseUrl,
      clientRegion,
    },
    (err, html) => {
      if (err) {
        console.error("[rootdatapro] render open-docs error", err);
        return res.status(500).send("Render error");
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }
  );
});


/**
 * 根据类型收集所有需要查询的 id 列表。
 * 返回形如 { Project: Set<id>, Organization: Set<id>, Person: Set<id> }
 */
function collectIdsByType(items, typeKey, idKey) {
  const map = { Project: new Set(), Organization: new Set(), Person: new Set() };
  for (const item of items) {
    const t = item[typeKey];
    if (map[t]) {
      map[t].add(item[idKey]);
    }
  }
  return map;
}

/**
 * 通用批量查询函数。
 * @param {"Project"|"Organization"|"Person"} entityType
 * @param {Set<number>} ids
 * @returns {Promise<Record<number, any>>}
 */
async function batchFetchEntities(entityType, ids) {
  if (!ids || ids.size === 0) return {};
  const idArray = [...ids];
  let Model, idColumn, attributesToSelect;

  if (entityType === "Project") {
    Model = db.Project;
    idColumn = "project_id";
    attributesToSelect = ["project_id", "project_name", "logo", "X"];
  } else if (entityType === "Organization") {
    Model = db.Organization;
    idColumn = "org_id";
    attributesToSelect = ["org_id", "org_name", "logo", "X"];
  } else if (entityType === "Person") {
    Model = db.Person;
    idColumn = "people_id";
    attributesToSelect = ["people_id", "people_name", "head_img", "X"];
  } else {
    return {};
  }

  const rows = await Model.findAll({
    where: { [idColumn]: idArray },
    attributes: attributesToSelect,
  });

  const res = {};
  for (const row of rows) {
    res[row[idColumn]] = row.toJSON();
  }
  return res;
}

async function attachInvestorEntities(investments) {
  // 1. 收集各类型 id
  const idsByType = collectIdsByType(investments, "investorType", "investorId");

  // 2. 批量查询
  const [projectMap, orgMap, personMap] = await Promise.all([
    batchFetchEntities("Project", idsByType.Project),
    batchFetchEntities("Organization", idsByType.Organization),
    batchFetchEntities("Person", idsByType.Person),
  ]);

  // 3. 组装结果
  const result = [];
  for (const inv of investments) {
    let investorSummary = null;
    if (inv.investorType === "Project") investorSummary = projectMap[inv.investorId] || null;
    else if (inv.investorType === "Organization") investorSummary = orgMap[inv.investorId] || null;
    else if (inv.investorType === "Person") investorSummary = personMap[inv.investorId] || null;

    const { investorType, fundedType, ...rest } = inv.toJSON();
    result.push({ ...rest, investor: investorSummary });
  }
  return result;
}

async function attachFundedEntities(investments) {
  // 1. 收集 id
  const idsByType = collectIdsByType(investments, "fundedType", "fundedId");

  // 2. 批量查询（funded 目前只有 Project 和 Organization）
  const [projectMap, orgMap] = await Promise.all([
    batchFetchEntities("Project", idsByType.Project),
    batchFetchEntities("Organization", idsByType.Organization),
  ]);

  const result = [];
  for (const inv of investments) {
    let fundedSummary = null;
    if (inv.fundedType === "Project") fundedSummary = projectMap[inv.fundedId] || null;
    else if (inv.fundedType === "Organization") fundedSummary = orgMap[inv.fundedId] || null;

    const { investorType, fundedType, ...rest } = inv.toJSON();
    result.push({ ...rest, funded: fundedSummary });
  }
  return result;
}

/**
 * 按日期分组投资记录（与 xhunt 接口保持结构兼容）
 * 使用天数作为分组 key，避免时区差异导致同一天的融资被分到不同组
 */
function groupInvestmentsByDateForOpen(investments) {
  if (!Array.isArray(investments) || investments.length === 0) return {};

  // 先按时间戳排序
  const sorted = [...investments].sort(
    (a, b) => (a.date || 0) - (b.date || 0)
  );

  const groups = [];
  let currentGroup = null;

  sorted.forEach((inv) => {
    const timestamp = inv.date;
    if (!timestamp) return;

    // 如果是第一条记录，或者与当前组的时间差超过 24 小时，创建新组
    if (
      !currentGroup ||
      timestamp - currentGroup.minTimestamp > 24 * 60 * 60 * 1000
    ) {
      currentGroup = {
        round: inv.round || null,
        amount: inv.amount ?? null,
        valuation: null,
        formattedAmount: inv.formattedAmount ?? inv.amount ?? null,
        formattedValuation: null,
        investors: [],
        minTimestamp: timestamp,
        maxTimestamp: timestamp,
      };
      groups.push(currentGroup);
    } else {
      currentGroup.maxTimestamp = Math.max(
        currentGroup.maxTimestamp,
        timestamp
      );
    }

    if (inv.investorSummary) {
      currentGroup.investors.push({
        lead: !!inv.lead,
        projectName: inv.investorSummary.name || null,
        projectLink: inv.investorSummary.link || null,
        socialLinks: inv.investorSummary.socialLinks || null,
        logo: inv.investorSummary.avatar || null,
      });
    }
  });

  // 转换为以时间戳为 key 的对象格式
  return groups.reduce((acc, group) => {
    acc[group.minTimestamp] = group;
    return acc;
  }, {});
}

router.get("/ecosystem_map", proApiKeyAuth(50), async (req, res) => {
  console.log("[rootdatapro] /open/ecosystem_map");

  try {
    const rows = await db.Ecosystem.findAll({
      attributes: ["ecosystem_id", "ecosystem_name"],
      order: [["ecosystem_id", "ASC"]],
    });

    return res.json({
      success: true,
      ecosystems: rows.map((r) => r.toJSON()),
    });
  } catch (err) {
    console.error("[rootdatapro] /open/ecosystem_map error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/tag_map", proApiKeyAuth(50), async (req, res) => {
  console.log("[rootdatapro] /open/tag_map");

  try {
    const rows = await db.Tag.findAll({
      attributes: ["tag_id", "tag_name"],
      order: [["tag_id", "ASC"]],
    });

    return res.json({
      success: true,
      tags: rows.map((r) => r.toJSON()),
    });
  } catch (err) {
    console.error("[rootdatapro] /open/tag_map error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.post("/projects_by_ecosystems", proApiKeyAuth(20), async (req, res) => {
  console.log("[rootdatapro] /open/projects_by_ecosystems");

  const ids = Array.isArray(req.body?.ecosystem_ids) ? req.body.ecosystem_ids : null;
  if (!ids || ids.length === 0) {
    return res.status(400).json({ success: false, error: "INVALID_ECOSYSTEM_IDS" });
  }

  const page = Number.isFinite(Number(req.body?.page)) ? Math.max(parseInt(req.body.page, 10), 1) : 1;
  const pageSizeRaw = Number.isFinite(Number(req.body?.page_size)) ? parseInt(req.body.page_size, 10) : 50;
  const page_size = Math.min(Math.max(pageSizeRaw, 1), 200);
  const offset = (page - 1) * page_size;

  try {
    const { count, rows } = await db.Project.findAndCountAll({
      distinct: true,
      attributes: ["project_id", "project_name", "logo", "X"],
      include: [
        {
          model: db.Ecosystem,
          as: "Ecosystems",
          through: { attributes: [] },
          where: { ecosystem_id: ids },
          attributes: [],
          required: true,
        },
      ],
      limit: page_size,
      offset,
      order: [["project_id", "ASC"]],
    });

    return res.json({
      success: true,
      page,
      page_size,
      total: count,
      projects: rows.map((p) => p.toJSON()),
    });
  } catch (err) {
    console.error("[rootdatapro] /open/projects_by_ecosystems error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.post("/projects_by_tags", proApiKeyAuth(20), async (req, res) => {
  console.log("[rootdatapro] /open/projects_by_tags");

  const ids = Array.isArray(req.body?.tag_ids) ? req.body.tag_ids : null;
  if (!ids || ids.length === 0) {
    return res.status(400).json({ success: false, error: "INVALID_TAG_IDS" });
  }

  const page = Number.isFinite(Number(req.body?.page)) ? Math.max(parseInt(req.body.page, 10), 1) : 1;
  const pageSizeRaw = Number.isFinite(Number(req.body?.page_size)) ? parseInt(req.body.page_size, 10) : 50;
  const page_size = Math.min(Math.max(pageSizeRaw, 1), 200);
  const offset = (page - 1) * page_size;

  try {
    const { count, rows } = await db.Project.findAndCountAll({
      distinct: true,
      attributes: ["project_id", "project_name", "logo", "X"],
      include: [
        {
          model: db.Tag,
          as: "Tags",
          through: { attributes: [] },
          where: { tag_id: ids },
          attributes: [],
          required: true,
        },
      ],
      limit: page_size,
      offset,
      order: [["project_id", "ASC"]],
    });

    return res.json({
      success: true,
      page,
      page_size,
      total: count,
      projects: rows.map((p) => p.toJSON()),
    });
  } catch (err) {
    console.error("[rootdatapro] /open/projects_by_tags error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.post("/query_investments", proApiKeyAuth(30), async (req, res) => {
  console.log("[rootdatapro] /open/query_investments", req.body);

  const page = Number.isFinite(Number(req.body?.page)) ? Math.max(parseInt(req.body.page, 10), 1) : 1;
  const pageSizeRaw = Number.isFinite(Number(req.body?.page_size)) ? parseInt(req.body.page_size, 10) : 50;
  const page_size = Math.min(Math.max(pageSizeRaw, 1), 200);
  const offset = (page - 1) * page_size;

  const where = {};
  const ands = [];

  const investorFilters = Array.isArray(req.body?.investor_filters) ? req.body.investor_filters : [];
  if (investorFilters.length > 0) {
    const ors = [];
    for (const f of investorFilters) {
      const type = f?.type;
      const ids = Array.isArray(f?.ids) ? f.ids : null;
      if (!type || !ids || ids.length === 0) continue;
      ors.push({ investorType: type, investorId: { [db.Sequelize.Op.in]: ids } });
    }
    if (ors.length > 0) ands.push({ [db.Sequelize.Op.or]: ors });
  }

  const fundedFilters = Array.isArray(req.body?.funded_filters) ? req.body.funded_filters : [];
  if (fundedFilters.length > 0) {
    const ors = [];
    for (const f of fundedFilters) {
      const type = f?.type;
      const ids = Array.isArray(f?.ids) ? f.ids : null;
      if (!type || !ids || ids.length === 0) continue;
      ors.push({ fundedType: type, fundedId: { [db.Sequelize.Op.in]: ids } });
    }
    if (ors.length > 0) ands.push({ [db.Sequelize.Op.or]: ors });
  }

  const roundNames = Array.isArray(req.body?.round_names) ? req.body.round_names : null;
  if (roundNames && roundNames.length > 0) {
    where.round = { [db.Sequelize.Op.in]: roundNames };
  }

  if (req.body?.date_from || req.body?.date_to) {
    const range = {};
    if (req.body.date_from) range[db.Sequelize.Op.gte] = new Date(req.body.date_from);
    if (req.body.date_to) range[db.Sequelize.Op.lte] = new Date(req.body.date_to);
    where.date = range;
  }

  if (req.body?.min_amount !== undefined || req.body?.max_amount !== undefined) {
    const range = {};
    if (req.body.min_amount !== undefined) range[db.Sequelize.Op.gte] = Number(req.body.min_amount);
    if (req.body.max_amount !== undefined) range[db.Sequelize.Op.lte] = Number(req.body.max_amount);
    where.amount = range;
  }

  if (ands.length > 0) where[db.Sequelize.Op.and] = ands;

  try {
    const { count, rows } = await db.Investment.findAndCountAll({
      where,
      limit: page_size,
      offset,
      order: [["date", "DESC"]],
    });

    const withInvestor = await attachInvestorEntities(rows);
    const withFunded = await attachFundedEntities(rows);

    const investments = withInvestor.map((inv, idx) => ({
      ...inv,
      funded: withFunded[idx]?.funded ?? null,
    }));

    return res.json({
      success: true,
      page,
      page_size,
      total: count,
      investments,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/query_investments error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.post(
  "/batch_get_details",
  express.json(),
  (req, res, next) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    req.dynamicCost = items.length * 2;
    return next();
  },
  proApiKeyAuth((req) => req.dynamicCost),
  async (req, res) => {
    console.log("[rootdatapro] /open/batch_get_details", req.body);

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: "INVALID_ITEMS" });
    }
    if (items.length > 200) {
      return res.status(400).json({ success: false, error: "TOO_MANY_ITEMS" });
    }

    const idsByType = { Project: new Set(), Organization: new Set(), Person: new Set() };
    for (const it of items) {
      const type = it?.type;
      const id = it?.id;
      if (!idsByType[type]) {
        return res.status(400).json({ success: false, error: "INVALID_TYPE" });
      }
      if (!Number.isFinite(Number(id))) {
        return res.status(400).json({ success: false, error: "INVALID_ID" });
      }
      idsByType[type].add(Number(id));
    }

    try {
      const [projectMap, orgMap, personMap] = await Promise.all([
        batchFetchEntities("Project", idsByType.Project),
        batchFetchEntities("Organization", idsByType.Organization),
        batchFetchEntities("Person", idsByType.Person),
      ]);

      return res.json({
        success: true,
        cost: req.proApiKey?.creditsCost,
        results: {
          Project: projectMap,
          Organization: orgMap,
          Person: personMap,
        },
      });
    } catch (err) {
      console.error("[rootdatapro] /open/batch_get_details error", err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }
);


router.get("/search", proApiKeyAuth(5), async (req, res) => {
  console.log("[rootdatapro] /open/search", req.query);

  const q = String(req.query?.q || "").trim();
  if (!q) {
    return res.status(400).json({ success: false, error: "MISSING_Q" });
  }

  const page = Number.isFinite(Number(req.query?.page)) ? Math.max(parseInt(req.query.page, 10), 1) : 1;
  const pageSizeRaw = Number.isFinite(Number(req.query?.page_size)) ? parseInt(req.query.page_size, 10) : 20;
  const page_size = Math.min(Math.max(pageSizeRaw, 1), 200);
  const offset = (page - 1) * page_size;

  const typesParam = String(req.query?.entity_types || "").trim();
  const allowed = new Set(["Project", "Organization", "Person"]);
  const types = typesParam
    ? typesParam.split(",").map((s) => s.trim()).filter((s) => allowed.has(s))
    : ["Project", "Organization", "Person"];

  const like = `%${q}%`;

  try {
    const results = [];

    const queries = [];
    if (types.includes("Project")) {
      queries.push(
        db.Project.findAll({
          where: {
            [db.Sequelize.Op.or]: [
              { project_name: { [db.Sequelize.Op.iLike]: like } },
              { one_liner: { [db.Sequelize.Op.iLike]: like } },
            ],
          },
          attributes: ["project_id", "project_name", "logo", "X"],
          limit: 200,
        }).then((rows) => rows.map((r) => ({ type: "Project", entity: r.toJSON() })))
      );
    }

    if (types.includes("Organization")) {
      queries.push(
        db.Organization.findAll({
          where: {
            [db.Sequelize.Op.or]: [
              { org_name: { [db.Sequelize.Op.iLike]: like } },
              { description: { [db.Sequelize.Op.iLike]: like } },
            ],
          },
          attributes: ["org_id", "org_name", "logo", "X"],
          limit: 200,
        }).then((rows) => rows.map((r) => ({ type: "Organization", entity: r.toJSON() })))
      );
    }

    if (types.includes("Person")) {
      queries.push(
        db.Person.findAll({
          where: {
            [db.Sequelize.Op.or]: [
              { people_name: { [db.Sequelize.Op.iLike]: like } },
              { one_liner: { [db.Sequelize.Op.iLike]: like } },
            ],
          },
          attributes: ["people_id", "people_name", "head_img", "X"],
          limit: 200,
        }).then((rows) => rows.map((r) => ({ type: "Person", entity: r.toJSON() })))
      );
    }

    const parts = await Promise.all(queries);
    parts.forEach((arr) => results.push(...arr));

    const total = results.length;
    const paged = results.slice(offset, offset + page_size);

    return res.json({
      success: true,
      q,
      entity_types: types,
      page,
      page_size,
      total,
      results: paged,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/search error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

function normalizeXHandle(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;

  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/\s+/g, "");
  s = s.replace(/[^a-zA-Z0-9_]/g, "");
  if (!s) return null;
  return s;
}

router.get("/find_by_x", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/find_by_x", req.query);

  const raw = req.query?.handle || req.query?.x;
  const handle = normalizeXHandle(raw);
  if (!handle) {
    return res.status(400).json({ success: false, error: "INVALID_HANDLE" });
  }

  try {
    const handleLower = handle.toLowerCase();
    const like1 = `https://x.com/${handleLower}`;

    const [people, projects, organizations] = await Promise.all([
      db.Person.findAll({
        where: {
          X: {
            [db.Sequelize.Op.or]: [
              { [db.Sequelize.Op.iLike]: like1 },
              { [db.Sequelize.Op.iLike]: `${like1}/` }
            ],
          },
        },
        attributes: ["people_id", "people_name", "head_img", "X"],
        limit: 10,
      }),
      db.Project.findAll({
        where: {
          X: {
            [db.Sequelize.Op.or]: [
              { [db.Sequelize.Op.iLike]: like1 },
              { [db.Sequelize.Op.iLike]: `${like1}/` },
            ],
          },
        },
        attributes: ["project_id", "project_name", "logo", "X"],
        limit: 10,
      }),
      db.Organization.findAll({
        where: {
          X: {
            [db.Sequelize.Op.or]: [
              { [db.Sequelize.Op.iLike]: like1 },
              { [db.Sequelize.Op.iLike]: `${like1}/` },
            ],
          },
        },
        attributes: ["org_id", "org_name", "logo", "X"],
        limit: 10,
      }),
    ]);

    return res.json({
      success: true,
      query: { handle, raw: raw || null },
      people: people.map((r) => r.toJSON()),
      projects: projects.map((r) => r.toJSON()),
      organizations: organizations.map((r) => r.toJSON()),
    });
  } catch (err) {
    console.error("[rootdatapro] /open/find_by_x error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * GET /open/search_investment_by_x
 * 根据 X / Twitter 用户名搜索实体（项目 / 机构 / 人物），返回与 xhunt /api/rootdata/search 兼容的数据结构：
 * {
 *   invested: { investors, total_funding, grouped_investments },
 *   investor: { investors, total_funding },
 *   projectLink,
 *   members
 * }
 */
router.get("/search_investment_by_x", proApiKeyAuth(10), async (req, res) => {
  console.log("[rootdatapro] /open/search_investment_by_x", req.query);

  const raw = req.query?.handle || req.query?.x || req.query?.keyword;
  const handle = normalizeXHandle(raw);

  if (!handle || handle.length < 2) {
    return res.json({
      invested: null,
      investor: null,
      message: "No keyword provided or keyword too short",
    });
  }

  const handleLower = handle.toLowerCase();
  const like1 = `https://x.com/${handleLower}`;

  try {
    // 1. 先确定这个 handle 对应的是 Project / Organization / Person 中的哪一种
    const Op = db.Sequelize.Op;

    const [projectMatch, orgMatch, personMatch] = await Promise.all([
      db.Project.findOne({
        where: {
          X: {
            [Op.or]: [
              { [Op.iLike]: like1 },
              { [Op.iLike]: `${like1}/` },
            ],
          },
        },
        attributes: [
          "project_id",
          "project_name",
          "logo",
          "X",
          "rootdataurl",
        ],
      }),
      db.Organization.findOne({
        where: {
          X: {
            [Op.or]: [
              { [Op.iLike]: like1 },
              { [Op.iLike]: `${like1}/` },
            ],
          },
        },
        attributes: [
          "org_id",
          "org_name",
          "logo",
          "X",
          "rootdataurl",
        ],
      }),
      db.Person.findOne({
        where: {
          X: {
            [Op.or]: [
              { [Op.iLike]: like1 },
              { [Op.iLike]: `${like1}/` },
            ],
          },
        },
        attributes: [
          "people_id",
          "people_name",  
          "head_img",
          "X",
        ],
      }),
    ]);

    let entityType = null;
    let entity = null;

    // 优先级：Project > Organization > Person
    if (projectMatch) {
      entityType = "Project";
      entity = projectMatch;
    } else if (orgMatch) {
      entityType = "Organization";
      entity = orgMatch;
    } else if (personMatch) {
      entityType = "Person";
      entity = personMatch;
    }

    if (!entity || !entityType) {
      return res.json({
        invested: null,
        investor: null,
        message: "No matching entity found",
      });
    }

    // 2. 解析基础信息
    let entityId;
    let entityX = null;
    let projectLink = null;

    if (entityType === "Project") {
      entityId = entity.project_id;
      entityX = entity.X || null;
      projectLink = entity.rootdataurl || null;
    } else if (entityType === "Organization") {
      entityId = entity.org_id;
      entityX = entity.X || null;
      projectLink = entity.rootdataurl || null;
    } else {
      // Person
      entityId = entity.people_id;
      entityX = entity.X || null;
      projectLink = null;
    }

    // 3. 加载投融资信息
    const [fundingRoundsRaw, investmentsMadeRaw] = await Promise.all([
      db.Investment.findAll({
        where: { fundedType: entityType, fundedId: entityId },
        order: [["date", "ASC"]],
      }),
      db.Investment.findAll({
        where: { investorType: entityType, investorId: entityId },
        order: [["date", "ASC"]],
      }),
    ]);

    // 3.1 收到的投资：附加投资方实体信息
    const withInvestor = await attachInvestorEntities(fundingRoundsRaw);
    const investmentsForGrouping = withInvestor.map((inv) => {
      const src = inv.investor || {};
      let name = "";
      let avatar = "";
      let xUrl = "";

      if (src.project_id) {
        name = src.project_name || "";
        avatar = src.logo || "";
        xUrl = src.X || "";
      } else if (src.org_id) {
        name = src.org_name || "";
        avatar = src.logo || "";
        xUrl = src.X || "";
      } else if (src.people_id) {
        name = src.people_name || "";
        avatar = src.head_img || "";
        xUrl = src.X || "";
      }

      return {
        date: inv.date ? new Date(inv.date).getTime() : null,
        round: inv.round || null,
        amount: inv.amount ?? null,
        formattedAmount: inv.amount ?? null,
        lead: !!inv.lead,
        investorSummary: {
          name,
          avatar,
          socialLinks: xUrl ? { x: xUrl } : {},
          link: null,
        },
      };
    });

    const groupedInvestments = groupInvestmentsByDateForOpen(
      investmentsForGrouping
    );

    const totalFunding = Object.values(groupedInvestments).reduce(
      (sum, group) => sum + (Number(group.formattedAmount) || 0),
      0
    );

    // 构造 investors（收到的投资方列表）并去重
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

    // 移除 grouped_investments 中的 investors 字段，保持与 xhunt 接口一致
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

    // 3.2 投出的投资：附加被投项目/机构信息
    const withFunded = await attachFundedEntities(investmentsMadeRaw);
    const rawFundedProjects = (withFunded || []).map((inv) => {
      const target = inv.funded || {};
      let name = "";
      let avatar = "";
      let xUrl = "";

      if (target.project_id) {
        name = target.project_name || "";
        avatar = target.logo || "";
        xUrl = target.X || "";
      } else if (target.org_id) {
        name = target.org_name || "";
        avatar = target.logo || "";
        xUrl = target.X || "";
      }

      return {
        avatar: avatar || "",
        name: name || "",
        twitter: xUrl || "",
        lead_investor: !!inv.lead,
        amount: inv.amount ?? 0,
      };
    });

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

    const totalInvestment = (withFunded || []).reduce(
      (sum, inv) => sum + (Number(inv.amount) || 0),
      0
    );

    const investorData = {
      investors: fundedProjects,
      total_funding: totalInvestment,
    };

    // 4. 加载成员信息
    let members = [];
    if (entityType === "Project") {
      const project = await db.Project.findByPk(entityId, {
        attributes: ["project_id"],
        include: [
          {
            model: db.Person,
            as: "TeamMembers",
            through: { attributes: ["position"] },
            attributes: ["people_id", "people_name", "head_img", "X"],
          },
        ],
      });
      if (project && Array.isArray(project.TeamMembers)) {
        members = project.TeamMembers.map((p) => ({
          name: p.people_name || "",
          position: p.ProjectTeamMember?.position || "",
          twitter: p.X || "",
          avatar: p.head_img || "",
        }));
      }
    } else if (entityType === "Organization") {
      const org = await db.Organization.findByPk(entityId, {
        attributes: ["org_id"],
        include: [
          {
            model: db.Person,
            as: "TeamMembers",
            through: { attributes: ["position"] },
            attributes: ["people_id", "people_name", "head_img", "X"],
          },
        ],
      });
      if (org && Array.isArray(org.TeamMembers)) {
        members = org.TeamMembers.map((p) => ({
          name: p.people_name || "",
          position: p.OrganizationTeamMember?.position || "",
          twitter: p.X || "",
          avatar: p.head_img || "",
        }));
      }
    } else if (entityType === "Person") {
      const person = await db.Person.findByPk(entityId, {
        attributes: ["people_id", "people_name", "head_img", "X"],
        include: [
          {
            model: db.Project,
            as: "MemberOfProjects",
            through: { attributes: ["position"] },
            attributes: ["project_id", "project_name", "logo", "X"],
          },
          {
            model: db.Organization,
            as: "MemberOfOrganizations",
            through: { attributes: ["position"] },
            attributes: ["org_id", "org_name", "logo", "X"],
          },
        ],
      });

      if (person) {
        const projectMembers =
          person.MemberOfProjects?.map((proj) => ({
            name: proj.project_name || "",
            position: proj.ProjectTeamMember?.position || "",
            twitter: proj.X || "",
            avatar: proj.logo || "",
          })) || [];

        const orgMembers =
          person.MemberOfOrganizations?.map((org) => ({
            name: org.org_name || "",
            position: org.OrganizationTeamMember?.position || "",
            twitter: org.X || "",
            avatar: org.logo || "",
          })) || [];

        members = [...projectMembers, ...orgMembers];
      }
    }

    return res.json({
      invested: investedData,
      investor: investorData,
      projectLink,
      members,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/search_investment_by_x error", err);
    return res.status(500).json({
      error: "Failed to search project",
      message: err.message || "Unknown error",
    });
  }
});

router.get("/quota", proApiKeyAuth(0), async (req, res) => {
  console.log("[rootdatapro] /open/quota");

  try {
    const apiKey = req.get("pro-api-key") || req.headers?.["pro-api-key"] || req.headers?.["pro-api-key".toLowerCase()] || null;
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "MISSING_API_KEY",
        message: "Missing required header: pro-api-key",
      });
    }

    const row = await db.ApiKey.findOne({ where: { key: apiKey } });
    if (!row) {
      return res.status(403).json({
        success: false,
        error: "INVALID_API_KEY",
        message: "Invalid pro-api-key",
      });
    }

    return res.json({
      success: true,
      status: row.status,
      credits_total: Number(row.credits_total ?? 0),
      credits_remaining: Number(row.credits_remaining ?? 0),
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,

    });
  } catch (err) {
    console.error("[rootdatapro] /open/quota error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/get_item", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_item", req.query);
  const project_id = parseIntParam(req.query.project_id);
  if (!project_id) {
    return res.status(400).json({ success: false, error: "INVALID_PROJECT_ID" });
  }

  try {
    // 1. 并行执行所有数据库查询
    const [project, fundingRoundsRaw, investmentsMadeRaw] = await Promise.all([
      // 1.1 获取项目主体信息（不含 include，速度最快）
      db.Project.findByPk(project_id, {
        attributes: { exclude: ["createdAt", "updatedAt"] },
        include: [
          { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
          { model: db.Ecosystem, as: "Ecosystems", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
          { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        ]
      }),
      // 1.2 获取项目的融资轮次
      db.Investment.findAll({
        where: { fundedType: "Project", fundedId: project_id },
        attributes: { exclude: ["id", "createdAt", "updatedAt"] },
        order: [["date", "DESC"]],
      }),
      // 1.3 获取项目作为投资方进行的投资
      db.Investment.findAll({
        where: { investorType: "Project", investorId: project_id },
        attributes: { exclude: ["id", "createdAt", "updatedAt"] },
        order: [["date", "DESC"]],
      }),
    ]);

    // 2. 如果项目不存在，提前返回
    if (!project) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    // 3. 并行处理获取到的原始数据，附加关联实体信息
    const [fundingRounds, investmentsMade] = await Promise.all([
      attachInvestorEntities(fundingRoundsRaw),
      attachFundedEntities(investmentsMadeRaw),
    ]);

    // 4. 组装最终结果
    const projectJson = project.toJSON();
    projectJson.InvestmentsMade = investmentsMade; // 将处理后的对外投资数据挂载到项目上

    return res.json({
      success: true,
      project: projectJson,
      fundingRounds: fundingRounds,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/get_item error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/get_org", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_org", req.query);
  const org_id = parseIntParam(req.query.org_id);
  if (!org_id) {
    return res.status(400).json({ success: false, error: "INVALID_ORG_ID" });
  }

  try {
    // 1. 并行执行所有数据库查询
    const [org, fundingRoundsRaw, investmentsMadeRaw] = await Promise.all([
      // 1.1 获取机构主体信息（移除 InvestmentsMade include）
      db.Organization.findByPk(org_id, {
        attributes: { exclude: ["createdAt", "updatedAt"] },
        include: [
          { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
          { model: db.InvestorCategory, as: "Categories", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
          { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        ],
      }),
      // 1.2 获取机构的融资轮次
      db.Investment.findAll({
        where: { fundedType: "Organization", fundedId: org_id },
        attributes: { exclude: ["id", "createdAt", "updatedAt"] },
        order: [["date", "DESC"]],
      }),
      // 1.3 获取机构作为投资方进行的投资
      db.Investment.findAll({
        where: { investorType: "Organization", investorId: org_id },
        attributes: { exclude: ["id", "createdAt", "updatedAt"] },
        order: [["date", "DESC"]],
      }),
    ]);

    // 2. 如果机构不存在，提前返回
    if (!org) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    // 3. 并行处理获取到的原始数据，附加关联实体信息
    const [fundingRounds, investmentsMade] = await Promise.all([
      attachInvestorEntities(fundingRoundsRaw),
      attachFundedEntities(investmentsMadeRaw),
    ]);

    // 4. 组装最终结果
    const orgJson = org.toJSON();
    orgJson.InvestmentsMade = investmentsMade;

    return res.json({
      success: true,
      organization: orgJson,
      fundingRounds: fundingRounds,
    });
  } catch (err) {
    console.error("[rootdatapro] /open/get_org error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get("/get_people", proApiKeyAuth(2), async (req, res) => {
  console.log("[rootdatapro] /open/get_people", req.query);
  const people_id = parseIntParam(req.query.people_id);
  if (!people_id) {
    return res.status(400).json({ success: false, error: "INVALID_PEOPLE_ID" });
  }

  try {
    // 1. 并行执行所有数据库查询
    const [person, investmentsMadeRaw] = await Promise.all([
      // 1.1 获取人物主体信息（移除 InvestmentsMade include）
      db.Person.findByPk(people_id, {
        attributes: { exclude: ["createdAt", "updatedAt"] },
        include: [
          { model: db.Project, as: "MemberOfProjects", through: { attributes: ["position"] }, attributes: ["project_id", "project_name", "X"] },
          { model: db.Organization, as: "MemberOfOrganizations", through: { attributes: ["position"] }, attributes: ["org_id", "org_name", "X"] },
        ],
      }),
      // 1.2 获取人物作为投资方进行的投资
      db.Investment.findAll({
        where: { investorType: "Person", investorId: people_id },
        attributes: { exclude: ["id", "createdAt", "updatedAt"] },
        order: [["date", "DESC"]],
      }),
    ]);

    // 2. 如果人物不存在，提前返回
    if (!person) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    // 3. 处理对外投资数据
    const investmentsMade = await attachFundedEntities(investmentsMadeRaw);

    // 4. 组装最终结果
    const personJson = person.toJSON();
    personJson.InvestmentsMade = investmentsMade;

    return res.json({ success: true, people: personJson });
  } catch (err) {
    console.error("[rootdatapro] /open/get_people error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "NOT FOUND API",
    message: "Not Found api route",
  });
});

module.exports = router;
