const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	return sequelize.define('Fundraising', {
		projectName: {
			type: DataTypes.STRING,
			allowNull: false
		},
		description: {
			type: DataTypes.STRING
		},
		round: {
			type: DataTypes.STRING
		},
		amount: {
			type: DataTypes.STRING, // 原始 Amount 数据
		},
		formattedAmount: {
			type: DataTypes.FLOAT, // 格式化后的 Amount 数据
			allowNull: true
		},
		valuation: {
			type: DataTypes.STRING, // 原始 Valuation 数据
		},
		formattedValuation: {
			type: DataTypes.FLOAT, // 格式化后的 Valuation 数据
			allowNull: true
		},
		date: {
			type: DataTypes.STRING, // 原始 Date 数据
		},
		formattedDate: {
			type: DataTypes.DATEONLY, // 格式化后的 Date 数据
			allowNull: true
		},
		investors: {
			type: DataTypes.JSON // 投资人信息存储为 JSON 格式
		}
	});
};
