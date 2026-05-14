import type { ReactNode } from "react";
import { LegacySidebarIcon } from "@/components/ui/LegacySidebarIcon";

export interface AdminNavItem {
  key: string;
  icon: ReactNode;
  label: string;
  permission?: string;
  external?: boolean;
  href?: string;
  group: "main" | "shortcut";
  implemented?: boolean;
}

export const adminNavItems: AdminNavItem[] = [
  { key: "/admin-react/overview", icon: <LegacySidebarIcon name="layout-dashboard" />, label: "数据概览", permission: "overview", group: "main", implemented: true },
  { key: "/admin-react/dau-details", icon: <LegacySidebarIcon name="users" />, label: "日活详情", permission: "dau-details", group: "main", implemented: true },
  { key: "/admin-react/online-users", icon: <LegacySidebarIcon name="activity" />, label: "在线用户", permission: "online-users", group: "main", implemented: true },
  { key: "/admin-react/cohorts", icon: <LegacySidebarIcon name="trending-up" />, label: "留存分析", permission: "cohorts", group: "main", implemented: true },
  { key: "/admin-react/rootdata", icon: <LegacySidebarIcon name="database" />, label: "RootData", permission: "rootdata", group: "main", implemented: true },
  { key: "/admin-react/binance-square", icon: <LegacySidebarIcon name="square" />, label: "币安广场", permission: "binance-square", group: "main", implemented: true },
  { key: "/admin-react/notes", icon: <LegacySidebarIcon name="file-text" />, label: "备注查看", permission: "notes", group: "main", implemented: true },
  { key: "/admin-react/log-search", icon: <LegacySidebarIcon name="search" />, label: "日志搜索", permission: "log-search:read", group: "main", implemented: true },
  { key: "/admin-react/device-monitor", icon: <LegacySidebarIcon name="monitor" />, label: "设备监控", permission: "device-status:read", group: "main", implemented: true },
  { key: "/admin-react/version-stats", icon: <LegacySidebarIcon name="package" />, label: "版本统计", permission: "version-stats", group: "main", implemented: true },
  { key: "/admin-react/url-stats", icon: <LegacySidebarIcon name="link" />, label: "接口统计", permission: "url-stats", group: "main", implemented: true },
  { key: "/admin-react/generic-stats", icon: <LegacySidebarIcon name="clipboard" />, label: "通用统计", permission: "generic-stats", group: "main", implemented: true },
  { key: "/admin-react/security-violations", icon: <LegacySidebarIcon name="shield" />, label: "安全违规", permission: "security-violations", group: "main", implemented: true },
  { key: "/admin-react/messages", icon: <LegacySidebarIcon name="message" />, label: "站内消息", permission: "messages", group: "main", implemented: true },
  { key: "/admin-react/reviews-management", icon: <LegacySidebarIcon name="message-circle" />, label: "点评管理", permission: "reviews-management", group: "main", implemented: true },
  { key: "/admin-react/perf-monitor", icon: <LegacySidebarIcon name="zap" />, label: "性能监控", permission: "perf-monitor", group: "main", implemented: true },
  { key: "/admin-react/server-command", icon: <LegacySidebarIcon name="server" />, label: "服务器命令", permission: "server:execute", group: "main", implemented: true },
  { key: "/admin-react/daily-report-email", icon: <LegacySidebarIcon name="message" />, label: "日报发送", permission: "daily-report:send", group: "main" },
  { key: "/admin-react/admin-audit-logs", icon: <LegacySidebarIcon name="clipboard" />, label: "操作记录", permission: "audit-logs:read", group: "main", implemented: true },
  { key: "/admin-react/nacos-messages", icon: <LegacySidebarIcon name="megaphone" />, label: "公告配置", permission: "nacos-messages", group: "main", implemented: true },
  { key: "/admin-react/nacos-campaigns", icon: <LegacySidebarIcon name="target" />, label: "活动配置", permission: "nacos_config", group: "main", implemented: true },
  { key: "/admin-react/nacos-tags", icon: <LegacySidebarIcon name="tag" />, label: "标签配置", permission: "nacos-tags", group: "main", implemented: true },
  { key: "/admin-react/feature-flags", icon: <LegacySidebarIcon name="toggle" />, label: "Feature Flags", permission: "feature_flags_config", group: "main" },
  { key: "/admin-react/redis-management", icon: <LegacySidebarIcon name="database" />, label: "Redis 管理", permission: "redis-management", group: "main" },
  { key: "/admin-react/llm-test", icon: <LegacySidebarIcon name="cpu" />, label: "LLM 测试", permission: "llm-test", group: "main" },

  { key: "shortcut-supabase", icon: <LegacySidebarIcon name="database" />, label: "Supabase", group: "shortcut", external: true, href: "https://supabase.com/dashboard" },
  { key: "shortcut-chrome", icon: <LegacySidebarIcon name="monitor" />, label: "Chrome 控制台", group: "shortcut", external: true, href: "https://chrome.google.com/webstore/devconsole/9d25eceb-fe8d-401a-a54e-08499569b9a3" },
  { key: "shortcut-doc", icon: <LegacySidebarIcon name="file-text" />, label: "需求文档", group: "shortcut", external: true, href: "https://docs.google.com/document/d/1W4URRutiCIxtYy8oLgEp8wy9yAzRDbNpIbNeXB2oors/edit?tab=t.0" },
  { key: "shortcut-nacos", icon: <LegacySidebarIcon name="target" />, label: "Nacos 配置", group: "shortcut", external: true, href: "https://kb.cryptohunt.ai/nacos/" },
];

export const adminMainNavItems = adminNavItems.filter((item) => item.group === "main");
export const adminShortcutNavItems = adminNavItems.filter((item) => item.group === "shortcut");
