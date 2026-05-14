import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BarChartOutlined, FieldTimeOutlined, ReloadOutlined } from "@ant-design/icons";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchVersionStats } from "@/services/stats";
import type { VersionStatsDataset } from "@/types/stats";

declare global {
  interface Window {
    Chart?: any;
  }
}

const CHART_JS_SRC = `${import.meta.env.BASE_URL}chart.umd.min.js`;
const LEGACY_CHART_JS_SRC = "/static/js/chart.umd.min.js";

const VERSION_TIME_RANGE_OPTIONS = [
  { label: "最近30分钟", value: "30m" },
  { label: "最近2小时", value: "2h" },
  { label: "最近12小时", value: "12h" },
  { label: "最近2天", value: "2d" },
];

function formatTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function sumDataset(dataset: VersionStatsDataset) {
  return dataset.data.reduce((sum, value) => sum + Number(value || 0), 0);
}

export function VersionStatsPage() {
  const [timeRange, setTimeRange] = useState("30m");
  const [chartReady, setChartReady] = useState(() => typeof window !== "undefined" && !!window.Chart);
  const [chartLoadError, setChartLoadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);

  const query = useQuery({
    queryKey: ["version-stats", timeRange],
    queryFn: () => fetchVersionStats(timeRange),
  });

  const labels = query.data?.labels || [];
  const datasets = query.data?.datasets || [];
  const formattedLabels = useMemo(() => labels.map(formatTimeLabel), [labels]);
  const totalRequests = useMemo(() => datasets.reduce((sum, item) => sum + sumDataset(item), 0), [datasets]);
  const topVersions = useMemo(
    () =>
      datasets
        .map((item) => ({
          version: item.label,
          total: sumDataset(item),
          color: item.borderColor || "#3b82f6",
          latest: Number(item.data[item.data.length - 1] || 0),
        }))
        .sort((a, b) => b.total - a.total),
    [datasets]
  );

  useEffect(() => {
    if (window.Chart) {
      setChartReady(true);
      return;
    }

    let cancelled = false;
    const candidates = Array.from(new Set([CHART_JS_SRC, LEGACY_CHART_JS_SRC]));

    const loadScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existingScript) {
          if (window.Chart) {
            resolve();
            return;
          }
          existingScript.remove();
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener("error", () => reject(new Error(src)), { once: true });
        document.body.appendChild(script);
      });

    (async () => {
      const failedSources: string[] = [];

      for (const src of candidates) {
        try {
          await loadScript(src);
          if (window.Chart) {
            if (!cancelled) {
              setChartReady(true);
              setChartLoadError(null);
            }
            return;
          }
          failedSources.push(`${src}（未暴露 window.Chart）`);
        } catch {
          failedSources.push(src);
        }
      }

      if (!cancelled) {
        setChartLoadError(`无法加载 Chart.js，已尝试：${failedSources.join("、")}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const Chart = window.Chart;
    if (!canvas || !Chart || !chartReady || !query.data?.success) return;

    const chartData = {
      labels: formattedLabels,
      datasets: datasets.map((dataset) => ({
        ...dataset,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        fill: false,
      })),
    };

    if (!chartRef.current) {
      chartRef.current = new Chart(canvas, {
        type: "line",
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: "top", labels: { usePointStyle: true, boxWidth: 8 } },
            title: { display: false },
            tooltip: { mode: "index", intersect: false },
          },
          scales: {
            x: {
              display: true,
              title: { display: true, text: "时间" },
              ticks: { maxRotation: 45, minRotation: 45 },
              grid: { color: "rgba(148, 163, 184, 0.16)" },
            },
            y: {
              display: true,
              title: { display: true, text: "请求次数" },
              beginAtZero: true,
              grid: { color: "rgba(148, 163, 184, 0.18)" },
            },
          },
          interaction: { mode: "nearest", axis: "x", intersect: false },
        },
      });
    } else {
      chartRef.current.data = chartData;
      chartRef.current.update();
    }
  }, [chartReady, datasets, formattedLabels, query.data?.success]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy?.();
      chartRef.current = null;
    };
  }, []);

  const columns: ColumnsType<(typeof topVersions)[number]> = [
    {
      title: "版本",
      dataIndex: "version",
      render: (value, record) => <Tag color={record.color}>{value || "未知版本"}</Tag>,
    },
    {
      title: "请求总数",
      dataIndex: "total",
      sorter: (a, b) => a.total - b.total,
      render: (value) => value.toLocaleString(),
    },
    {
      title: "最新窗口",
      dataIndex: "latest",
      sorter: (a, b) => a.latest - b.latest,
      render: (value) => value.toLocaleString(),
    },
  ];

  return (
    <PermissionGuard permission="version-stats">
      <PageSection
        title="版本统计"
        description="查看各版本在不同时间段的请求趋势，沿用旧版 Chart.js 图表能力。"
        extra={
          <Space wrap>
            <Select value={timeRange} options={VERSION_TIME_RANGE_OPTIONS} onChange={setTimeRange} style={{ width: 140 }} />
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>
              刷新
            </Button>
          </Space>
        }
      >
        <div className="request-stats-page version-stats-page-react">
          <Row gutter={[14, 14]} className="request-stats-summary-row">
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--blue">
                <Statistic title="版本数量" value={query.data?.totalVersions || 0} prefix={<BarChartOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--green">
                <Statistic title="请求总数" value={totalRequests} prefix={<FieldTimeOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--purple">
                <Statistic title="时间窗口" value={labels.length} suffix="个" />
              </Card>
            </Col>
          </Row>

          {query.isError ? <Alert type="error" showIcon message="加载版本统计失败" description={query.error.message} /> : null}

          <Card className="request-stats-card" title="版本请求趋势">
            {!query.isLoading && !datasets.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围暂无版本统计数据" />
            ) : chartLoadError ? (
              <Alert type="warning" showIcon message="Chart.js 加载失败" description={chartLoadError} />
            ) : !chartReady ? (
              <div className="request-stats-chart-loading">正在加载图表库...</div>
            ) : (
              <div className="request-stats-chart-wrap">
                <canvas ref={canvasRef} />
              </div>
            )}
          </Card>

          <Card className="request-stats-card" title="版本排行">
            <Table
              rowKey="version"
              size="small"
              columns={columns}
              dataSource={topVersions}
              loading={query.isLoading || query.isFetching}
              pagination={false}
              scroll={{ y: 360 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无版本数据" /> }}
            />
          </Card>
        </div>
      </PageSection>
    </PermissionGuard>
  );
}
