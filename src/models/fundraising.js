const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Fundraising', {
    projectName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.STRING
    },
    date: {
      type: DataTypes.DATE
    },
    investors: {
      type: DataTypes.STRING
    },
    stage: {
      type: DataTypes.STRING
    },
    category: {
      type: DataTypes.STRING
    }
  });
};