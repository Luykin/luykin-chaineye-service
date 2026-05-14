import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  Modal,
  Pagination,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQueries, useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchPerfErrorTraces,
  fetchPerfKpis,
  fetchPerfMetrics,
  fetchPerfQueueStatus,
  fetchPerfTraceDetail,
  fetchPerfTraces,
} from "@/services/perf";
import { fetchLogSearch } from "@/services/stats";
import type {
  PerfErrorTracePoint,
  PerfKpiResponse,
  PerfMetricPoint,
  PerfTraceDetail,
  PerfTracePoint,
} from "@/types/perf";

const TRACE_PAGE_SIZE = 50;
const TABLE_MAX_HEIGHT = 480;

function getDefaultRange() {
  const end = dayjs();
  const start = end.subtract(30, "minute");
  return { start, end };
}

function formatMs(value?: number | null) {
  if (!Number.isFinite(value)) return "--";
  if ((value || 0) >= 1000) return `${((value || 0) / 1000).toFixed(2)} s`;
  return `${Math.round(value || 0)} ms`;
}

function normalizePath(path?: string | null) {
  if (!path) return "";
  return path.split("?")[0];
}

function getKpiCurrent(data?: PerfKpiResponse | null) {
  return (data?.current || data?.cur || data?.data || data || {}) as Record<string, unknown>;
}

function getRequestCount(cur: Record<string, unknown>) {
  return Number(cur.totalRequests ?? cur.requestCount ?? cur.totalCount ?? cur.total ?? cur.count ?? 0);
}

function getAvgDuration(cur: Record<string, unknown>) {
  return Number(cur.avgDurationMs ?? cur.avg_duration_ms ?? cur.avgMs ?? cur.avg ?? 0);
}

function getP95Duration(cur: Record<string, unknown>) {
  return Number(cur.p95DurationMs ?? cur.p95_duration_ms ?? cur.p95Ms ?? cur.p95 ?? 0);
}

function statusTagColor(status: number) {
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  return "success";
}

function highlightText(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), (match) => `<mark>${match}</mark>`);
}

