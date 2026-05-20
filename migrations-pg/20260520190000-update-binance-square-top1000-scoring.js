'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    // Followings: 支持任意层级用户关注同步、关系失效、批次追踪
    await queryInterface.addColumn('BinanceSquareFollowings', 'followerSquareUid', {
      type: DataTypes.STRING(64),
      comment: '关注者SquareUid —— 用于Top50/100/300扩展源追踪，可能缺失',
    });
    await queryInterface.addColumn('BinanceSquareFollowings', 'isActive', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: '当前关系是否仍有效 —— 每次同步关注列表后维护',
    });
    await queryInterface.addColumn('BinanceSquareFollowings', 'firstSeenAt', {
      type: DataTypes.DATE,
      comment: '首次发现该关注关系的时间',
    });
    await queryInterface.addColumn('BinanceSquareFollowings', 'lastSeenAt', {
      type: DataTypes.DATE,
      comment: '最近一次同步仍看到该关注关系的时间',
    });
    await queryInterface.addColumn('BinanceSquareFollowings', 'lastSyncRunId', {
      type: DataTypes.STRING(64),
      comment: '最近一次关注同步批次ID',
    });

    await queryInterface.sequelize.query(`
      UPDATE "BinanceSquareFollowings"
      SET "firstSeenAt" = COALESCE("firstSeenAt", "createdAt"),
          "lastSeenAt" = COALESCE("lastSeenAt", "updatedAt", "createdAt"),
          "isActive" = COALESCE("isActive", true)
    `);

    await queryInterface.addIndex('BinanceSquareFollowings', {
      fields: ['isActive', 'followingUsername'],
      name: 'idx_binance_square_followings_active_following',
    });
    await queryInterface.addIndex('BinanceSquareFollowings', {
      fields: ['followerUsername', 'isActive'],
      name: 'idx_binance_square_followings_follower_active',
    });
    await queryInterface.addIndex('BinanceSquareFollowings', {
      fields: ['lastSyncRunId'],
      name: 'idx_binance_square_followings_sync_run',
    });

    // TargetRanks: 支持 top50/top100/top300/top1000 多rankSet独立存储
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'rankSet', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'top50',
      comment: '排名集合：top50/top100/top300/top1000',
    });
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'sourceRankSet', {
      type: DataTypes.STRING(32),
      comment: '来源集合：seed/top50/top100/top300',
    });
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'sourceUserCount', {
      type: DataTypes.INTEGER,
      comment: '本次计算使用的来源用户数量',
    });
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'sourceFollowers', {
      type: DataTypes.JSONB,
      comment: '关注该用户的来源用户列表[{username,displayName}]',
    });
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'includedRankSets', {
      type: DataTypes.JSONB,
      comment: '该用户命中的层级集合，例如["top50","top100"]',
    });
    await queryInterface.addColumn('BinanceSquareTargetRanks', 'calculationRunId', {
      type: DataTypes.STRING(64),
      comment: '目标用户计算批次ID',
    });

    await queryInterface.sequelize.query(`
      UPDATE "BinanceSquareTargetRanks"
      SET "sourceRankSet" = COALESCE("sourceRankSet", 'seed'),
          "sourceFollowers" = COALESCE("sourceFollowers", "seedFollowers"),
          "includedRankSets" = COALESCE("includedRankSets", '["top50"]'::jsonb)
    `);

    await queryInterface.addIndex('BinanceSquareTargetRanks', {
      fields: ['rankSet', 'rank'],
      name: 'idx_binance_square_target_ranks_rankset_rank',
    });
    await queryInterface.addIndex('BinanceSquareTargetRanks', {
      fields: ['rankSet', 'username'],
      unique: true,
      name: 'idx_binance_square_target_ranks_rankset_username_unique',
    });
    await queryInterface.addIndex('BinanceSquareTargetRanks', {
      fields: ['calculationRunId'],
      name: 'idx_binance_square_target_ranks_calc_run',
    });

    // Users: 最终Top1000目标排名和关注同步时间
    await queryInterface.addColumn('BinanceSquareUsers', 'targetRank', {
      type: DataTypes.INTEGER,
      comment: '最终目标用户排名（finalTop1000）',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'targetRankSet', {
      type: DataTypes.STRING(32),
      comment: '最终目标用户所属rankSet，一般为top1000',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'lastFollowingSyncedAt', {
      type: DataTypes.DATE,
      comment: '最后同步关注列表时间',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['targetRankSet', 'targetRank'],
      name: 'idx_binance_square_users_target_rankset_rank',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['lastFollowingSyncedAt'],
      name: 'idx_binance_square_users_last_following_synced',
    });

    // Posts: 热度评分字段
    await queryInterface.addColumn('BinanceSquarePosts', 'score', {
      type: DataTypes.FLOAT,
      comment: '综合热度分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'viewScore', {
      type: DataTypes.FLOAT,
      comment: '浏览归一化分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'shareScore', {
      type: DataTypes.FLOAT,
      comment: '分享归一化分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'commentScore', {
      type: DataTypes.FLOAT,
      comment: '评论归一化分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'likeScore', {
      type: DataTypes.FLOAT,
      comment: '点赞归一化分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'freshnessScore', {
      type: DataTypes.FLOAT,
      comment: '新鲜度分',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'scoreDetails', {
      type: DataTypes.JSONB,
      comment: '评分明细：权重、原始值、归一化值、max值等',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'scoreVersion', {
      type: DataTypes.STRING(32),
      comment: '评分公式版本',
    });
    await queryInterface.addColumn('BinanceSquarePosts', 'lastScoredAt', {
      type: DataTypes.DATE,
      comment: '最后计算得分时间',
    });

    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['score'],
      name: 'idx_binance_square_posts_score',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['score', 'publishedAt'],
      name: 'idx_binance_square_posts_score_published',
    });
    await queryInterface.addIndex('BinanceSquarePosts', {
      fields: ['scoreVersion', 'lastScoredAt'],
      name: 'idx_binance_square_posts_score_version_time',
    });

    // 新增配置：冷却、并发、窗口、抓取类型
    await queryInterface.bulkInsert('BinanceSquareConfigs', [
      {
        configKey: 'post_crawl_min_cooldown_minutes',
        configValue: '30',
        description: '帖子抓取完成后的最小冷却时间（分钟）',
        minValue: '0',
        maxValue: '240',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        configKey: 'post_crawl_days_back',
        configValue: '7',
        description: '帖子抓取回溯天数',
        minValue: '1',
        maxValue: '14',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        configKey: 'post_crawl_concurrency',
        configValue: '2',
        description: '帖子抓取用户并发数（初始保守，避免封控）',
        minValue: '1',
        maxValue: '10',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        configKey: 'post_crawl_filter_types',
        configValue: 'ALL,REPLY',
        description: '帖子抓取类型，坤哥确认固定ALL+REPLY',
        minValue: null,
        maxValue: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        configKey: 'post_score_version',
        configValue: 'bs_post_v1',
        description: '帖子评分公式版本',
        minValue: null,
        maxValue: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ], { ignoreDuplicates: true });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('BinanceSquarePosts', 'idx_binance_square_posts_score_version_time').catch(() => {});
    await queryInterface.removeIndex('BinanceSquarePosts', 'idx_binance_square_posts_score_published').catch(() => {});
    await queryInterface.removeIndex('BinanceSquarePosts', 'idx_binance_square_posts_score').catch(() => {});
    await queryInterface.removeColumn('BinanceSquarePosts', 'lastScoredAt');
    await queryInterface.removeColumn('BinanceSquarePosts', 'scoreVersion');
    await queryInterface.removeColumn('BinanceSquarePosts', 'scoreDetails');
    await queryInterface.removeColumn('BinanceSquarePosts', 'freshnessScore');
    await queryInterface.removeColumn('BinanceSquarePosts', 'likeScore');
    await queryInterface.removeColumn('BinanceSquarePosts', 'commentScore');
    await queryInterface.removeColumn('BinanceSquarePosts', 'shareScore');
    await queryInterface.removeColumn('BinanceSquarePosts', 'viewScore');
    await queryInterface.removeColumn('BinanceSquarePosts', 'score');

    await queryInterface.removeIndex('BinanceSquareUsers', 'idx_binance_square_users_last_following_synced').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareUsers', 'idx_binance_square_users_target_rankset_rank').catch(() => {});
    await queryInterface.removeColumn('BinanceSquareUsers', 'lastFollowingSyncedAt');
    await queryInterface.removeColumn('BinanceSquareUsers', 'targetRankSet');
    await queryInterface.removeColumn('BinanceSquareUsers', 'targetRank');

    await queryInterface.removeIndex('BinanceSquareTargetRanks', 'idx_binance_square_target_ranks_calc_run').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareTargetRanks', 'idx_binance_square_target_ranks_rankset_username_unique').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareTargetRanks', 'idx_binance_square_target_ranks_rankset_rank').catch(() => {});
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'calculationRunId');
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'includedRankSets');
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'sourceFollowers');
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'sourceUserCount');
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'sourceRankSet');
    await queryInterface.removeColumn('BinanceSquareTargetRanks', 'rankSet');

    await queryInterface.removeIndex('BinanceSquareFollowings', 'idx_binance_square_followings_sync_run').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareFollowings', 'idx_binance_square_followings_follower_active').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareFollowings', 'idx_binance_square_followings_active_following').catch(() => {});
    await queryInterface.removeColumn('BinanceSquareFollowings', 'lastSyncRunId');
    await queryInterface.removeColumn('BinanceSquareFollowings', 'lastSeenAt');
    await queryInterface.removeColumn('BinanceSquareFollowings', 'firstSeenAt');
    await queryInterface.removeColumn('BinanceSquareFollowings', 'isActive');
    await queryInterface.removeColumn('BinanceSquareFollowings', 'followerSquareUid');
  },
};
