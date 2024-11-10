const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrawlState', {
    lastPage: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    lastUpdateTime: {
      type: DataTypes.DATE
    },
    isFullCrawl: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    status: {
      type: DataTypes.ENUM('idle', 'running', 'failed', 'completed'),
      defaultValue: 'idle'
    },
    error: {
      type: DataTypes.TEXT
    }
  });
};