const db = require("../../models");

function normalizeEntityType({ type, item_type }) {
  if (type) return type;

  if (item_type === 1) return "Project";
  if (item_type === 2) return "Organization";
  if (item_type === 3) return "Person";

  return null;
}

async function ensureEntity({ type, item_type, id, name, logo }) {
  if (!id) return null;

  const resolvedType = normalizeEntityType({ type, item_type });
  if (!resolvedType) return null;

  if (resolvedType === "Organization") {
    await db.Organization.findOrCreate({
      where: { org_id: id },
      defaults: {
        org_id: id,
        org_name: name,
        logo,
        description: "",
        active: true,
      },
    });
    return resolvedType;
  }

  if (resolvedType === "Project") {
    await db.Project.findOrCreate({
      where: { project_id: id },
      defaults: {
        project_id: id,
        project_name: name,
        logo,
        description: "",
        active: true,
      },
    });
    return resolvedType;
  }

  if (resolvedType === "Person") {
    await db.Person.findOrCreate({
      where: { people_id: id },
      defaults: {
        people_id: id,
        people_name: name,
        head_img: logo,
      },
    });
    return resolvedType;
  }

  return null;
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
      for (const m of orgData.teamMembers) {
        await db.Person.upsert({
          people_id: m.personId,
          people_name: m.people_name,
          head_img: m.head_img,
          X: m.X,
          linkedin: m.linkedin,
        });

        await db.OrganizationTeamMember.upsert({
          organizationId: orgData.org_id,
          personId: m.personId,
          position: m.position,
        });
      }
    }

    // 机构分类 (InvestorCategory)
    if (orgData.categories && orgData.categories.length > 0) {
      for (const c of orgData.categories) {
        if (!c?.category_id) continue;
        await db.InvestorCategory.findOrCreate({
          where: { category_id: c.category_id },
          defaults: { category_id: c.category_id, category_name: c.category_name },
        });

        await db.OrganizationInvestorCategory.findOrCreate({
          where: { organizationId: orgData.org_id, categoryId: c.category_id },
          defaults: { organizationId: orgData.org_id, categoryId: c.category_id },
        });
      }
    }

    // 机构标签 (Tag)
    if (orgData.tags && orgData.tags.length > 0) {
      for (const t of orgData.tags) {
        if (!t?.tag_id) continue;

        await db.Tag.findOrCreate({
          where: { tag_id: t.tag_id },
          defaults: { tag_id: t.tag_id, tag_name: t.tag_name },
        });

        await db.OrganizationTag.findOrCreate({
          where: { organizationId: orgData.org_id, tagId: t.tag_id },
          defaults: { organizationId: orgData.org_id, tagId: t.tag_id },
        });
      }
    }

    // 机构被投资关系 (Investor -> Organization)
    if (orgData.fundingRounds && orgData.fundingRounds.length > 0) {
      for (const r of orgData.fundingRounds) {
        const roundKey = `${r?.date || ""}|${r?.amount_text || ""}`;
        const investorList = r?.lps || [];

        for (const inv of investorList) {
          const investorId = inv?.item_id ? Number(inv.item_id) : null;
          if (!investorId) continue;

          const investorType = await ensureEntity({
            item_type: inv.item_type,
            id: investorId,
            name: inv.item_name,
            logo: inv.logo,
          });
          if (!investorType) continue;

          await db.Investment.findOrCreate({
            where: {
              investorId: investorId,
              investorType,
              fundedId: orgData.org_id,
              fundedType: "Organization",
              round: roundKey,
            },
            defaults: {
              investorId: investorId,
              investorType,
              fundedId: orgData.org_id,
              fundedType: "Organization",
              round: roundKey,
              amount: null,
              date: r?.date ? new Date(r.date) : null,
              lead: false,
            },
          });
        }
      }
    }

    // 机构对外投资关系 -> Investment
    if (orgData.investments && orgData.investments.length > 0) {
      for (const inv of orgData.investments) {
        if (!inv.item_id) continue;

        const fundedType = await ensureEntity({
          item_type: inv.item_type,
          id: inv.item_id,
          name: inv.item_name,
          logo: inv.logo,
        });
        if (!fundedType) continue;

        await db.Investment.findOrCreate({
          where: {
            investorId: orgData.org_id,
            investorType: "Organization",
            fundedId: inv.item_id,
            fundedType,
            round: inv.round,
          },
          defaults: {
            investorId: orgData.org_id,
            investorType: "Organization",
            fundedId: inv.item_id,
            fundedType,
            round: inv.round,
            amount: inv.amount,
            date: inv.date,
            lead: false,
          },
        });
      }
    }

    console.log(`[DB] 更新组织成功: ${orgData.org_name}`);
  } catch (error) {
    console.error(`[DB] 更新组织 ${orgData.org_name} 时出错:`, error);
  }
}

/**
 * 更新或创建个人及其投资关系到数据库。
 * @param {object} personData 从解析器获取的个人数据。
 */
