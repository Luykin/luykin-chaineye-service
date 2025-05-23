const { DataTypes } = require('sequelize');

/**
 * XPointRecord 用户积分记录表
 * 用于记录用户每次评论获得的积分，支持历史追溯和评论删除同步撤销积分
 *
 * @param {import('sequelize').Sequelize} sequelize - Sequelize 实例
 * @returns {any}
 */
module.exports = (sequelize) => {
	return sequelize.define('XPointRecord', {
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true,
			comment: '积分记录唯一标识符'
		},
		xHuntUserId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XHuntUsers',
				key: 'id'
			},
			comment: '获得积分的用户 ID'
		},
		reviewId: {
			type: DataTypes.UUID,
			allowNull: false,
			references: {
				model: 'XReviewForAccounts',
				key: 'id'
			},
			comment: '关联的评论 ID'
		},
		points: {
			type: DataTypes.INTEGER,
			allowNull: false,
			comment: '用户本次评论获得的积分值'
		},
		userRankAtTimeOfReview: {
			type: DataTypes.INTEGER,
			allowNull: true,
			comment: '获取积分时用户的 kolRank20W 排名（用于历史追溯）'
		}
	}, {
		tableName: 'XPointRecords',
		timestamps: true,
		indexes: [
			{
				name: 'idx_points_xhuntuser_id',
				fields: ['xHuntUserId'],
				using: 'BTREE', //索引类型
				concurrently: true, // 并发创建,防止建索引的时候锁表
				ifNotExists: true // 防止重复创建索引，避免报错
			},
			{
				name: 'idx_points_review_id',
				fields: ['reviewId'],
				unique: true, // 每条评论只能产生一条积分记录
				using: 'BTREE',
				concurrently: true,
				ifNotExists: true
			}
		]
	});
};
