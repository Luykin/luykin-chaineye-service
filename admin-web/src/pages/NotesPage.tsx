import { useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { LegacyStatCard, LegacyStatsGrid } from "@/components/ui/LegacyStats";
import { fetchNotes } from "@/services/stats";
import type { NoteItem } from "@/types/stats";

const TABLE_MAX_HEIGHT = 560;

function getTodayInBeijing() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }))
    .toISOString()
    .split("T")[0];
}

function formatDateTime(value?: string) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-";
}

type SortMode = "newest" | "oldest" | "user" | "account";

export function NotesPage() {
  const [date, setDate] = useState(getTodayInBeijing());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");

  const query = useQuery({
    queryKey: ["notes", date, page],
    queryFn: () => fetchNotes({ date, page, limit: 50 }),
  });

  const notes = query.data?.data.notes || [];

  const filteredNotes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let result = notes.filter((item) => {
      if (!keyword) return true;
      return [item.note, item.userUsername, item.userDisplayName, item.accountHandle, item.accountDisplayName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });

    result = [...result].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf();
        case "user":
          return String(a.userUsername || a.userDisplayName || "").localeCompare(
            String(b.userUsername || b.userDisplayName || "")
          );
        case "account":
          return String(a.accountHandle || a.accountDisplayName || "").localeCompare(
            String(b.accountHandle || b.accountDisplayName || "")
          );
        case "newest":
        default:
          return dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf();
      }
    });

    return result;
  }, [notes, search, sort]);

  const columns: ColumnsType<NoteItem> = [
    {
      title: "备注用户",
      key: "user",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.userDisplayName || "-"}</Typography.Text>
          <Typography.Text type="secondary">@{record.userUsername || "-"}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "被备注账号",
      key: "account",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.accountDisplayName || "-"}</Typography.Text>
          <Typography.Text type="secondary">@{record.accountHandle || "-"}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "备注内容",
      dataIndex: "note",
      key: "note",
      render: (value: string) => <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}>{value || "-"}</Typography.Paragraph>,
    },
    {
      title: "备注时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <PermissionGuard permission="notes">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="备注查看"
          description="查看指定日期内的全部备注记录，支持搜索备注内容、备注人和被备注账号。"
          extra={
            <Space wrap>
              <DatePicker
                value={dayjs(date)}
                onChange={(value) => {
                  if (value) {
                    setDate(value.format("YYYY-MM-DD"));
                    setPage(1);
                  }
                }}
                allowClear={false}
              />
              <Button type="primary" onClick={() => query.refetch()} loading={query.isFetching}>
                加载数据
              </Button>
            </Space>
          }
        >
          <LegacyStatsGrid className="admin-summary-grid">
            <LegacyStatCard minimal title="总备注数" value={query.data?.data.stats.totalNotes || 0} accent="#3b82f6" />
            <LegacyStatCard minimal title="备注用户数" value={query.data?.data.stats.uniqueUsers || 0} accent="#10b981" />
            <LegacyStatCard minimal title="被备注账号数" value={query.data?.data.stats.uniqueAccounts || 0} accent="#8b5cf6" />
          </LegacyStatsGrid>
        </PageSection>

        <PageSection
          title="备注列表"
          description={`${date} 的备注明细`}
          extra={
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="搜索备注内容、用户名或账号"
                style={{ width: 260 }}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select<SortMode>
                value={sort}
                onChange={setSort}
                style={{ width: 180 }}
                options={[
                  { label: "按时间排序（最新）", value: "newest" },
                  { label: "按时间排序（最旧）", value: "oldest" },
                  { label: "按用户排序", value: "user" },
                  { label: "按账号排序", value: "account" },
                ]}
              />
            </Space>
          }
        >
          <Table
            rowKey={(record) => String(record.id)}
            columns={columns}
            dataSource={filteredNotes}
            loading={query.isLoading || query.isFetching}
            scroll={{ y: TABLE_MAX_HEIGHT }}
            locale={{
              emptyText: query.isError ? (
                <Empty description="加载备注数据失败" />
              ) : (
                <Empty description="当前日期暂无备注记录" />
              ),
            }}
            pagination={{
              current: query.data?.data.pagination.currentPage || page,
              pageSize: query.data?.data.pagination.pageSize || 50,
              total: query.data?.data.pagination.totalCount || 0,
              onChange: (nextPage) => setPage(nextPage),
              showSizeChanger: false,
            }}
          />
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
