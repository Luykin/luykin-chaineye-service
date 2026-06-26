import { useEffect, useMemo, useRef, useState } from "react";
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
  Select,
  Space,
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
  fetchPerfKpis,
  fetchPerfMetrics,
  fetchPerfQueueStatus,
  fetchPerfTraceDetail,
  fetchPerfTraces,
} from "@/services/perf";
import { fetchLogSearch } from "@/services/stats";
import type {
  PerfKpiResponse,
  PerfMetricPoint,
  PerfTraceDetail,
  PerfTracePoint,
} from "@/types/perf";

const TRACE_PAGE_SIZE = 50;
const TABLE_MAX_HEIGHT = 420;
const SCATTER_HEIGHT = 520;
const METRICS_HEIGHT = 360;

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

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function PerfPanelCard({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      size="small"
      className="perf-panel-card"
      title={
        <div className="perf-panel-title">
          <span>{title}</span>
          {extra ? <span className="perf-panel-extra">{extra}</span> : null}
        </div>
      }
    >
      {children}
    </Card>
  );
}

function PerfKpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone: "blue" | "green" | "orange" | "red";
  hint?: string;
}) {
  return (
    <Card size="small" className={`perf-kpi-card perf-kpi-${tone}`}>
      <span className="perf-kpi-label">{label}</span>
      <strong className="perf-kpi-value">{value}</strong>
      {hint ? <span className="perf-kpi-hint">{hint}</span> : null}
    </Card>
  );
}

function ChartContainer({
  chartRef,
  height,
  ready,
  emptyText,
}: {
  chartRef: React.RefObject<HTMLDivElement>;
  height: number;
  ready: boolean;
  emptyText?: string;
}) {
  return (
    <div
      className="perf-chart-container"
      style={{ height }}
    >
      <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
      {!ready ? (
        <div className="perf-chart-empty-mask">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText || "图表库未加载"} />
        </div>
      ) : null}
    </div>
  );
}

function getScatterSeriesData(data: PerfTracePoint[]) {
  const errorData5xx: Array<{ value: unknown[] }> = [];
  const errorData4xx: Array<{ value: unknown[] }> = [];
  const normalData: Array<{ value: unknown[] }> = [];

  data.forEach((d) => {
    const point = {
      value: [d.ts, d.durationMs, d.status, d.hasDetail ? 1 : 0, d.requestId, d.path, d.userId, d.ip, d.source, d.webClientKey, d.webSignResult, d.webSignFailReason, d.pageUrl],
    };

    if (d.status >= 500) {
      errorData5xx.push(point);
    } else if (d.status >= 400) {
      errorData4xx.push(point);
    } else {
      normalData.push(point);
    }
  });

  return { errorData5xx, errorData4xx, normalData };
}

function getTraceRequestId(trace: PerfTracePoint | null) {
  return trace?.requestId || "";
}

