import { useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Empty,
  Input,
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
import { LegacyStatCard, LegacyStatsGrid } from "@/components/ui/LegacyStats";
import { fetchDauDetails } from "@/services/stats";
import type { DauDetailItem } from "@/types/stats";

const TABLE_MAX_HEIGHT = 520;

const IDENTITY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  twitterId: { label: "Twitter ID", color: "blue" },
  fingerprint: { label: "设备指纹", color: "green" },
  legacy_pair: { label: "旧版指纹+用户", color: "orange" },
  legacy_fingerprint: { label: "旧版指纹", color: "default" },
};

function getIdentityTypeMeta(type?: string) {
  return IDENTITY_TYPE_LABELS[type || ""] || { label: type || "未知", color: "default" };
}

function getTodayInBeijing() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  )
    .toISOString()
    .split("T")[0];
}

export function DauDetailsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayInBeijing());
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["dau-details", selectedDate],
    queryFn: () => fetchDauDetails(selectedDate),
  });

  const details = query.data?.data.details ?? [];

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return details;
    return details.filter((item: DauDetailItem) =>
      [item.identityType, item.twitterId, item.fingerprint, item.userId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [details, search]);

  const summary = useMemo(() => {
    const totalCount = details.length;
    const twitterIdUsers = details.filter((item: DauDetailItem) => item.identityType === "twitterId" && item.twitterId);
    const uniqueTwitterIds = new Set(twitterIdUsers.map((item: DauDetailItem) => item.twitterId)).size;
    const fingerprintUsers = details.filter((item: DauDetailItem) => item.identityType !== "twitterId").length;
    return { totalCount, uniqueTwitterIds, fingerprintUsers };
  }, [details]);

  const columns: ColumnsType<DauDetailItem> = [
    {
      title: "身份类型",
      dataIndex: "identityType",
      key: "identityType",
      width: 150,
      render: (value: string | undefined) => {
        const meta = getIdentityTypeMeta(value);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "Twitter ID",
      dataIndex: "twitterId",
      key: "twitterId",
      render: (value: string | null | undefined) =>
        value ? <Typography.Text copyable>{value}</Typography.Text> : <Tag color="default">-</Tag>,
    },
    {
      title: "用户 ID / 兼容字段",
      dataIndex: "userId",
      key: "userId",
      render: (value: string) =>
        value === "未知" ? <Tag color="default">未知</Tag> : <Typography.Text copyable>{value}</Typography.Text>,
    },
    {
      title: "设备指纹",
      dataIndex: "fingerprint",
      key: "fingerprint",
      render: (value: string | null | undefined) =>
        value ? <Typography.Text copyable>{value}</Typography.Text> : <Tag color="default">-</Tag>,
    },
  ];

  return (
    <PermissionGuard permission="dau-details">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="日活详情"
          description="查看指定日期的日活身份明细，支持按 Twitter ID、用户 ID、设备指纹或身份类型搜索。"
          extra={
            <Space>
              <DatePicker
                value={dayjs(selectedDate)}
                onChange={(value: Dayjs | null) => {
                  if (value) setSelectedDate(value.format("YYYY-MM-DD"));
                }}
                allowClear={false}
              />
              <Button type="primary" onClick={() => query.refetch()} loading={query.isFetching}>
                刷新
              </Button>
            </Space>
          }
        >
          <LegacyStatsGrid className="admin-summary-grid">
            <LegacyStatCard minimal title="日活身份总数" value={summary.totalCount} accent="#3b82f6" />
            <LegacyStatCard minimal title="Twitter ID 数" value={summary.uniqueTwitterIds} accent="#10b981" />
            <LegacyStatCard minimal title="指纹/旧版身份数" value={summary.fingerprintUsers} accent="#94a3b8" />
          </LegacyStatsGrid>
        </PageSection>

        <PageSection
          title="明细列表"
          description={`${selectedDate} 的日活明细`}
          extra={
            <Input.Search
              allowClear
              placeholder="搜索 Twitter ID / 用户 ID / 指纹"
              style={{ width: 280 }}
              onChange={(e) => setSearch(e.target.value)}
            />
          }
        >
          <Table
            rowKey={(record) => `${record.identityType || "unknown"}-${record.twitterId || ""}-${record.userId || ""}-${record.fingerprint || ""}`}
            columns={columns}
            dataSource={filtered}
            scroll={{ y: TABLE_MAX_HEIGHT }}
            loading={query.isLoading || query.isFetching}
            locale={{
              emptyText: query.isError ? (
                <Empty description="加载日活详情失败" />
              ) : (
                <Empty description="当前日期暂无日活明细" />
              ),
            }}
            pagination={{
              pageSize: 100,
              showSizeChanger: false,
            }}
          />
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
