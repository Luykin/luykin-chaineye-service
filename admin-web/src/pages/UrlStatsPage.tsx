import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Empty, Input, Progress, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiOutlined, LinkOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchUrlStats } from "@/services/stats";
import type { UrlStatsItem } from "@/types/stats";

const URL_TIME_RANGE_OPTIONS = [
  { label: "最近30分钟", value: "30m" },
  { label: "最近1小时", value: "1h" },
  { label: "最近2小时", value: "2h" },
  { label: "最近4小时", value: "4h" },
  { label: "最近1天", value: "1d" },
  { label: "最近2天", value: "2d" },
];

function normalizePercent(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function UrlStatsPage() {
  const [timeRange, setTimeRange] = useState("30m");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["url-stats", timeRange],
    queryFn: () => fetchUrlStats(timeRange),
  });

  const allUrlStats = query.data?.data.urlStats || [];
  const filteredStats = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return allUrlStats;
    return allUrlStats.filter((item) => item.urlPath.toLowerCase().includes(keyword));
  }, [allUrlStats, search]);

  const filteredRequests = useMemo(() => filteredStats.reduce((sum, item) => sum + Number(item.count || 0), 0), [filteredStats]);
  const topPath = filteredStats[0]?.urlPath || "-";

  const columns: ColumnsType<UrlStatsItem & { rank: number }> = [
    {
      title: "排名",
      dataIndex: "rank",
      width: 80,
      fixed: "left",
      render: (rank) => <span className={`request-rank request-rank--${rank <= 3 ? rank : "normal"}`}>{rank}</span>,
    },
    {
      title: "接口路径",
      dataIndex: "urlPath",
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text copyable className="url-stats-path" title={value}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: "请求数量",
      dataIndex: "count",
      width: 140,
      sorter: (a, b) => a.count - b.count,
      render: (value: number) => <Typography.Text strong>{value.toLocaleString()}</Typography.Text>,
    },
    {
      title: "占比",
      dataIndex: "percent",
      width: 220,
      sorter: (a, b) => normalizePercent(a.percent) - normalizePercent(b.percent),
      render: (value) => {
        const percent = normalizePercent(value);
        return (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Typography.Text className="url-stats-percent-text">{percent.toFixed(2)}%</Typography.Text>
            <Progress percent={Math.min(percent, 100)} size="small" showInfo={false} />
          </Space>
        );
      },
    },
  ];

  const dataSource = filteredStats.map((item, index) => ({ ...item, rank: index + 1 }));

  return (
    <PermissionGuard permission="url-stats">
      <PageSection
        title="接口统计"
        description="查看各接口在不同时间段的请求排行榜，支持按路径搜索。"
        extra={
          <Space wrap>
            <Select value={timeRange} options={URL_TIME_RANGE_OPTIONS} onChange={setTimeRange} style={{ width: 140 }} />
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>
              刷新
            </Button>
          </Space>
        }
      >
        <div className="request-stats-page url-stats-page-react">
          <Row gutter={[14, 14]} className="request-stats-summary-row">
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--blue">
                <Statistic title={search.trim() ? "筛选后请求数" : "总请求数"} value={filteredRequests} prefix={<ApiOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--green">
                <Statistic title={search.trim() ? "筛选后接口数" : "接口数量"} value={filteredStats.length} prefix={<LinkOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="request-stat-card request-stat-card--purple">
                <Statistic title="时间窗口" value={query.data?.data.timeWindows || 0} suffix="个" />
              </Card>
            </Col>
          </Row>

          {query.isError ? <Alert type="error" showIcon message="加载接口统计失败" description={query.error.message} /> : null}

          <Card
            className="request-stats-card"
            title="接口请求排行"
            extra={
              <Space wrap>
                <Tag color="blue">Top: {topPath}</Tag>
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索接口路径，例如 /me 或 /api/xhunt/proxy"
                  style={{ width: 320 }}
                />
              </Space>
            }
          >
            <Table
              rowKey={(record) => record.urlPath}
              size="small"
              columns={columns}
              dataSource={dataSource}
              loading={query.isLoading || query.isFetching}
              pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (total) => `共 ${total} 条接口` }}
              scroll={{ x: 900, y: 560 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search.trim() ? "未找到匹配接口" : "暂无接口统计数据"} /> }}
            />
          </Card>
        </div>
      </PageSection>
    </PermissionGuard>
  );
}
