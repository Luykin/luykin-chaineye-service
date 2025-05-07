const { DataTypes } = require('sequelize');

/**
 * XReviewForAccount 用户对 X 账号的评价表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XReviewForAccount', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true,
			comment: '评价记录唯一标识符'
		},
		xHuntUserId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XHuntUsers', // 注意：与 XHuntUser 的 tableName 一致
				key: 'id'
			},
			comment: '评价用户的 ID'
		},
		xAccountId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XAccounts', // 注意：与 XAccount 的 tableName 一致
				key: 'id'
			},
			comment: '被评价的 X 账号 ID'
		},
		userAvatar: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: '评价用户头像 URL'
		},
		userName: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: '评价用户的用户名'
		},
		rating: {
			type: DataTypes.INTEGER,
			allowNull: false,
			validate: {
				min: 1,
				max: 5
			},
			comment: '评分（1 到 5 分）'
		},
		tags: {
			type: DataTypes.ARRAY(DataTypes.STRING),
			allowNull: true,
			comment: '用户打的标签'
		},
		note: {
			type: DataTypes.TEXT,
			allowNull: true,
			comment: '用户评论内容'
		}
	}, {
		tableName: 'XReviewForAccounts', // 显式指定表名（可选）
		timestamps: true,                // 启用 createdAt/updatedAt
		indexes: [
			{
				name: 'idx_xhuntuser_id',
				fields: ['xHuntUserId']
			},
			{
				name: 'idx_xaccount_id',
				fields: ['xAccountId']
			}
		]
	});
};
