const { DataTypes } = require('sequelize');

/**
 * XHuntUserToken 用户 Token 表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XHuntUserToken', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true,
			comment: 'Token 记录唯一标识符'
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XHuntUsers', // 注意：这里与 tableName 保持一致
				key: 'id'
			},
			comment: '关联用户 ID（指向 XHuntUser）'
		},
		accessToken: {
			type: DataTypes.TEXT,
			allowNull: false,
			comment: '访问 Token（JWT）'
		},
		refreshToken: {
			type: DataTypes.TEXT,
			allowNull: false,
			comment: '刷新 Token'
		},
		tokenExpiry: {
			type: DataTypes.DATE,
			allowNull: false,
			comment: 'Token 过期时间'
		},
		lastUsed: {
			type: DataTypes.DATE,
			defaultValue: DataTypes.NOW,
			comment: '最后使用时间'
		},
		isRevoked: {
			type: DataTypes.BOOLEAN,
			defaultValue: false,
			comment: '是否已被撤销'
		}
	}, {
		tableName: 'XHuntUserTokens', // 显式指定表名（可选）
		timestamps: true,             // 启用 createdAt 和 updatedAt
		indexes: [
			{
				name: 'idx_userid',
				fields: ['userId']
			},
			{
				name: 'idx_token_expiry',
				fields: ['tokenExpiry']
			}
		]
	});
};
