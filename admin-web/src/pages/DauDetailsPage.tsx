import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchDauDetails } from "@/services/stats";
import type { DauDetailItem } from "@/types/stats";

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
    return details.filter(
      (item: DauDetailItem) =>
        item.fingerprint.toLowerCase().includes(keyword) ||
        item.userId.toLowerCase().includes(keyword)
    );
  }, [details, search]);

  const summary = useMemo(() => {
    const totalCount = details.length;
    const validUsers = details.filter((item: DauDetailItem) => item.userId !== "未知");
    const uniqueUsers = new Set(validUsers.map((item: DauDetailItem) => item.userId)).size;
    const unknownUsers = totalCount - validUsers.length;
    return { totalCount, uniqueUsers, unknownUsers };
  }, [details]);

  const columns: ColumnsType<DauDetailItem> = [
    {
      title: "用户 ID",
      dataIndex: "userId",
      key: "userId",
      render: (value: string) =>
        value === "未知" ? <Tag color="default">未知</Tag> : <Typography.Text copyable>{value}</Typography.Text>,
    },
    {
      title: "设备指纹",
      dataIndex: "fingerprint",
      key: "fingerprint",
      render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
    },
  ];

  return (
    <PermissionGuard permission="dau-details">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="日活详情"
          description="查看指定日期的日活明细，支持按用户 ID 或设备指纹搜索。"
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
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="指纹日活总数" value={summary.totalCount} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="去重用户数" value={summary.uniqueUsers} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="未知用户数" value={summary.unknownUsers} />
              </Card>
            </Col>
          </Row>
        </PageSection>

        <PageSection
          title="明细列表"
          description={`${selectedDate} 的日活明细`}
          extra={
            <Input.Search
              allowClear
              placeholder="搜索用户 ID 或设备指纹"
              style={{ width: 280 }}
              onChange={(e) => setSearch(e.target.value)}
            />
          }
        >
          <Table
            rowKey={(record) => `${record.userId}-${record.fingerprint}`}
            columns={columns}
            dataSource={filtered}
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
