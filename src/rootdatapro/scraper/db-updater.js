const db = require("../models");

function normalizeEntityType({ type, item_type }) {
  if (type) return type;

  if (item_type === 1) return "Project";
  if (item_type === 2) return "Organization";
  if (item_type === 3) return "Person";

  return null;
}

async function ensureEntities(entities) {
  if (!entities || entities.length === 0) return;

  const entitiesByType = {
    Project: [],
    Organization: [],
    Person: [],
  };

  for (const { type, item_type, id, name, logo } of entities) {
    if (!id) continue;
    const resolvedType = normalizeEntityType({ type, item_type });
    if (!resolvedType) continue;

    if (resolvedType === "Organization") {
      entitiesByType.Organization.push({
        org_id: id,
        org_name: name,
        logo,
        description: "",
      });
    } else if (resolvedType === "Project") {
      entitiesByType.Project.push({
        project_id: id,
        project_name: name,
        logo,
        description: "",
      });
    } else if (resolvedType === "Person") {
      entitiesByType.Person.push({
        people_id: id,
        people_name: name,
        head_img: logo,
      });
    }
  }

  const promises = [];
  if (entitiesByType.Organization.length > 0) {
    promises.push(db.Organization.bulkCreate(entitiesByType.Organization, { ignoreDuplicates: true }));
  }
  if (entitiesByType.Project.length > 0) {
    promises.push(db.Project.bulkCreate(entitiesByType.Project, { ignoreDuplicates: true }));
  }
  if (entitiesByType.Person.length > 0) {
    promises.push(db.Person.bulkCreate(entitiesByType.Person, { ignoreDuplicates: true }));
  }

  await Promise.all(promises);
}

/**
 * 更新或创建组织信息到数据库。
 * @param {object} orgData 从解析器获取的组织数据。
 */
async function updateOrganization(orgData) {
  if (!orgData) return;

  try {
    await db.Organization.upsert({
      org_id: orgData.org_id,
      org_name: orgData.org_name,
      logo: orgData.logo,
      establishment_date: orgData.establishment_date,
      description: orgData.description,
      active: orgData.active,
      social_media: orgData.social_media,
      events: orgData.events,
      X: orgData.X,
      rootdataurl: orgData.rootdataurl,
      heat: orgData.heat,
      heat_rank: orgData.heat_rank,
      influence: orgData.influence,
      influence_rank: orgData.influence_rank,
      followers: orgData.followers,
      following: orgData.following,
    });

    // 机构团队成员
    if (orgData.teamMembers && orgData.teamMembers.length > 0) {
      const peopleToUpsert = orgData.teamMembers.map(m => ({
        people_id: m.personId,
        people_name: m.people_name,
        head_img: m.head_img,
        X: m.X,
        linkedin: m.linkedin,
      }));
      await db.Person.bulkCreate(peopleToUpsert, { updateOnDuplicate: ["people_name", "head_img", "X", "linkedin"] });

      const teamMembersToUpsert = orgData.teamMembers.map(m => ({
        organizationId: orgData.org_id,
        personId: m.personId,
        position: m.position,
      }));
      await db.OrganizationTeamMember.bulkCreate(teamMembersToUpsert, { updateOnDuplicate: ["position"] });
    }

    // 机构分类 (InvestorCategory)
    if (orgData.categories && orgData.categories.length > 0) {
      const categoriesToCreate = orgData.categories.filter(c => c?.category_id).map(c => ({
        category_id: c.category_id,
        category_name: c.category_name,
      }));
      await db.InvestorCategory.bulkCreate(categoriesToCreate, { ignoreDuplicates: true });

      const orgCategoriesToCreate = orgData.categories.filter(c => c?.category_id).map(c => ({
        organizationId: orgData.org_id,
        categoryId: c.category_id,
      }));
      await db.OrganizationInvestorCategory.bulkCreate(orgCategoriesToCreate, { ignoreDuplicates: true });
    }

    // 机构标签 (Tag)
    if (orgData.tags && orgData.tags.length > 0) {
      const tagsToCreate = orgData.tags.filter(t => t?.tag_id).map(t => ({ tag_id: t.tag_id, tag_name: t.tag_name }));
      await db.Tag.bulkCreate(tagsToCreate, { updateOnDuplicate: ["tag_name"] });

      const orgTagsToCreate = orgData.tags.filter(t => t?.tag_id).map(t => ({
        organizationId: orgData.org_id,
        tagId: t.tag_id,
      }));
      await db.OrganizationTag.bulkCreate(orgTagsToCreate, { ignoreDuplicates: true });
    }

    // 机构被投资关系 (Investor -> Organization)
    if (orgData.fundingRounds && orgData.fundingRounds.length > 0) {
      const investmentsToCreate = [];
      const entitiesToEnsure = [];
      for (const r of orgData.fundingRounds) {
        // const roundKey = `${r?.date || ""}|${r?.amount_text || ""}`;
        for (const inv of (r?.lps || [])) {
          const investorId = inv?.item_id ? Number(inv.item_id) : null;
          if (!investorId) continue;

          const investorType = normalizeEntityType({ item_type: inv.item_type });
          if (!investorType) continue;

          entitiesToEnsure.push({ item_type: inv.item_type, id: investorId, name: inv.item_name, logo: inv.logo });
          investmentsToCreate.push({
            investorId: investorId,
            investorType,
            fundedId: orgData.org_id,
            fundedType: "Organization",
            round: "_UNKNOWN_",
            amount: null,
            date: r?.date ? new Date(r.date) : null,
            lead: false,
          });
        }
      }
      await ensureEntities(entitiesToEnsure);
      await db.Investment.bulkCreate(investmentsToCreate, { ignoreDuplicates: true });
    }

    // 机构对外投资关系 -> Investment
    if (orgData.investments && orgData.investments.length > 0) {
      const investmentsToCreate = [];
      const entitiesToEnsure = [];
      for (const inv of orgData.investments) {
        if (!inv.item_id) continue;
        const fundedType = normalizeEntityType({ item_type: inv.item_type });
        if (!fundedType) continue;

        entitiesToEnsure.push({ item_type: inv.item_type, id: inv.item_id, name: inv.item_name, logo: inv.logo });
        investmentsToCreate.push({
          investorId: orgData.org_id,
          investorType: "Organization",
          fundedId: inv.item_id,
          fundedType,
          round: inv.round,
          amount: inv.amount,
          date: inv.date,
          lead: false,
        });
      }
      await ensureEntities(entitiesToEnsure);
      await db.Investment.bulkCreate(investmentsToCreate, { ignoreDuplicates: true });
    }

    console.log(`[DB] 更新组织成功: ${orgData.org_name}`);
  } catch (error) {
    console.error(`[DB] 更新组织 ${orgData.org_name} 时出错:`, error);
    throw error;
  }
}

