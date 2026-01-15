const db = require("../../models");

/**
 * 更新或创建组织信息到数据库。
 * @param {object} orgData 从解析器获取的组织数据。
 */
async function updateOrganization(orgData) {
  if (!orgData) return;
  // TODO: 实现组织数据的 upsert 逻辑
  console.log(`[DB] TODO: 更新组织数据 ${orgData.org_name}`);
}

/**
 * 更新或创建个人及其投资关系到数据库。
 * @param {object} personData 从解析器获取的个人数据。
 */
async function updatePersonAndInvestments(personData) {
  if (!personData) return;

  try {
    // 更新或创建个人信息
    const [person, created] = await db.RootdataPeople.upsert({
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
            entityModel = db.RootdataProject;
            entityIdField = "project_id";
            entityNameField = "project_name";
            fundedEntityType = "Project";
            break;
          case 2: // Organization
            entityModel = db.RootdataOrganization;
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

module.exports = {
  updateOrganization,
  updatePersonAndInvestments,
};
