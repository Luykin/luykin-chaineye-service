const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Project = sequelize.define(
    "Project",
    {
      projectName: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "项目名称，例如 'Ripple' 或 'TradeBlock'",
      },
      projectLink: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "项目详情页链接，用于唯一标识项目",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "项目描述，简要说明项目内容",
      },
      logo: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "项目 Logo 的 URL",
      },
      round: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "当前融资轮次，例如 'Series A', 'M&A'",
      },
      amount: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "原始投资金额，例如 '$25 M'",
      },
      formattedAmount: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: "格式化后的投资金额，浮点数类型，用于计算",
      },
      valuation: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "原始估值金额，例如 '$250 M'",
      },
      formattedValuation: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: "格式化后的估值金额，浮点数类型，用于计算",
      },
      date: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "原始日期字符串，保持原始格式，例如 'Dec 20, 2019'",
      },
      fundedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: "融资日期，格式化为 Date 类型",
      },
      detailFetchedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        defaultValue: null,
        comment: "最近一次爬取详情页的时间，用于检查详情是否需要更新",
      },
      detailFailuresNumber: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "抓取详情失败次数",
      },
      isInitial: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否为初始抓取",
      },
      socialLinks: {
        type: DataTypes.JSON,
        allowNull: true,
        comment:
          "社交链接信息，包含官网、Twitter、LinkedIn、博客等链接的 JSON 对象",
      },
      twitterUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Twitter/X 链接，从 socialLinks.x 提取，用于快速查询",
      },
      teamMembers: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "团队成员信息，包括头像、姓名、职位和个人链接等的 JSON 数组",
      },
      originalPageNumber: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "原始在rootdata的页码",
      },
      isVcListed: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null,
        comment: "是否在风险投资者列表中",
      },
      vcListPage: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "在风险投资者列表中的页码",
      },
      updateProgram: {
        type: DataTypes.ENUM(
          "auto_crawler",
          "manual_crawler",
          "auto_api_fix",
          "manual_api_fix",
          "auto_crawler_fix"
        ),
        allowNull: true,
        comment: "记录由哪个程序流程创建或更新",
      },
    },
    {
      comment: "项目表，包含每个项目的基本信息以及融资和投资记录",
      timestamps: true, // 启用 createdAt 和 updatedAt 字段
      indexes: [
        {
          name: "unique_project_link",
          unique: true,
          fields: ["projectLink"],
        },
        {
          name: "idx_twitter_url",
          fields: ["twitterUrl"],
          comment: "Twitter URL 索引，用于快速查询 Twitter 账号",
        },
      ],
      hooks: {
        // 在保存前自动从 socialLinks 提取 twitterUrl
        beforeSave: (instance) => {
          if (instance.socialLinks) {
            const possibleKeys = ["x", "X", "twitter", "Twitter"];
            for (const key of possibleKeys) {
              if (instance.socialLinks[key]) {
                instance.twitterUrl = instance.socialLinks[key];
                break;
              }
            }
          }
        },
      },
    }
  );

  const InvestmentRelationships = sequelize.define(
    "InvestmentRelationships",
    {
      investorProjectId: {
        type: DataTypes.INTEGER,
        references: {
          model: Project,
          key: "id",
        },
        allowNull: false,
        comment: "出资方项目的 ID",
      },
      fundedProjectId: {
        type: DataTypes.INTEGER,
        references: {
          model: Project,
          key: "id",
        },
        allowNull: false,
        comment: "接受投资方项目的 ID",
      },
      round: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "融资轮次，例如 Series A, M&A",
      },
      amount: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "投资金额，例如 $25 M",
      },
      formattedAmount: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: "格式化后的投资金额，浮点数类型",
      },
      valuation: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "估值金额，例如 $250 M",
      },
      formattedValuation: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: "格式化后的估值，浮点数类型",
      },
      date: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: "投资或融资日期",
      },
      lead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否是主导投资人",
      },
      updateProgram: {
        type: DataTypes.ENUM(
          "auto_crawler",
          "manual_crawler",
          "auto_api_fix",
          "manual_api_fix",
          "auto_crawler_fix"
        ),
        allowNull: true,
        comment: "记录由哪个程序流程创建或更新",
      },
    },
    {
      timestamps: true, // 启用 createdAt 和 updatedAt 字段
      indexes: [
        {
          name: "unique_investment_relationship",
          unique: true,
          fields: ["investorProjectId", "fundedProjectId", "round"],
        },
      ],
      hooks: {
        // 在创建或更新前，自动将 null 或空 round 转换为 '--'
        beforeCreate: (instance) => {
          if (!instance.round || instance.round.trim() === "") {
            instance.round = "--";
          }
        },
        beforeUpdate: (instance) => {
          if (!instance.round || instance.round.trim() === "") {
            instance.round = "--";
          }
        },
        beforeBulkCreate: (instances) => {
          instances.forEach((instance) => {
            if (!instance.round || instance.round.trim() === "") {
              instance.round = "--";
            }
          });
        },
      },
    }
  );

  // 人员-组织/项目 职位关系
  const PositionRelationships = sequelize.define(
    "PositionRelationships",
    {
      subjectProjectId: {
        type: DataTypes.INTEGER,
        references: { model: Project, key: "id" },
        allowNull: false,
        comment: "人员(成员)对应的 Project ID",
      },
      objectProjectId: {
        type: DataTypes.INTEGER,
        references: { model: Project, key: "id" },
        allowNull: false,
        comment: "组织/项目 对应的 Project ID",
      },
      position: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "职位信息，例如 'Partner'、'Founder'",
      },
      source: {
        type: DataTypes.ENUM("vc", "project"),
        allowNull: true,
        comment: "来源类型：来自 VC 或 Project 的 team_members",
      },
      updateProgram: {
        type: DataTypes.ENUM(
          "auto_crawler",
          "manual_crawler",
          "auto_api_fix",
          "manual_api_fix",
          "auto_crawler_fix"
        ),
        allowNull: true,
        comment: "记录由哪个程序流程创建或更新",
      },
    },
    {
      timestamps: true,
      indexes: [
        {
          name: "uniq_position_relation",
          unique: true,
          fields: ["subjectProjectId", "objectProjectId", "position"],
        },
        {
          name: "idx_position_object",
          fields: ["objectProjectId"],
        },
        {
          name: "idx_position_subject",
          fields: ["subjectProjectId"],
        },
      ],
    }
  );

  // 设置关联关系
  Project.hasMany(InvestmentRelationships, {
    foreignKey: "investorProjectId",
    as: "investmentsGiven", // 出资的项目
  });

  Project.hasMany(InvestmentRelationships, {
    foreignKey: "fundedProjectId",
    as: "investmentsReceived", // 接受投资的项目
  });

  InvestmentRelationships.belongsTo(Project, {
    foreignKey: "investorProjectId",
    as: "investorProject", // 出资方
  });

  InvestmentRelationships.belongsTo(Project, {
    foreignKey: "fundedProjectId",
    as: "fundedProject", // 接受投资方
  });

  // 职位关系关联
  Project.hasMany(PositionRelationships, {
    foreignKey: "subjectProjectId",
    as: "positionsHeld", // 该成员在各组织/项目担任的职位
  });

  Project.hasMany(PositionRelationships, {
    foreignKey: "objectProjectId",
    as: "members", // 该组织/项目的成员
  });

  PositionRelationships.belongsTo(Project, {
    foreignKey: "subjectProjectId",
    as: "subjectProject", // 成员
  });

  PositionRelationships.belongsTo(Project, {
    foreignKey: "objectProjectId",
    as: "objectProject", // 组织/项目
  });

  return { Project, InvestmentRelationships, PositionRelationships };
};
