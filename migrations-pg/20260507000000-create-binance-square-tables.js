'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    // 1. BinanceSquareUsers（用户主表）
    await queryInterface.createTable('BinanceSquareUsers', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        comment: '自增主键',
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '用户名（如 CZ）—— 程序传入的查询key',
      },
      isSeedUser: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否为种子用户',
      },
      isTargetUser: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否为目标用户(Top50)',
      },
      followScore: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '被关注分数（种子用户关注次数）',
      },
      lastCrawledAt: {
        type: DataTypes.DATE,
        comment: '最后抓取时间 —— 帖子抓取时更新，关注同步时不更新',
      },
      squareUid: {
        type: DataTypes.STRING(64),
        comment: '币安广场用户UID —— API返回，可能缺失',
      },
      displayName: {
        type: DataTypes.STRING(256),
        comment: '显示名称 —— API返回，可能缺失',
      },
      avatar: {
        type: DataTypes.TEXT,
        comment: '头像URL —— API返回，可能缺失',
      },
      biography: {
        type: DataTypes.TEXT,
        comment: '个人简介 —— API返回，可能缺失',
      },
      role: {
        type: DataTypes.INTEGER,
        comment: '角色标识 —— API返回，可能缺失',
      },
      verificationType: {
        type: DataTypes.INTEGER,
        comment: '认证类型 —— API返回，可能缺失',
      },
      verificationDescription: {
        type: DataTypes.STRING(256),
        comment: '认证描述 —— API返回，可能缺失',
      },
      totalFollowerCount: {
        type: DataTypes.INTEGER,
        comment: '粉丝总数 —— API返回，可能缺失',
      },
      totalFollowingCount: {
        type: DataTypes.INTEGER,
        comment: '关注总数 —— API返回，可能缺失',
      },
      totalPostCount: {
        type: DataTypes.INTEGER,
        comment: '帖子总数 —— API返回，可能缺失',
      },
      totalLikeCount: {
        type: DataTypes.INTEGER,
        comment: '获赞总数 —— API返回，可能缺失',
      },
      totalShareCount: {
        type: DataTypes.INTEGER,
        comment: '被分享总数 —— API返回，可能缺失',
      },
      accountLang: {
        type: DataTypes.STRING(16),
        comment: '账号语言 —— API返回，可能缺失',
      },
      isKol: {
        type: DataTypes.BOOLEAN,
        comment: '是否KOL —— API返回，可能缺失',
      },
      userStatus: {
        type: DataTypes.INTEGER,
        comment: '用户状态 —— API返回，可能缺失',
      },
      level: {
        type: DataTypes.INTEGER,
        comment: '用户等级 —— API返回，可能缺失',
      },
      rawData: {
        type: DataTypes.JSONB,
        comment: '原始API响应数据（完整备份）—— API异常时用于排查',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareUsers', {
      unique: true,
      fields: ['username'],
      name: 'idx_binance_square_users_username_unique',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['squareUid'],
      name: 'idx_binance_square_users_square_uid',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['isSeedUser'],
      name: 'idx_binance_square_users_is_seed',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['isTargetUser'],
      name: 'idx_binance_square_users_is_target',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['followScore'],
      name: 'idx_binance_square_users_follow_score',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['lastCrawledAt'],
      name: 'idx_binance_square_users_last_crawled',
    });

    // 2. BinanceSquareFollowings（关注关系表）
    await queryInterface.createTable('BinanceSquareFollowings', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      followerUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '关注者用户名（种子用户）',
      },
      followingUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '被关注者用户名',
      },
      followingSquareUid: {
        type: DataTypes.STRING(64),
        comment: '被关注者SquareUid —— API返回，可能缺失',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareFollowings', {
      unique: true,
      fields: ['followerUsername', 'followingUsername'],
      name: 'idx_binance_square_followings_unique',
    });
    await queryInterface.addIndex('BinanceSquareFollowings', {
      fields: ['followerUsername'],
      name: 'idx_binance_square_followings_follower',
    });
    await queryInterface.addIndex('BinanceSquareFollowings', {
      fields: ['followingUsername'],
      name: 'idx_binance_square_followings_following',
    });

    // 3. BinanceSquareSeedConfigs（种子用户配置表）
    await queryInterface.createTable('BinanceSquareSeedConfigs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '用户名 —— 手动配置时必须提供',
      },
      displayName: {
        type: DataTypes.STRING(256),
        comment: '显示名称 —— 可选',
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '排序权重',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: '是否激活',
      },
      description: {
        type: DataTypes.TEXT,
        comment: '备注说明',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareSeedConfigs', {
      unique: true,
      fields: ['username'],
      name: 'idx_binance_square_seed_configs_username_unique',
    });
    await queryInterface.addIndex('BinanceSquareSeedConfigs', {
      fields: ['isActive', 'sortOrder'],
      name: 'idx_binance_square_seed_configs_active_sort',
    });

    // 4. BinanceSquareTargetRanks（目标用户排名表）
    await queryInterface.createTable('BinanceSquareTargetRanks', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '目标用户用户名',
      },
      rank: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '排名(1-50)',
      },
      followerCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '被种子用户关注次数',
      },
      lastCalculatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: '最后计算时间',
      },
      seedFollowers: {
        type: DataTypes.JSONB,
        comment: '关注该用户的种子用户列表[{username,displayName}] —— 聚合时生成',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareTargetRanks', {
      fields: ['rank'],
      name: 'idx_binance_square_target_ranks_rank',
    });
    await queryInterface.addIndex('BinanceSquareTargetRanks', {
      fields: ['lastCalculatedAt'],
      name: 'idx_binance_square_target_ranks_calc_time',
    });

    // 5. BinanceSquarePosts（帖子主表）
    await queryInterface.createTable('BinanceSquarePosts', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '币安帖子ID —— 程序传入的唯一标识',
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '作者用户名 —— 程序传入',
      },
      postType: {
        type: DataTypes.ENUM('article', 'quote', 'reply', 'following'),
        allowNull: false,
        comment: '帖子类型 —— 程序传入',
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否已删除',
      },
      lastSnapshotId: {
        type: DataTypes.STRING(64),
        comment: '最新镜像批次ID',
      },
      title: {
        type: DataTypes.TEXT,
        comment: '标题 —— API返回，纯图片帖可能为空',
      },
      content: {
        type: DataTypes.TEXT,
        comment: '内容正文 —— API返回，可能为空',
      },
      contentText: {
        type: DataTypes.TEXT,
        comment: '纯文本内容 —— API返回，可能为空',
      },
      mediaUrls: {
        type: DataTypes.JSONB,
        comment: '媒体文件URL数组 —— API返回，可能为空',
      },
      likeCount: {
        type: DataTypes.INTEGER,
        comment: '点赞数 —— API返回，新帖可能为空',
      },
      shareCount: {
        type: DataTypes.INTEGER,
        comment: '分享数 —— API返回，可能为空',
      },
      commentCount: {
        type: DataTypes.INTEGER,
        comment: '评论数 —— API返回，可能为空',
      },
      viewCount: {
        type: DataTypes.INTEGER,
        comment: '浏览数 —— API返回，可能为空',
      },
      publishedAt: {
        type: DataTypes.DATE,
        comment: '发布时间 —— API返回，可能为空',
      },
      sourceUrl: {
        type: DataTypes.TEXT,
        comment: '原文链接 —— API返回，可能为空',
      },
      rawData: {
        type: DataTypes.JSONB,
        comment: '原始API数据',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquarePosts', {
      unique: true,
      fields: ['postId'],
      name: 'idx_binance_square_posts_postid_unique',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['username'],
      name: 'idx_binance_square_posts_username',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['postType'],
      name: 'idx_binance_square_posts_type',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['publishedAt'],
      name: 'idx_binance_square_posts_published',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['isDeleted'],
      name: 'idx_binance_square_posts_deleted',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['lastSnapshotId'],
      name: 'idx_binance_square_posts_last_snapshot',
    });

    // 6. BinanceSquarePostSnapshots（帖子镜像表）
    await queryInterface.createTable('BinanceSquarePostSnapshots', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '帖子ID',
      },
      snapshotId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '镜像批次ID（格式：YYYYMMDDHHmmss）',
      },
      snapshotTime: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: '镜像时间',
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '帖子是否已删除',
      },
      title: {
        type: DataTypes.TEXT,
        comment: '标题快照 —— 源数据可能为空',
      },
      content: {
        type: DataTypes.TEXT,
        comment: '内容快照 —— 源数据可能为空',
      },
      contentText: {
        type: DataTypes.TEXT,
        comment: '纯文本快照 —— 源数据可能为空',
      },
      mediaUrls: {
        type: DataTypes.JSONB,
        comment: '媒体URL快照 —— 源数据可能为空',
      },
      likeCount: {
        type: DataTypes.INTEGER,
        comment: '点赞数 —— 源数据可能为空',
      },
      shareCount: {
        type: DataTypes.INTEGER,
        comment: '分享数 —— 源数据可能为空',
      },
      commentCount: {
        type: DataTypes.INTEGER,
        comment: '评论数 —— 源数据可能为空',
      },
      viewCount: {
        type: DataTypes.INTEGER,
        comment: '浏览数 —— 源数据可能为空',
      },
      diffFromPrev: {
        type: DataTypes.JSONB,
        comment: '与上一版本的差异记录 —— 每次抓取时自动计算，无变化时存null',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquarePostSnapshots', {
      unique: true,
      fields: ['postId', 'snapshotId'],
      name: 'idx_binance_square_snapshots_postid_snapshotid_unique',
    });
    await queryInterface.addIndex('BinanceSquarePostSnapshots', {
      fields: ['snapshotId'],
      name: 'idx_binance_square_snapshots_snapshot_id',
    });
    await queryInterface.addIndex('BinanceSquarePostSnapshots', {
      fields: ['snapshotTime'],
      name: 'idx_binance_square_snapshots_time',
    });
    await queryInterface.addIndex('BinanceSquarePostSnapshots', {
      fields: ['postId', 'snapshotTime'],
      name: 'idx_binance_square_snapshots_postid_time',
    });

    // 7. BinanceSquareCrawlLogs（爬取日志表）
    await queryInterface.createTable('BinanceSquareCrawlLogs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      taskType: {
        type: DataTypes.ENUM('following', 'post', 'target_calculate'),
        allowNull: false,
        comment: '任务类型',
      },
      status: {
        type: DataTypes.ENUM('success', 'failed', 'partial'),
        allowNull: false,
        comment: '执行状态',
      },
      targetId: {
        type: DataTypes.STRING(128),
        comment: '目标标识（用户名/帖子ID）—— target_calculate任务无此字段',
      },
      filterType: {
        type: DataTypes.ENUM('ALL', 'REPLY', 'QUOTE'),
        comment: '帖子抓取的filterType —— 非帖子任务为空',
      },
      errorMessage: {
        type: DataTypes.TEXT,
        comment: '错误信息 —— 失败时记录',
      },
      durationMs: {
        type: DataTypes.INTEGER,
        comment: '耗时毫秒 —— 失败时可能为空',
      },
      itemsCount: {
        type: DataTypes.INTEGER,
        comment: '抓取项目数 —— 失败时可能为空',
      },
      snapshotId: {
        type: DataTypes.STRING(64),
        comment: '关联镜像批次ID —— 非帖子任务为空',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareCrawlLogs', {
      fields: ['taskType', 'status'],
      name: 'idx_binance_square_logs_task_status',
    });
    await queryInterface.addIndex('BinanceSquareCrawlLogs', {
      fields: ['filterType'],
      name: 'idx_binance_square_logs_filter_type',
    });
    await queryInterface.addIndex('BinanceSquareCrawlLogs', {
      fields: ['targetId'],
      name: 'idx_binance_square_logs_target',
    });
    await queryInterface.addIndex('BinanceSquareCrawlLogs', {
      fields: ['snapshotId'],
      name: 'idx_binance_square_logs_snapshot',
    });
    await queryInterface.addIndex('BinanceSquareCrawlLogs', {
      fields: ['createdAt'],
      name: 'idx_binance_square_logs_created',
    });

    // 8. BinanceSquareConfigs（爬虫配置表）
    await queryInterface.createTable('BinanceSquareConfigs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      configKey: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '配置项key',
      },
      configValue: {
        type: DataTypes.STRING(256),
        allowNull: false,
        comment: '配置项value（字符串存储，使用时转换）',
      },
      description: {
        type: DataTypes.TEXT,
        comment: '配置说明',
      },
      minValue: {
        type: DataTypes.STRING(64),
        comment: '最小值（用于前端校验，数字类型时）',
      },
      maxValue: {
        type: DataTypes.STRING(64),
        comment: '最大值（用于前端校验，数字类型时）',
      },
      updatedBy: {
        type: DataTypes.STRING(128),
        comment: '最后修改人（admin邮箱）',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('BinanceSquareConfigs', {
      unique: true,
      fields: ['configKey'],
      name: 'idx_binance_square_configs_key_unique',
    });

    // 插入默认配置
    await queryInterface.bulkInsert('BinanceSquareConfigs', [
      {
        configKey: 'post_crawl_interval_hours',
        configValue: '2',
        description: '帖子抓取间隔（小时）',
        minValue: '0.5',
        maxValue: '4',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        configKey: 'snapshot_retention_days',
        configValue: '3',
        description: '镜像保留天数',
        minValue: '1',
        maxValue: '7',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('BinanceSquareConfigs');
    await queryInterface.dropTable('BinanceSquareCrawlLogs');
    await queryInterface.dropTable('BinanceSquarePostSnapshots');
    await queryInterface.dropTable('BinanceSquarePosts');
    await queryInterface.dropTable('BinanceSquareTargetRanks');
    await queryInterface.dropTable('BinanceSquareSeedConfigs');
    await queryInterface.dropTable('BinanceSquareFollowings');
    await queryInterface.dropTable('BinanceSquareUsers');
  },
};
