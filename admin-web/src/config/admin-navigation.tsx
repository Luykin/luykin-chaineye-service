import type { ReactNode } from "react";
import { LegacySidebarIcon } from "@/components/ui/LegacySidebarIcon";

export interface AdminNavItem {
  key: string;
  icon: ReactNode;
  label: string;
  permission?: string | string[];
  group: "main";
  implemented?: boolean;
  superOnly?: boolean;
  section?: "primary" | "system";
  sidebarGroup?: "data" | "operation" | "monitor" | "dev" | "system";
}

export const adminNavItems: AdminNavItem[] = [
  { key: "/overview", icon: <LegacySidebarIcon name="layout-dashboard" />, label: "数据概览", permission: "overview", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/dau-details", icon: <LegacySidebarIcon name="users" />, label: "日活详情", permission: "dau-details", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/online-users", icon: <LegacySidebarIcon name="activity" />, label: "在线用户", permission: "online-users", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/cohorts", icon: <LegacySidebarIcon name="trending-up" />, label: "留存分析", permission: "cohorts", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/binance-square", icon: <LegacySidebarIcon name="square" />, label: "币安广场", permission: "binance-square", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/binance-square-binding", icon: <LegacySidebarIcon name="link" />, label: "BS绑定监控", permission: "binance-square", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/notes", icon: <LegacySidebarIcon name="file-text" />, label: "备注查看", permission: "notes", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/log-search", icon: <LegacySidebarIcon name="search" />, label: "日志搜索", permission: "log-search:read", group: "main", sidebarGroup: "dev", implemented: true, section: "primary" },
  { key: "/device-monitor", icon: <LegacySidebarIcon name="monitor" />, label: "设备监控", permission: "device-status:read", group: "main", sidebarGroup: "monitor", implemented: true, section: "primary" },
  { key: "/version-stats", icon: <LegacySidebarIcon name="package" />, label: "版本统计", permission: "version-stats", group: "main", sidebarGroup: "monitor", implemented: true, section: "primary" },
  { key: "/url-stats", icon: <LegacySidebarIcon name="link" />, label: "接口统计", permission: "url-stats", group: "main", sidebarGroup: "monitor", implemented: true, section: "primary" },
  { key: "/generic-stats", icon: <LegacySidebarIcon name="clipboard" />, label: "通用统计", permission: "generic-stats", group: "main", sidebarGroup: "data", implemented: true, section: "primary" },
  { key: "/security-violations", icon: <LegacySidebarIcon name="shield" />, label: "安全违规", permission: "security-violations", group: "main", sidebarGroup: "monitor", implemented: true, section: "primary" },
  { key: "/messages", icon: <LegacySidebarIcon name="message" />, label: "站内消息", permission: "messages", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/user-lookup", icon: <LegacySidebarIcon name="search" />, label: "用户查询", permission: ["messages", "vip-management"], group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/reviews-management", icon: <LegacySidebarIcon name="message-circle" />, label: "点评管理", permission: "reviews-management", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/perf-monitor", icon: <LegacySidebarIcon name="zap" />, label: "性能监控", permission: "perf-monitor", group: "main", sidebarGroup: "monitor", implemented: true, section: "primary" },
  { key: "/server-command", icon: <LegacySidebarIcon name="server" />, label: "服务器命令", permission: "server:execute", group: "main", sidebarGroup: "dev", implemented: true, section: "primary" },
  { key: "/auth-center-test", icon: <LegacySidebarIcon name="shield" />, label: "认证中心联调", permission: "llm-test", group: "main", sidebarGroup: "dev", implemented: true, section: "system", superOnly: true },
  { key: "/tampermonkey", icon: <LegacySidebarIcon name="cpu" />, label: "采集脚本", permission: "tampermonkey", group: "main", sidebarGroup: "dev", implemented: true, section: "primary" },
  { key: "/vip-management", icon: <LegacySidebarIcon name="user" />, label: "VIP 管理", permission: "vip-management", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/nacos-messages", icon: <LegacySidebarIcon name="megaphone" />, label: "公告配置", permission: "nacos-messages", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/nacos-campaigns", icon: <LegacySidebarIcon name="target" />, label: "活动配置", permission: "nacos_config", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/nacos-tags", icon: <LegacySidebarIcon name="tag" />, label: "标签配置", permission: "nacos-tags", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/nacos-i18n", icon: <LegacySidebarIcon name="file-text" />, label: "翻译配置", permission: "nacos-i18n", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/nacos-admin", icon: <LegacySidebarIcon name="database" />, label: "Nacos配置中心", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/feature-flags", icon: <LegacySidebarIcon name="toggle" />, label: "功能开关", permission: "feature_flags_config", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/banner-config", icon: <LegacySidebarIcon name="square" />, label: "Banner配置", permission: "banner-config", group: "main", sidebarGroup: "operation", implemented: true, section: "primary" },
  { key: "/redis-management", icon: <LegacySidebarIcon name="database" />, label: "Redis管理", permission: "redis-management", group: "main", sidebarGroup: "dev", implemented: true, section: "system", superOnly: true },
  { key: "/db-admin", icon: <LegacySidebarIcon name="database" />, label: "数据表管理", permission: ["db-admin:read", "db-admin:write"], group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/backup-restore", icon: <LegacySidebarIcon name="database" />, label: "备份恢复", permission: "backup:operate", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/release-deploy", icon: <LegacySidebarIcon name="rocket" />, label: "发布上线", permission: "deploy:release", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/emergency-rollback", icon: <LegacySidebarIcon name="rotate-ccw" />, label: "紧急回滚", permission: "deploy:rollback", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/llm-test", icon: <LegacySidebarIcon name="cpu" />, label: "LLM测试", permission: "llm-test", group: "main", sidebarGroup: "dev", implemented: true, section: "system", superOnly: true },
  { key: "/admin-users", icon: <LegacySidebarIcon name="user" />, label: "管理员列表", permission: "admin-users", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
  { key: "/admin-audit-logs", icon: <LegacySidebarIcon name="clipboard" />, label: "操作记录", permission: "audit-logs:read", group: "main", sidebarGroup: "system", implemented: true, section: "system", superOnly: true },
];

export const adminMainNavItems = adminNavItems;
