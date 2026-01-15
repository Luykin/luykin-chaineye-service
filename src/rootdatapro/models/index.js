const { Sequelize } = require("sequelize");
const fs = require("fs");
const path = require("path");

const pgDialect = process.env.PG_DIALECT || "postgres";
const pgHost = process.env.PG_HOST;
const pgPort = process.env.PG_PORT
  ? parseInt(process.env.PG_PORT, 10)
  : undefined;
const pgUsername = process.env.PG_USERNAME;
const pgPassword = process.env.PG_PASSWORD;

// rootdatapro 专用数据库名：只替换 database，其它配置与 postgres-start.js 一致
const pgDatabase = "rootdatapro";

if (!pgHost || !pgDatabase || !pgUsername || !pgPassword) {
  throw new Error(
    "PostgreSQL env incomplete: require PG_HOST, PG_USERNAME, PG_PASSWORD"
  );
}

const dialectOptions = {};
if (process.env.PG_SSL === "true") {
  dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

const sequelize = new Sequelize({
  dialect: pgDialect,
  host: pgHost,
  port: pgPort,
  database: pgDatabase,
  username: pgUsername,
  password: pgPassword,
  logging: process.env.PG_LOGGING === "true",
  timezone: "+00:00",
  pool: { max: 5, min: 0, idle: 10000, acquire: 20000 },
  dialectOptions,
});

const db = {};

// 自动加载当前目录下的所有模型文件（工厂函数模式）
fs.readdirSync(__dirname)
  .filter(
    (file) =>
      file.indexOf(".") !== 0 && file !== "index.js" && file.slice(-3) === ".js"
  )
  .forEach((file) => {
    const modelFactory = require(path.join(__dirname, file));
    const model = modelFactory(sequelize);
    db[model.name] = model;
  });

// --- 多对多关联 ---

// Project <-> Person (Team Members)
db.Project.belongsToMany(db.Person, {
  through: db.ProjectTeamMember,
  foreignKey: "projectId",
  otherKey: "personId",
  as: "TeamMembers",
});
db.Person.belongsToMany(db.Project, {
  through: db.ProjectTeamMember,
  foreignKey: "personId",
  otherKey: "projectId",
  as: "MemberOfProjects",
});

// Organization <-> Person (Team Members)
db.Organization.belongsToMany(db.Person, {
  through: db.OrganizationTeamMember,
  foreignKey: "organizationId",
  otherKey: "personId",
  as: "TeamMembers",
});
db.Person.belongsToMany(db.Organization, {
  through: db.OrganizationTeamMember,
  foreignKey: "personId",
  otherKey: "organizationId",
  as: "MemberOfOrganizations",
});

// Project <-> Tag
db.Project.belongsToMany(db.Tag, {
  through: db.ProjectTag,
  foreignKey: "projectId",
  otherKey: "tagId",
  as: "Tags",
});
db.Tag.belongsToMany(db.Project, {
  through: db.ProjectTag,
  foreignKey: "tagId",
  otherKey: "projectId",
  as: "Projects",
});

// Organization <-> Tag
db.Organization.belongsToMany(db.Tag, {
  through: db.OrganizationTag,
  foreignKey: "organizationId",
  otherKey: "tagId",
  as: "Tags",
});
db.Tag.belongsToMany(db.Organization, {
  through: db.OrganizationTag,
  foreignKey: "tagId",
  otherKey: "organizationId",
  as: "Organizations",
});

// Project <-> Ecosystem
// 注意：Ecosystem 主键是 ecosystem_id，但在 through 表里我们使用 ecosystemId 字段名
// belongsToMany 的 otherKey 指的是 through 表字段名，不是目标表字段名
db.Project.belongsToMany(db.Ecosystem, {
  through: db.ProjectEcosystem,
  foreignKey: "projectId",
  otherKey: "ecosystemId",
  as: "Ecosystems",
});
db.Ecosystem.belongsToMany(db.Project, {
  through: db.ProjectEcosystem,
  foreignKey: "ecosystemId",
  otherKey: "projectId",
  as: "Projects",
});

// Organization <-> InvestorCategory
db.Organization.belongsToMany(db.InvestorCategory, {
  through: db.OrganizationInvestorCategory,
  foreignKey: "organizationId",
  otherKey: "categoryId",
  as: "Categories",
});
db.InvestorCategory.belongsToMany(db.Organization, {
  through: db.OrganizationInvestorCategory,
  foreignKey: "categoryId",
  otherKey: "organizationId",
  as: "Organizations",
});

// --- 投资关系 (多态关联) ---

// 一个投资关系属于一个被投项目（Project 主键为 project_id）
db.Investment.belongsTo(db.Project, {
  foreignKey: "fundedProjectId",
  targetKey: "project_id",
  as: "FundedProject",
});
db.Project.hasMany(db.Investment, {
  foreignKey: "fundedProjectId",
  sourceKey: "project_id",
  as: "FundingRounds",
});

// 一个实体(项目/机构/个人)可以进行多次投资
db.Project.hasMany(db.Investment, {
  foreignKey: "investorId",
  constraints: false,
  scope: { investorType: "Project" },
  as: "InvestmentsMade",
});
db.Organization.hasMany(db.Investment, {
  foreignKey: "investorId",
  constraints: false,
  scope: { investorType: "Organization" },
  as: "InvestmentsMade",
});
db.Person.hasMany(db.Investment, {
  foreignKey: "investorId",
  constraints: false,
  scope: { investorType: "Person" },
  as: "InvestmentsMade",
});

// 为 Investment 模型添加获取多态投资方的实例方法
db.Investment.prototype.getInvestor = function (options) {
  if (!this.investorType) return Promise.resolve(null);
  const model = db[this.investorType];
  if (model) {
    return model.findByPk(this.investorId, options);
  }
  return Promise.resolve(null);
};

async function setupRootdataProPostgres() {
  await sequelize.authenticate();
  console.log("rootdatapro Database connection established.");
  await sequelize.sync({ alter: false });
  console.log("rootdatapro Database synchronized.");
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.setupRootdataProPostgres = setupRootdataProPostgres;

module.exports = db;
