import { useState } from "react";
import {
  Button,
  Empty,
  Form,
  Input,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchAuditLogs } from "@/services/stats";
import type { AuditLogItem } from "@/types/stats";

const TABLE_MAX_HEIGHT = 520;
const PAGE_SIZE = 50;

interface AuditFilterValues {
  email?: string;
  action?: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
}

export function AuditLogsPage() {
  const [form] = Form.useForm<AuditFilterValues>();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditFilterValues>({});

  const query = useQuery({
    queryKey: ["audit-logs", page, filters.email, filters.action],
    queryFn: () =>
      fetchAuditLogs({
        page,
        limit: PAGE_SIZE,
        email: filters.email?.trim() || undefined,
        action: filters.action?.trim() || undefined,
      }),
  });

  const columns: ColumnsType<AuditLogItem> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value: string) => <Typography.Text>{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 220,
      ellipsis: true,
      render: (value: string | null) => (
        <Typography.Text ellipsis style={{ maxWidth: 180 }}>
          {value || "-"}
        </Typography.Text>
      ),
    },
    {
      title: "动作",
      dataIndex: "action",
      key: "action",
      width: 180,
      render: (value: string | null) => <Tag color="blue">{value || "-"}</Tag>,
    },
    {
      title: "方法",
      dataIndex: "method",
      key: "method",
      width: 100,
      render: (value: string | null) => <Tag>{value || "-"}</Tag>,
    },
    {
      title: "路径",
      dataIndex: "route",
      key: "route",
      width: 240,
      ellipsis: true,
      render: (value: string | null) => (
        <Tooltip title={value || "-"}>
          <Typography.Text ellipsis style={{ maxWidth: 200 }}>
            {value || "-"}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      dataIndex: "success",
      key: "success",
      width: 100,
      render: (value: boolean) =>
        value ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>,
    },
    {
      title: "信息",
      dataIndex: "message",
      key: "message",
      ellipsis: true,
      render: (value: string | null) => (
        <Tooltip title={value || "-"}>
          <Typography.Text ellipsis style={{ maxWidth: 280 }}>
            {value || "-"}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "IP",
      dataIndex: "ip",
      key: "ip",
      width: 150,
      render: (value: string | null) => <Typography.Text>{value || "-"}</Typography.Text>,
    },
  ];

  return (
    <PermissionGuard permission="audit-logs:read">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="操作记录"
          description="管理员操作审计日志，支持按邮箱与动作筛选。"
          extra={
            <Space>
              <Button
                onClick={() => {
                  form.resetFields();
                  setFilters({});
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button type="primary" onClick={() => form.submit()} loading={query.isFetching}>
                查询
              </Button>
            </Space>
          }
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => {
              setFilters(values);
              setPage(1);
            }}
          >
            <Space size={16} wrap style={{ width: "100%" }}>
              <Form.Item label="邮箱" name="email" style={{ minWidth: 280, marginBottom: 0 }}>
                <Input allowClear placeholder="按邮箱筛选" />
              </Form.Item>
              <Form.Item label="动作" name="action" style={{ minWidth: 240, marginBottom: 0 }}>
                <Input allowClear placeholder="按动作筛选" />
              </Form.Item>
            </Space>
          </Form>
        </PageSection>

        <PageSection
          title="日志列表"
          description={`当前第 ${query.data?.pagination.page || page} 页，共 ${
            query.data?.pagination.total || 0
          } 条记录`}
        >
          <Table
            rowKey={(record) => String(record.id)}
            columns={columns}
            dataSource={query.data?.data || []}
            loading={query.isLoading || query.isFetching}
            locale={{
              emptyText: query.isError ? (
                <Empty description="加载操作记录失败" />
              ) : (
                <Empty description="暂无操作记录" />
              ),
            }}
            pagination={{
              current: query.data?.pagination.page || page,
              pageSize: query.data?.pagination.limit || PAGE_SIZE,
              total: query.data?.pagination.total || 0,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (nextPage) => setPage(nextPage),
            }}
            onChange={(pagination: TablePaginationConfig) => {
              if (pagination.current) {
                setPage(pagination.current);
              }
            }}
            scroll={{ y: TABLE_MAX_HEIGHT, x: 1300 }}
          />
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
