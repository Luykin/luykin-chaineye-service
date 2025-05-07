const { DataTypes } = require('sequelize');

/**
 * XAccount 推特账号表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XAccount', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		xLink: {
			type: DataTypes.STRING,
			allowNull: false,
			unique: true,
			comment: 'x.com 推特唯一公开链接'
		},
		xId: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: 'x.com 推特 用户 ID 字符串（可为空）'
		},
		handle: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: 'x.com 推特 用户名: @menta'
		},
		displayName: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: 'x.com 推特 用户显示名称 Menta-xxx'
		},
		avatar: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '头像 URL'
		},
		followers: {
			type: DataTypes.INTEGER,
			defaultValue: 0,
			comment: '关注者数量'
		},
		following: {
			type: DataTypes.INTEGER,
			defaultValue: 0,
			comment: '正在关注的数量'
		},
		lastUpdated: {
			type: DataTypes.DATE,
			defaultValue: DataTypes.NOW,
			comment: '最后更新时间'
		}
	}, {
		tableName: 'XAccounts', // 显式指定表名（可选）
		timestamps: true, // 是否启用 createdAt/updatedAt
		indexes: [
			{
				name: 'idx_xlink',
				fields: ['xLink'],
				unique: true
			}
		]
	});
};
