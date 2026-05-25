/**
 * 合并 RootData Project 重复数据
 *
 * 背景：
 * - 老库里 RootData URL 通常是 /Projects/detail/...、/Investors/detail/...
 * - 新 Tampermonkey 页面可能抓到 /projects/detail/...、/investors/detail/...
 * - PostgreSQL 唯一索引按 projectLink 字符串精确匹配，大小写不同会插出重复 Project
 *
 * 默认 dry-run，只打印合并计划；加 --apply 才会写库。
 *
 * 用法：
 *   NODE_ENV=production node src/script/merge-rootdata-duplicate-projects.js
 *   NODE_ENV=production node src/script/merge-rootdata-duplicate-projects.js --apply
 *
 * 可选：
 *   --only=SignalPlus                  只处理项目名/链接包含指定关键词的组
 *   --keeper-id=2760 --loser-id=29211  只合并指定 loser 到 keeper
 */

const path = require("path");

function loadEnv() {
  const envFile =
    process.env.MERGE_ENV_FILE ||
    (process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro");
  try {
    require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });
    console.log(`[merge-rootdata] loaded env: ${envFile}`);
  } catch (error) {
    console.warn(`[merge-rootdata] dotenv load skipped: ${error.message}`);
  }
}

loadEnv();

const { Op } = require("sequelize");
const { Fundraising, pgInstance } = require("../models/postgres-fundraising");

