const { DataTypes } = require("sequelize");

/**
 * SecurityViolationLog 安全校验失败日志
 *
 * 记录所有未通过安全校验的请求，便于后续排查和可疑行为监控。
 *
 * 建议索引：
 * - created_at：按时间排序与分页
 * - reason_code：按原因筛选
 * - client_ip：定位攻击来源
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "SecurityViolationLog",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        comment: "主键ID",
      },
      reasonCode: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: "reason_code",
        comment: "失败原因编码，例如 missing_headers / invalid_signature",
      },
      errorDetail: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "error_detail",
        comment: "失败的详细说明（可读性更强）",
      },
      requestMethod: {
        type: DataTypes.STRING(10),
        allowNull: false,
        field: "request_method",
        comment: "HTTP 方法",
      },
      requestPath: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: "request_path",
        comment: "请求路径（不包含查询参数）",
      },
      queryString: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "query_string",
        comment: "原始查询字符串",
      },
      clientIp: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: "client_ip",
        comment: "客户端IP",
      },
      headers: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "请求头（已做脱敏处理）",
      },
      requestBody: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "request_body",
        comment: "请求体（字符串化后的截断内容）",
      },
      fingerprint: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "设备指纹",
      },
      extensionVersion: {
        type: DataTypes.STRING(32),
        allowNull: true,
        field: "extension_version",
        comment: "浏览器扩展版本",
      },
      requestTimestamp: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: "request_timestamp",
        comment: "客户端上报的时间戳",
      },
      requestId: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: "request_id",
        comment: "请求ID",
      },
      windowLocationHref: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "window_location_href",
        comment: "页面来源标识",
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "user_agent",
        comment: "User-Agent",
      },
    },
    {
      tableName: "SecurityViolationLogs",
      timestamps: true,
      indexes: [
        {
          name: "idx_security_violation_logs_created_at",
          fields: ["createdAt"],
        },
        {
          name: "idx_security_violation_logs_reason",
          fields: ["reason_code"],
        },
        {
          name: "idx_security_violation_logs_client_ip",
          fields: ["client_ip"],
        },
      ],
    }
  );
};