/**
 * 更新或创建个人及其投资关系到数据库。
 * @param {object} personData 从解析器获取的个人数据。
 */
async function updatePersonAndInvestments(personData) {
  if (!personData) return;

  try {
    const [person, created] = await db.Person.upsert({
      people_id: personData.people_id,
      people_name: personData.people_name,
      head_img: personData.head_img,
      introduce: personData.introduce,
      one_liner: personData.one_liner,
      X: personData.X,
      linkedin: personData.linkedin,
      followers: personData.followers,
      following: personData.following,
    });

    console.log(
      created
        ? `[DB] 创建了新的个人: ${personData.people_name}`
        : `[DB] 更新了个人: ${personData.people_name}`
    );

    if (personData.investments && personData.investments.length > 0) {
      const investmentsToCreate = [];
      const entitiesToEnsure = [];
      for (const investment of personData.investments) {
        const fundedEntityType = normalizeEntityType({ item_type: investment.item_type });
        if (!fundedEntityType) {
          console.warn(`[DB] 未知的投资类型: ${investment.item_type}，将跳过。`);
          continue;
        }

        entitiesToEnsure.push({ type: fundedEntityType, id: investment.item_id, name: investment.item_name, logo: investment.logo });
        investmentsToCreate.push({
          fundedId: investment.item_id,
          fundedType: fundedEntityType,
          investorId: person.people_id,
          investorType: "Person",
          round: investment.round,
          amount: investment.amount,
          date: investment.date,
        });
      }
      await ensureEntities(entitiesToEnsure);
      await db.Investment.bulkCreate(investmentsToCreate, { ignoreDuplicates: true });
    }
  } catch (error) {
    console.error(`[DB] 更新个人 ${personData.people_name} 的数据时出错:`, error);
    throw error;
  }
}

