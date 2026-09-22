"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. 历史重复留言数据清洗：同一议题下同一推特用户仅保留最新一条留言，清理多余的旧留言
    await queryInterface.sequelize.query(`
      DELETE FROM "XHuntHotVoteComments"
      WHERE id NOT IN (
        SELECT DISTINCT ON ("topicId", "twitterId") id
        FROM "XHuntHotVoteComments"
        ORDER BY "topicId", "twitterId", "createdAt" DESC, "id" DESC
      );
    `);

    // 2. 移除旧的非唯一索引
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS "idx_hot_vote_comments_topic_twitter";'
    );

    // 3. 创建同一议题同一推特用户的唯一索引，从数据库层强制保证单人单议题仅一条留言
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_hot_vote_comments_topic_twitter"
      ON "XHuntHotVoteComments" ("topicId", "twitterId");
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // 回滚：移除唯一索引，恢复非唯一普通索引
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS "uk_hot_vote_comments_topic_twitter";'
    );
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_hot_vote_comments_topic_twitter"
      ON "XHuntHotVoteComments" ("topicId", "twitterId");
    `);
  },
};
