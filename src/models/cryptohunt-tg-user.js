const { DataTypes } = require('sequelize');
module.exports = (sequelize) => {
	return sequelize.define('User', {
		myId: {
			type: DataTypes.UUID, // 使用 UUID 类型
      defaultValue: DataTypes.UUIDV4, // 自动生成 UUID
      allowNull: false,
      primaryKey: true, // 可以设置为主键
		},
		tgId: {
			type: DataTypes.STRING,
			allowNull: true,
		},
		username: {
			type: DataTypes.STRING,
			allowNull: true
		}, // tg用户名
		joinTime: {
			type: DataTypes.DATE,
			allowNull: true
		}, // 用户加入群组的时间
		expireTime: {
			type: DataTypes.DATE,
			allowNull: true
		}, // 会员到期时间
		removedTime: {
			type: DataTypes.DATE,
			allowNull: true
		}, // 被移除群的时间
		paidAt: {
			type: DataTypes.DATE,
			allowNull: true
		}, // 用户支付的时间
		paymentMethod: {
			type: DataTypes.STRING,
			allowNull: true
		}, // 支付方式
		inviteLink: {
			type: DataTypes.STRING,
			allowNull: false
		}, // 生成的邀请链接
		otherInfo: {
			type: DataTypes.JSON,
			allowNull: true
		},
		userType: {
			/**
			 * 'admin', 'internal', 'vip' 3种类型永远不被T出
			 * 'normal' 普通用户
			 * 'pro' 付费用户
			 * 'blank' 未加入tg但有邀请链接的用户
			 * ‘removed’ 被移除用户
			 * **/
			type: DataTypes.ENUM('removed', 'blank', 'normal', 'pro', 'admin', 'internal', 'vip'),
			allowNull: false,
			defaultValue: 'normal'
		},
		orderNumberPaid: {
			/** 简单的记录用户的支付hash
			 * 例如key为链id，值为hash
			 * {
			 *   'solana': "0xxxxxx",
			 *   '1': '0xxxxxxx'
			 * }
			 * **/
			type: DataTypes.JSON,
			allowNull: true
		}
	});
};
