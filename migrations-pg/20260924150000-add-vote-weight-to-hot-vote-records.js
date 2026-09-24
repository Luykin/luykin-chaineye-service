'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('XHuntHotVoteRecords', 'voteWeight', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: '投票加权分值 (根据投票时刻XHunt排名决定)',
    });

    await queryInterface.addColumn('XHuntHotVoteRecords', 'voterRankSnapshot', {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '投票瞬间用户的 XHunt 排名快照',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('XHuntHotVoteRecords', 'voteWeight');
    await queryInterface.removeColumn('XHuntHotVoteRecords', 'voterRankSnapshot');
  },
};
