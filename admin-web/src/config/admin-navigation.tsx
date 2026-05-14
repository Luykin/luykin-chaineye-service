import type { ReactNode } from "react";
import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  BugOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  FireOutlined,
  FlagOutlined,
  InboxOutlined,
  LinkOutlined,
  MessageOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StarOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";

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
  { key: "/admin-react/overview", icon: <BarChartOutlined />, label: "数据概览", permission: "overview", group: "main" },
  { key: "/admin-react/dau-details", icon: <FireOutlined />, label: "日活详情", permission: "dau-details", group: "main", implemented: true },
  { key: "/admin-react/online-users", icon: <TeamOutlined />, label: "在线用户", permission: "online-users", group: "main", implemented: true },
  { key: "/admin-react/cohorts", icon: <BarChartOutlined />, label: "留存分析", permission: "cohorts", group: "main", implemented: true },
  { key: "/admin-react/rootdata", icon: <DatabaseOutlined />, label: "RootData", permission: "rootdata", group: "main" },
  { key: "/admin-react/binance-square", icon: <MessageOutlined />, label: "币安广场", group: "main" },
  { key: "/admin-react/notes", icon: <BookOutlined />, label: "备注查看", permission: "notes", group: "main", implemented: true },
  { key: "/admin-react/log-search", icon: <FileSearchOutlined />, label: "日志搜索", permission: "log-search:read", group: "main", implemented: true },
  { key: "/admin-react/device-monitor", icon: <SafetyCertificateOutlined />, label: "设备监控", permission: "device-status:read", group: "main" },
  { key: "/admin-react/version-stats", icon: <BarChartOutlined />, label: "版本统计", permission: "version-stats", group: "main" },
  { key: "/admin-react/url-stats", icon: <LinkOutlined />, label: "接口统计", permission: "url-stats", group: "main" },
  { key: "/admin-react/generic-stats", icon: <AppstoreOutlined />, label: "通用统计", permission: "generic-stats", group: "main", implemented: true },
  { key: "/admin-react/security-violations", icon: <ExclamationCircleOutlined />, label: "安全违规", permission: "security-violations", group: "main" },
  { key: "/admin-react/messages", icon: <InboxOutlined />, label: "站内消息", permission: "messages", group: "main" },
  { key: "/admin-react/reviews-management", icon: <StarOutlined />, label: "点评管理", permission: "reviews-management", group: "main" },
  { key: "/admin-react/perf-monitor", icon: <DashboardOutlinedShim />, label: "性能监控", permission: "perf-monitor", group: "main" },
  { key: "/admin-react/server-command", icon: <CodeOutlined />, label: "服务器命令", permission: "server:execute", group: "main" },
  { key: "/admin-react/daily-report-email", icon: <MailOutlinedShim />, label: "日报发送", permission: "daily-report:send", group: "main" },
  { key: "/admin-react/admin-audit-logs", icon: <AuditOutlined />, label: "操作记录", permission: "audit-logs:read", group: "main", implemented: true },
  { key: "/admin-react/nacos-messages", icon: <MessageOutlined />, label: "公告配置", permission: "nacos-messages", group: "main" },
  { key: "/admin-react/nacos-campaigns", icon: <SettingOutlined />, label: "活动配置", permission: "nacos_config", group: "main" },
  { key: "/admin-react/nacos-tags", icon: <TagsOutlined />, label: "标签配置", permission: "nacos-tags", group: "main" },
  { key: "/admin-react/feature-flags", icon: <FlagOutlined />, label: "Feature Flags", permission: "feature_flags_config", group: "main" },
  { key: "/admin-react/redis-management", icon: <DatabaseOutlined />, label: "Redis 管理", permission: "redis-management", group: "main" },
  { key: "/admin-react/llm-test", icon: <RobotOutlined />, label: "LLM 测试", permission: "llm-test", group: "main" },

  { key: "shortcut-supabase", icon: <DatabaseOutlined />, label: "Supabase", group: "shortcut", external: true, href: "https://supabase.com/dashboard" },
  { key: "shortcut-chrome", icon: <ToolOutlined />, label: "Chrome 控制台", group: "shortcut", external: true, href: "https://chrome.google.com/webstore/devconsole/9d25eceb-fe8d-401a-a54e-08499569b9a3" },
  { key: "shortcut-doc", icon: <BookOutlined />, label: "需求文档", group: "shortcut", external: true, href: "https://docs.google.com/document/d/1W4URRutiCIxtYy8oLgEp8wy9yAzRDbNpIbNeXB2oors/edit?tab=t.0" },
  { key: "shortcut-nacos", icon: <SettingOutlined />, label: "Nacos 配置", group: "shortcut", external: true, href: "https://kb.cryptohunt.ai/nacos/" },
];

// antd icons fallback without adding more imports just for two names
function DashboardOutlinedShim() {
  return <BarChartOutlined />;
}

function MailOutlinedShim() {
  return <MessageOutlined />;
}

export const adminMainNavItems = adminNavItems.filter((item) => item.group === "main");
export const adminShortcutNavItems = adminNavItems.filter((item) => item.group === "shortcut");
