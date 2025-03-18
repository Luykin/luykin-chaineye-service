const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	return sequelize.define('NewsStatistics', {
		key: {
			type: DataTypes.STRING,
			allowNull: false,
		},
		ip: {
			type: DataTypes.STRING,
			allowNull: false,
		},
		mainInfo: {
			type: DataTypes.JSON,
			allowNull: false,
		},
		moreInfo: {
			type: DataTypes.JSON,
			allowNull: true,
		},
		timestamp: {
			type: DataTypes.STRING,
			allowNull: false,
		},
	})
};
