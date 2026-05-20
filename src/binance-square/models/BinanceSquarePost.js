const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquarePost",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "币安帖子ID —— 程序传入的唯一标识",
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "作者用户名 —— 程序传入",
      },
      postType: {
        type: DataTypes.ENUM("article", "quote", "reply", "following"),
        allowNull: false,
        comment: "帖子类型 —— 程序传入",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否已删除",
      },
      lastSnapshotId: {
        type: DataTypes.STRING(64),
        comment: "最新镜像批次ID",
      },
      title: {
        type: DataTypes.TEXT,
        comment: "标题 —— API返回，纯图片帖可能为空",
      },
      content: {
        type: DataTypes.TEXT,
        comment: "内容正文 —— API返回，可能为空",
      },
      contentText: {
        type: DataTypes.TEXT,
        comment: "纯文本内容 —— API返回，可能为空",
      },
      mediaUrls: {
        type: DataTypes.JSONB,
        comment: "媒体文件URL数组 —— API返回，可能为空",
      },
      likeCount: {
        type: DataTypes.INTEGER,
        comment: "点赞数 —— API返回，新帖可能为空",
      },
      shareCount: {
        type: DataTypes.INTEGER,
        comment: "分享数 —— API返回，可能为空",
      },
      commentCount: {
        type: DataTypes.INTEGER,
        comment: "评论数 —— API返回，可能为空",
      },
      viewCount: {
        type: DataTypes.INTEGER,
        comment: "浏览数 —— API返回，可能为空",
      },
      publishedAt: {
        type: DataTypes.DATE,
        comment: "发布时间 —— API返回，可能为空",
      },
      sourceUrl: {
        type: DataTypes.TEXT,
        comment: "原文链接 —— API返回，可能为空",
      },
      rawData: {
        type: DataTypes.JSONB,
        comment: "原始API数据",
      },
      score: {
        type: DataTypes.FLOAT,
        comment: "综合热度分",
      },
      viewScore: {
        type: DataTypes.FLOAT,
        comment: "浏览归一化分",
      },
      shareScore: {
        type: DataTypes.FLOAT,
        comment: "分享归一化分",
      },
      commentScore: {
        type: DataTypes.FLOAT,
        comment: "评论归一化分",
      },
      likeScore: {
        type: DataTypes.FLOAT,
        comment: "点赞归一化分",
      },
      freshnessScore: {
        type: DataTypes.FLOAT,
        comment: "新鲜度分",
      },
      scoreDetails: {
        type: DataTypes.JSONB,
        comment: "评分明细：权重、原始值、归一化值、max值等",
      },
      scoreVersion: {
        type: DataTypes.STRING(32),
        comment: "评分公式版本",
      },
      lastScoredAt: {
        type: DataTypes.DATE,
        comment: "最后计算得分时间",
      },
    },
    {
      tableName: "BinanceSquarePosts",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["postId"], name: "idx_binance_square_posts_postid_unique" },
        { fields: ["username"], name: "idx_binance_square_posts_username" },
        { fields: ["postType"], name: "idx_binance_square_posts_type" },
        { fields: ["publishedAt"], name: "idx_binance_square_posts_published" },
        { fields: ["isDeleted"], name: "idx_binance_square_posts_deleted" },
        { fields: ["lastSnapshotId"], name: "idx_binance_square_posts_last_snapshot" },
        { fields: ["score"], name: "idx_binance_square_posts_score" },
        { fields: ["score", "publishedAt"], name: "idx_binance_square_posts_score_published" },
        { fields: ["scoreVersion", "lastScoredAt"], name: "idx_binance_square_posts_score_version_time" },
      ],
    }
  );
};
