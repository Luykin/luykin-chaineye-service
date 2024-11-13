const { Sequelize } = require('sequelize');
const FundraisingModel = require('./fundraising');
const NewCrawlStateModel = require('./new-crawl-state');

const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: './database.sqlite',
	logging: false
});

const Fundraising = FundraisingModel(sequelize);
const NewCrawlState = NewCrawlStateModel(sequelize);
const C_STATE_TYPE = {
	full: { type: 'full'},
	quick: { type: 'quick' },
	detail: { type: 'detail' },
	detail2: { type: 'detail2' },
	spare: { type: 'spare' }
};

async function setupDatabase() {
	try {
		await sequelize.authenticate();
		console.log('Database connection established.');
		await sequelize.sync();
		console.log('Database synchronized.');
	} catch (error) {
		console.error('Database setup error:', error);
		throw error;
	}
}

module.exports = {
	sequelize,
	Fundraising,
	NewCrawlState,
	C_STATE_TYPE,
	setupDatabase
};
