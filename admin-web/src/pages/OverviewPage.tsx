import { useMemo } from "react";
import {
  Alert,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined, RiseOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchOverviewStats } from "@/services/stats";
import type { OverviewDailyActiveUserItem } from "@/types/stats";

function formatNumber(value: number | string | null | undefined) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("zh-CN").format(numericValue);
}

function calcChange(current: number, previous: number) {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

export function OverviewPage() {
  const query = useQuery({
    queryKey: ["overview-stats"],
    queryFn: fetchOverviewStats,
  });

  const overview = query.data?.data;
  const dailyActiveUsersData = overview?.dailyActiveUsersData ?? [];

  const trendSummary = useMemo(() => {
    if (!dailyActiveUsersData.length) {
      return {
        average: 0,
        maxValue: 0,
      };
    }

    const total = dailyActiveUsersData.reduce((sum, item) => sum + Number(item.activeUsers || 0), 0);
    const maxValue = dailyActiveUsersData.reduce(
      (max, item) => Math.max(max, Number(item.activeUsers || 0)),
      0
    );

    return {
      average: Math.round(total / dailyActiveUsersData.length),
      maxValue,
    };
  }, [dailyActiveUsersData]);

  const totalMetricCards = useMemo(
    () => [
      { label: "总用户数", value: overview?.totalMetrics.totalUsers ?? 0 },
      { label: "总账号数", value: overview?.totalMetrics.totalAccounts ?? 0 },
      { label: "KOL 用户数", value: overview?.totalMetrics.totalKOLUsers ?? 0 },
      { label: "KOL ≤ 20万", value: overview?.totalMetrics.kolBuckets?.within200k ?? 0 },
      { label: "KOL ≤ 5万", value: overview?.totalMetrics.kolBuckets?.within50k ?? 0 },
      { label: "KOL ≤ 2万", value: overview?.totalMetrics.kolBuckets?.within20k ?? 0 },
      { label: "KOL ≤ 5千", value: overview?.totalMetrics.kolBuckets?.within5k ?? 0 },
      { label: "累计积分", value: overview?.totalMetrics.totalPointsAwarded ?? 0 },
      {
        label: "平均评分",
        value: overview?.totalMetrics.averageRating ?? "0.00",
        suffix: "★",
      },
      { label: "今日积分", value: overview?.todayDetails.pointsAwarded ?? 0 },
    ],
    [overview]
  );

  const periodCards = useMemo(
    () => [
      {
        title: "本周",
        color: "#3b82f6",
        reviews: overview?.periodMetrics.weekly.reviews ?? 0,
        newUsers: overview?.periodMetrics.weekly.newUsers ?? 0,
      },
      {
        title: "本月",
        color: "#8b5cf6",
        reviews: overview?.periodMetrics.monthly.reviews ?? 0,
        newUsers: overview?.periodMetrics.monthly.newUsers ?? 0,
      },
    ],
    [overview]
  );

  return (
    <PermissionGuard permission="overview">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="数据概览"
          description="后台总体运行概况，包含最近 7 天设备指纹日活、核心指标、累计数据与周期统计。"
          extra={
            <Space>
              <Tag color="processing" bordered={false}>
                最近 7 天
              </Tag>
              <Tag color="success" bordered={false}>
                实时
              </Tag>
              <a
                onClick={(event) => {
                  event.preventDefault();
                  void query.refetch();
                }}
                style={{ color: "#1677ff" }}
              >
                <ReloadOutlined /> 刷新
              </a>
            </Space>
          }
        >
          {query.isError ? (
            <Alert
              type="error"
              showIcon
              message="加载数据概览失败"
              description="请稍后重试，或检查当前账号是否具备 overview 权限。"
            />
          ) : (
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={14}>
                <Card
                  loading={query.isLoading || query.isFetching}
                  styles={{ body: { padding: 20 } }}
                  title="设备指纹日活统计"
                  extra={<Typography.Text type="secondary">包含已登录 + 未登录访问</Typography.Text>}
                >
                  {dailyActiveUsersData.length ? (
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                      <Row gutter={[12, 12]}>
                        {dailyActiveUsersData.map((item, index) => {
                          const previous = index > 0 ? dailyActiveUsersData[index - 1] : undefined;
                          const change = previous
                            ? calcChange(Number(item.activeUsers || 0), Number(previous.activeUsers || 0))
                            : 0;
                          const isToday = index === dailyActiveUsersData.length - 1;

                          return (
                            <Col xs={12} md={8} xl={12} xxl={8} key={item.date}>
                              <Card
                                size="small"
                                styles={{ body: { padding: 14 } }}
                                style={{
                                  borderColor: isToday ? "#bfdbfe" : "#e5e7eb",
                                  background: isToday ? "#eff6ff" : "#fff",
                                }}
                              >
                                <Space
                                  direction="vertical"
                                  size={8}
                                  style={{ width: "100%" }}
                                >
                                  <Space
                                    align="center"
                                    style={{ width: "100%", justifyContent: "space-between" }}
                                  >
                                    <Typography.Text strong>{item.displayDate}</Typography.Text>
                                    {isToday ? <Tag color="blue">今日</Tag> : null}
                                  </Space>
                                  <Typography.Title level={3} style={{ margin: 0 }}>
                                    {formatNumber(item.activeUsers)}
                                  </Typography.Title>
                                  <Typography.Text type="secondary">{item.date}</Typography.Text>
                                  {previous ? (
                                    <Typography.Text
                                      style={{
                                        color: change >= 0 ? "#16a34a" : "#dc2626",
                                        fontSize: 12,
                                      }}
                                    >
                                      <RiseOutlined rotate={change >= 0 ? 0 : 180} />{" "}
                                      {Math.abs(change).toFixed(1)}%
                                    </Typography.Text>
                                  ) : (
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                      基准日
                                    </Typography.Text>
                                  )}
                                </Space>
                              </Card>
                            </Col>
                          );
                        })}
                      </Row>

                      <Card
                        size="small"
                        styles={{ body: { padding: 16 } }}
                        style={{ background: "#fafcff", borderColor: "#e2e8f0" }}
                      >
                        <Space
                          align="center"
                          style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}
                        >
                          <Typography.Text strong>7 天趋势</Typography.Text>
                          <Typography.Text type="secondary">
                            平均 <strong>{formatNumber(trendSummary.average)}</strong>
                          </Typography.Text>
                        </Space>

                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          {dailyActiveUsersData.map((item: OverviewDailyActiveUserItem) => {
                            const percent = trendSummary.maxValue
                              ? Math.round((Number(item.activeUsers || 0) / trendSummary.maxValue) * 100)
                              : 0;

                            return (
                              <div key={`${item.date}-progress`}>
                                <Space
                                  align="center"
                                  style={{ width: "100%", justifyContent: "space-between" }}
                                >
                                  <Typography.Text>{item.displayDate}</Typography.Text>
                                  <Typography.Text strong>
                                    {formatNumber(item.activeUsers)}
                                  </Typography.Text>
                                </Space>
                                <Progress
                                  percent={percent}
                                  showInfo={false}
                                  strokeColor={item.date === dailyActiveUsersData[dailyActiveUsersData.length - 1]?.date ? "#3b82f6" : "#94a3b8"}
                                  trailColor="#e5e7eb"
                                />
                              </div>
                            );
                          })}
                        </Space>
                      </Card>
                    </Space>
                  ) : (
                    <Empty description="暂无最近 7 天日活数据" />
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={10}>
                <Card
                  loading={query.isLoading || query.isFetching}
                  styles={{ body: { padding: 20 } }}
                  title="核心指标"
                  extra={<Tag color="success">实时</Tag>}
                >
                  <Row gutter={[12, 12]}>
                    <Col span={12}>
                      <Card size="small" styles={{ body: { padding: 16 } }}>
                        <Statistic
                          title="日活用户 (已登录X)"
                          value={overview?.coreMetrics.dailyActiveUsers.value ?? 0}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" styles={{ body: { padding: 16 } }}>
                        <Statistic
                          title="今日评论"
                          value={overview?.coreMetrics.dailyReviews.value ?? 0}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" styles={{ body: { padding: 16 } }}>
                        <Statistic
                          title="评论用户"
                          value={overview?.coreMetrics.dailyReviewUsers.value ?? 0}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" styles={{ body: { padding: 16 } }}>
                        <Statistic
                          title="新注册用户 (已登录X)"
                          value={overview?.coreMetrics.dailyNewUsers.value ?? 0}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Card>
                    </Col>
                  </Row>
                </Card>
              </Col>
            </Row>
          )}
        </PageSection>

        <PageSection
          title="累计数据"
          description="用户体量、KOL 分层、评分与积分累计情况。"
        >
          <Row gutter={[16, 16]}>
            {totalMetricCards.map((item) => (
              <Col xs={12} md={8} xl={6} xxl={4} key={item.label}>
                <Card size="small" styles={{ body: { padding: 16 } }}>
                  <Statistic
                    title={item.label}
                    value={item.value}
                    suffix={item.suffix}
                    formatter={(value) => {
                      if (typeof value === "string" && value.includes(".")) return value;
                      return formatNumber(Number(value || 0));
                    }}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        </PageSection>

        <PageSection title="周期统计" description="查看本周 / 本月的评论与新增用户节奏。">
          <Row gutter={[16, 16]}>
            {periodCards.map((card) => (
              <Col xs={24} md={12} key={card.title}>
                <Card
                  style={{
                    borderColor: `${card.color}22`,
                    background: `${card.color}08`,
                  }}
                  styles={{ body: { padding: 20 } }}
                >
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space align="center">
                      <Tag color={card.color}>{card.title}</Tag>
                    </Space>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Statistic
                          title="评论"
                          value={card.reviews}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="新用户"
                          value={card.newUsers}
                          formatter={(value) => formatNumber(Number(value || 0))}
                        />
                      </Col>
                    </Row>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
