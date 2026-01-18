const express = require("express");
const db = require("../models");

const router = express.Router();

function parseIntParam(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

async function attachInvestorEntities(investments) {
  const result = [];
  for (const inv of investments) {
    try {
      let investor = null;
      if (inv.investorType === "Project") investor = await db.Project.findByPk(inv.investorId);
      else if (inv.investorType === "Organization") investor = await db.Organization.findByPk(inv.investorId);
      else if (inv.investorType === "Person") investor = await db.Person.findByPk(inv.investorId);

      result.push({
        ...inv.toJSON(),
        investor: investor ? investor.toJSON() : null,
      });
    } catch (e) {
      result.push({
        ...inv.toJSON(),
        investor: null,
      });
    }
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
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] } },
        { model: db.Ecosystem, as: "Ecosystems", through: { attributes: [] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] } },
        { model: db.Investment, as: "InvestmentsMade" },
      ],
    });

    if (!project) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Project", fundedId: project_id },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    return res.json({
      success: true,
      project: project.toJSON(),
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
      include: [
        { model: db.Tag, as: "Tags", through: { attributes: [] } },
        { model: db.InvestorCategory, as: "Categories", through: { attributes: [] } },
        { model: db.Person, as: "TeamMembers", through: { attributes: ["position"] } },
        { model: db.Investment, as: "InvestmentsMade" },
      ],
    });

    if (!org) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const fundingRounds = await db.Investment.findAll({
      where: { fundedType: "Organization", fundedId: org_id },
      order: [["date", "DESC"]],
    });

    const fundingRoundsWithInvestors = await attachInvestorEntities(fundingRounds);

    return res.json({
      success: true,
      organization: org.toJSON(),
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
      include: [
        { model: db.Project, as: "MemberOfProjects", through: { attributes: ["position"] } },
        { model: db.Organization, as: "MemberOfOrganizations", through: { attributes: ["position"] } },
        { model: db.Investment, as: "InvestmentsMade" },
      ],
    });

    if (!person) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    return res.json({ success: true, people: person.toJSON() });
  } catch (err) {
    console.error("[rootdatapro] /open/get_people error", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

module.exports = router;

