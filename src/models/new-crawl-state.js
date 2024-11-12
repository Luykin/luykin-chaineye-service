const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	return sequelize.define('NewCrawlState', {
		type: {
			type: DataTypes.ENUM('full', 'quick', 'detail', 'detail2'),
			allowNull: false,
		},
		lastUpdateTime: {
			type: DataTypes.DATE,
			allowNull: true,
		},
		otherInfo: {
			type: DataTypes.JSON,
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
