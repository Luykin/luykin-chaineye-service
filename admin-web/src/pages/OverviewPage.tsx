import { useMemo, useState } from "react";
import { Alert, DatePicker, Segmented, Spin } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
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
import type {
  OverviewDailyActiveUserItem,
  OverviewWeeklyActiveUserItem,
} from "@/types/stats";

const { RangePicker } = DatePicker;
const ACTIVE_RANGE_PRESETS = [7, 30, 90];

function formatNumber(value: number | string | null | undefined) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("zh-CN").format(numericValue);
}

function getRangeDays(startDate: string, endDate: string) {
  return dayjs(endDate).diff(dayjs(startDate), "day") + 1;
}

function getActivePreset(startDate: string, endDate: string) {
  const today = dayjs().format("YYYY-MM-DD");
  if (endDate !== today) return "custom";
  const days = getRangeDays(startDate, endDate);
  return ACTIVE_RANGE_PRESETS.includes(days) ? String(days) : "custom";
}

function getChartLabelStep(length: number) {
  if (length > 90) return Math.ceil(length / 12);
  if (length > 45) return Math.ceil(length / 10);
  if (length > 24) return Math.ceil(length / 8);
  return 1;
}

type ActivityChartItem = {
  key: string;
  label: string;
  subLabel: string;
  value: number;
  isCurrent?: boolean;
};

