const db = require("../../models");

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

    // 机构对外投资关系 -> Investment
    if (orgData.investments && orgData.investments.length > 0) {
      for (const inv of orgData.investments) {
        if (!inv.item_id) continue;

        const fundedType = inv.item_type === 2 ? "Organization" : "Project";

        if (fundedType === "Project") {
          await db.Project.findOrCreate({
            where: { project_id: inv.item_id },
            defaults: {
              project_id: inv.item_id,
              project_name: inv.item_name,
              logo: inv.logo,
              description: inv.description,
              active: true,
            },
          });
        } else {
          await db.Organization.findOrCreate({
            where: { org_id: inv.item_id },
            defaults: {
              org_id: inv.item_id,
              org_name: inv.item_name,
              logo: inv.logo,
              description: inv.description,
              active: true,
            },
          });
        }

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

        const [entity, entityCreated] = await entityModel.findOrCreate({
          where: { [entityIdField]: investment.item_id },
          defaults: {
            [entityIdField]: investment.item_id,
            [entityNameField]: investment.item_name,
            logo: investment.logo,
            description: investment.description,
            active: investment.active,
          },
        });

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
      tags: projectData.tags,
      ecosystems: projectData.ecosystems,
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

    // 更新融资投资方 -> Investment
    if (projectData.investors?.investList && projectData.investors.investList.length > 0) {
      for (const inv of projectData.investors.investList) {
        if (!inv.investId) continue;

        await db.Organization.findOrCreate({
          where: { org_id: inv.investId },
          defaults: {
            org_id: inv.investId,
            org_name: inv.investName,
            logo: inv.imgUrl,
            X: null,
            rootdataurl: null,
          },
        });

        await db.Investment.findOrCreate({
          where: {
            investorId: inv.investId,
            investorType: "Organization",
            fundedId: projectData.project_id,
            fundedType: "Project",
            round: null,
          },
          defaults: {
            investorId: inv.investId,
            investorType: "Organization",
            fundedId: projectData.project_id,
            fundedType: "Project",
            round: null,
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

        await db.Project.findOrCreate({
          where: { project_id: item.itemId },
          defaults: {
            project_id: item.itemId,
            project_name: item.itemName,
            logo: item.imgUrl,
            one_liner: item.briefIntd,
            description: item.intd,
            active: item.operateStatus === 1,
          },
        });

        await db.Investment.findOrCreate({
          where: {
            investorId: projectData.project_id,
            investorType: "Project",
            fundedId: item.itemId,
            fundedType: "Project",
            round: null,
          },
          defaults: {
            investorId: projectData.project_id,
            investorType: "Project",
            fundedId: item.itemId,
            fundedType: "Project",
            round: null,
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
