const { DataTypes } = require('sequelize');

/**
 * XPrivateNote 用户对 X 账号的私人备注表
 * 只有用户自己能看到自己的备注
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XPrivateNote', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true,
			comment: '私人备注记录唯一标识符'
		},
		xHuntUserId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XHuntUsers',
				key: 'id'
			},
			comment: '备注用户的 ID'
		},
		xAccountId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XAccounts',
				key: 'id'
			},
			comment: '被备注的 X 账号 ID'
		},
		note: {
			type: DataTypes.TEXT,
			allowNull: true,
			comment: '私人备注内容'
		}
	}, {
		tableName: 'XPrivateNotes',
		timestamps: true,
		indexes: [
			{
				name: 'idx_private_note_user_account',
				fields: ['xHuntUserId', 'xAccountId'],
				unique: true // 每个用户对每个账号只能有一条备注
			},
			{
				name: 'idx_private_note_user',
				fields: ['xHuntUserId']
			}
		]
	});
};