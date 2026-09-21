'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('XHuntHotVoteComments', 'isAnonymous', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否匿名留言',
    });

    await queryInterface.addColumn('XHuntHotVoteRecords', 'isAnonymous', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否匿名投票',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('XHuntHotVoteComments', 'isAnonymous');
    await queryInterface.removeColumn('XHuntHotVoteRecords', 'isAnonymous');
  },
};