function ActivityLineChart({
  title,
  items,
}: {
  title: string;
  items: ActivityChartItem[];
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);
  const chartMaxValue = Math.max(maxValue, 1);
  const labelStep = getChartLabelStep(items.length);
  const width = 1000;
  const height = 240;
  const top = 22;
  const bottom = 198;
  const left = 28;
  const right = 24;
  const chartWidth = width - left - right;
  const chartHeight = bottom - top;
  const points = items.map((item, index) => {
    const x = items.length === 1 ? left + chartWidth / 2 : left + (index / (items.length - 1)) * chartWidth;
    const y = bottom - (item.value / chartMaxValue) * chartHeight;
    return { ...item, x, y };
  });
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = points.length
    ? `M ${points[0].x} ${bottom} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points[points.length - 1].x} ${bottom} Z`
    : "";

  return (
    <div className="overview-activity-panel overview-activity-panel--daily-line">
      <div className="overview-activity-panel-head">
        <span>{title}</span>
        <strong>{formatNumber(maxValue)}</strong>
      </div>

      {items.length ? (
        <div className="overview-line-chart-wrap">
          <svg
            className="overview-line-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="overviewDauLineArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = top + ratio * chartHeight;
              return (
                <line
                  className="overview-line-chart-grid"
                  key={ratio}
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                />
              );
            })}

            {areaPath ? <path className="overview-line-chart-area" d={areaPath} /> : null}
            <polyline className="overview-line-chart-line" points={polylinePoints} />

            {points.map((point, index) => {
              const showLabel =
                index === 0 || index === points.length - 1 || index % labelStep === 0;
              return (
                <g className={point.isCurrent ? "is-current" : ""} key={point.key}>
                  <circle
                    className="overview-line-chart-dot-hit"
                    cx={point.x}
                    cy={point.y}
                    r="14"
                  >
                    <title>{`${point.label}：${formatNumber(point.value)}`}</title>
                  </circle>
                  <circle
                    className="overview-line-chart-dot"
                    cx={point.x}
                    cy={point.y}
                    r={point.isCurrent ? 5.5 : 4}
                  />
                  {showLabel ? (
                    <text className="overview-line-chart-label" x={point.x} y={height - 12}>
                      {point.subLabel}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="overview-activity-empty">
          <LegacyStatsIcon name="empty" />
          <span>暂无活跃数据</span>
        </div>
      )}
    </div>
  );
}

function ActivityBarChart({
  title,
  items,
  variant,
}: {
  title: string;
  items: ActivityChartItem[];
  variant: "daily" | "weekly";
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);
  const chartMaxValue = Math.max(maxValue, 1);
  const labelStep = getChartLabelStep(items.length);

  return (
    <div className={`overview-activity-panel overview-activity-panel--${variant}`}>
      <div className="overview-activity-panel-head">
        <span>{title}</span>
        <strong>{formatNumber(maxValue)}</strong>
      </div>

      {items.length ? (
        <div className="overview-activity-chart" role="list" aria-label={title}>
          {items.map((item, index) => {
            const height = item.value ? Math.max(8, (item.value / chartMaxValue) * 100) : 2;
            const showLabel =
              index === 0 || index === items.length - 1 || index % labelStep === 0;

            return (
              <div
                className={[
                  "overview-activity-bar-cell",
                  item.isCurrent ? "is-current" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.key}
                role="listitem"
                title={`${item.label}：${formatNumber(item.value)}`}
              >
                <span className="overview-activity-bar-value">
                  {formatNumber(item.value)}
                </span>
                <div className="overview-activity-bar-track">
                  <div
                    className="overview-activity-bar"
                    style={{ height: `${height}%` }}
                  />
                </div>
                <span className="overview-activity-bar-label">
                  {showLabel ? item.subLabel : ""}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overview-activity-empty">
          <LegacyStatsIcon name="empty" />
          <span>暂无活跃数据</span>
        </div>
      )}
    </div>
  );
}

function DailyActiveSection({
  items,
  weeklyItems,
  startDate,
  endDate,
  onPresetChange,
  onRangeChange,
}: {
  items: OverviewDailyActiveUserItem[];
  weeklyItems: OverviewWeeklyActiveUserItem[];
  startDate: string;
  endDate: string;
  onPresetChange: (days: number) => void;
  onRangeChange: (range: [Dayjs, Dayjs]) => void;
}) {
  const rangeDays = getRangeDays(startDate, endDate);
  const activePreset = getActivePreset(startDate, endDate);
  const latest = items[items.length - 1];
  const total = items.reduce((sum, item) => sum + Number(item.activeUsers || 0), 0);
  const average = items.length ? Math.round(total / items.length) : 0;
  const peak = items.reduce<OverviewDailyActiveUserItem | null>(
    (max, item) => (!max || item.activeUsers > max.activeUsers ? item : max),
    null
  );
  const dailyChartItems = items.map((item, index) => ({
    key: item.date,
    label: item.displayDate,
    subLabel: item.date.slice(5),
    value: Number(item.activeUsers || 0),
    isCurrent: index === items.length - 1,
  }));
  const weeklyChartItems = weeklyItems.map((item, index) => ({
    key: item.weekStart,
    label: item.displayDate,
    subLabel: item.weekStart.slice(5),
    value: Number(item.activeUsers || 0),
    isCurrent: index === weeklyItems.length - 1,
  }));

  return (
    <div className="overview-section overview-active-section">
      <div className="overview-active-topbar">
        <div>
          <LegacyStatsSectionHeader
            title="活跃用户趋势"
            icon="trend"
            badge={`${startDate} 至 ${endDate}`}
          />
          <p className="overview-section-desc">
            数据来自 PostgreSQL 的 DailyActiveUsers 历史表，按 userId 去重；周活按自然周汇总。
          </p>
        </div>
        <div className="overview-active-controls">
          <Segmented
            value={activePreset}
            onChange={(value) => {
              if (value !== "custom") onPresetChange(Number(value));
            }}
            options={[
              { label: "7天", value: "7" },
              { label: "30天", value: "30" },
              { label: "90天", value: "90" },
              { label: "自定义", value: "custom" },
            ]}
          />
          <RangePicker
            allowClear={false}
            value={[dayjs(startDate), dayjs(endDate)]}
            onChange={(dates) => {
              if (dates?.[0] && dates?.[1]) {
                onRangeChange([dates[0], dates[1]]);
              }
            }}
            disabledDate={(current) => Boolean(current && current > dayjs().endOf("day"))}
          />
        </div>
      </div>

      <div className="overview-active-summary">
        <div className="overview-active-summary-card">
          <span>统计天数</span>
          <strong>{rangeDays}</strong>
          <em>days</em>
        </div>
        <div className="overview-active-summary-card">
          <span>平均日活</span>
          <strong>{formatNumber(average)}</strong>
          <em>DAU</em>
        </div>
        <div className="overview-active-summary-card">
          <span>峰值日活</span>
          <strong>{formatNumber(peak?.activeUsers ?? 0)}</strong>
          <em>{peak?.date ?? "--"}</em>
        </div>
        <div className="overview-active-summary-card is-current">
          <span>区间末日活</span>
          <strong>{formatNumber(latest?.activeUsers ?? 0)}</strong>
          <em>{latest?.date ?? "--"}</em>
        </div>
      </div>

      <div className="overview-activity-panels">
        <ActivityLineChart title="日活用户数（DAU）" items={dailyChartItems} />
        <ActivityBarChart title="周活用户数（WAU）" items={weeklyChartItems} variant="weekly" />
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
  activeUsers,
}: {
  type: "weekly" | "monthly";
  label: string;
  icon: LegacyStatsIconName;
  reviews: number;
  newUsers: number;
  activeUsers?: number;
}) {
  return (
    <div className={`overview-period-card overview-period-card-${type}`}>
      <div className="overview-period-card-header">
        <div className="overview-period-icon">
          <LegacyStatsIcon name={icon} />
        </div>
        <span className="overview-period-label">{label}</span>
      </div>
      <div className="overview-period-metrics">
        {typeof activeUsers === "number" ? (
          <>
            <div className="overview-period-metric">
              <span className="overview-period-metric-value">{formatNumber(activeUsers)}</span>
              <span className="overview-period-metric-label">活跃</span>
            </div>
            <div className="overview-period-metric-divider" />
          </>
        ) : null}
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
  const [activeRange, setActiveRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(29, "day"),
    dayjs(),
  ]);
  const activeStartDate = activeRange[0].format("YYYY-MM-DD");
  const activeEndDate = activeRange[1].format("YYYY-MM-DD");

  const query = useQuery({
    queryKey: ["overview-stats", activeStartDate, activeEndDate],
    queryFn: () =>
      fetchOverviewStats({
        startDate: activeStartDate,
        endDate: activeEndDate,
      }),
  });

  const overview = query.data?.data;
  const activeUsersRange = overview?.activeUsersRange;
  const dailyActiveUsersData = overview?.dailyActiveUsersData ?? [];
  const weeklyActiveUsersData = overview?.weeklyActiveUsersData ?? [];
  const displayedStartDate = activeUsersRange?.startDate ?? activeStartDate;
  const displayedEndDate = activeUsersRange?.endDate ?? activeEndDate;

  function handlePresetChange(days: number) {
    setActiveRange([dayjs().subtract(days - 1, "day"), dayjs()]);
  }

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
          <DailyActiveSection
            items={dailyActiveUsersData}
            weeklyItems={weeklyActiveUsersData}
            startDate={displayedStartDate}
            endDate={displayedEndDate}
            onPresetChange={handlePresetChange}
            onRangeChange={setActiveRange}
          />

          <div className="overview-section">
            <LegacyStatsSectionHeader title="核心指标" />

            <LegacyStatsGrid variant="core">
              <CoreMetricCard
                icon="users"
                tone="blue"
                title="今日活跃身份"
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
            <LegacyStatsSectionHeader title="累计数据" />

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
            <LegacyStatsSectionHeader title="周期统计" />

            <div className="overview-period-stats-grid">
              <PeriodCard
                type="weekly"
                label="本周"
                icon="week"
                reviews={overview?.periodMetrics.weekly.reviews ?? 0}
                newUsers={overview?.periodMetrics.weekly.newUsers ?? 0}
                activeUsers={overview?.periodMetrics.weekly.activeUsers ?? 0}
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
