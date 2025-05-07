// const { Sequelize } = require('sequelize');
const { pgInstance } = require('../../models/postgres-start');

// 加载所有模型（注意：调用方式改为工厂函数）
const XHuntUser = require('./XHuntUser')(pgInstance);
const XAccount = require('./XAccount')(pgInstance);
const XHuntUserToken = require('./XHuntUserToken')(pgInstance);
const XReviewForAccount = require('./XReviewForAccount')(pgInstance);

// 建立模型之间的关系
XHuntUser.hasMany(XReviewForAccount, {
	foreignKey: 'xHuntUserId',
	as: 'reviews'
});

XReviewForAccount.belongsTo(XHuntUser, {
	foreignKey: 'xHuntUserId',
	as: 'xHuntUser'
});

XAccount.hasMany(XReviewForAccount, {
	foreignKey: 'xAccountId',
	as: 'receivedReviews'
});

XReviewForAccount.belongsTo(XAccount, {
	foreignKey: 'xAccountId',
	as: 'xAccount'
});

XHuntUser.hasMany(XHuntUserToken, {
	foreignKey: 'userId',
	as: 'tokens'
});

XHuntUserToken.belongsTo(XHuntUser, {
	foreignKey: 'userId',
	as: 'user'
});

// 导出所有模型和实例
module.exports = {
	// 数据库实例
	sequelize: pgInstance,
	
	// 模型
	XHuntUser,
	XAccount,
	XReviewForAccount,
	XHuntUserToken
};
