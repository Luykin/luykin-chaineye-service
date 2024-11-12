const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CrawlState', {
	  lastProjectLink: {
			type: DataTypes.STRING,
			allowNull: true,
	  },
	  numberDetailsToCrawl: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
	    allowNull: true,
    },
	  numberDetailsFailed: {
		  type: DataTypes.INTEGER,
		  defaultValue: 0,
		  allowNull: true,
	  },
    lastPage: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    lastUpdateTime: {
      type: DataTypes.DATE,
	    allowNull: true,
    },
	  isDetailCrawl: {
			type: DataTypes.BOOLEAN,
			defaultValue: false,
		  allowNull: true,
	  },
    isFullCrawl: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
	    allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('idle', 'running', 'failed', 'completed'),
      defaultValue: 'idle',
	    allowNull: true,
    },
    error: {
      type: DataTypes.TEXT,
	    allowNull: true,
    }
  });
};