async function updatePersonAndInvestments(personData) {
  if (!personData) return;

  try {
    // 更新或创建个人信息
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

    // 处理投资关系
    if (personData.investments && personData.investments.length > 0) {
      for (const investment of personData.investments) {
        let entityModel, entityIdField, entityNameField, fundedEntityType;

        switch (investment.item_type) {
          case 1: // Project
            entityModel = db.Project;
            entityIdField = "project_id";
            entityNameField = "project_name";
            fundedEntityType = "Project";
            break;
          case 2: // Organization
            entityModel = db.Organization;
            entityIdField = "org_id";
            entityNameField = "org_name";
            fundedEntityType = "Organization";
            break;
          default:
            console.warn(
              `[DB] 未知的投资类型: ${investment.item_type}，将跳过。`
            );
            continue;
        }

        await ensureEntity({
          type: fundedEntityType,
          id: investment.item_id,
          name: investment.item_name,
          logo: investment.logo,
        });

        const entity = { [entityIdField]: investment.item_id };
        const entityCreated = false;

        if (entityCreated) {
          console.log(
            `[DB] 创建了新的 ${fundedEntityType}: ${investment.item_name}`
          );
        }

        await db.Investment.findOrCreate({
          where: {
            // 复合键确保投资事件的唯一性
            investorId: person.people_id,
            investorType: "Person",
            fundedId: entity[entityIdField],
            fundedType: fundedEntityType,
            round: investment.round, // 将轮次加入唯一性检查
          },
          defaults: {
            fundedId: entity[entityIdField],
            fundedType: fundedEntityType,
            investorId: person.people_id,
            investorType: "Person",
            round: investment.round,
            amount: investment.amount,
            date: investment.date,
          },
        });

        console.log(
          `[DB] 已为 ${person.people_name} 创建/确认了对 ${
            investment.item_name
          } (${investment.round || "未知"}轮) 的投资关系。`
        );
      }
    }
  } catch (error) {
    console.error(
      `[DB] 更新个人 ${personData.people_name} 的数据时出错:`,
      error
    );
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

    // 更新团队成员
    if (projectData.teamMembers && projectData.teamMembers.length > 0) {
      for (const m of projectData.teamMembers) {
        await db.Person.upsert({
          people_id: m.personId,
          people_name: m.people_name,
          head_img: m.head_img,
          X: m.X,
          linkedin: m.linkedin,
        });

        await db.ProjectTeamMember.upsert({
          projectId: projectData.project_id,
          personId: m.personId,
          position: m.position,
        });
      }
    }

    // Project <-> Tag
    if (projectData.tags && projectData.tags.length > 0) {
      for (const t of projectData.tags) {
        if (!t?.tag_id) continue;

        await db.Tag.findOrCreate({
          where: { tag_id: t.tag_id },
          defaults: { tag_id: t.tag_id, tag_name: t.tag_name },
        });

        await db.ProjectTag.findOrCreate({
          where: { projectId: projectData.project_id, tagId: t.tag_id },
          defaults: { projectId: projectData.project_id, tagId: t.tag_id },
        });
      }
    }

    // Project <-> Ecosystem
    if (projectData.ecosystems && projectData.ecosystems.length > 0) {
      for (const e of projectData.ecosystems) {
        if (!e?.ecosystem_id) continue;

        await db.Ecosystem.findOrCreate({
          where: { ecosystem_id: e.ecosystem_id },
          defaults: { ecosystem_id: e.ecosystem_id, ecosystem_name: e.ecosystem_name },
        });

        await db.ProjectEcosystem.findOrCreate({
          where: { projectId: projectData.project_id, ecosystemId: e.ecosystem_id },
          defaults: { projectId: projectData.project_id, ecosystemId: e.ecosystem_id },
        });
      }
    }

    // 更新融资投资方 -> Investment
    if (projectData.investors?.investList && projectData.investors.investList.length > 0) {
      for (const inv of projectData.investors.investList) {
        if (!inv.investId) continue;

        const investorType = await ensureEntity({
          item_type: inv.item_type,
          id: inv.investId,
          name: inv.investName,
          logo: inv.imgUrl,
        });
        if (!investorType) continue;

        const roundKey = String(inv.facDate || "");
        await db.Investment.findOrCreate({
          where: {
            investorId: inv.investId,
            investorType,
            fundedId: projectData.project_id,
            fundedType: "Project",
            round: roundKey,
          },
          defaults: {
            investorId: inv.investId,
            investorType,
            fundedId: projectData.project_id,
            fundedType: "Project",
            round: roundKey,
            amount: null,
            date: inv.facDate ? new Date(inv.facDate) : null,
            lead: inv.ltNum === 1,
          },
        });
      }
    }

    // 对外投资项目 -> Investment
    if (projectData.investmentProjects?.investList && projectData.investmentProjects.investList.length > 0) {
      for (const item of projectData.investmentProjects.investList) {
        if (!item.itemId) continue;

        const fundedType = await ensureEntity({
          item_type: item.item_type || 1,
          id: item.itemId,
          name: item.itemName,
          logo: item.imgUrl,
        });
        if (!fundedType) continue;

        const roundKey = `investmentProjects|${item.facRounds || ""}`;
        await db.Investment.findOrCreate({
          where: {
            investorId: projectData.project_id,
            investorType: "Project",
            fundedId: item.itemId,
            fundedType,
            round: roundKey,
          },
          defaults: {
            investorId: projectData.project_id,
            investorType: "Project",
            fundedId: item.itemId,
            fundedType,
            round: roundKey,
            amount: null,
            date: null,
            lead: false,
          },
        });
      }
    }

    console.log(`[DB] 更新项目成功: ${projectData.project_name}`);
  } catch (error) {
    console.error(`[DB] 更新项目 ${projectData.project_name} 时出错:`, error);
  }
}

module.exports = {
  updateOrganization,
  updatePersonAndInvestments,
  updateProject,
};
