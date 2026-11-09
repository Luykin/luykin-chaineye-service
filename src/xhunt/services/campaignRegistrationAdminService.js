const {
  pgInstance,
  CampaignRegistration,
  XhuntCampaignLeaderboardAddressBinding,
  XhuntCampaignTweetSubmission,
} = require("../../models/postgres-start");

async function deleteCampaignRegistrationWithRelations({ id, campaign }) {
  return pgInstance.transaction(async (transaction) => {
    const where = { id };
    if (campaign) where.campaign = campaign;

    const record = await CampaignRegistration.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) return null;

    // 投稿可能同时引用报名和地址绑定，必须最先删除。
    const deletedTweetSubmissions = await XhuntCampaignTweetSubmission.destroy({
      where: { campaignRegistrationId: record.id },
      transaction,
    });

    // 地址绑定默认由数据库触发器保护为不可变，仅在当前强删事务内放行 DELETE。
    await pgInstance.query(
      "SELECT set_config('xhunt.allow_campaign_registration_cascade_delete', 'on', true)",
      { transaction }
    );
    const deletedAddressBindings = await XhuntCampaignLeaderboardAddressBinding.destroy({
      where: { campaignRegistrationId: record.id },
      transaction,
    });

    await record.destroy({ transaction });

    return {
      record,
      deletedTweetSubmissions,
      deletedAddressBindings,
    };
  });
}

module.exports = {
  deleteCampaignRegistrationWithRelations,
};
