import { useMemo } from "react";
import { Alert, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
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

function Icon({ name }: { name: string }) {
  if (name === "monitor") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }

  if (name === "layers") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    );
  }

  if (name === "bars") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  if (name === "trend") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="m18.7 8-5.1 5.2-2.8-2.7L7 14.3" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (name === "message") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
      </svg>
    );
  }

  if (name === "user") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }

  if (name === "user-plus") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    );
  }

  if (name === "week") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M2 12h20" />
        <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" />
        <path d="m12 12 4-4" />
        <path d="m12 12-4-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
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

function SectionHeader({
  title,
  icon,
  iconClass,
  badge,
  live,
}: {
  title: string;
  icon: string;
  iconClass: string;
  badge?: string;
  live?: boolean;
}) {
  return (
    <div className="overview-section-header">
      <div className="overview-section-title-wrapper">
        <div className={`overview-section-icon ${iconClass}`}>
          <Icon name={icon} />
        </div>
        <h2 className="overview-section-title">{title}</h2>
      </div>
      {badge ? (
        <span className={`overview-section-badge ${live ? "overview-badge-live" : ""}`}>
          {live ? <span className="overview-live-pulse" /> : null}
          {badge}
        </span>
      ) : null}
    </div>
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
      <SectionHeader
        title="设备指纹日活统计"
        icon="monitor"
        iconClass="overview-icon-blue"
        badge="最近7天"
      />
      <p className="overview-section-desc">
        基于设备指纹统计，包含所有访问用户（已登录 + 未登录）
      </p>

      <div className="overview-stats-grid overview-daily-stats-grid">
        {items.length ? (
          items.map((item, index) => {
            const isToday = index === items.length - 1;
            const previous = index > 0 ? items[index - 1] : undefined;
            const change = previous
              ? calcChange(Number(item.activeUsers || 0), Number(previous.activeUsers || 0))
              : 0;
            const isPositive = change >= 0;

            return (
              <div
                className={`overview-stat-card ${isToday ? "overview-stat-card-highlight" : ""}`}
                key={item.date}
              >
                <div className="overview-stat-card-header">
                  <span className="overview-stat-date">{item.displayDate}</span>
                  {isToday ? <span className="overview-today-badge">今日</span> : null}
                </div>
                <div className="overview-stat-value-large">
                  {formatNumber(item.activeUsers)}
                </div>
                <div className="overview-stat-meta">
                  <span className="overview-stat-full-date">{item.date}</span>
                </div>
                {!isToday && index > 0 ? (
                  <div
                    className={`overview-stat-trend ${
                      isPositive ? "overview-trend-up" : "overview-trend-down"
                    }`}
                  >
                    <TrendArrow positive={isPositive} />
                    <span>{Math.abs(change).toFixed(1)}%</span>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="overview-stat-card overview-stat-card-empty">
            <div className="overview-empty-state">
              <Icon name="empty" />
              <span>暂无数据</span>
            </div>
          </div>
        )}
      </div>

      <div className="overview-trend-chart-container">
        <div className="overview-trend-chart-header">
          <div className="overview-trend-chart-title">
            <Icon name="trend" />
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
  className,
  icon,
  title,
  value,
}: {
  className: string;
  icon: string;
  title: string;
  value: number;
}) {
  return (
    <div className={`overview-stat-card ${className}`}>
      <div className="overview-stat-card-icon">
        <Icon name={icon} />
      </div>
      <div className="overview-stat-card-content">
        <div className="overview-stat-title">{title}</div>
        <div className="overview-stat-value">{formatNumber(value)}</div>
      </div>
    </div>
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
    <div className={`overview-stat-card overview-stat-card-minimal ${className || ""}`}>
      <div className="overview-stat-title">{label}</div>
      <div className={`overview-stat-value ${suffix ? "overview-rating-value" : ""}`}>
        {displayValue}
        {suffix ? <span className="overview-star-icon">{suffix}</span> : null}
      </div>
    </div>
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
            <SectionHeader
              title="核心指标"
              icon="layers"
              iconClass="overview-icon-purple"
              badge="实时"
              live
            />

            <div className="overview-stats-grid overview-core-metrics-grid">
              <CoreMetricCard
                className="overview-stat-card-blue"
                icon="users"
                title="日活用户 (已登录X)"
                value={overview?.coreMetrics.dailyActiveUsers.value ?? 0}
              />
              <CoreMetricCard
                className="overview-stat-card-green"
                icon="message"
                title="今日评论"
                value={overview?.coreMetrics.dailyReviews.value ?? 0}
              />
              <CoreMetricCard
                className="overview-stat-card-orange"
                icon="user"
                title="评论用户"
                value={overview?.coreMetrics.dailyReviewUsers.value ?? 0}
              />
              <CoreMetricCard
                className="overview-stat-card-pink"
                icon="user-plus"
                title="新注册用户 (已登录X)"
                value={overview?.coreMetrics.dailyNewUsers.value ?? 0}
              />
            </div>
          </div>

          <div className="overview-section">
            <SectionHeader
              title="累计数据"
              icon="bars"
              iconClass="overview-icon-teal"
            />

            <div className="overview-stats-grid overview-total-metrics-grid">
              {totalMetricCards.map((item) => (
                <TotalMetricCard
                  className={item.className}
                  key={item.label}
                  label={item.label}
                  suffix={item.suffix}
                  value={item.value}
                />
              ))}
            </div>
          </div>

          <div className="overview-section overview-section-period">
            <SectionHeader
              title="周期统计"
              icon="calendar"
              iconClass="overview-icon-indigo"
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
