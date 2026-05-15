import { Alert, Badge, Button, Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchDeviceStatus } from "@/services/stats";
import type { DeviceStatusResponse } from "@/types/stats";

const TABLE_MAX_HEIGHT = 340;

type HealthLevel = "ok" | "warn" | "danger";

type SseProcessRow = {
  processId?: string;
  connectionCount?: number;
  isInitialized?: boolean;
  feedIntervalActive?: boolean;
  topTweetIntervalActive?: boolean;
  lastFeedPollTimeFormatted?: string;
  lastTopTweetPollTimeFormatted?: string;
};

function percentToNumber(value?: string) {
  if (!value) return 0;
  const parsed = Number(String(value).replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function healthFromPercent(value: number, warn = 75, danger = 90): HealthLevel {
  if (value >= danger) return "danger";
  if (value >= warn) return "warn";
  return "ok";
}

function healthText(level: HealthLevel) {
  if (level === "danger") return "危险";
  if (level === "warn") return "注意";
  return "安全";
}

function healthColor(level: HealthLevel) {
  if (level === "danger") return "#dc2626";
  if (level === "warn") return "#d97706";
  return "#16a34a";
}

function progressStatus(level: HealthLevel) {
  if (level === "danger") return "exception" as const;
  if (level === "warn") return "normal" as const;
  return "success" as const;
}

function getDiskRisk(disks?: DeviceStatusResponse["disk"]) {
  const rows = disks || [];
  const highest = rows.reduce(
    (acc, disk) => {
      const value = percentToNumber(disk.usePercent);
      return value > acc.value ? { value, disk } : acc;
    },
    { value: 0, disk: undefined as NonNullable<DeviceStatusResponse["disk"]>[number] | undefined },
  );
  return { ...highest, level: healthFromPercent(highest.value, 80, 90) };
}

function getOverallHealth(levels: HealthLevel[]): HealthLevel {
  if (levels.includes("danger")) return "danger";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

function sseProcesses(sse?: DeviceStatusResponse["sse"]): SseProcessRow[] {
  const raw = sse?.processes;
  return Array.isArray(raw) ? (raw as SseProcessRow[]) : [];
}

function MetricCard(props: {
  title: string;
  value: number;
  level: HealthLevel;
  detail?: string;
  meta?: string;
}) {
  return (
    <Card className={`device-health-card is-${props.level}`}>
      <div className="device-health-card-topline">
        <span>{props.title}</span>
        <Tag color={props.level === "danger" ? "error" : props.level === "warn" ? "warning" : "success"}>{healthText(props.level)}</Tag>
      </div>
      <div className="device-health-value">{props.value.toFixed(props.value % 1 ? 1 : 0)}%</div>
      <Progress percent={Math.min(100, Math.max(0, props.value))} showInfo={false} status={progressStatus(props.level)} strokeColor={healthColor(props.level)} trailColor="#eef2f7" />
      <div className="device-health-detail">{props.detail || "-"}</div>
      {props.meta ? <div className="device-health-meta">{props.meta}</div> : null}
    </Card>
  );
}

function StatusPill({ ok, text }: { ok?: boolean; text?: string }) {
  return <Tag color={ok ? "success" : "error"}>{text || (ok ? "正常" : "异常")}</Tag>;
}

export function DeviceMonitorPage() {
  const query = useQuery({
    queryKey: ["device-status"],
    queryFn: fetchDeviceStatus,
    refetchInterval: 60_000,
  });

  const data = query.data;
  const cpuPercent = percentToNumber(data?.cpu?.usage);
  const memoryPercent = percentToNumber(data?.memory?.usagePercent);
  const diskRisk = getDiskRisk(data?.disk);
  const cpuLevel = healthFromPercent(cpuPercent, 70, 85);
  const memoryLevel = healthFromPercent(memoryPercent, 75, 90);
  const overall = getOverallHealth([cpuLevel, memoryLevel, diskRisk.level]);
  const pm2Rows = data?.pm2 || [];
  const pm2Online = pm2Rows.filter((item) => item.status === "online").length;
  const pm2Bad = pm2Rows.length - pm2Online;
  const sseRows = sseProcesses(data?.sse);
  const sseTotalConnections = Number((data?.sse?.connections as { active?: number } | undefined)?.active || 0);

  const pm2Columns: ColumnsType<NonNullable<DeviceStatusResponse["pm2"]>[number]> = [
    { title: "进程", dataIndex: "name", key: "name", fixed: "left", width: 180 },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value?: string) => <Tag color={value === "online" ? "success" : "error"}>{value || "-"}</Tag>,
    },
    { title: "CPU", dataIndex: "cpu", key: "cpu", width: 90 },
    { title: "内存", dataIndex: "memory", key: "memory", width: 120 },
    { title: "重启", dataIndex: "restarts", key: "restarts", width: 80 },
    { title: "运行时长", dataIndex: "uptime", key: "uptime", width: 150 },
  ];

  const diskColumns: ColumnsType<NonNullable<DeviceStatusResponse["disk"]>[number]> = [
    { title: "挂载点", dataIndex: "mounted", key: "mounted", fixed: "left", width: 160 },
    { title: "使用率", dataIndex: "usePercent", key: "usePercent", width: 130, render: (value?: string) => {
      const n = percentToNumber(value);
      const level = healthFromPercent(n, 80, 90);
      return <Tag color={level === "danger" ? "error" : level === "warn" ? "warning" : "success"}>{value || "-"}</Tag>;
    } },
    { title: "已用 / 总量", key: "usage", width: 160, render: (_, record) => `${record.used || "-"} / ${record.size || "-"}` },
    { title: "可用", dataIndex: "available", key: "available", width: 100 },
    { title: "文件系统", dataIndex: "filesystem", key: "filesystem" },
  ];

  const sseColumns: ColumnsType<SseProcessRow> = [
    { title: "进程", dataIndex: "processId", key: "processId", fixed: "left", width: 180, render: (value?: string) => <Typography.Text code>{value || "current"}</Typography.Text> },
    { title: "连接数", dataIndex: "connectionCount", key: "connectionCount", width: 100, render: (value?: number) => <strong>{value || 0}</strong> },
    { title: "初始化", dataIndex: "isInitialized", key: "isInitialized", width: 100, render: (value?: boolean) => <StatusPill ok={value} text={value ? "已初始化" : "未初始化"} /> },
    { title: "Feed 轮询", dataIndex: "feedIntervalActive", key: "feedIntervalActive", width: 110, render: (value?: boolean) => <StatusPill ok={value} text={value ? "运行中" : "未启动"} /> },
    { title: "Top Tweet", dataIndex: "topTweetIntervalActive", key: "topTweetIntervalActive", width: 110, render: (value?: boolean) => <StatusPill ok={value} text={value ? "运行中" : "未启动"} /> },
  ];

  return (
    <PermissionGuard permission="device-status:read">
      <PageSection
        title="设备监控"
        description="只读状态面板：优先判断磁盘、内存、CPU 是否危险，其次查看 PM2、数据库与 SSE 连接。"
        extra={<Button onClick={() => query.refetch()} loading={query.isFetching}>刷新</Button>}
      >
        {query.isError ? <Alert type="error" showIcon message="加载设备状态失败" /> : null}
        {!data && !query.isError ? <Empty description="暂无设备状态数据" /> : null}
        {data ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }} className="device-monitor-page">
            <Card className={`device-overview is-${overall}`}>
              <div className="device-overview-main">
                <div>
                  <div className="device-kicker">当前风险判断</div>
                  <div className="device-overview-title">{healthText(overall)}</div>
                  <div className="device-overview-desc">
                    主机 {data.system?.hostname || "-"} · {data.system?.platform || "-"} · 运行 {data.system?.uptime || "-"}
                  </div>
                </div>
                <div className="device-overview-time">更新时间：{data.timestamp}</div>
              </div>
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={8}>
                <MetricCard title="磁盘占用" value={diskRisk.value} level={diskRisk.level} detail={`${diskRisk.disk?.mounted || "-"} · ${diskRisk.disk?.used || "-"} / ${diskRisk.disk?.size || "-"}`} meta="超过 90% 需要立即处理" />
              </Col>
              <Col xs={24} lg={8}>
                <MetricCard title="内存占用" value={memoryPercent} level={memoryLevel} detail={`${data.memory?.used || "-"} / ${data.memory?.total || "-"}`} meta={`可用 ${data.memory?.free || "-"}`} />
              </Col>
              <Col xs={24} lg={8}>
                <MetricCard title="CPU 占用" value={cpuPercent} level={cpuLevel} detail={`${data.cpu?.cores || "-"} 核 · ${data.cpu?.loadAverage || "-"}`} meta={data.cpu?.model || "-"} />
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={16}>
                <Card
                  title={<Space><span>PM2 运行</span><Badge status={pm2Bad ? "error" : "success"} text={`${pm2Online}/${pm2Rows.length} online`} /></Space>}
                  className="device-panel"
                >
                  <Table rowKey={(record) => [record.name, record.status, record.uptime].filter(Boolean).join("-")} columns={pm2Columns} dataSource={pm2Rows} scroll={{ y: TABLE_MAX_HEIGHT, x: 780 }} pagination={false} size="small" locale={{ emptyText: <Empty description="暂无 PM2 数据" /> }} />
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Card title="数据库状态" className="device-panel device-db-panel">
                  <div className="device-db-row"><span>Redis</span><StatusPill ok={data.redis?.connected} text={data.redis?.connected ? "已连接" : "未连接"} /></div>
                  <div className="device-db-meta">内存 {data.redis?.memory || "-"} / {data.redis?.maxMemory || "未设置"}</div>
                  <div className="device-db-meta">Key 数量 {data.redis?.keys ?? "-"} · 运行 {data.redis?.uptime || "-"}</div>
                  <div className="device-db-divider" />
                  <div className="device-db-row"><span>PostgreSQL</span><StatusPill ok={data.postgresql?.connected} text={data.postgresql?.connected ? "已连接" : "未连接"} /></div>
                  <div className="device-db-meta">版本 {data.postgresql?.version || "-"}</div>
                  <div className="device-db-meta">大小 {data.postgresql?.size || "-"} · 活跃连接 {data.postgresql?.connections ?? "-"}</div>
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <Card title="磁盘详情" className="device-panel">
                  <Table rowKey={(record) => `${record.filesystem}-${record.mounted}`} columns={diskColumns} dataSource={data.disk || []} pagination={false} size="small" scroll={{ y: 300, x: 720 }} locale={{ emptyText: <Empty description="暂无磁盘信息" /> }} />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card
                  title={<Space><span>SSE 连接</span><Tag color={data.sse?.available ? "success" : "default"}>{data.sse?.available ? "可用" : "不可用"}</Tag></Space>}
                  extra={<Statistic value={sseTotalConnections} suffix="连接" valueStyle={{ fontSize: 18 }} />}
                  className="device-panel"
                >
                  <Table rowKey={(record, index) => `${record.processId || "current"}-${index}`} columns={sseColumns} dataSource={sseRows} pagination={false} size="small" scroll={{ y: 300, x: 620 }} locale={{ emptyText: <Empty description="暂无 SSE 进程连接数据" /> }} />
                </Card>
              </Col>
            </Row>
          </Space>
        ) : null}
      </PageSection>
    </PermissionGuard>
  );
}
