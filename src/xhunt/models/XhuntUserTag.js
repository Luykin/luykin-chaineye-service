const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XhuntUserTag = sequelize.define(
    "XhuntUserTag",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Twitter 用户名（小写存储）",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "Twitter 用户 ID（同步自 data.cryptohunt.ai）",
      },
      tagsZh: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: "中文标签列表",
      },
      tagsEn: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: "英文标签列表",
      },
    },
    {
      tableName: "xhunt_user_tags",
      indexes: [
        {
          unique: true,
          fields: ["username"],
          name: "idx_xhunt_user_tags_username_unique",
        },
        {
          fields: ["twitterId"],
          name: "idx_xhunt_user_tags_twitter_id",
        },
      ],
    }
  );

  return XhuntUserTag;
};
