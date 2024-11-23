const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('User', {
    myId: {
      type: DataTypes.UUID, // 使用 UUID 类型
      defaultValue: DataTypes.UUIDV4, // 自动生成 UUID
      allowNull: false,
      primaryKey: true, // 设置为主键
    },
    tgId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
    }, // tg用户名
    joinTime: {
      type: DataTypes.BIGINT, // 存储时间戳
      allowNull: true,
    }, // 用户加入群组的时间（时间戳）
    expireTime: {
      type: DataTypes.BIGINT, // 存储时间戳
      allowNull: true,
    }, // 会员到期时间（时间戳）
    removedTime: {
      type: DataTypes.BIGINT, // 存储时间戳
      allowNull: true,
    }, // 被移除群的时间（时间戳）
    paidAt: {
      type: DataTypes.BIGINT, // 存储时间戳
      allowNull: true,
    }, // 用户支付的时间（时间戳）
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: true,
    }, // 支付方式
    inviteLink: {
      type: DataTypes.STRING,
      allowNull: false,
    }, // 生成的邀请链接
    otherInfo: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    userType: {
      /**
       * 'admin', 'internal', 'vip' 3种类型永远不被T出
       * 'normal' 普通用户
       * 'pro' 付费用户
       * 'blank' 未加入tg但有邀请链接的用户
       * ‘removed’ 被移除用户
       **/
      type: DataTypes.ENUM(
        'removed',
        'blank',
        'normal',
        'pro',
        'admin',
        'internal',
        'vip'
      ),
      allowNull: false,
      defaultValue: 'normal',
    },
    paymentHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });
};
