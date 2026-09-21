'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('XHuntHotVoteTopics', {
      id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        comment: '议题唯一ID',
      },
      title: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: '纯文本标题 (限100字)',
      },
      titleHtml: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '富文本标题 (限1000字符，白名单HTML标签)',
      },
      summary: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: '一句话核心冲突介绍 (限100字)',
      },
      topicType: {
        type: DataTypes.ENUM('person_pk', 'general_topic'),
        defaultValue: 'person_pk',
        comment: '议题形式: 人物PK / 普通议题',
      },
      options: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: '选项定义: [{ id, name, avatar, twitterHandle, color, isGua }]',
      },
      displayDomains: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: Sequelize.literal("ARRAY['web3']::varchar[]"),
        comment: "可见领域: ['web3', 'ai']",
      },
      displayLanguages: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: Sequelize.literal("ARRAY['zh']::varchar[]"),
        comment: "可见语言: ['zh', 'en']",
      },
      testingPhase: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: '是否处于测试阶段 (测试阶段仅对 testList 可见)',
      },
      testList: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: Sequelize.literal('ARRAY[]::varchar[]'),
        comment: '内部测试人员名单 (Twitter handle 或 ID 列表)',
      },
      maxRevotes: {
        type: DataTypes.INTEGER,
        defaultValue: 2,
        comment: '允许修改选择的最大次数 (默认2次)',
      },
      status: {
        type: DataTypes.ENUM('draft', 'published', 'ended', 'archived'),
        defaultValue: 'draft',
        comment: '议题状态',
      },
      sortWeight: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '排序权重 (数值大者优先展示)',
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: '议题开始时间',
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: '议题结束时间',
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

    await queryInterface.addIndex('XHuntHotVoteTopics', {
      fields: ['status', 'sortWeight'],
      name: 'idx_xhunt_hot_vote_topics_status_sort_weight',
    });
    await queryInterface.addIndex('XHuntHotVoteTopics', {
      fields: ['testingPhase'],
      name: 'idx_xhunt_hot_vote_topics_testing_phase',
    });
    await queryInterface.addIndex('XHuntHotVoteTopics', {
      fields: ['createdAt'],
      name: 'idx_xhunt_hot_vote_topics_created_at',
    });

    await queryInterface.createTable('XHuntHotVoteRecords', {
      id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      topicId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntHotVoteTopics',
          key: 'id',
        },
        comment: '所属议题ID',
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '推特唯一ID (唯一身份标识，不依赖登录)',
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'XHuntUsers',
          key: 'id',
        },
        comment: 'XHunt 用户 ID (若已登录则关联)',
      },
      optionId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '当前支持的选项ID',
      },
      previousOptionId: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '上一次支持的选项ID',
      },
      revoteCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '已修改次数',
      },
      clientIp: {
        type: DataTypes.STRING(64),
        allowNull: true,
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

    await queryInterface.addIndex('XHuntHotVoteRecords', {
      fields: ['topicId', 'twitterId'],
      unique: true,
      name: 'uk_hot_vote_topic_twitter_id',
    });
    await queryInterface.addIndex('XHuntHotVoteRecords', {
      fields: ['topicId', 'optionId'],
      name: 'idx_xhunt_hot_vote_records_topic_option',
    });
    await queryInterface.addIndex('XHuntHotVoteRecords', {
      fields: ['twitterId'],
      name: 'idx_xhunt_hot_vote_records_twitter_id',
    });

    await queryInterface.createTable('XHuntHotVoteComments', {
      id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      topicId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntHotVoteTopics',
          key: 'id',
        },
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '留言者推特ID (用户索引与投票身份严格对应)',
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntUsers',
          key: 'id',
        },
        comment: '必须登录才能留言',
      },
      userName: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      displayName: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      userAvatar: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      content: {
        type: DataTypes.STRING(200),
        allowNull: false,
        comment: '留言内容 (脱敏纯文本，限200字)',
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '管理员屏蔽',
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

    await queryInterface.addIndex('XHuntHotVoteComments', {
      fields: ['topicId', 'createdAt'],
      name: 'idx_hot_vote_comments_topic_created',
    });
    await queryInterface.addIndex('XHuntHotVoteComments', {
      fields: ['twitterId'],
      name: 'idx_hot_vote_comments_twitter_id',
    });
    await queryInterface.addIndex('XHuntHotVoteComments', {
      fields: ['topicId', 'twitterId'],
      name: 'idx_hot_vote_comments_topic_twitter',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('XHuntHotVoteComments');
    await queryInterface.dropTable('XHuntHotVoteRecords');
    await queryInterface.dropTable('XHuntHotVoteTopics');
  },
};
