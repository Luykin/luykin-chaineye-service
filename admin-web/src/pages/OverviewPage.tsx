import { useMemo } from "react";
import { Alert, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  LegacyStatCard,
  LegacyStatsGrid,
  LegacyStatsIcon,
  LegacyStatsSectionHeader,
} from "@/components/ui/LegacyStats";
import type { LegacyStatsIconName, LegacyTone } from "@/components/ui/LegacyStats";
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

function TrendArrow({ positive }: { positive: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline
        points={
          positive
            ? "23 6 13.5 15.5 8.5 10.5 1 18"
            : "23 18 13.5 8.5 8.5 13.5 1 6"
        }
      />
    </svg>
  );
}

function DailyActiveSection({
  items,
}: {
  items: OverviewDailyActiveUserItem[];
}) {
  const trendSummary = useMemo(() => {
    if (!items.length) {
      return { average: 0, maxValue: 0 };
    }

    const total = items.reduce((sum, item) => sum + Number(item.activeUsers || 0), 0);
    const maxValue = items.reduce(
      (max, item) => Math.max(max, Number(item.activeUsers || 0)),
      0
    );

    return {
      average: Math.round(total / items.length),
      maxValue,
    };
  }, [items]);

  return (
    <div className="overview-section">
      <LegacyStatsSectionHeader
        title="设备指纹日活统计"
        icon="monitor"
        tone="blue"
        badge="最近7天"
      />
      <p className="overview-section-desc">
        基于设备指纹统计，包含所有访问用户（已登录 + 未登录）
      </p>

      <LegacyStatsGrid variant="daily">
        {items.length ? (
          items.map((item, index) => {
            const isToday = index === items.length - 1;
            const previous = index > 0 ? items[index - 1] : undefined;
            const change = previous
              ? calcChange(Number(item.activeUsers || 0), Number(previous.activeUsers || 0))
              : 0;
            const isPositive = change >= 0;

            return (
              <LegacyStatCard
                centered
                highlighted={isToday}
                key={item.date}
                title={item.displayDate}
                badge={isToday ? "今日" : undefined}
                value={formatNumber(item.activeUsers)}
                meta={
                  <span className="overview-stat-full-date">{item.date}</span>
                }
                trend={
                  !isToday && index > 0 ? (
                    <span
                    className={`overview-stat-trend ${
                      isPositive ? "overview-trend-up" : "overview-trend-down"
                    }`}
                  >
                    <TrendArrow positive={isPositive} />
                    <span>{Math.abs(change).toFixed(1)}%</span>
                  </span>
                  ) : undefined
                }
              />
            );
          })
        ) : (
          <div className="legacy-stat-card overview-stat-card-empty">
            <div className="overview-empty-state">
              <LegacyStatsIcon name="empty" />
              <span>暂无数据</span>
            </div>
          </div>
        )}
      </LegacyStatsGrid>

      <div className="overview-trend-chart-container">
        <div className="overview-trend-chart-header">
          <div className="overview-trend-chart-title">
            <LegacyStatsIcon name="trend" />
            <span>7天趋势</span>
          </div>
          {items.length ? (
            <div className="overview-trend-chart-avg">
              平均: <strong>{formatNumber(trendSummary.average)}</strong>
            </div>
          ) : null}
        </div>

        <div className="overview-trend-chart">
          {items.map((item, index) => {
            const height = trendSummary.maxValue
              ? Math.max(20, (Number(item.activeUsers || 0) / trendSummary.maxValue) * 140)
              : 20;
            const isToday = index === items.length - 1;

            return (
              <div className="overview-trend-bar-wrapper" key={`${item.date}-bar`}>
                <div
                  className={`overview-trend-bar ${
                    isToday ? "overview-trend-bar-today" : ""
                  }`}
                  style={{ height }}
                >
                  <span className="overview-trend-bar-value">
                    {formatNumber(item.activeUsers)}
                  </span>
                </div>
                <span className="overview-trend-bar-label">
                  {item.displayDate.split(" ")[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CoreMetricCard({
  icon,
  tone,
  title,
  value,
}: {
  icon: LegacyStatsIconName;
  tone: LegacyTone;
  title: string;
  value: number;
}) {
  return (
    <LegacyStatCard icon={icon} tone={tone} title={title} value={formatNumber(value)} />
  );
}

function TotalMetricCard({
  label,
  value,
  className,
  suffix,
}: {
  label: string;
  value: number | string;
  className?: string;
  suffix?: string;
}) {
  const displayValue =
    typeof value === "string" && value.includes(".") ? value : formatNumber(value);

  return (
    <LegacyStatCard
      minimal
      className={className}
      title={label}
      value={displayValue}
      suffix={suffix}
    />
  );
}

function PeriodCard({
  type,
  label,
  icon,
  reviews,
  newUsers,
}: {
  type: "weekly" | "monthly";
  label: string;
  icon: string;
  reviews: number;
  newUsers: number;
}) {
  return (
    <div className={`overview-period-card overview-period-card-${type}`}>
      <div className="overview-period-card-header">
        <div className="overview-period-icon">
          <Icon name={icon} />
        </div>
        <span className="overview-period-label">{label}</span>
      </div>
      <div className="overview-period-metrics">
        <div className="overview-period-metric">
          <span className="overview-period-metric-value">{formatNumber(reviews)}</span>
          <span className="overview-period-metric-label">评论</span>
        </div>
        <div className="overview-period-metric-divider" />
        <div className="overview-period-metric">
          <span className="overview-period-metric-value">{formatNumber(newUsers)}</span>
          <span className="overview-period-metric-label">新用户</span>
        </div>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const query = useQuery({
    queryKey: ["overview-stats"],
    queryFn: fetchOverviewStats,
  });

  const overview = query.data?.data;
  const dailyActiveUsersData = overview?.dailyActiveUsersData ?? [];

  const totalMetricCards = useMemo(
    () => [
      {
        label: "总用户数",
        value: overview?.totalMetrics.totalUsers ?? 0,
      },
      {
        label: "总账号数",
        value: overview?.totalMetrics.totalAccounts ?? 0,
      },
      {
        label: "KOL 用户数",
        value: overview?.totalMetrics.totalKOLUsers ?? 0,
        className: "overview-stat-card-kol",
      },
      {
        label: "KOL ≤ 20万",
        value: overview?.totalMetrics.kolBuckets?.within200k ?? 0,
        className: "overview-stat-card-kol-tier",
      },
      {
        label: "KOL ≤ 5万",
        value: overview?.totalMetrics.kolBuckets?.within50k ?? 0,
        className: "overview-stat-card-kol-tier",
      },
      {
        label: "KOL ≤ 2万",
        value: overview?.totalMetrics.kolBuckets?.within20k ?? 0,
        className: "overview-stat-card-kol-tier",
      },
      {
        label: "KOL ≤ 5千",
        value: overview?.totalMetrics.kolBuckets?.within5k ?? 0,
        className: "overview-stat-card-kol-tier",
      },
      {
        label: "累计积分",
        value: overview?.totalMetrics.totalPointsAwarded ?? 0,
        className: "overview-stat-card-points",
      },
      {
        label: "平均评分",
        value: overview?.totalMetrics.averageRating ?? "0.00",
        className: "overview-stat-card-rating",
        suffix: "★",
      },
      {
        label: "今日积分",
        value: overview?.todayDetails.pointsAwarded ?? 0,
        className: "overview-stat-card-points-today",
      },
    ],
    [overview]
  );

  return (
    <PermissionGuard permission="overview">
      <div className="overview-stats-section">
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="加载数据概览失败"
            description="请稍后重试，或检查当前账号是否具备 overview 权限。"
          />
        ) : null}

        <Spin spinning={query.isLoading || query.isFetching}>
          <DailyActiveSection items={dailyActiveUsersData} />

          <div className="overview-section">
            <LegacyStatsSectionHeader
              title="核心指标"
              icon="layers"
              tone="purple"
              badge="实时"
              live
            />

            <LegacyStatsGrid variant="core">
              <CoreMetricCard
                icon="users"
                tone="blue"
                title="日活用户 (已登录X)"
                value={overview?.coreMetrics.dailyActiveUsers.value ?? 0}
              />
              <CoreMetricCard
                icon="message"
                tone="green"
                title="今日评论"
                value={overview?.coreMetrics.dailyReviews.value ?? 0}
              />
              <CoreMetricCard
                icon="user"
                tone="orange"
                title="评论用户"
                value={overview?.coreMetrics.dailyReviewUsers.value ?? 0}
              />
              <CoreMetricCard
                icon="user-plus"
                tone="pink"
                title="新注册用户 (已登录X)"
                value={overview?.coreMetrics.dailyNewUsers.value ?? 0}
              />
            </LegacyStatsGrid>
          </div>

          <div className="overview-section">
            <LegacyStatsSectionHeader
              title="累计数据"
              icon="bars"
              tone="teal"
            />

            <LegacyStatsGrid variant="total">
              {totalMetricCards.map((item) => (
                <TotalMetricCard
                  className={item.className}
                  key={item.label}
                  label={item.label}
                  suffix={item.suffix}
                  value={item.value}
                />
              ))}
            </LegacyStatsGrid>
          </div>

          <div className="overview-section overview-section-period">
            <LegacyStatsSectionHeader
              title="周期统计"
              icon="calendar"
              tone="indigo"
            />

            <div className="overview-period-stats-grid">
              <PeriodCard
                type="weekly"
                label="本周"
                icon="week"
                reviews={overview?.periodMetrics.weekly.reviews ?? 0}
                newUsers={overview?.periodMetrics.weekly.newUsers ?? 0}
              />
              <PeriodCard
                type="monthly"
                label="本月"
                icon="calendar"
                reviews={overview?.periodMetrics.monthly.reviews ?? 0}
                newUsers={overview?.periodMetrics.monthly.newUsers ?? 0}
              />
            </div>
          </div>
        </Spin>
      </div>
    </PermissionGuard>
  );
}
