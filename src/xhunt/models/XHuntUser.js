const { DataTypes } = require('sequelize');

/**
 * XHuntUser 用户表（关联 Twitter 登录用户）
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XHuntUser', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true,
			comment: '用户唯一标识符'
		},
		twitterId: {
			type: DataTypes.STRING,
			allowNull: false,
			unique: true,
			comment: '推特登录时给的 ID 字符串（全局唯一）'
		},
		username: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '用户登录名（可为空）'
		},
		displayName: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '用户显示名称'
		},
		avatar: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '用户头像 URL'
		}
	}, {
		tableName: 'XHuntUsers', // 显式指定表名（可选）
		timestamps: true,        // 启用 createdAt 和 updatedAt
		indexes: [
			{
				name: 'idx_twitter_id',
				fields: ['twitterId'],
				unique: true
			}
		]
	});
};
