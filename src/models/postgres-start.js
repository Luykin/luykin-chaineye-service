const { Sequelize } = require('sequelize');
const TGUserModel = require('./cryptohunt-tg-user');

const postgres = new Sequelize({
	dialect: process.env.PG_DIALECT,
	host: process.env.PG_HOST,
	port: parseInt(process.env.PG_PORT, 10),
	database: process.env.PG_DATABASE,
	username: process.env.PG_USERNAME,
	password: process.env.PG_PASSWORD,
	logging: process.env.PG_LOGGING === 'true', // 转换为布尔值
});

/** 用postgres数据库 **/
const TGUser = TGUserModel(postgres);
/**用postgres数据库 ======== end **/

async function setupPostgres() {
	try {
		await postgres.authenticate();
		console.log('postgres Database connection established.');
		await postgres.sync();
		console.log('postgres Database synchronized.');
	} catch (error) {
		console.error('postgres Database setup error:', error);
		throw error;
	}
}

module.exports = {
	TGUser,
	setupPostgres,
};