export function PerfMonitorPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const defaultRange = getDefaultRange();
  const [startTime, setStartTime] = useState<Dayjs>(defaultRange.start);
  const [endTime, setEndTime] = useState<Dayjs>(defaultRange.end);
  const [appliedStart, setAppliedStart] = useState<Dayjs>(defaultRange.start);
  const [appliedEnd, setAppliedEnd] = useState<Dayjs>(defaultRange.end);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterPath, setFilterPath] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [tracePage, setTracePage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRequestId, setDetailRequestId] = useState("");
  const [detailData, setDetailData] = useState<PerfTraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [requestIdSearch, setRequestIdSearch] = useState("");
  const [errorPage, setErrorPage] = useState(1);

  const startMs = appliedStart.valueOf();
  const endMs = appliedEnd.valueOf();
  const spanSecs = Math.max((endMs - startMs) / 1000, 1);
  const intervalSecs = spanSecs > 2 * 3600 ? 300 : 60;

  const [queueQuery, kpiQuery, metricsQuery, tracesQuery, errorsQuery] = useQueries({
    queries: [
      {
        queryKey: ["perf", "queue-status"],
        queryFn: fetchPerfQueueStatus,
        refetchInterval: 15_000,
      },
      {
        queryKey: ["perf", "kpis", startMs, endMs],
        queryFn: () => fetchPerfKpis({ startTime: startMs, endTime: endMs }),
      },
      {
        queryKey: ["perf", "metrics", startMs, endMs, intervalSecs],
        queryFn: () => fetchPerfMetrics({ startTime: startMs, endTime: endMs, intervalSecs }),
      },
      {
        queryKey: ["perf", "traces", startMs, endMs],
        queryFn: () => fetchPerfTraces({ startTime: startMs, endTime: endMs, limit: 15000 }),
      },
      {
        queryKey: ["perf", "errors"],
        queryFn: () => fetchPerfErrorTraces({ maxScan: 100000 }),
      },
    ],
  });

  const curKpi = getKpiCurrent(kpiQuery.data);
  const requestCount = getRequestCount(curKpi);
  const avgDuration = getAvgDuration(curKpi);
  const p95Duration = getP95Duration(curKpi);
  const rps = requestCount / spanSecs;

  const filteredTraces = useMemo(() => {
    const traces = tracesQuery.data || [];
    const userNeedle = filterUserId.trim().toLowerCase();
    const pathNeedle = filterPath.trim().toLowerCase();
    const ipNeedle = filterIp.trim().toLowerCase();
    return traces.filter((item) => {
      const userOk = !userNeedle || String(item.userId || "").toLowerCase().includes(userNeedle);
      const pathOk = !pathNeedle || String(item.path || "").toLowerCase().includes(pathNeedle);
      const ipOk = !ipNeedle || String(item.ip || "").toLowerCase().includes(ipNeedle);
      return userOk && pathOk && ipOk;
    });
  }, [tracesQuery.data, filterUserId, filterPath, filterIp]);

  useEffect(() => {
    setTracePage(1);
  }, [filterUserId, filterPath, filterIp, startMs, endMs]);

  const pagedTraces = useMemo(() => {
    const start = (tracePage - 1) * TRACE_PAGE_SIZE;
    return filteredTraces.slice(start, start + TRACE_PAGE_SIZE);
  }, [filteredTraces, tracePage]);

  const latencyRows = useMemo(() => {
    const buckets = new Map<string, number[]>();
    filteredTraces.forEach((item) => {
      const path = normalizePath(item.path) || "(unknown)";
      if (!buckets.has(path)) buckets.set(path, []);
      buckets.get(path)!.push(item.durationMs);
    });

    return Array.from(buckets.entries())
      .map(([path, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b);
        const count = sorted.length;
        const avg = sorted.reduce((sum, cur) => sum + cur, 0) / count;
        const median =
          count % 2 === 0
            ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
            : sorted[Math.floor(count / 2)];
        return {
          path,
          count,
          avgDuration: avg,
          medianDuration: median,
          maxDuration: sorted[count - 1],
        };
      })
      .filter((item) => item.count >= 10)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 20);
  }, [filteredTraces]);

  const requestSearchResult = useMemo(() => {
    const needle = requestIdSearch.trim();
    if (!needle) return null;
    return filteredTraces.find((item) => String(item.requestId || "").startsWith(needle)) || null;
  }, [requestIdSearch, filteredTraces]);

  const errorRows = useMemo(() => {
    const rows = errorsQuery.data || [];
    const start = (errorPage - 1) * TRACE_PAGE_SIZE;
    return rows.slice(start, start + TRACE_PAGE_SIZE);
  }, [errorsQuery.data, errorPage]);

  const traceColumns: ColumnsType<PerfTracePoint> = [
    {
      title: "时间",
      key: "ts",
      width: 170,
      render: (_, record) => dayjs(record.ts).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: number) => <Tag color={statusTagColor(value)}>{value}</Tag>,
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 110,
      render: (value: number) => formatMs(value),
    },
    {
      title: "接口路径",
      dataIndex: "path",
      key: "path",
      render: (value: string) => (
        <Typography.Text ellipsis style={{ maxWidth: 320 }}>
          {value || "-"}
        </Typography.Text>
      ),
    },
    {
      title: "userId",
      dataIndex: "userId",
      key: "userId",
      width: 180,
      render: (value: string) => value || "-",
    },
    {
      title: "IP",
      dataIndex: "ip",
      key: "ip",
      width: 180,
      render: (value: string) => value || "-",
    },
    {
      title: "requestId",
      dataIndex: "requestId",
      key: "requestId",
      width: 220,
      render: (value: string, record) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0 }}
          onClick={() => void openTraceDetail(record)}
        >
          {value || "-"}
        </Button>
      ),
    },
  ];

  const errorColumns: ColumnsType<PerfErrorTracePoint> = [
    {
      title: "时间",
      key: "ts",
      width: 170,
      render: (_, record) => dayjs(record.ts).format("YYYY-MM-DD HH:mm:ss"),
    },
    { title: "状态", dataIndex: "status", key: "status", width: 90, render: (value: number) => <Tag color="error">{value}</Tag> },
    { title: "耗时", dataIndex: "durationMs", key: "durationMs", width: 110, render: (value: number) => formatMs(value) },
    { title: "接口路径", dataIndex: "path", key: "path", render: (value: string) => value || "-" },
    { title: "userId", dataIndex: "userId", key: "userId", width: 180, render: (value: string) => value || "-" },
    { title: "requestId", dataIndex: "requestId", key: "requestId", width: 220 },
  ];

  async function openTraceDetail(trace: PerfTracePoint) {
    setDetailOpen(true);
    setDetailRequestId(trace.requestId || "");
    setDetailData(null);
    setDetailLoading(true);
    try {
      if (trace.hasDetail && trace.requestId) {
        const detail = await fetchPerfTraceDetail(trace.requestId);
        setDetailData(detail);
      } else {
        setDetailData({
          message: "该请求点没有采样到详情（hasDetail=false），仅展示基础信息",
          ...trace,
        });
      }
    } catch (error) {
      setDetailData({
        error: error instanceof Error ? error.message : "详情加载失败",
        ...trace,
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const logSearchQuery = useQuery({
    queryKey: ["perf", "log-search", detailRequestId],
    queryFn: () => fetchLogSearch({ query: detailRequestId, contextLines: 3, limit: 20 }),
    enabled: detailOpen && Boolean(detailRequestId),
  });

  return (
    <PermissionGuard permission="perf-monitor">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="性能监控"
          description="实时追踪 API 性能指标、请求分布、错误请求与接口延迟分析。"
          extra={
            <Space wrap>
              <DatePicker
                showTime
                value={startTime}
                onChange={(value) => value && setStartTime(value)}
                allowClear={false}
              />
              <DatePicker
                showTime
                value={endTime}
                onChange={(value) => value && setEndTime(value)}
                allowClear={false}
              />
              <Button
                type="primary"
                onClick={() => {
                  if (endTime.diff(startTime, "minute") > 30) {
                    messageApi.warning("查询范围不能超过 30 分钟");
                    return;
                  }
                  setAppliedStart(startTime);
                  setAppliedEnd(endTime);
                }}
              >
                查询
              </Button>
              <Button
                onClick={() => {
                  const next = getDefaultRange();
                  setStartTime(next.start);
                  setEndTime(next.end);
                  setAppliedStart(next.start);
                  setAppliedEnd(next.end);
                }}
              >
                最近30分钟
              </Button>
            </Space>
          }
        >
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap size={12}>
              <Input
                placeholder="按 userId 筛选"
                value={filterUserId}
                onChange={(event) => setFilterUserId(event.target.value)}
                style={{ width: 220 }}
              />
              <Input
                placeholder="按 path 筛选"
                value={filterPath}
                onChange={(event) => setFilterPath(event.target.value)}
                style={{ width: 220 }}
              />
              <Input
                placeholder="按 IP 筛选"
                value={filterIp}
                onChange={(event) => setFilterIp(event.target.value)}
                style={{ width: 220 }}
              />
              <Input
                placeholder="按 requestId 前缀搜索"
                value={requestIdSearch}
                onChange={(event) => setRequestIdSearch(event.target.value)}
                style={{ width: 240 }}
              />
              <Tag color="blue">队列积压: {queueQuery.data?.queueLength ?? "--"}</Tag>
              {requestIdSearch.trim() ? (
                <Tag color={requestSearchResult ? "success" : "default"}>
                  {requestSearchResult ? "已匹配到当前窗口请求" : "当前窗口未匹配"}
                </Tag>
              ) : null}
            </Space>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="请求数" value={requestCount || 0} /></Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="RPS" value={Number(rps.toFixed(2))} /></Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="平均耗时" value={formatMs(avgDuration)} /></Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="P95 耗时" value={formatMs(p95Duration)} /></Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 0 }}>
            <Col xs={24} xl={14}>
              <Card
                title={`请求追踪列表 (${filteredTraces.length})`}
                extra={
                  metricsQuery.data?.length ? (
                    <Typography.Text type="secondary">
                      聚合点数：{metricsQuery.data.length}
                    </Typography.Text>
                  ) : null
                }
              >
                <Table
                  rowKey={(record) => `${record.requestId}-${record.ts}`}
                  columns={traceColumns}
                  dataSource={pagedTraces}
                  loading={tracesQuery.isFetching}
                  pagination={false}
                  scroll={{ y: TABLE_MAX_HEIGHT, x: 1300 }}
                  locale={{ emptyText: <Empty description="当前时间范围暂无追踪数据" /> }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <Pagination
                    current={tracePage}
                    pageSize={TRACE_PAGE_SIZE}
                    total={filteredTraces.length}
                    showSizeChanger={false}
                    onChange={setTracePage}
                  />
                </div>
              </Card>
            </Col>

            <Col xs={24} xl={10}>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card title="接口平均耗时排行榜">
                  <Table
                    rowKey="path"
                    pagination={false}
                    scroll={{ y: 280 }}
                    size="small"
                    columns={[
                      { title: "接口路径", dataIndex: "path", key: "path" },
                      {
                        title: "平均耗时",
                        dataIndex: "avgDuration",
                        key: "avgDuration",
                        width: 110,
                        render: (value: number) => formatMs(value),
                      },
                      {
                        title: "中位耗时",
                        dataIndex: "medianDuration",
                        key: "medianDuration",
                        width: 110,
                        render: (value: number) => formatMs(value),
                      },
                      {
                        title: "最大耗时",
                        dataIndex: "maxDuration",
                        key: "maxDuration",
                        width: 110,
                        render: (value: number) => formatMs(value),
                      },
                      { title: "请求数", dataIndex: "count", key: "count", width: 90 },
                    ]}
                    dataSource={latencyRows}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无足够样本" /> }}
                  />
                </Card>

                <Card title="指标说明">
                  <Space direction="vertical" size={8}>
                    <Typography.Text>RPS：每秒请求数，反映系统吞吐量。</Typography.Text>
                    <Typography.Text>Avg Duration：统计窗口内平均耗时。</Typography.Text>
                    <Typography.Text>队列积压：perf:events:queue 当前长度。</Typography.Text>
                    <Typography.Text>采样规则：快请求部分采样，错误请求优先保留详情。</Typography.Text>
                  </Space>
                </Card>
              </Space>
            </Col>
          </Row>

          <Card title={`500+ 错误请求 (${errorsQuery.data?.length || 0})`} style={{ marginTop: 16 }}>
            <Table
              rowKey={(record) => `${record.requestId}-${record.ts}`}
              columns={errorColumns}
              dataSource={errorRows}
              loading={errorsQuery.isFetching}
              pagination={false}
              scroll={{ y: 300, x: 1000 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 500+ 错误请求" /> }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <Pagination
                current={errorPage}
                pageSize={TRACE_PAGE_SIZE}
                total={errorsQuery.data?.length || 0}
                showSizeChanger={false}
                onChange={setErrorPage}
              />
            </div>
          </Card>

          {queueQuery.isError || kpiQuery.isError || metricsQuery.isError || tracesQuery.isError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 16 }}
              message="性能监控部分数据加载失败"
              description="请检查后端 perf-monitor 服务、Redis 队列或管理员登录状态。"
            />
          ) : null}
        </PageSection>

        <Modal
          open={detailOpen}
          onCancel={() => setDetailOpen(false)}
          footer={null}
          width={920}
          title="请求追踪详情"
        >
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="requestId">{detailRequestId || "-"}</Descriptions.Item>
            </Descriptions>
            <Card size="small" loading={detailLoading}>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 360,
                  overflow: "auto",
                  background: "#1e293b",
                  color: "#e2e8f0",
                  padding: 16,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {JSON.stringify(detailData, null, 2)}
              </pre>
            </Card>

            <Card title="关联日志搜索" size="small" loading={logSearchQuery.isFetching}>
              {logSearchQuery.data?.data.totalMatches ? (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {logSearchQuery.data.data.results.map((result, index) => (
                    <Card key={`${result.file}-${index}`} size="small">
                      <Typography.Text strong>{result.file}</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        {result.context.map((line) => (
                          <div key={`${result.file}-${line.lineNumber}`} style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            <span style={{ color: "#94a3b8", marginRight: 10 }}>{line.lineNumber}:</span>
                            <span dangerouslySetInnerHTML={{ __html: highlightText(line.content, detailRequestId) }} />
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到关联日志" />
              )}
            </Card>
          </Space>
        </Modal>
      </Space>
    </PermissionGuard>
  );
}
