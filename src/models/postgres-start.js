const { Sequelize } = require('sequelize');
const TGUserModel = require('./cryptohunt-tg-user');

const pgInstance = new Sequelize({
	dialect: process.env.PG_DIALECT,
	host: process.env.PG_HOST,
	port: parseInt(process.env.PG_PORT, 10),
	database: process.env.PG_DATABASE,
	username: process.env.PG_USERNAME,
	password: process.env.PG_PASSWORD,
	logging: process.env.PG_LOGGING === 'true', // 转换为布尔值
});

/** 🏖️这是 https://www.cryptohunt.ai/ 的数据表 start====== **/
//由于历史和时间原因，展示不对原来的代码修改
const TGUser = TGUserModel(pgInstance);
/** 这是 https://www.cryptohunt.ai/ 的数据表 end====== **/

/** ✅这是XHunt 浏览器插件的 数据表  start====== **/
const {
	XHuntUser,
	XAccount,
	XHuntUserToken,
	XReviewForAccount
} = require('../xhunt/models'); // 替换为正确的路径
/** 这是XHunt 浏览器插件的 数据表  end====== **/


async function setupPostgres() {
	try {
		await pgInstance.authenticate();
		console.log('postgres Database connection established.');
		await pgInstance.sync();
		console.log('postgres Database synchronized.');
	} catch (error) {
		console.error('postgres Database setup error:', error);
		throw error;
	}
}

module.exports = {
	// 数据库初始化
	setupPostgres,
	
	// 数据库实例
	pgInstance,
	
	// CryptoHunt 数据表
	TGUser,
	
	// XHunt 数据表
	XHuntUser,
	XAccount,
	XHuntUserToken,
	XReviewForAccount
};
