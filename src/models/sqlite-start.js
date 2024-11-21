const { Sequelize } = require('sequelize');
const FundraisingModel = require('./fundraising');
const NewCrawlStateModel = require('./new-crawl-state');
const EXNewsModel = require('./ex-news');
const sqlite = new Sequelize({
	dialect: 'sqlite',
	storage: './database.sqlite',
	logging: false
});
/** 用sqlite数据库 **/
const Fundraising = FundraisingModel(sqlite);
const NewCrawlState = NewCrawlStateModel(sqlite);
const EXNews = EXNewsModel(sqlite);
/**用sqlite数据库 ======== end **/

const C_STATE_TYPE = {
	full: { type: 'full' },
	quick: { type: 'quick' },
	detail: { type: 'detail' },
	detail2: { type: 'detail2' },
	spare: { type: 'spare' }
};

async function setupSqlite() {
	try {
		await sqlite.authenticate();
		console.log('sqlite Database connection established.');
		await sqlite.sync();
		console.log('sqlite Database synchronized.');
	} catch (error) {
		console.error('sqlite Database setup error:', error);
		throw error;
	}
}

module.exports = {
	EXNews,
	Fundraising,
	NewCrawlState,
	C_STATE_TYPE,
	setupSqlite
};
