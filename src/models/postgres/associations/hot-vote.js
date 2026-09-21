/**
 * 热点投票相关模型关联
 */
function setupHotVoteAssociations({
  XHuntHotVoteTopic,
  XHuntHotVoteRecord,
  XHuntHotVoteComment,
  XHuntUser,
}) {
  XHuntHotVoteTopic.hasMany(XHuntHotVoteRecord, {
    foreignKey: "topicId",
    as: "voteRecords",
  });
  XHuntHotVoteRecord.belongsTo(XHuntHotVoteTopic, {
    foreignKey: "topicId",
    as: "topic",
  });

  XHuntHotVoteTopic.hasMany(XHuntHotVoteComment, {
    foreignKey: "topicId",
    as: "comments",
  });
  XHuntHotVoteComment.belongsTo(XHuntHotVoteTopic, {
    foreignKey: "topicId",
    as: "topic",
  });

  XHuntUser.hasMany(XHuntHotVoteRecord, {
    foreignKey: "xHuntUserId",
    as: "hotVoteRecords",
  });
  XHuntHotVoteRecord.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "user",
  });

  XHuntUser.hasMany(XHuntHotVoteComment, {
    foreignKey: "xHuntUserId",
    as: "hotVoteComments",
  });
  XHuntHotVoteComment.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "user",
  });
}

module.exports = {
  setupHotVoteAssociations,
};
