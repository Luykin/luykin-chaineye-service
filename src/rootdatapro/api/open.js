const express = require("express");
const db = require("../models");

const router = express.Router();

function parseIntParam(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

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

router.get("/get_item", async (req, res) => {
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

router.get("/get_org", async (req, res) => {
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

router.get("/get_people", async (req, res) => {
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

module.exports = router;
