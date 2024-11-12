const { Sequelize } = require('sequelize');
const FundraisingModel = require('./fundraising');
const CrawlStateModel = require('./crawl-state');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite',
  logging: false
});

const Fundraising = FundraisingModel(sequelize);
const CrawlState = CrawlStateModel(sequelize);

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
  CrawlState,
  setupDatabase
};
