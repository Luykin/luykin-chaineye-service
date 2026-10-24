import { useState } from "react";
import { Alert, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/services/apiClient";
import {
  grantE2ePublishAccess,
  listE2ePublishAccesses,
  revokeE2ePublishAccess,
  type E2ePublishAccess,
} from "@/services/e2e-campaigns";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "-";

export function E2ePublishAccessCard() {
  const [handle, setHandle] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const queryKey = ["e2e-publish-accesses", "active"];
  const query = useQuery({ queryKey, queryFn: () => listE2ePublishAccesses("active") });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["e2e-publish-accesses"] });
  const grant = useMutation({
    mutationFn: (twitterHandle: string) => grantE2ePublishAccess(twitterHandle),
    onSuccess: (response) => {
      messageApi.success(response.data.created ? "已授予 E2E 投放权限" : "该账号已有投放权限");
      setHandle("");
      refresh();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (accessId: string) => revokeE2ePublishAccess(accessId),
    onSuccess: () => {
      messageApi.success("已撤销 E2E 投放权限");
      refresh();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const normalizedHandle = handle.trim().replace(/^@+/, "");

  return <Card
    size="small"
    style={{ marginBottom: 12 }}
    title={<Space><span>E2E 投放权限</span><Tag color="blue">e2e-publish</Tag></Space>}
    extra={<Button size="small" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>}
  >
    {contextHolder}
    <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
      只有名单内的 X 账号可以解析推文并创建新的 E2E 支付订单；撤销后不影响已经创建的订单和支付激活。
    </Typography.Paragraph>
    <Space.Compact block style={{ marginBottom: 12 }}>
      <Input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        onPressEnter={() => HANDLE_PATTERN.test(normalizedHandle) && grant.mutate(normalizedHandle)}
        prefix="@"
        placeholder="输入项目方 X Handle"
        status={normalizedHandle && !HANDLE_PATTERN.test(normalizedHandle) ? "error" : undefined}
      />
      <Button
        type="primary"
        icon={<PlusOutlined />}
        loading={grant.isPending}
        disabled={!HANDLE_PATTERN.test(normalizedHandle)}
        onClick={() => grant.mutate(normalizedHandle)}
      >
        授予权限
      </Button>
    </Space.Compact>
    {query.isError ? <Alert type="error" showIcon message="投放权限名单加载失败" description={getApiErrorMessage(query.error)} style={{ marginBottom: 12 }} /> : null}
    <Table<E2ePublishAccess>
      rowKey="id"
      size="small"
      loading={query.isLoading}
      dataSource={query.data?.data || []}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已授权账号" /> }}
      pagination={{ pageSize: 8, hideOnSinglePage: true }}
      columns={[
        { title: "X 账号", dataIndex: "twitterHandle", render: (value: string) => <Typography.Text strong>@{value}</Typography.Text> },
        { title: "Twitter ID", dataIndex: "twitterId", render: (value: string | null) => value || <Typography.Text type="secondary">首次登录后自动绑定</Typography.Text> },
        { title: "授权时间", dataIndex: "grantedAt", render: formatTime },
        {
          title: "操作",
          key: "action",
          width: 100,
          render: (_: unknown, row: E2ePublishAccess) => <Popconfirm
            title={`确认撤销 @${row.twitterHandle} 的投放权限？`}
            onConfirm={() => revoke.mutate(row.id)}
          >
            <Button size="small" danger icon={<StopOutlined />} loading={revoke.isPending}>撤销</Button>
          </Popconfirm>,
        },
      ]}
    />
  </Card>;
}
