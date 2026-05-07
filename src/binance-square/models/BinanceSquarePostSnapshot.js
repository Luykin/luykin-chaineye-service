const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquarePostSnapshot",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "帖子ID",
      },
      snapshotId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "镜像批次ID（格式：YYYYMMDDHHmmss）",
      },
      snapshotTime: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "镜像时间",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "帖子是否已删除",
      },
      title: {
        type: DataTypes.TEXT,
        comment: "标题快照 —— 源数据可能为空",
      },
      content: {
        type: DataTypes.TEXT,
        comment: "内容快照 —— 源数据可能为空",
      },
      contentText: {
        type: DataTypes.TEXT,
        comment: "纯文本快照 —— 源数据可能为空",
      },
      mediaUrls: {
        type: DataTypes.JSONB,
        comment: "媒体URL快照 —— 源数据可能为空",
      },
      likeCount: {
        type: DataTypes.INTEGER,
        comment: "点赞数 —— 源数据可能为空",
      },
      shareCount: {
        type: DataTypes.INTEGER,
        comment: "分享数 —— 源数据可能为空",
      },
      commentCount: {
        type: DataTypes.INTEGER,
        comment: "评论数 —— 源数据可能为空",
      },
      viewCount: {
        type: DataTypes.INTEGER,
        comment: "浏览数 —— 源数据可能为空",
      },
      diffFromPrev: {
        type: DataTypes.JSONB,
        comment: "与上一版本的差异记录 —— 每次抓取时自动计算，无变化时存null",
      },
    },
    {
      tableName: "BinanceSquarePostSnapshots",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["postId", "snapshotId"], name: "idx_binance_square_snapshots_postid_snapshotid_unique" },
        { fields: ["snapshotId"], name: "idx_binance_square_snapshots_snapshot_id" },
        { fields: ["snapshotTime"], name: "idx_binance_square_snapshots_time" },
        { fields: ["postId", "snapshotTime"], name: "idx_binance_square_snapshots_postid_time" },
      ],
    }
  );
};
