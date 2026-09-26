const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XhuntSpecialUserMarker = sequelize.define(
    "XhuntSpecialUserMarker",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "目标 Twitter 用户名（小写存储，无@）",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: "twitter_id",
        comment: "目标账号 Twitter 数字 ID",
      },
      markerText: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: "marker_text",
        comment: "标记文本，如：疑似诈骗",
      },
      colorPreset: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "danger-red",
        field: "color_preset",
        comment: "预设色系",
      },
      variant: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "subtle",
        comment: "徽章形态: subtle, solid, outline, glow",
      },
      icon: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "none",
        comment: "微型图标: none, shield-alert, alert-triangle, shield-check, badge-check, skull, flame, crown, bot, ban, zap",
      },
      effect: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "none",
        comment: "动画特效: none, pulse",
      },
      customTextColor: {
        type: DataTypes.STRING(32),
        allowNull: true,
        field: "custom_text_color",
        comment: "自定义文字颜色",
      },
      customBgColor: {
        type: DataTypes.STRING(32),
        allowNull: true,
        field: "custom_bg_color",
        comment: "自定义背景颜色",
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: "标记原因或说明备注 (Tooltip展示)",
      },
      linkUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "link_url",
        comment: "详情或佐证链接",
      },
      visibleScope: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "all",
        field: "visible_scope",
        comment: "可见性范围: all(全员可见), whitelist(指定白名单用户可见)",
      },
      visibleTwids: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        field: "visible_twids",
        comment: "指定可见用户的 Twitter ID 字符串数组",
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "是否启用",
      },
      operatorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "operator_id",
        comment: "最后操作人 ID",
      },
      operatorEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "operator_email",
        comment: "最后操作人邮箱",
      },
    },
    {
      tableName: "xhunt_special_user_markers",
      underscored: true,
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["username"],
          name: "idx_special_user_markers_username_unique",
        },
        {
          fields: ["twitter_id"],
          name: "idx_special_user_markers_twitter_id",
        },
        {
          fields: ["enabled"],
          name: "idx_special_user_markers_enabled",
        },
        {
          fields: ["visible_scope"],
          name: "idx_special_user_markers_visible_scope",
        },
      ],
    }
  );

  return XhuntSpecialUserMarker;
};