async function updateProject(projectData) {
  if (!projectData) return;

  try {
    await db.Project.upsert({
      project_id: projectData.project_id,
      project_name: projectData.project_name,
      logo: projectData.logo,
      token_symbol: projectData.token_symbol,
      establishment_date: projectData.establishment_date,
      one_liner: projectData.one_liner,
      description: projectData.description,
      active: projectData.active,
      total_funding: projectData.total_funding,
      rootdataurl: projectData.rootdataurl,
      social_media: projectData.social_media,
      X: projectData.X,
      similar_project: projectData.similar_project,
      on_main_net: projectData.on_main_net,
      plan_to_launch: projectData.plan_to_launch,
      on_test_net: projectData.on_test_net,
      fully_diluted_market_cap: projectData.fully_diluted_market_cap,
      market_cap: projectData.market_cap,
      price: projectData.price,
      event: projectData.event,
      reports: projectData.reports,
      token_launch_time: projectData.token_launch_time,
      contracts: projectData.contracts,
      support_exchanges: projectData.support_exchanges,
      heat: projectData.heat,
      heat_rank: projectData.heat_rank,
      influence: projectData.influence,
      influence_rank: projectData.influence_rank,
      followers: projectData.followers,
      following: projectData.following,
    });

    if (projectData.teamMembers && projectData.teamMembers.length > 0) {
      const peopleToUpsert = projectData.teamMembers.map(m => ({
        people_id: m.personId,
        people_name: m.people_name,
        head_img: m.head_img,
        X: m.X,
        linkedin: m.linkedin,
      }));
      await db.Person.bulkCreate(peopleToUpsert, { updateOnDuplicate: ["people_name", "head_img", "X", "linkedin"] });

      const teamMembersToUpsert = projectData.teamMembers.map(m => ({
        projectId: projectData.project_id,
        personId: m.personId,
        position: m.position,
      }));
      await db.ProjectTeamMember.bulkCreate(teamMembersToUpsert, { updateOnDuplicate: ["position"] });
    }

    if (projectData.tags && projectData.tags.length > 0) {
      const tagsToCreate = projectData.tags.filter(t => t?.tag_id).map(t => ({ tag_id: t.tag_id, tag_name: t.tag_name }));
      await db.Tag.bulkCreate(tagsToCreate, { updateOnDuplicate: ["tag_name"] });

      const projectTagsToCreate = projectData.tags.filter(t => t?.tag_id).map(t => ({
        projectId: projectData.project_id,
        tagId: t.tag_id,
      }));
      await db.ProjectTag.bulkCreate(projectTagsToCreate, { ignoreDuplicates: true });
    }

    if (projectData.ecosystems && projectData.ecosystems.length > 0) {
      const ecosystemsToCreate = projectData.ecosystems.filter(e => e?.ecosystem_id).map(e => ({
        ecosystem_id: e.ecosystem_id,
        ecosystem_name: e.ecosystem_name,
      }));
      await db.Ecosystem.bulkCreate(ecosystemsToCreate, { ignoreDuplicates: true });

      const projectEcosystemsToCreate = projectData.ecosystems.filter(e => e?.ecosystem_id).map(e => ({
        projectId: projectData.project_id,
        ecosystemId: e.ecosystem_id,
      }));
      await db.ProjectEcosystem.bulkCreate(projectEcosystemsToCreate, { ignoreDuplicates: true });
    }

    // 更新融资投资方 (修正后)
    if (projectData.investors?.investList && projectData.investors.investList.length > 0) {
      const investmentsToCreate = [];
      const entitiesToEnsure = [];
      for (const inv of projectData.investors.investList) {
        if (!inv.investorId) continue;
        const investorType = normalizeEntityType({ item_type: inv.item_type });
        if (!investorType) continue;

        entitiesToEnsure.push({ item_type: inv.item_type, id: inv.investorId, name: inv.investorName, logo: inv.investorLogo });
        investmentsToCreate.push({
          investorId: inv.investorId,
          investorType,
          fundedId: projectData.project_id,
          fundedType: "Project",
          round: inv.round,
          amount: inv.amount,
          date: inv.date ? new Date(inv.date) : null,
          lead: inv.isLead,
        });
      }
      await ensureEntities(entitiesToEnsure);
      await db.Investment.bulkCreate(investmentsToCreate, { ignoreDuplicates: true });
    }

    // 对外投资项目 (修正后)
    if (projectData.investmentProjects?.investList && projectData.investmentProjects.investList.length > 0) {
      const investmentsToCreate = [];
      const entitiesToEnsure = [];
      for (const item of projectData.investmentProjects.investList) {
        if (!item.fundedId) continue;
        const fundedType = normalizeEntityType({ item_type: item.item_type });
        if (!fundedType) continue;

        entitiesToEnsure.push({ item_type: item.item_type, id: item.fundedId, name: item.fundedName, logo: item.fundedLogo });
        investmentsToCreate.push({
          investorId: projectData.project_id,
          investorType: "Project",
          fundedId: item.fundedId,
          fundedType,
          round: item.round,
          amount: item.amount,
          date: item.date ? new Date(item.date) : null,
          lead: item.isLead,
        });
      }
      await ensureEntities(entitiesToEnsure);
      await db.Investment.bulkCreate(investmentsToCreate, { ignoreDuplicates: true });
    }

    console.log(`[DB] 更新项目成功: ${projectData.project_name}`);
  } catch (error) {
    console.error(`[DB] 更新项目 ${projectData.project_name} 时出错:`, error);
    throw error;
  }
}

module.exports = {
  updateOrganization,
  updatePersonAndInvestments,
  updateProject,
};
