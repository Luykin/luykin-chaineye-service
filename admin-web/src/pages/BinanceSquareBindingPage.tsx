import { Alert, Card, Input, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useState } from "react";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyActionButton, LegacyMetricCard } from "@/components/ui/LegacyAdmin";
import {
  fetchBinanceSquareBindingChallenges,
  fetchBinanceSquareBindingEvents,
  fetchBinanceSquareBindingOverview,
  fetchBinanceSquareBindings,
  fetchBinanceSquareProgress,
  fetchBinanceSquareStatus,
} from "@/services/binance-square";
import type {
  BinanceSquareBindingChallengeItem,
  BinanceSquareBindingEventItem,
  BinanceSquareBindingItem,
} from "@/types/binance-square";

const TABLE_MAX_HEIGHT = 520;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const CHALLENGE_STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "待验证", value: "pending" },
  { label: "已验证", value: "verified" },
  { label: "验证失败", value: "failed" },
  { label: "已过期", value: "expired" },
  { label: "已取消", value: "cancelled" },
];

const BINDING_STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "已绑定", value: "active" },
  { label: "已解绑", value: "revoked" },
];

const EVENT_TYPE_OPTIONS = [
  { label: "全部事件", value: "" },
  { label: "绑定", value: "bind" },
  { label: "换绑", value: "rebind" },
  { label: "解绑", value: "unbind" },
  { label: "验证失败", value: "verify_failed" },
];

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
}

