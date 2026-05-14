import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchDailyCohorts } from "@/services/stats";
import type { DailyCohortItem } from "@/types/stats";

const TABLE_MAX_HEIGHT = 560;
const { RangePicker } = DatePicker;

function getDefaultRange() {
  return [dayjs().subtract(8, "day"), dayjs()] as [Dayjs, Dayjs];
}

function formatPercent(value: string | number) {
  const num = Number(value || 0);
  return `${num.toFixed(1)}%`;
}

function getRetentionColor(value: string | number) {
  const num = Number(value || 0);
  if (num >= 40) return "success";
  if (num >= 20) return "processing";
  if (num > 0) return "warning";
  return "default";
}

function getDayActive(record: DailyCohortItem, day: number) {
  const map: Record<number, number> = {
    2: record.day2Active,
    3: record.day3Active,
    4: record.day4Active,
    5: record.day5Active,
    6: record.day6Active,
    7: record.day7Active,
    8: record.day8Active,
    9: record.day9Active,
    10: record.day10Active,
  };
  return map[day] || 0;
}

function getDayRetention(record: DailyCohortItem, day: number) {
  const map: Record<number, string | number> = {
    2: record.day2Retention,
    3: record.day3Retention,
    4: record.day4Retention,
    5: record.day5Retention,
    6: record.day6Retention,
    7: record.day7Retention,
    8: record.day8Retention,
    9: record.day9Retention,
    10: record.day10Retention,
  };
  return map[day] || 0;
}

export function CohortsPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(getDefaultRange());

  const params = useMemo(
    () => ({
      startDate: range[0].format("YYYY-MM-DD"),
      endDate: range[1].format("YYYY-MM-DD"),
    }),
    [range]
  );

  const query = useQuery({
    queryKey: ["daily-cohorts", params.startDate, params.endDate],
    queryFn: () => fetchDailyCohorts(params),
  });

  const data = query.data?.data;

  const columns: ColumnsType<DailyCohortItem> = [
    {
      title: "首次活跃日期",
      dataIndex: "cohortDate",
      key: "cohortDate",
      fixed: "left",
      width: 150,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当日日活 {record.dailyActiveUsers}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "新用户数",
      dataIndex: "newUsers",
      key: "newUsers",
      width: 100,
      align: "center",
    },
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((day) => ({
      title: `第${day}天`,
      key: `day${day}`,
      width: 110,
      align: "center" as const,
      render: (_: unknown, record: DailyCohortItem) => {
        const active = getDayActive(record, day);
        const retention = getDayRetention(record, day);
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text>{active}</Typography.Text>
            <Tag color={getRetentionColor(retention)}>{formatPercent(retention)}</Tag>
          </Space>
        );
      },
    })),
  ];

  return (
    <PermissionGuard permission="cohorts">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="留存分析"
          description="基于用户首次活跃日期，追踪第 2~10 天留存。当前为天级留存分析，最大建议跨度 3 个月。"
          extra={
            <Space wrap>
              <RangePicker
                value={range}
                onChange={(values) => {
                  if (values?.[0] && values?.[1]) {
                    setRange([values[0], values[1]]);
                  }
                }}
                allowClear={false}
              />
              <Button type="primary" onClick={() => query.refetch()} loading={query.isFetching}>
                查询
              </Button>
              <Button
                onClick={() => {
                  setRange(getDefaultRange());
                }}
              >
                重置为最近 8 天
              </Button>
            </Space>
          }
        >
          {query.isError ? (
            <Alert type="error" showIcon message="加载留存分析失败" />
          ) : (
            <Card styles={{ body: { padding: 0 } }}>
              <Table
                rowKey={(record) => record.cohortDate}
                columns={columns}
                dataSource={data?.cohorts || []}
                loading={query.isLoading || query.isFetching}
                scroll={{ x: 1280, y: TABLE_MAX_HEIGHT }}
                pagination={false}
                locale={{
                  emptyText: <Empty description="当前日期范围暂无留存数据" />,
                }}
              />
            </Card>
          )}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
