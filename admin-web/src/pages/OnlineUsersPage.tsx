import { useMemo, useState } from "react";
import {
  Button,
  Empty,
  Input,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { LegacyStatCard, LegacyStatsGrid } from "@/components/ui/LegacyStats";
import { fetchOnlineUsers } from "@/services/stats";
import type { OnlineUserItem } from "@/types/stats";

const TABLE_MAX_HEIGHT = 520;

function getTimeAgo(dateString: string) {
  const now = dayjs();
  const target = dayjs(dateString);
  const diffMinutes = now.diff(target, "minute");

  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = now.diff(target, "hour");
  if (diffHours < 24) return `${diffHours} 小时前`;
  return `${now.diff(target, "day")} 天前`;
}

export function OnlineUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["online-users", page],
    queryFn: () => fetchOnlineUsers({ page, limit: 100 }),
  });

  const users = query.data?.data.users ?? [];
  const pagination = query.data?.data.pagination;

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter(
      (user: OnlineUserItem) =>
        user.username.toLowerCase().includes(keyword) ||
        user.displayName.toLowerCase().includes(keyword) ||
        user.twitterId.toLowerCase().includes(keyword)
    );
  }, [users, search]);

  const columns: ColumnsType<OnlineUserItem> = [
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: "显示名称",
      dataIndex: "displayName",
      key: "displayName",
    },
    {
      title: "推特 ID",
      dataIndex: "twitterId",
      key: "twitterId",
    },
    {
      title: "最后使用",
      dataIndex: "lastUsed",
      key: "lastUsed",
      render: (value: string) => (
        <Typography.Text title={dayjs(value).format("YYYY-MM-DD HH:mm:ss")}>
          {getTimeAgo(value)}
        </Typography.Text>
      ),
    },
  ];

  return (
    <PermissionGuard permission="online-users">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="在线用户"
          description="查看最近 10 分钟内有活动的已登录用户。"
          extra={
            <Button type="primary" onClick={() => query.refetch()} loading={query.isFetching}>
              刷新
            </Button>
          }
        >
          <LegacyStatsGrid className="admin-summary-grid">
            <LegacyStatCard minimal title="在线用户" value={pagination?.totalCount ?? 0} accent="#3b82f6" />
            <LegacyStatCard minimal title="当前页" value={pagination?.currentPage ?? 1} accent="#8b5cf6" />
            <LegacyStatCard minimal title="总页数" value={pagination?.totalPages ?? 1} accent="#10b981" />
          </LegacyStatsGrid>
        </PageSection>

        <PageSection
          title="用户列表"
          description="支持搜索用户名、显示名称或推特 ID。"
          extra={
            <Input.Search
              allowClear
              placeholder="搜索用户名 / 显示名称 / 推特 ID"
              style={{ width: 320 }}
              onChange={(e) => setSearch(e.target.value)}
            />
          }
        >
          <Table
            rowKey={(record) => record.id}
            columns={columns}
            dataSource={filtered}
            scroll={{ y: TABLE_MAX_HEIGHT }}
            loading={query.isLoading || query.isFetching}
            locale={{
              emptyText: query.isError ? (
                <Empty description="加载在线用户失败" />
              ) : (
                <Empty description="最近 10 分钟内暂无在线用户" />
              ),
            }}
            pagination={{
              current: pagination?.currentPage ?? page,
              total: pagination?.totalCount ?? 0,
              pageSize: pagination?.pageSize ?? 100,
              showSizeChanger: false,
              onChange: (nextPage) => setPage(nextPage),
            }}
            onChange={(nextPagination: TablePaginationConfig) => {
              if (nextPagination.current) {
                setPage(nextPagination.current);
              }
            }}
          />
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
