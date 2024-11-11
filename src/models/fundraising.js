const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	const Project = sequelize.define('Project', {
		projectName: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: '项目名称，例如 \'Ripple\' 或 \'TradeBlock\''
		},
		projectLink: {
			type: DataTypes.STRING,
			unique: true,
			allowNull: false,
			comment: '项目详情页链接，用于唯一标识项目'
		},
		description: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '项目描述，简要说明项目内容'
		},
		logo: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '项目 Logo 的 URL'
		},
		round: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '当前融资轮次，例如 \'Series A\', \'M&A\''
		},
		amount: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '原始投资金额，例如 \'$25 M\''
		},
		formattedAmount: {
			type: DataTypes.FLOAT,
			allowNull: true,
			comment: '格式化后的投资金额，浮点数类型，用于计算'
		},
		valuation: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '原始估值金额，例如 \'$250 M\''
		},
		formattedValuation: {
			type: DataTypes.FLOAT,
			allowNull: true,
			comment: '格式化后的估值金额，浮点数类型，用于计算'
		},
		date: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '原始日期字符串，保持原始格式，例如 \'Dec 20, 2019\''
		},
		fundedAt: {
			type: DataTypes.BIGINT,
			allowNull: true,
			comment: '融资日期，格式化为 Date 类型'
		},
		detailFetchedAt: {
			type: DataTypes.BIGINT,
			allowNull: true,
			defaultValue: null,
			comment: '最近一次爬取详情页的时间，用于检查详情是否需要更新'
		},
		isInitial: {
			type: DataTypes.BOOLEAN,
			defaultValue: false,
			comment: '是否为初始抓取'
		},
		socialLinks: {
			type: DataTypes.JSON,
			allowNull: true,
			comment: '社交链接信息，包含官网、Twitter、LinkedIn、博客等链接的 JSON 对象'
		},
		teamMembers: {
			type: DataTypes.JSON,
			allowNull: true,
			comment: '团队成员信息，包括头像、姓名、职位和个人链接等的 JSON 数组'
		}
	}, {
		comment: '项目表，包含每个项目的基本信息以及融资和投资记录',
		timestamps: true, // 启用 createdAt 和 updatedAt 字段
	});
	
	const InvestmentRelationships = sequelize.define('InvestmentRelationships', {
		investorProjectId: {
			type: DataTypes.INTEGER,
			references: {
				model: Project,
				key: 'id'
			},
			allowNull: false,
			comment: '出资方项目的 ID'
		},
		fundedProjectId: {
			type: DataTypes.INTEGER,
			references: {
				model: Project,
				key: 'id'
			},
			allowNull: false,
			comment: '接受投资方项目的 ID'
		},
		round: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '融资轮次，例如 Series A, M&A'
		},
		amount: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '投资金额，例如 $25 M'
		},
		formattedAmount: {
			type: DataTypes.FLOAT,
			allowNull: true,
			comment: '格式化后的投资金额，浮点数类型'
		},
		valuation: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '估值金额，例如 $250 M'
		},
		formattedValuation: {
			type: DataTypes.FLOAT,
			allowNull: true,
			comment: '格式化后的估值，浮点数类型'
		},
		date: {
			type: DataTypes.BIGINT,
			allowNull: true,
			comment: '投资或融资日期'
		},
		lead: {
			type: DataTypes.BOOLEAN,
			defaultValue: false,
			comment: '是否是主导投资人'
		}
	}, {
		timestamps: true, // 启用 createdAt 和 updatedAt 字段
	});
	
	// 设置关联关系
	Project.hasMany(InvestmentRelationships, {
		foreignKey: 'investorProjectId',
		as: 'investmentsGiven' // 出资的项目
	});
	
	Project.hasMany(InvestmentRelationships, {
		foreignKey: 'fundedProjectId',
		as: 'investmentsReceived' // 接受投资的项目
	});
	
	InvestmentRelationships.belongsTo(Project, {
		foreignKey: 'investorProjectId',
		as: 'investorProject' // 出资方
	});
	
	InvestmentRelationships.belongsTo(Project, {
		foreignKey: 'fundedProjectId',
		as: 'fundedProject' // 接受投资方
	});
	
	return { Project, InvestmentRelationships };
};
