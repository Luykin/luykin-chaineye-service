import { useState } from "react";
import { Alert, Button, Card, Dropdown, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { DownOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined, StopOutlined, TeamOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/services/apiClient";
import {
  bulkGrantE2ePublishAccess,
  getE2ePublishAccessMode,
  grantE2ePublishAccess,
  listE2ePublishAccesses,
  revokeE2ePublishAccess,
  type E2ePublishAccess,
  type E2ePublishAccessMode,
  updateE2ePublishAccessMode,
} from "@/services/e2e-campaigns";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "-";

export function E2ePublishAccessCard() {
  const [handle, setHandle] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const queryClient = useQueryClient();
  const queryKey = ["e2e-publish-accesses", "active"];
  const query = useQuery({ queryKey, queryFn: () => listE2ePublishAccesses("active") });
  const modeQuery = useQuery({ queryKey: ["e2e-publish-access-mode"], queryFn: getE2ePublishAccessMode });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["e2e-publish-accesses"] });
    void queryClient.invalidateQueries({ queryKey: ["e2e-publish-access-mode"] });
  };
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
  const updateMode = useMutation({
    mutationFn: updateE2ePublishAccessMode,
    onSuccess: (response) => {
      messageApi.success(response.data.mode === "all" ? "已允许全部用户投放 E2E" : "已恢复为指定用户投放");
      refresh();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const bulkGrant = useMutation({
    mutationFn: bulkGrantE2ePublishAccess,
    onSuccess: ({ data }) => {
      const summary = `共 ${data.total} 人，新增 ${data.created} 人，已存在 ${data.existing} 人`;
      if (data.failed > 0) messageApi.warning(`${summary}，失败 ${data.failed} 人`);
      else messageApi.success(summary);
      refresh();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const normalizedHandle = handle.trim().replace(/^@+/, "");
  const accessMode = modeQuery.data?.data.mode || "allowlist";

  const confirmModeChange = (mode: E2ePublishAccessMode) => {
    if (mode === accessMode) return;
    modalApi.confirm({
      title: mode === "all" ? "允许全部用户投放 E2E？" : "恢复为指定用户投放？",
      content: mode === "all"
        ? "开启后，所有已使用 X 登录的 EchoHunt 用户都可以创建 E2E 投放。现有授权名单会保留。"
        : "关闭全部用户权限后，仅下方授权名单中的用户可以创建 E2E 投放。",
      okText: "确认切换",
      cancelText: "取消",
      onOk: () => updateMode.mutateAsync(mode),
    });
  };

  const confirmBulkGrant = (source: "vip" | "internal_test") => {
    const label = source === "vip" ? "VIP 用户" : "内测用户";
    modalApi.confirm({
      title: `一键添加${label}？`,
      content: `将当前${label}名单批量加入 E2E 投放权限；已有权限的用户会自动跳过。`,
      okText: "确认添加",
      cancelText: "取消",
      onOk: () => bulkGrant.mutateAsync(source),
    });
  };

  return <Card
    size="small"
    style={{ marginBottom: 12 }}
    title={<Space><span>E2E 投放权限</span><Tag color="blue">e2e-publish</Tag></Space>}
    extra={<Button size="small" icon={<ReloadOutlined />} loading={query.isFetching || modeQuery.isFetching} onClick={refresh}>刷新</Button>}
  >
    {contextHolder}
    {modalContextHolder}
    <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
      配置哪些已使用 X 登录的 EchoHunt 用户可以解析推文并创建新的 E2E 支付订单；权限变更不影响已创建的订单和支付激活。
    </Typography.Paragraph>
    <Space wrap size={12} style={{ marginBottom: 12 }}>
      <Space size={8}>
        <Typography.Text strong>可投放范围</Typography.Text>
        <Select<E2ePublishAccessMode>
          aria-label="E2E 可投放范围"
          value={accessMode}
          loading={modeQuery.isLoading || updateMode.isPending}
          disabled={modeQuery.isLoading || modeQuery.isError || updateMode.isPending}
          style={{ width: 160 }}
          options={[
            { value: "allowlist", label: "指定用户" },
            { value: "all", label: "全部用户" },
          ]}
          onChange={confirmModeChange}
        />
      </Space>
      <Dropdown
        disabled={bulkGrant.isPending}
        menu={{
          items: [
            { key: "internal_test", icon: <ExperimentOutlined />, label: "一键添加内测用户" },
            { key: "vip", icon: <TeamOutlined />, label: "一键添加 VIP 用户" },
          ],
          onClick: ({ key }) => confirmBulkGrant(key as "vip" | "internal_test"),
        }}
      >
        <Button loading={bulkGrant.isPending}>
          批量添加名单 <DownOutlined />
        </Button>
      </Dropdown>
    </Space>
    {modeQuery.isError ? <Alert type="error" showIcon message="投放权限范围加载失败" description={getApiErrorMessage(modeQuery.error)} style={{ marginBottom: 12 }} /> : null}
    {accessMode === "all" ? <Alert type="info" showIcon message="当前允许全部用户投放" description="个人授权名单仍会保留，切回“指定用户”后继续生效。" style={{ marginBottom: 12 }} /> : null}
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