export function PerfMonitorPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const defaultRange = getDefaultRange();
  const [startTime, setStartTime] = useState<Dayjs>(defaultRange.start);
  const [endTime, setEndTime] = useState<Dayjs>(defaultRange.end);
  const [appliedStart, setAppliedStart] = useState<Dayjs>(defaultRange.start);
  const [appliedEnd, setAppliedEnd] = useState<Dayjs>(defaultRange.end);
  const [filterUserIdInput, setFilterUserIdInput] = useState("");
  const [filterPathInput, setFilterPathInput] = useState("");
  const [filterIpInput, setFilterIpInput] = useState("");
  const [filterSourceInput, setFilterSourceInput] = useState("all");
  const [filterWebClientInput, setFilterWebClientInput] = useState("");
  const [filterWebSignInput, setFilterWebSignInput] = useState("all");
  const [filterWebSignReasonInput, setFilterWebSignReasonInput] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterPath, setFilterPath] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterWebClient, setFilterWebClient] = useState("");
  const [filterWebSign, setFilterWebSign] = useState("all");
  const [filterWebSignReason, setFilterWebSignReason] = useState("");
  const [tracePage, setTracePage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRequestId, setDetailRequestId] = useState("");
  const [detailData, setDetailData] = useState<PerfTraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [requestIdSearch, setRequestIdSearch] = useState("");
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);

  const scatterContainerRef = useRef<HTMLDivElement | null>(null);
  const metricsContainerRef = useRef<HTMLDivElement | null>(null);
  const scatterChartRef = useRef<any>(null);
  const metricsChartRef = useRef<any>(null);
  const [echartsReady, setEchartsReady] = useState(false);

  const startMs = appliedStart.valueOf();
  const endMs = appliedEnd.valueOf();
  const spanSecs = Math.max((endMs - startMs) / 1000, 1);
  const intervalSecs = spanSecs > 2 * 3600 ? 300 : 60;

  const [queueQuery, kpiQuery, metricsQuery, tracesQuery] = useQueries({
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
        queryKey: ["perf", "traces", startMs, endMs, filterSource, filterWebClient, filterWebSign, filterWebSignReason],
        queryFn: () => fetchPerfTraces({
          startTime: startMs,
          endTime: endMs,
          limit: 15000,
          source: filterSource,
          webClientKey: filterWebClient,
          webSignResult: filterWebSign,
          webSignFailReason: filterWebSignReason,
        }),
      },
    ],
  });

  const curKpi = getKpiCurrent(kpiQuery.data);
  const requestCount = getRequestCount(curKpi);
  const avgDuration = getAvgDuration(curKpi);
  const p95Duration = getP95Duration(curKpi);
  const rps = requestCount / spanSecs;
  const rangeText = `${appliedStart.format("MM-DD HH:mm")} ~ ${appliedEnd.format("MM-DD HH:mm")}`;

  const filteredTraces = useMemo(() => {
    const traces = tracesQuery.data || [];
    const userNeedle = filterUserId.trim().toLowerCase();
    const pathNeedle = filterPath.trim().toLowerCase();
    const ipNeedle = filterIp.trim().toLowerCase();
    const sourceNeedle = filterSource;
    const webClientNeedle = filterWebClient.trim().toLowerCase();
    const webSignNeedle = filterWebSign;
    const webSignReasonNeedle = filterWebSignReason.trim().toLowerCase();
    return traces.filter((item) => {
      const userOk = !userNeedle || String(item.userId || "").toLowerCase().includes(userNeedle);
      const pathOk = !pathNeedle || String(item.path || "").toLowerCase().includes(pathNeedle);
      const ipOk = !ipNeedle || String(item.ip || "").toLowerCase().includes(ipNeedle);
      const sourceOk = sourceNeedle === "all" || String(item.source || "legacy") === sourceNeedle;
      const webClientOk = !webClientNeedle || String(item.webClientKey || "").toLowerCase().includes(webClientNeedle);
      const webSignOk = webSignNeedle === "all" || String(item.webSignResult || "") === webSignNeedle;
      const webSignReasonOk = !webSignReasonNeedle || String(item.webSignFailReason || "").toLowerCase().includes(webSignReasonNeedle);
      return userOk && pathOk && ipOk && sourceOk && webClientOk && webSignOk && webSignReasonOk;
    });
  }, [tracesQuery.data, filterUserId, filterPath, filterIp, filterSource, filterWebClient, filterWebSign, filterWebSignReason]);

  useEffect(() => {
    setTracePage(1);
  }, [filterUserId, filterPath, filterIp, filterSource, filterWebClient, filterWebSign, filterWebSignReason, startMs, endMs]);

  const pagedTraces = useMemo(() => {
    const start = (tracePage - 1) * TRACE_PAGE_SIZE;
    return filteredTraces.slice(start, start + TRACE_PAGE_SIZE);
  }, [filteredTraces, tracePage]);

  const latencyRows = useMemo(() => {
    const buckets = new Map<string, number[]>();
    filteredTraces.forEach((item) => {
      const path = normalizePath(item.path) || "(unknown)";
      if (!buckets.has(path)) buckets.set(path, []);
      buckets.get(path)?.push(item.durationMs);
    });

    return Array.from(buckets.entries())
      .map(([path, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b);
        const count = sorted.length;
        const avg = sorted.reduce((sum, cur) => sum + cur, 0) / count;
        const median = count % 2 === 0
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

  async function openTraceDetail(traceOrRequestId: PerfTracePoint | string) {
    const requestId = typeof traceOrRequestId === "string" ? traceOrRequestId : traceOrRequestId.requestId || "";
    const trace = typeof traceOrRequestId === "string"
      ? filteredTraces.find((item) => item.requestId === traceOrRequestId) || null
      : traceOrRequestId;

    if (!requestId) {
      messageApi.warning("未找到 requestId");
      return;
    }

    setDetailOpen(true);
    setDetailRequestId(requestId);
    setDetailData(null);
    setDetailLoading(true);

    try {
      if (trace?.hasDetail) {
        const detail = await fetchPerfTraceDetail(requestId);
        setDetailData(detail);
      } else if (trace) {
        setDetailData({
          message: "该请求点没有采样到详情（hasDetail=false），仅展示基础信息",
          ...trace,
        });
      } else {
        const detail = await fetchPerfTraceDetail(requestId);
        setDetailData(detail);
      }
    } catch (error) {
      setDetailData({
        error: error instanceof Error ? error.message : "详情加载失败",
        requestId,
      });
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.echarts) {
      setEchartsReady(false);
      return;
    }

    const echarts = window.echarts;
    if (scatterContainerRef.current && !scatterChartRef.current) {
      scatterChartRef.current = echarts.init(scatterContainerRef.current);
      scatterChartRef.current.on("click", (params: any) => {
        const requestId = params?.value?.[4];
        const trace = filteredTraces.find((item) => item.requestId === requestId);
        void openTraceDetail(trace || requestId);
      });
    }

    if (metricsContainerRef.current && !metricsChartRef.current) {
      metricsChartRef.current = echarts.init(metricsContainerRef.current);
    }

    const handleResize = () => {
      scatterChartRef.current?.resize();
      metricsChartRef.current?.resize();
    };

    window.addEventListener("resize", handleResize);
    setEchartsReady(true);
    setTimeout(handleResize, 0);

    return () => {
      window.removeEventListener("resize", handleResize);
      scatterChartRef.current?.dispose();
      metricsChartRef.current?.dispose();
      scatterChartRef.current = null;
      metricsChartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!echartsReady || !scatterChartRef.current) return;
    const chart = scatterChartRef.current;

    if (tracesQuery.isFetching) {
      chart.showLoading("default", {
        text: "正在加载请求分布...",
        maskColor: "rgba(255,255,255,0.65)",
      });
      return;
    }

    chart.hideLoading();

    if (!filteredTraces.length) {
      chart.setOption({ title: { text: "当前范围暂无散点数据", left: "center", top: "center", textStyle: { color: "#94a3b8", fontSize: 14, fontWeight: 500 } } }, true);
      return;
    }

    const { errorData5xx, errorData4xx, normalData } = getScatterSeriesData(filteredTraces);
    const now = endMs;
    const tenMinutesAgo = Math.max(startMs, now - 10 * 60 * 1000);

    chart.setOption(
      {
        animation: false,
        legend: {
          data: ["Server Errors (5xx)", "Client Errors (4xx)", "Success"],
          right: 10,
          top: 8,
          textStyle: { color: "#64748b", fontSize: 12 },
        },
        tooltip: {
          trigger: "item",
          formatter: (params: any) => {
            const v = params.value;
            const path = v[5] || "";
            const truncatedPath = path.length > 65 ? `${path.substring(0, 65)}...` : path;
            const ip = v[7] || "";
            const ipTruncated = ip.length > 40 ? `${ip.slice(0, 40)}...` : ip;
            const hasDetail = v[3] === 1;
            const source = v[8] || "legacy";
            const client = v[9] || "";
            const sign = v[10] || "";
            const reason = v[11] || "";
            return `<b>requestId:</b> ${escapeHtml(v[4] || "")}<br/><b>source:</b> ${escapeHtml(source)}${client ? ` / ${escapeHtml(client)}` : ""}${sign ? ` / sign=${escapeHtml(sign)}` : ""}${reason ? ` / ${escapeHtml(reason)}` : ""}<br/><b>path:</b> <span title="${escapeHtml(path)}">${escapeHtml(truncatedPath)}</span><br/><b>userId:</b> ${escapeHtml(v[6] || "")}<br/>${ip ? `<b>ip:</b> <span title="${escapeHtml(ip)}">${escapeHtml(ipTruncated)}</span><br/>` : ""}<b>status:</b> ${v[2]}<br/><b>duration:</b> ${Number(v[1]).toFixed(2)} ms<br/>${hasDetail ? "<b>点击查看详情</b>" : "无详情（未采样）"}`;
          },
        },
        xAxis: { type: "time", name: "Time", scale: true, axisLabel: { color: "#64748b" }, nameTextStyle: { color: "#64748b" } },
        yAxis: { type: "value", name: "Duration (ms)", scale: true, axisLabel: { color: "#64748b" }, nameTextStyle: { color: "#64748b" } },
        visualMap: {
          type: "piecewise",
          orient: "horizontal",
          left: "center",
          top: 8,
          pieces: [
            { min: 6000, label: "> 6s", color: "#fca5a5" },
            { min: 3000, max: 6000, label: "3s - 6s", color: "#f97316" },
            { min: 500, max: 3000, label: "500ms - 3s", color: "#86efac" },
            { max: 500, label: "<= 500ms", color: "#22c55e" },
          ],
          dimension: 1,
          seriesIndex: 2,
        },
        series: [
          { name: "Server Errors (5xx)", type: "effectScatter", symbolSize: 12, color: "#dc2626", data: errorData5xx, z: 10 },
          { name: "Client Errors (4xx)", type: "scatter", symbolSize: 10, color: "#144e33", data: errorData4xx, z: 9 },
          { name: "Success", type: "scatter", symbolSize: 8, data: normalData, z: 5 },
        ],
        dataZoom: [
          { type: "inside", disabled: true },
          { type: "slider", startValue: tenMinutesAgo, endValue: now, bottom: 18 },
        ],
        grid: { left: 50, right: 24, top: 64, bottom: 84 },
      },
      true,
    );
  }, [echartsReady, endMs, filteredTraces, startMs, tracesQuery.isFetching]);

  useEffect(() => {
    if (!echartsReady || !metricsChartRef.current) return;
    const chart = metricsChartRef.current;

    if (metricsQuery.isFetching) {
      chart.showLoading("default", {
        text: "正在加载聚合指标...",
        maskColor: "rgba(255,255,255,0.65)",
      });
      return;
    }

    chart.hideLoading();
    const metrics = metricsQuery.data || [];

    if (!metrics.length) {
      chart.setOption({ title: { text: "暂无聚合指标数据", left: "center", top: "center", textStyle: { color: "#94a3b8", fontSize: 14, fontWeight: 500 } } }, true);
      return;
    }

    chart.setOption(
      {
        animation: false,
        tooltip: { trigger: "axis" },
        legend: { data: ["Avg Duration (ms)", "RPS"], top: 8, textStyle: { color: "#64748b", fontSize: 12 } },
        xAxis: { type: "time", axisLabel: { color: "#64748b" } },
        yAxis: [
          { type: "value", name: "Duration (ms)", scale: true, axisLabel: { color: "#64748b" }, nameTextStyle: { color: "#64748b" } },
          { type: "value", name: "RPS", axisLabel: { color: "#64748b" }, nameTextStyle: { color: "#64748b" } },
        ],
        series: [
          {
            name: "Avg Duration (ms)",
            type: "line",
            showSymbol: false,
            smooth: false,
            yAxisIndex: 0,
            lineStyle: { color: "#3b82f6", width: 2 },
            data: metrics.map((d) => [d.timestamp, Number(d.avg_duration_ms).toFixed(2)]),
          },
          {
            name: "RPS",
            type: "line",
            showSymbol: false,
            smooth: false,
            yAxisIndex: 1,
            lineStyle: { color: "#10b981", width: 2 },
            data: metrics.map((d) => [d.timestamp, (d.request_count / intervalSecs).toFixed(2)]),
          },
        ],
        dataZoom: [
          { type: "inside", disabled: true },
          { type: "slider", startValue: startMs, endValue: endMs, bottom: 12 },
        ],
        grid: { left: 50, right: 24, top: 48, bottom: 60 },
      },
      true,
    );
  }, [echartsReady, endMs, intervalSecs, metricsQuery.data, metricsQuery.isFetching, startMs]);

  const traceColumns: ColumnsType<PerfTracePoint> = [
    { title: "时间", key: "ts", width: 170, render: (_, record) => dayjs(record.ts).format("YYYY-MM-DD HH:mm:ss") },
    { title: "状态", dataIndex: "status", key: "status", width: 90, render: (value: number) => <Tag color={statusTagColor(value)}>{value}</Tag> },
    { title: "耗时", dataIndex: "durationMs", key: "durationMs", width: 110, render: (value: number) => formatMs(value) },
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
    { title: "userId", dataIndex: "userId", key: "userId", width: 180, render: (value: string) => value || "-" },
    { title: "IP", dataIndex: "ip", key: "ip", width: 180, render: (value: string) => value || "-" },
    { title: "来源", dataIndex: "source", key: "source", width: 100, render: (value: string) => <Tag color={value === "web" ? "geekblue" : "default"}>{value || "legacy"}</Tag> },
    { title: "Client", dataIndex: "webClientKey", key: "webClientKey", width: 170, render: (value: string) => value || "-" },
    { title: "签名", dataIndex: "webSignResult", key: "webSignResult", width: 100, render: (value: string) => value ? <Tag color={value === "pass" ? "success" : value === "fail" ? "error" : "default"}>{value}</Tag> : "-" },
    { title: "失败原因", dataIndex: "webSignFailReason", key: "webSignFailReason", width: 190, render: (value: string) => value || "-" },
    {
      title: "requestId",
      dataIndex: "requestId",
      key: "requestId",
      width: 220,
      render: (value: string, record) => (
        <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => void openTraceDetail(record)}>
          {value || "-"}
        </Button>
      ),
    },
  ];

  const logSearchQuery = useQuery({
    queryKey: ["perf", "log-search", detailRequestId],
    queryFn: () => fetchLogSearch({ query: detailRequestId, contextLines: 3, limit: 20 }),
    enabled: detailOpen && Boolean(detailRequestId),
  });

  return (
    <PermissionGuard permission="perf-monitor">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }} className="perf-monitor-page">
        <PageSection
          title="性能监控"
          description="实时追踪 API 性能指标、请求分布与接口延迟分析"
          extra={
            <Space size={8} wrap>
              <Tag color={Number(queueQuery.data?.queueLength || 0) > 1000 ? "red" : "blue"}>
                队列积压: {queueQuery.data?.queueLength ?? "--"}
              </Tag>
              <Tag color="geekblue">{rangeText}</Tag>
            </Space>
          }
        >
          <Card
            size="small"
            className="perf-filter-card"
          >
            <div className="perf-filter-shell">
              <div className="perf-filter-group perf-filter-time-group">
                <div className="perf-filter-label">时间范围</div>
                <div className="perf-filter-row">
                  <DatePicker.RangePicker
                    showTime
                    allowClear={false}
                    value={[startTime, endTime]}
                    onChange={(values) => {
                      if (values?.[0] && values?.[1]) {
                        setStartTime(values[0]);
                        setEndTime(values[1]);
                      }
                    }}
                    className="perf-range-picker"
                  />
                  <Button
                    type="primary"
                    className="perf-filter-primary-btn"
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
                    className="perf-filter-secondary-btn"
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
                  <Button
                    className="perf-filter-secondary-btn"
                    onClick={() => setAdvancedSearchOpen((value) => !value)}
                  >
                    {advancedSearchOpen ? "收起筛选" : "高级筛选"}
                  </Button>
                </div>
              </div>

              {advancedSearchOpen ? (
                <div className="perf-advanced-filter">
                  <div className="perf-filter-group">
                    <div className="perf-filter-label">条件筛选</div>
                    <div className="perf-filter-grid">
                      <Input allowClear value={filterUserIdInput} onChange={(event) => setFilterUserIdInput(event.target.value)} placeholder="userId" />
                      <Input allowClear value={filterPathInput} onChange={(event) => setFilterPathInput(event.target.value)} placeholder="path，例如 /api/xhunt" />
                      <Input allowClear value={filterIpInput} onChange={(event) => setFilterIpInput(event.target.value)} placeholder="IP" />
                      <Select
                        value={filterSourceInput}
                        onChange={setFilterSourceInput}
                        options={[
                          { value: "all", label: "全部来源" },
                          { value: "legacy", label: "插件/旧接口" },
                          { value: "web", label: "Web" },
                        ]}
                      />
                      <Input allowClear value={filterWebClientInput} onChange={(event) => setFilterWebClientInput(event.target.value)} placeholder="Web clientKey" />
                      <Select
                        value={filterWebSignInput}
                        onChange={setFilterWebSignInput}
                        options={[
                          { value: "all", label: "全部签名" },
                          { value: "pass", label: "签名通过" },
                          { value: "fail", label: "签名失败" },
                          { value: "skipped", label: "未启用/跳过" },
                        ]}
                      />
                      <Input allowClear value={filterWebSignReasonInput} onChange={(event) => setFilterWebSignReasonInput(event.target.value)} placeholder="签名失败原因" />
                      <div className="perf-filter-actions">
                        <Button
                          type="primary"
                          className="perf-filter-primary-btn"
                          onClick={() => {
                            setFilterUserId(filterUserIdInput);
                            setFilterPath(filterPathInput);
                            setFilterIp(filterIpInput);
                            setFilterSource(filterSourceInput);
                            setFilterWebClient(filterWebClientInput);
                            setFilterWebSign(filterWebSignInput);
                            setFilterWebSignReason(filterWebSignReasonInput);
                          }}
                        >
                          筛选
                        </Button>
                        <Button
                          className="perf-filter-secondary-btn"
                          onClick={() => {
                            setFilterUserIdInput("");
                            setFilterPathInput("");
                            setFilterIpInput("");
                            setFilterSourceInput("all");
                            setFilterWebClientInput("");
                            setFilterWebSignInput("all");
                            setFilterWebSignReasonInput("");
                            setFilterUserId("");
                            setFilterPath("");
                            setFilterIp("");
                            setFilterSource("all");
                            setFilterWebClient("");
                            setFilterWebSign("all");
                            setFilterWebSignReason("");
                          }}
                        >
                          清除
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="perf-filter-group perf-filter-request-group">
                    <div className="perf-filter-label">定位请求详情</div>
                    <div className="perf-filter-row">
                      <Input
                        allowClear
                        value={requestIdSearch}
                        onChange={(event) => setRequestIdSearch(event.target.value)}
                        placeholder="requestId 前缀，例如 b6550afd-9194"
                        className="perf-request-input"
                      />
                      <Button
                        type="primary"
                        className="perf-filter-primary-btn"
                        onClick={() => {
                          if (!requestIdSearch.trim()) {
                            messageApi.info("请先输入 requestId 前缀");
                            return;
                          }
                          if (!requestSearchResult) {
                            messageApi.warning("当前筛选范围内未匹配到 requestId");
                            return;
                          }
                          void openTraceDetail(requestSearchResult);
                        }}
                      >
                        搜索
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <PerfKpiCard label="请求数" value={requestCount || 0} tone="blue" hint="当前窗口" />
            </Col>
            <Col xs={12} md={6}>
              <PerfKpiCard label="RPS" value={Number(rps.toFixed(2))} tone="green" hint="吞吐量" />
            </Col>
            <Col xs={12} md={6}>
              <PerfKpiCard label="平均耗时" value={formatMs(avgDuration)} tone={avgDuration > 1000 ? "orange" : "blue"} hint="Avg" />
            </Col>
            <Col xs={12} md={6}>
              <PerfKpiCard label="P95 耗时" value={formatMs(p95Duration)} tone={p95Duration > 3000 ? "red" : p95Duration > 1000 ? "orange" : "green"} hint="慢请求水位" />
            </Col>
          </Row>

          <Space direction="vertical" size={16} style={{ width: "100%", marginTop: 16 }}>
            <PerfPanelCard title="请求耗时分布（散点图）（采样后）">
              <ChartContainer chartRef={scatterContainerRef} height={SCATTER_HEIGHT} ready={echartsReady} emptyText="ECharts 未加载" />
            </PerfPanelCard>

            <PerfPanelCard title="平均耗时与吞吐量（折线图）（采样后）">
              <ChartContainer chartRef={metricsContainerRef} height={METRICS_HEIGHT} ready={echartsReady} emptyText="ECharts 未加载" />
            </PerfPanelCard>

            <PerfPanelCard title="接口平均耗时排行榜（采样后）">
              <Table
                className="perf-compact-table"
                rowKey="path"
                pagination={false}
                scroll={{ y: 400, x: 860 }}
                size="small"
                columns={[
                  { title: "接口路径", dataIndex: "path", key: "path" },
                  { title: "平均延迟 (ms)", dataIndex: "avgDuration", key: "avgDuration", width: 120, align: "right", render: (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "--") },
                  { title: "中位延迟 (ms)", dataIndex: "medianDuration", key: "medianDuration", width: 120, align: "right", render: (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "--") },
                  { title: "最大延迟 (ms)", dataIndex: "maxDuration", key: "maxDuration", width: 120, align: "right", render: (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "--") },
                  { title: "请求数", dataIndex: "count", key: "count", width: 100, align: "right" },
                ]}
                dataSource={latencyRows}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无足够样本" /> }}
              />
            </PerfPanelCard>

            <PerfPanelCard title="当前窗口请求明细（采样后）">
              <Table
                className="perf-compact-table"
                rowKey={(record) => `${record.requestId}-${record.ts}`}
                columns={traceColumns}
                dataSource={pagedTraces}
                loading={tracesQuery.isFetching}
                pagination={false}
                scroll={{ y: TABLE_MAX_HEIGHT, x: 1680 }}
                locale={{ emptyText: <Empty description="当前时间范围暂无追踪数据" /> }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <Pagination current={tracePage} pageSize={TRACE_PAGE_SIZE} total={filteredTraces.length} showSizeChanger={false} onChange={setTracePage} />
              </div>
            </PerfPanelCard>

            <PerfPanelCard title="指标说明">
              <Space direction="vertical" size={8} className="perf-help-text">
                <Typography.Text><b>RPS</b>（Requests Per Second）：每秒请求数，反映系统吞吐量。</Typography.Text>
                <Typography.Text><b>Avg Duration</b>：统计窗口内的平均耗时（毫秒）。窗口大小由后端聚合（通常 60s 或 300s）。</Typography.Text>
                <Typography.Text><b>队列积压</b>：perf:events:queue 当前长度。持续升高表示后台消费速度不足。</Typography.Text>
                <Typography.Text><b>颜色规则</b>：深红 (5xx)；深绿 (4xx)；浅红 (&gt;6s)；橙色 (3-6s)；浅绿 (500ms-3s)；绿色 (&lt;=500ms)。</Typography.Text>
                <Typography.Text><b>为什么搜索可能有延迟？</b> requestId 详情写入是异步流程，通常会有 1~5 秒延迟。</Typography.Text>
                <Typography.Text><b>采样规则</b>：较快请求只保留极少量采样，其余慢请求与错误请求优先保留。</Typography.Text>
              </Space>
            </PerfPanelCard>
          </Space>

          {queueQuery.isError || kpiQuery.isError || metricsQuery.isError || tracesQuery.isError ? (
            <Alert className="perf-error-alert" type="error" showIcon message="性能监控部分数据加载失败" description="请检查后端 perf-monitor 服务、Redis 队列或管理员登录状态。" />
          ) : null}
        </PageSection>

        <Modal className="perf-detail-modal" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={920} title="请求追踪详情">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="requestId">{detailRequestId || getTraceRequestId(requestSearchResult)}</Descriptions.Item>
            </Descriptions>
            <Card size="small" loading={detailLoading}>
              <pre className="perf-detail-json">
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
                          <div key={`${result.file}-${line.lineNumber}`} className="perf-log-line">
                            <span className="perf-log-line-number">{line.lineNumber}:</span>
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
