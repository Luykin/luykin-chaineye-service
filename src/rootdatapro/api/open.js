const express = require("express");
const db = require("../models");
const { proApiKeyAuth } = require("../middleware/proApiKey");

const router = express.Router();

const path = require("path");

router.get("/", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const app = req.app;
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));

  return app.render(
    "open-docs",
    {
      baseUrl,
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
          attributes: ["ecosystem_id", "ecosystem_name"],
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
          attributes: ["tag_id", "tag_name"],
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
    const like2 = `https://twitter.com/${handleLower}`;

    const [people, projects, organizations] = await Promise.all([
      db.Person.findAll({
        where: {
          X: {
            [db.Sequelize.Op.or]: [
              { [db.Sequelize.Op.iLike]: like1 },
              { [db.Sequelize.Op.iLike]: `${like1}/` },
              { [db.Sequelize.Op.iLike]: like2 },
              { [db.Sequelize.Op.iLike]: `${like2}/` },
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
              { [db.Sequelize.Op.iLike]: like2 },
              { [db.Sequelize.Op.iLike]: `${like2}/` },
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
              { [db.Sequelize.Op.iLike]: like2 },
              { [db.Sequelize.Op.iLike]: `${like2}/` },
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
    const project = await db.Project.findByPk(project_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Ecosystem, as: "Ecosystems", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!project) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Project", fundedId: project_id },
      attributes: { exclude: ["id", "createdAt", "updatedAt"] },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    const projectJson = project.toJSON();
    if (projectJson.InvestmentsMade) {
      projectJson.InvestmentsMade = await attachFundedEntities(project.InvestmentsMade);
    }

    return res.json({
      success: true,
      project: projectJson,
      fundingRounds: fundingRoundsWithInvestors,
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
    const org = await db.Organization.findByPk(org_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.InvestorCategory, as: "Categories", through: { attributes: [] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] }, attributes: ["people_id", "people_name", "head_img", "X"] },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!org) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Organization", fundedId: org_id },
      attributes: { exclude: ["id", "createdAt", "updatedAt"] },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    const orgJson = org.toJSON();
    if (orgJson.InvestmentsMade) {
      orgJson.InvestmentsMade = await attachFundedEntities(org.InvestmentsMade);
    }

    return res.json({
      success: true,
      organization: orgJson,
      fundingRounds: fundingRoundsWithInvestors,
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
    const person = await db.Person.findByPk(people_id, {
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        { model: db.Project, as: "MemberOfProjects", through: { attributes: ["position"] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Organization, as: "MemberOfOrganizations", through: { attributes: ["position"] }, attributes: { exclude: ["createdAt", "updatedAt"] } },
        { model: db.Investment, as: "InvestmentsMade", attributes: { exclude: ["id", "createdAt", "updatedAt"] } },
      ],
    });

    if (!person) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const personJson = person.toJSON();
    if (personJson.InvestmentsMade) {
      personJson.InvestmentsMade = await attachFundedEntities(person.InvestmentsMade);
    }

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