function formatDuration(ms?: number | null) {
  if (!ms && ms !== 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

function statusTag(status?: string | null, type: "challenge" | "binding" | "event" = "challenge") {
  const value = status || "unknown";
  const challengeMap: Record<string, { color: string; label: string }> = {
    pending: { color: "processing", label: "待验证" },
    verified: { color: "success", label: "已验证" },
    failed: { color: "error", label: "失败" },
    expired: { color: "default", label: "过期" },
    cancelled: { color: "warning", label: "取消" },
  };
  const bindingMap: Record<string, { color: string; label: string }> = {
    active: { color: "success", label: "已绑定" },
    revoked: { color: "default", label: "已解绑" },
  };
  const eventMap: Record<string, { color: string; label: string }> = {
    bind: { color: "success", label: "绑定" },
    rebind: { color: "processing", label: "换绑" },
    unbind: { color: "default", label: "解绑" },
    verify_failed: { color: "error", label: "验证失败" },
  };
  const map = type === "binding" ? bindingMap : type === "event" ? eventMap : challengeMap;
  const option = map[value] || { color: "default", label: value };
  return <Tag color={option.color}>{option.label}</Tag>;
}

function safeJson(value?: Record<string, unknown> | null) {
  if (!value) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function postLink(url?: string | null, label = "查看帖子") {
  if (!url) return "-";
  return (
    <Typography.Link href={url} target="_blank" rel="noreferrer">
      <LinkOutlined /> {label}
    </Typography.Link>
  );
}

function profileLink(username?: string | null) {
  if (!username) return "-";
  return (
    <Typography.Link href={`https://www.binance.com/zh-CN/square/profile/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer">
      @{username}
    </Typography.Link>
  );
}

interface ChallengeFilters {
  page: number;
  pageSize: number;
  status: string;
  twitterId: string;
  twitterUsername: string;
  verificationCode: string;
}

interface BindingFilters {
  page: number;
  pageSize: number;
  status: string;
  twitterId: string;
  twitterUsername: string;
  binanceSquareUid: string;
  binanceUsername: string;
  verificationCode: string;
}

interface EventFilters {
  page: number;
  pageSize: number;
  eventType: string;
  twitterId: string;
}

const initialChallengeFilters: ChallengeFilters = {
  page: 1,
  pageSize: 20,
  status: "",
  twitterId: "",
  twitterUsername: "",
  verificationCode: "",
};

const initialBindingFilters: BindingFilters = {
  page: 1,
  pageSize: 20,
  status: "",
  twitterId: "",
  twitterUsername: "",
  binanceSquareUid: "",
  binanceUsername: "",
  verificationCode: "",
};

const initialEventFilters: EventFilters = {
  page: 1,
  pageSize: 20,
  eventType: "",
  twitterId: "",
};

export function BinanceSquareBindingPage() {
  const [activeTab, setActiveTab] = useState("challenges");
  const [challengeFilters, setChallengeFilters] = useState<ChallengeFilters>(initialChallengeFilters);
  const [bindingFilters, setBindingFilters] = useState<BindingFilters>(initialBindingFilters);
  const [eventFilters, setEventFilters] = useState<EventFilters>(initialEventFilters);

  const overviewQuery = useQuery({
    queryKey: ["binance-square-binding-overview"],
    queryFn: fetchBinanceSquareBindingOverview,
    refetchInterval: 15_000,
  });
  const statusQuery = useQuery({
    queryKey: ["binance-square-crawl-status", "binding-page"],
    queryFn: fetchBinanceSquareStatus,
    refetchInterval: 10_000,
  });
  const progressQuery = useQuery({
    queryKey: ["binance-square-crawl-progress", "binding-page"],
    queryFn: fetchBinanceSquareProgress,
    refetchInterval: 10_000,
  });
  const challengesQuery = useQuery({
    queryKey: ["binance-square-binding-challenges", challengeFilters],
    queryFn: () => fetchBinanceSquareBindingChallenges(challengeFilters),
  });
  const bindingsQuery = useQuery({
    queryKey: ["binance-square-bindings", bindingFilters],
    queryFn: () => fetchBinanceSquareBindings(bindingFilters),
    enabled: activeTab === "bindings",
  });
  const eventsQuery = useQuery({
    queryKey: ["binance-square-binding-events", eventFilters],
    queryFn: () => fetchBinanceSquareBindingEvents(eventFilters),
    enabled: activeTab === "events",
  });

  const overview = overviewQuery.data?.data;
  const crawlStatus = statusQuery.data?.data;
  const crawlProgress = progressQuery.data?.data;

  const refreshAll = () => {
    overviewQuery.refetch();
    statusQuery.refetch();
    progressQuery.refetch();
    challengesQuery.refetch();
    bindingsQuery.refetch();
    eventsQuery.refetch();
  };

  const challengeColumns: ColumnsType<BinanceSquareBindingChallengeItem> = [
    { title: "ID", dataIndex: "id", key: "id", width: 76, fixed: "left" },
    {
      title: "Twitter 用户",
      key: "twitter",
      width: 190,
      fixed: "left",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.twitterUsername ? `@${record.twitterUsername}` : "-"}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: record.twitterId }}>{record.twitterId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "验证码",
      dataIndex: "verificationCode",
      key: "verificationCode",
      width: 140,
      render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
    },
    {
      title: "发帖文案",
      dataIndex: "verificationText",
      key: "verificationText",
      width: 360,
      render: (value: string) => (
        <Typography.Paragraph className="bs-binding-copy" copyable={{ text: value }} ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}>
          {value}
        </Typography.Paragraph>
      ),
    },
    { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value) => statusTag(value) },
    { title: "尝试", dataIndex: "attemptCount", key: "attemptCount", width: 80 },
    { title: "最近尝试", dataIndex: "lastAttemptAt", key: "lastAttemptAt", width: 170, render: formatDateTime },
    { title: "过期时间", dataIndex: "expiresAt", key: "expiresAt", width: 170, render: formatDateTime },
    { title: "验证时间", dataIndex: "verifiedAt", key: "verifiedAt", width: 170, render: formatDateTime },
    { title: "帖子", dataIndex: "lastPostUrl", key: "lastPostUrl", width: 130, render: (value) => postLink(value) },
    {
      title: "最近错误",
      key: "error",
      width: 260,
      render: (_, record) => record.lastErrorCode || record.lastErrorMessage ? (
        <Tooltip title={record.lastErrorMessage || record.lastErrorCode}>
          <Typography.Text type="danger" ellipsis>{record.lastErrorCode || record.lastErrorMessage}</Typography.Text>
        </Tooltip>
      ) : "-",
    },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
  ];

  const bindingColumns: ColumnsType<BinanceSquareBindingItem> = [
    { title: "ID", dataIndex: "id", key: "id", width: 76, fixed: "left" },
    {
      title: "Twitter 用户",
      key: "twitter",
      width: 190,
      fixed: "left",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.twitterUsername ? `@${record.twitterUsername}` : "-"}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: record.twitterId }}>{record.twitterId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Binance Square",
      key: "binance",
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.binanceDisplayName || profileLink(record.binanceUsername)}</Typography.Text>
          <Space size={6}>
            {profileLink(record.binanceUsername)}
            <Typography.Text type="secondary" copyable={{ text: record.binanceSquareUid }}>{record.binanceSquareUid}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value) => statusTag(value, "binding") },
    {
      title: "验证码",
      dataIndex: "verificationCode",
      key: "verificationCode",
      width: 140,
      render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
    },
    { title: "验证帖子", dataIndex: "verificationPostUrl", key: "verificationPostUrl", width: 130, render: (value) => postLink(value) },
    { title: "绑定时间", dataIndex: "verifiedAt", key: "verifiedAt", width: 170, render: formatDateTime },
    { title: "解绑时间", dataIndex: "revokedAt", key: "revokedAt", width: 170, render: formatDateTime },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
  ];

  const eventColumns: ColumnsType<BinanceSquareBindingEventItem> = [
    { title: "ID", dataIndex: "id", key: "id", width: 76, fixed: "left" },
    {
      title: "事件",
      dataIndex: "eventType",
      key: "eventType",
      width: 120,
      fixed: "left",
      render: (value) => statusTag(value, "event"),
    },
    {
      title: "Twitter ID",
      dataIndex: "twitterId",
      key: "twitterId",
      width: 170,
      render: (value: string) => <Typography.Text copyable={{ text: value }}>{value}</Typography.Text>,
    },
    {
      title: "Square UID 变化",
      key: "squareUidChange",
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary">from: {record.fromBinanceSquareUid || "-"}</Typography.Text>
          <Typography.Text>to: {record.toBinanceSquareUid || "-"}</Typography.Text>
        </Space>
      ),
    },
    { title: "Binding ID", dataIndex: "bindingId", key: "bindingId", width: 110, render: (value) => value || "-" },
    { title: "Challenge ID", dataIndex: "challengeId", key: "challengeId", width: 120, render: (value) => value || "-" },
    {
      title: "元数据",
      dataIndex: "metadata",
      key: "metadata",
      width: 360,
      render: (value) => {
        const json = safeJson(value);
        if (json === "-") return "-";
        return (
          <Tooltip title={<pre className="bs-binding-json-tooltip">{json}</pre>}>
            <Typography.Text code ellipsis className="bs-binding-json-line">{json}</Typography.Text>
          </Tooltip>
        );
      },
    },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
  ];

  return (
    <PermissionGuard permission="binance-square">
      <div className="binance-square-page binance-square-binding-page">
        <div className="bs-binding-header">
          <div>
            <h1 className="section-title">Binance Square 绑定监控</h1>
            <p className="section-desc">
              观测 EchoHunt 用户生成的发帖验证码、绑定关系、帖子校验结果与当前币安广场爬虫状态。
            </p>
          </div>
          <LegacyActionButton icon={<ReloadOutlined />} variant="sync" onClick={refreshAll} loading={overviewQuery.isFetching || statusQuery.isFetching}>
            刷新
          </LegacyActionButton>
        </div>

        <Alert
          className="bs-binding-alert"
          type="info"
          showIcon
          message="这里仅做观测，不提供人工改绑操作。活动期间如需保证验证爬虫稳定，可在币安广场页暂停原帖子抓取任务。"
        />

        <div className="bs-stats-grid bs-binding-stats-grid">
          <LegacyMetricCard label="当前有效绑定" value={overview?.activeBindingCount ?? "-"} indicatorColor="#10b981" />
          <LegacyMetricCard label="待验证帖子码" value={overview?.pendingChallengeCount ?? "-"} indicatorColor="#3b82f6" />
          <LegacyMetricCard label="今日生成验证码" value={overview?.todayChallengeCount ?? "-"} indicatorColor="#f59e0b" />
          <LegacyMetricCard label="今日验证成功" value={overview?.todayVerifySuccessCount ?? "-"} indicatorColor="#22c55e" />
          <LegacyMetricCard label="今日验证失败" value={overview?.todayVerifyFailedCount ?? "-"} indicatorColor="#ef4444" />
          <LegacyMetricCard label="累计解绑记录" value={overview?.revokedBindingCount ?? "-"} indicatorColor="#94a3b8" />
        </div>

        <Card className="bs-binding-crawl-card" bordered={false}>
          <div className="bs-binding-crawl-grid">
            <div>
              <Typography.Text type="secondary">调度状态</Typography.Text>
              <div className="bs-binding-crawl-main">
                {crawlStatus?.isRunning ? <Tag color="success">调度中</Tag> : <Tag>未启动</Tag>}
                {crawlStatus?.isCrawling ? <Tag color="processing">正在抓取</Tag> : <Tag color="default">空闲</Tag>}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">当前任务</Typography.Text>
              <div className="bs-binding-crawl-text">
                {crawlStatus?.currentTask?.taskType || crawlProgress?.taskType || "-"}
                {crawlStatus?.currentTask?.snapshotId ? ` / ${crawlStatus.currentTask.snapshotId}` : ""}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">进度</Typography.Text>
              <div className="bs-binding-crawl-text">
                {crawlStatus?.currentTask
                  ? `${crawlStatus.currentTask.processedUsers || 0}/${crawlStatus.currentTask.totalUsers || 0}`
                  : crawlProgress?.running
                    ? `${crawlProgress.processedUsers || 0}/${crawlProgress.totalUsers || 0}`
                    : "-"}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">最近抓取</Typography.Text>
              <div className="bs-binding-crawl-text">
                {crawlStatus?.lastCrawl
                  ? `${crawlStatus.lastCrawl.status || "-"} · ${formatDateTime(crawlStatus.lastCrawl.createdAt)} · ${formatDuration(crawlStatus.lastCrawl.durationMs)}`
                  : "-"}
              </div>
            </div>
          </div>
        </Card>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "challenges",
              label: "验证码",
              children: (
                <Card bordered={false}>
                  <div className="bs-binding-filter-bar">
                    <Select
                      value={challengeFilters.status}
                      options={CHALLENGE_STATUS_OPTIONS}
                      style={{ width: 130 }}
                      onChange={(status) => setChallengeFilters((prev) => ({ ...prev, page: 1, status }))}
                    />
                    <Input
                      allowClear
                      placeholder="Twitter ID"
                      value={challengeFilters.twitterId}
                      onChange={(event) => setChallengeFilters((prev) => ({ ...prev, page: 1, twitterId: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="Twitter 用户名"
                      value={challengeFilters.twitterUsername}
                      onChange={(event) => setChallengeFilters((prev) => ({ ...prev, page: 1, twitterUsername: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="验证码 EH-..."
                      value={challengeFilters.verificationCode}
                      onChange={(event) => setChallengeFilters((prev) => ({ ...prev, page: 1, verificationCode: event.target.value.trim() }))}
                    />
                    <LegacyActionButton variant="neutral" onClick={() => setChallengeFilters(initialChallengeFilters)}>重置</LegacyActionButton>
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    loading={challengesQuery.isLoading}
                    columns={challengeColumns}
                    dataSource={challengesQuery.data?.data.data || []}
                    scroll={{ x: 1900, y: TABLE_MAX_HEIGHT }}
                    pagination={{
                      current: challengeFilters.page,
                      pageSize: challengeFilters.pageSize,
                      total: challengesQuery.data?.data.total || 0,
                      showSizeChanger: true,
                      pageSizeOptions: PAGE_SIZE_OPTIONS,
                      showTotal: (total) => `共 ${total} 条`,
                      onChange: (page, pageSize) => setChallengeFilters((prev) => ({ ...prev, page, pageSize })),
                    }}
                  />
                </Card>
              ),
            },
            {
              key: "bindings",
              label: "绑定关系",
              children: (
                <Card bordered={false}>
                  <div className="bs-binding-filter-bar">
                    <Select
                      value={bindingFilters.status}
                      options={BINDING_STATUS_OPTIONS}
                      style={{ width: 130 }}
                      onChange={(status) => setBindingFilters((prev) => ({ ...prev, page: 1, status }))}
                    />
                    <Input
                      allowClear
                      placeholder="Twitter ID"
                      value={bindingFilters.twitterId}
                      onChange={(event) => setBindingFilters((prev) => ({ ...prev, page: 1, twitterId: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="Twitter 用户名"
                      value={bindingFilters.twitterUsername}
                      onChange={(event) => setBindingFilters((prev) => ({ ...prev, page: 1, twitterUsername: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="Binance username"
                      value={bindingFilters.binanceUsername}
                      onChange={(event) => setBindingFilters((prev) => ({ ...prev, page: 1, binanceUsername: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="Square UID"
                      value={bindingFilters.binanceSquareUid}
                      onChange={(event) => setBindingFilters((prev) => ({ ...prev, page: 1, binanceSquareUid: event.target.value.trim() }))}
                    />
                    <Input
                      allowClear
                      placeholder="验证码"
                      value={bindingFilters.verificationCode}
                      onChange={(event) => setBindingFilters((prev) => ({ ...prev, page: 1, verificationCode: event.target.value.trim() }))}
                    />
                    <LegacyActionButton variant="neutral" onClick={() => setBindingFilters(initialBindingFilters)}>重置</LegacyActionButton>
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    loading={bindingsQuery.isLoading}
                    columns={bindingColumns}
                    dataSource={bindingsQuery.data?.data.data || []}
                    scroll={{ x: 1500, y: TABLE_MAX_HEIGHT }}
                    pagination={{
                      current: bindingFilters.page,
                      pageSize: bindingFilters.pageSize,
                      total: bindingsQuery.data?.data.total || 0,
                      showSizeChanger: true,
                      pageSizeOptions: PAGE_SIZE_OPTIONS,
                      showTotal: (total) => `共 ${total} 条`,
                      onChange: (page, pageSize) => setBindingFilters((prev) => ({ ...prev, page, pageSize })),
                    }}
                  />
                </Card>
              ),
            },
            {
              key: "events",
              label: "事件日志",
              children: (
                <Card bordered={false}>
                  <div className="bs-binding-filter-bar">
                    <Select
                      value={eventFilters.eventType}
                      options={EVENT_TYPE_OPTIONS}
                      style={{ width: 130 }}
                      onChange={(eventType) => setEventFilters((prev) => ({ ...prev, page: 1, eventType }))}
                    />
                    <Input
                      allowClear
                      placeholder="Twitter ID"
                      value={eventFilters.twitterId}
                      onChange={(event) => setEventFilters((prev) => ({ ...prev, page: 1, twitterId: event.target.value.trim() }))}
                    />
                    <LegacyActionButton variant="neutral" onClick={() => setEventFilters(initialEventFilters)}>重置</LegacyActionButton>
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    loading={eventsQuery.isLoading}
                    columns={eventColumns}
                    dataSource={eventsQuery.data?.data.data || []}
                    scroll={{ x: 1300, y: TABLE_MAX_HEIGHT }}
                    pagination={{
                      current: eventFilters.page,
                      pageSize: eventFilters.pageSize,
                      total: eventsQuery.data?.data.total || 0,
                      showSizeChanger: true,
                      pageSizeOptions: PAGE_SIZE_OPTIONS,
                      showTotal: (total) => `共 ${total} 条`,
                      onChange: (page, pageSize) => setEventFilters((prev) => ({ ...prev, page, pageSize })),
                    }}
                  />
                </Card>
              ),
            },
          ]}
        />
      </div>
    </PermissionGuard>
  );
}
