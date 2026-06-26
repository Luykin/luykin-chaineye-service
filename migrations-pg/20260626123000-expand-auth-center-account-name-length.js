"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("AuthCenterXhuntUsers", "accountName", {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: "用户自己设置的账户名或邮箱",
    });
    await queryInterface.changeColumn("AuthCenterXhuntUsers", "accountNameLower", {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: "小写账户名或邮箱",
    });
    await queryInterface.changeColumn("AuthCenterXhuntPasswordCredentials", "usernameLower", {
      type: Sequelize.STRING(255),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("AuthCenterXhuntUsers", "accountName", {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: "用户自己设置的账户名",
    });
    await queryInterface.changeColumn("AuthCenterXhuntUsers", "accountNameLower", {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: "小写账户名",
    });
    await queryInterface.changeColumn("AuthCenterXhuntPasswordCredentials", "usernameLower", {
      type: Sequelize.STRING(64),
      allowNull: false,
    });
  },
};
