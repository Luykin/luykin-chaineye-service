const { setupHotVoteAssociations } = require("./hot-vote");
const { setupXhuntCoreAssociations } = require("./xhunt-core");
const { setupCampaignAssociations } = require("./campaign");
const { setupAdminAssociations } = require("./admin");
const { setupWebUserAssociations } = require("./web-user");
const { setupAuthCenterAssociations } = require("./auth-center");
const { setupBusinessCollaborationAssociations } = require("./business-collaboration");
const { setupSocialListeningAssociations } = require("./social-listening");

/**
 * 统一按业务域注册所有模型关联关系
 * @param {object} models 全部初始化的模型集合
 */
function setupAllAssociations(models) {
  setupHotVoteAssociations(models);
  setupXhuntCoreAssociations(models);
  setupCampaignAssociations(models);
  setupAdminAssociations(models);
  setupWebUserAssociations(models);
  setupAuthCenterAssociations(models);
  setupBusinessCollaborationAssociations(models);
  setupSocialListeningAssociations(models);
}

module.exports = {
  setupAllAssociations,
  setupHotVoteAssociations,
  setupXhuntCoreAssociations,
  setupCampaignAssociations,
  setupAdminAssociations,
  setupWebUserAssociations,
  setupAuthCenterAssociations,
  setupBusinessCollaborationAssociations,
  setupSocialListeningAssociations,
};
