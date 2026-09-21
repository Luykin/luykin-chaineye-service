/**
 * PostgreSQL 数据表与连接入口（向后兼容门面 Facade）
 *
 * 历史原因，工程中 70+ 个业务模块直接 require 本文件。
 * 现已模块化拆分至 ./postgres/ 目录：
 * - connection.js: 数据库连接实例 (pgInstance) 与 setupPostgres
 * - registry.js: 集中注册并实例化全部模型
 * - associations/: 按业务域（XHunt核心、认证中心、商业合作、社交监听、热点投票等）独立维护关系
 *
 * 本文件作为统一聚合门面，保持 100% 接口与调用兼容性。
 */
module.exports = require("./postgres");
