const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	return sequelize.define('ExNews', {
		type: {
			type: DataTypes.ENUM('binance_airdrop', 'binance_api', 'binance_cryptocurrency',
				'okx_api', 'okx_cryptocurrency'),
			allowNull: false,
		},
		newsUrl: {
			type: DataTypes.STRING,
			allowNull: false,
			unique: true,
		},
		title: {
			type: DataTypes.STRING,
			allowNull: true,
		},
		detail: {
			type: DataTypes.TEXT,
			allowNull: true,
		},
		moreInfo: {
			type: DataTypes.JSON,
			allowNull: true,
		},
		timestamp: {
			type: DataTypes.DATE,
			allowNull: true,
		}
	})
};