function getArgValue(name) {
  const prefix = `${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeK(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(String(value)).replace(/=+$/, "");
  } catch (_) {
    return String(value).replace(/=+$/, "");
  }
}

function parseRootDataUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, "https://www.rootdata.com");
    const match = url.pathname.match(/^\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
    if (!match?.[1]) return null;

    const type = /\/(?:investors|Investors)\//.test(url.pathname)
      ? "Investors"
      : "Projects";
    const slug = decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
    const k = normalizeK(url.searchParams.get("k"));

    return {
      type,
      slug,
      k,
      key: `${type}:${k || slug.toLowerCase()}`,
    };
  } catch (_) {
    return null;
  }
}

function canonicalRootDataDetailUrl(rawUrl) {
  const parsed = parseRootDataUrl(rawUrl);
  if (!parsed) return rawUrl;

  try {
    const url = new URL(rawUrl, "https://www.rootdata.com");
    url.protocol = "https:";
    url.hostname = "www.rootdata.com";
    url.pathname = `/${parsed.type}/detail/${encodeURIComponent(parsed.slug).replace(/%20/g, "%20")}`;
    const k = url.searchParams.get("k");
    url.search = "";
    if (k) url.searchParams.set("k", k);
    url.hash = "";
    return url.toString();
  } catch (_) {
    return rawUrl;
  }
}

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

function asTime(value) {
  if (!value) return 0;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeObjects(left, right) {
  const result = {
    ...(left && typeof left === "object" && !Array.isArray(left) ? left : {}),
    ...(right && typeof right === "object" && !Array.isArray(right) ? right : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function chooseLongerArray(left, right) {
  const leftArray = Array.isArray(left) ? left : [];
  const rightArray = Array.isArray(right) ? right : [];
  return rightArray.length > leftArray.length ? rightArray : leftArray;
}

function chooseKeeper(projects) {
  return [...projects].sort((a, b) => {
    const aCanonical = a.projectLink === canonicalRootDataDetailUrl(a.projectLink) ? 0 : 1;
    const bCanonical = b.projectLink === canonicalRootDataDetailUrl(b.projectLink) ? 0 : 1;
    if (aCanonical !== bCanonical) return aCanonical - bCanonical;

    // 兼容历史库：同一 canonical 下优先保留更早的 ID。
    return Number(a.id) - Number(b.id);
  })[0];
}

function buildMergedProjectPatch(keeper, loser) {
  const patch = {};
  const loserIsNewer = asTime(loser.updatedAt) >= asTime(keeper.updatedAt);

  const preferNewerFields = [
    "description",
    "logo",
    "round",
    "amount",
    "formattedAmount",
    "valuation",
    "formattedValuation",
    "date",
    "fundedAt",
    "originalPageNumber",
  ];

  if (isBlank(keeper.projectName) && !isBlank(loser.projectName)) {
    patch.projectName = loser.projectName;
  }

  for (const field of preferNewerFields) {
    if (!isBlank(loser[field]) && (isBlank(keeper[field]) || loserIsNewer)) {
      patch[field] = loser[field];
    }
  }

  const socialLinks = mergeObjects(keeper.socialLinks, loser.socialLinks);
  if (socialLinks && JSON.stringify(socialLinks) !== JSON.stringify(keeper.socialLinks || null)) {
    patch.socialLinks = socialLinks;
  }

  const teamMembers = chooseLongerArray(keeper.teamMembers, loser.teamMembers);
  if (teamMembers.length > 0 && teamMembers.length !== (keeper.teamMembers || []).length) {
    patch.teamMembers = teamMembers;
  }

  if (Boolean(loser.isInitial) && !Boolean(keeper.isInitial)) {
    patch.isInitial = true;
  }

  const keeperFetchedAt = asTime(keeper.detailFetchedAt);
  const loserFetchedAt = asTime(loser.detailFetchedAt);
  if (loserFetchedAt > keeperFetchedAt) {
    patch.detailFetchedAt = loser.detailFetchedAt;
  }

  const keeperFailures = Number(keeper.detailFailuresNumber || 0);
  const loserFailures = Number(loser.detailFailuresNumber || 0);
  patch.detailFailuresNumber =
    loserFetchedAt || keeperFetchedAt
      ? Math.min(keeperFailures, loserFailures)
      : Math.max(keeperFailures, loserFailures);

  if (!isBlank(loser.updateProgram) && (isBlank(keeper.updateProgram) || loserIsNewer)) {
    patch.updateProgram = loser.updateProgram;
  }

  // 保留 keeper 的 canonical URL 形态，但如果 keeper 本身不是 canonical，顺便修正。
  const canonicalLink = canonicalRootDataDetailUrl(keeper.projectLink);
  if (canonicalLink && keeper.projectLink !== canonicalLink) {
    patch.projectLink = canonicalLink;
  }

  return patch;
}

function mergeRelationshipPatch(existing, incoming) {
  return {
    lead: Boolean(existing.lead) || Boolean(incoming.lead),
    amount: incoming.amount || existing.amount || null,
    formattedAmount: incoming.formattedAmount ?? existing.formattedAmount ?? null,
    valuation: incoming.valuation || existing.valuation || null,
    formattedValuation: incoming.formattedValuation ?? existing.formattedValuation ?? null,
    date: incoming.date || existing.date || null,
    updateProgram: incoming.updateProgram || existing.updateProgram || null,
  };
}

async function migrateInvestmentRelationships(loserId, keeperId, transaction) {
  const rows = await Fundraising.InvestmentRelationships.findAll({
    where: {
      [Op.or]: [{ investorProjectId: loserId }, { fundedProjectId: loserId }],
    },
    transaction,
  });

  const stats = { moved: 0, merged: 0, deletedSelf: 0 };

  for (const row of rows) {
    const nextInvestorId =
      Number(row.investorProjectId) === Number(loserId) ? keeperId : row.investorProjectId;
    const nextFundedId =
      Number(row.fundedProjectId) === Number(loserId) ? keeperId : row.fundedProjectId;

    if (Number(nextInvestorId) === Number(nextFundedId)) {
      await row.destroy({ transaction });
      stats.deletedSelf += 1;
      continue;
    }

    const round = row.round || "--";
    const existing = await Fundraising.InvestmentRelationships.findOne({
      where: {
        investorProjectId: nextInvestorId,
        fundedProjectId: nextFundedId,
        round,
        id: { [Op.ne]: row.id },
      },
      transaction,
    });

    if (existing) {
      await existing.update(mergeRelationshipPatch(existing, row), { transaction });
      await row.destroy({ transaction });
      stats.merged += 1;
    } else {
      await row.update(
        {
          investorProjectId: nextInvestorId,
          fundedProjectId: nextFundedId,
          round,
        },
        { transaction }
      );
      stats.moved += 1;
    }
  }

  return stats;
}

async function migratePositionRelationships(loserId, keeperId, transaction) {
  const rows = await Fundraising.PositionRelationships.findAll({
    where: {
      [Op.or]: [{ subjectProjectId: loserId }, { objectProjectId: loserId }],
    },
    transaction,
  });

  const stats = { moved: 0, merged: 0, deletedSelf: 0 };

  for (const row of rows) {
    const nextSubjectId =
      Number(row.subjectProjectId) === Number(loserId) ? keeperId : row.subjectProjectId;
    const nextObjectId =
      Number(row.objectProjectId) === Number(loserId) ? keeperId : row.objectProjectId;

    if (Number(nextSubjectId) === Number(nextObjectId)) {
      await row.destroy({ transaction });
      stats.deletedSelf += 1;
      continue;
    }

    const existing = await Fundraising.PositionRelationships.findOne({
      where: {
        subjectProjectId: nextSubjectId,
        objectProjectId: nextObjectId,
        position: row.position || null,
        id: { [Op.ne]: row.id },
      },
      transaction,
    });

    if (existing) {
      await existing.update(
        {
          source: existing.source || row.source || null,
          updateProgram: row.updateProgram || existing.updateProgram || null,
        },
        { transaction }
      );
      await row.destroy({ transaction });
      stats.merged += 1;
    } else {
      await row.update(
        {
          subjectProjectId: nextSubjectId,
          objectProjectId: nextObjectId,
        },
        { transaction }
      );
      stats.moved += 1;
    }
  }

  return stats;
}

async function findDuplicateGroups({ only } = {}) {
  const projects = await Fundraising.Project.findAll({
    where: {
      projectLink: {
        [Op.iLike]: "%rootdata.com/%/detail/%",
      },
    },
    order: [["id", "ASC"]],
  });

  const groups = new Map();
  for (const project of projects) {
    const parsed = parseRootDataUrl(project.projectLink);
    if (!parsed) continue;
    if (
      only &&
      !`${project.projectName || ""} ${project.projectLink || ""}`
        .toLowerCase()
        .includes(String(only).toLowerCase())
    ) {
      continue;
    }
    if (!groups.has(parsed.key)) groups.set(parsed.key, []);
    groups.get(parsed.key).push(project);
  }

  return Array.from(groups.entries()).filter(([, rows]) => rows.length > 1);
}

async function mergeSingleLoser({ keeperId, loserId, apply }) {
  const keeper = await Fundraising.Project.findByPk(keeperId);
  const loser = await Fundraising.Project.findByPk(loserId);

  if (!keeper) throw new Error(`keeper 不存在: ${keeperId}`);
  if (!loser) throw new Error(`loser 不存在: ${loserId}`);

  const parsedKeeper = parseRootDataUrl(keeper.projectLink);
  const parsedLoser = parseRootDataUrl(loser.projectLink);
  if (!parsedKeeper || !parsedLoser || parsedKeeper.key !== parsedLoser.key) {
    throw new Error(`keeper/loser 不是同一个 RootData canonical key: ${keeper.projectLink} / ${loser.projectLink}`);
  }

  console.log(`\n[merge] ${keeper.projectName} canonical=${parsedKeeper.key}`);
  console.log(`  keep  ID=${keeper.id} ${keeper.projectLink}`);
  console.log(`  merge ID=${loser.id} ${loser.projectLink}`);

  const investmentCounts = await Promise.all([
    Fundraising.InvestmentRelationships.count({ where: { investorProjectId: loser.id } }),
    Fundraising.InvestmentRelationships.count({ where: { fundedProjectId: loser.id } }),
    Fundraising.PositionRelationships.count({ where: { subjectProjectId: loser.id } }),
    Fundraising.PositionRelationships.count({ where: { objectProjectId: loser.id } }),
  ]);
  console.log(
    `  loser relations: investAsInvestor=${investmentCounts[0]}, investAsFunded=${investmentCounts[1]}, positionAsSubject=${investmentCounts[2]}, positionAsObject=${investmentCounts[3]}`
  );

  if (!apply) return { dryRun: true };

  return Fundraising.Project.sequelize.transaction(async (transaction) => {
    const freshKeeper = await Fundraising.Project.findByPk(keeperId, { transaction });
    const freshLoser = await Fundraising.Project.findByPk(loserId, { transaction });

    const patch = buildMergedProjectPatch(freshKeeper, freshLoser);
    await freshKeeper.update(patch, { transaction });

    const investmentStats = await migrateInvestmentRelationships(loserId, keeperId, transaction);
    const positionStats = await migratePositionRelationships(loserId, keeperId, transaction);

    await freshLoser.destroy({ transaction });

    console.log(
      `  ✅ merged loser=${loserId} -> keeper=${keeperId}, investment=${JSON.stringify(investmentStats)}, position=${JSON.stringify(positionStats)}`
    );

    return { patch, investmentStats, positionStats };
  });
}

async function mergeDuplicateGroups({ apply = false, only = null } = {}) {
  const keeperIdArg = getArgValue("--keeper-id");
  const loserIdArg = getArgValue("--loser-id");

  if (keeperIdArg || loserIdArg) {
    if (!keeperIdArg || !loserIdArg) {
      throw new Error("--keeper-id 和 --loser-id 必须同时提供");
    }
    await mergeSingleLoser({
      keeperId: Number(keeperIdArg),
      loserId: Number(loserIdArg),
      apply,
    });
    return;
  }

  const groups = await findDuplicateGroups({ only });
  console.log(`[merge-rootdata] duplicate groups=${groups.length}, apply=${apply}`);

  let loserCount = 0;
  for (const [key, rows] of groups) {
    const keeper = chooseKeeper(rows);
    const losers = rows.filter((row) => row.id !== keeper.id);
    loserCount += losers.length;

    console.log(`\n[group] ${key} count=${rows.length}`);
    for (const row of rows) {
      const marker = row.id === keeper.id ? "KEEP " : "LOSE ";
      console.log(
        `  ${marker} ID=${row.id} name=${cleanText(row.projectName)} detailFetchedAt=${row.detailFetchedAt || "-"} link=${row.projectLink}`
      );
    }

    for (const loser of losers) {
      await mergeSingleLoser({
        keeperId: keeper.id,
        loserId: loser.id,
        apply,
      });
    }
  }

  console.log(`\n[merge-rootdata] summary groups=${groups.length}, losers=${loserCount}, apply=${apply}`);
  if (!apply) {
    console.log("[merge-rootdata] DRY RUN only. Add --apply to merge/delete duplicates.");
  }
}

async function main() {
  const apply = hasFlag("--apply") || hasFlag("--execute");
  const only = getArgValue("--only");

  if (apply) {
    console.log("[merge-rootdata] ⚠️ APPLY mode: will update relationships and delete loser Projects.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } else {
    console.log("[merge-rootdata] DRY RUN mode: no DB writes.");
  }

  try {
    await mergeDuplicateGroups({ apply, only });
  } finally {
    await pgInstance.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[merge-rootdata] failed:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseRootDataUrl,
  canonicalRootDataDetailUrl,
  findDuplicateGroups,
  mergeDuplicateGroups,
  mergeSingleLoser,
};
