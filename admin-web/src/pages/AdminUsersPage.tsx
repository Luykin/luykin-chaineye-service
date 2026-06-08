import { useMemo, useState } from "react";
import { Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { createAdminUser, fetchAdminUsers, updateAdminDailyReport, updateAdminPermissions, type AdminUserItem } from "@/services/admin-users";

const PERMISSION_OPTIONS = [
  { label: "数据概览", value: "overview" },
  { label: "日活详情", value: "dau-details" },
  { label: "在线用户", value: "online-users" },
  { label: "留存分析", value: "cohorts" },
  { label: "币安广场", value: "binance-square" },
  { label: "备注查看", value: "notes" },
  { label: "日志搜索", value: "log-search:read" },
  { label: "设备监控", value: "device-status:read" },
  { label: "版本统计", value: "version-stats" },
  { label: "接口统计", value: "url-stats" },
  { label: "通用统计", value: "generic-stats" },
  { label: "安全违规", value: "security-violations" },
  { label: "站内消息", value: "messages" },
  { label: "点评管理", value: "reviews-management" },
  { label: "性能监控", value: "perf-monitor" },
  { label: "服务器命令", value: "server:execute" },
  { label: "采集脚本", value: "tampermonkey" },
  { label: "公告配置", value: "nacos-messages" },
  { label: "活动配置", value: "nacos_config" },
  { label: "翻译配置", value: "nacos-i18n" },
  { label: "标签配置", value: "nacos-tags" },
  { label: "功能开关", value: "feature_flags_config" },
  { label: "Banner配置", value: "banner-config" },
  { label: "图片上传", value: "assets:upload" },
  { label: "VIP 管理", value: "vip-management" },
  { label: "Redis 管理", value: "redis-management" },
  { label: "LLM 测试", value: "llm-test" },
  { label: "管理员列表", value: "admin-users" },
  { label: "操作记录", value: "audit-logs:read" },
  { label: "权限管理", value: "admin:manage-permissions" },
];

export function AdminUsersPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [form] = Form.useForm();
  const [permForm] = Form.useForm();

  const query = useQuery({ queryKey: ["admin-users"], queryFn: fetchAdminUsers });
  const rows = query.data?.data || [];

  const createMutation = useMutation({
    mutationFn: (values: { email: string; password: string; role: "admin" | "super"; permissions: string[] }) => createAdminUser(values),
    onSuccess: () => { messageApi.success("管理员已创建"); setCreateOpen(false); form.resetFields(); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "创建失败"),
  });

  const dailyMutation = useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) => updateAdminDailyReport(id, checked),
    onSuccess: () => { messageApi.success("日报配置已更新"); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "更新失败"),
  });

  const permMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: number; permissions: string[] }) => updateAdminPermissions(id, permissions),
    onSuccess: () => { messageApi.success("权限已更新"); setEditingUser(null); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "权限更新失败"),
  });

  const columns = useMemo(() => [
    { title: "ID", dataIndex: "id", width: 64 },
    { title: "邮箱", dataIndex: "email", render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: "角色", dataIndex: "role", width: 110, render: (value: string) => <Tag color={value === "super" ? "gold" : "blue"}>{value}</Tag> },
    { title: "状态", width: 120, render: (_: unknown, row: AdminUserItem) => <Space size={4}><Tag color={row.isActive ? "success" : "default"}>{row.isActive ? "启用" : "停用"}</Tag>{!row.canLogin ? <Tag color="error">锁定</Tag> : null}</Space> },
    { title: "生物识别", dataIndex: "webauthnCount", width: 100, render: (value: number) => `${value || 0} 个` },
    { title: "接收日报", width: 100, render: (_: unknown, row: AdminUserItem) => <Switch size="small" checked={row.receivesDailyReport} loading={dailyMutation.isPending} onChange={(checked) => dailyMutation.mutate({ id: row.id, checked })} /> },
    { title: "权限", dataIndex: "permissions", render: (values: string[]) => <Space wrap size={[4, 4]} className="admin-users-perm-tags">{(values || []).slice(0, 8).map((item) => <Tag key={item}>{item}</Tag>)}{(values || []).length > 8 ? <Tag>+{values.length - 8}</Tag> : null}</Space> },
    { title: "操作", width: 100, render: (_: unknown, row: AdminUserItem) => <Button size="small" onClick={() => { setEditingUser(row); permForm.setFieldsValue({ permissions: row.permissions || [] }); }}>权限</Button> },
  ], [dailyMutation, permForm]);

  return (
    <PermissionGuard permission="admin-users">
      {contextHolder}
      <PageSection
        title="管理员列表"
        description="管理后台账号、日报接收开关和权限清单。"
        extra={<Space><Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增管理员</Button></Space>}
      >
        <Table rowKey="id" size="small" columns={columns} dataSource={rows} loading={query.isFetching} scroll={{ x: 1100 }} pagination={false} />
      </PageSection>

      <Modal title="新增管理员" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} confirmLoading={createMutation.isPending} okText="创建" cancelText="取消" width={760}>
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)} initialValues={{ role: "admin", permissions: [] }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true }, { type: "email" }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>
          <Form.Item name="role" label="角色"><Select options={[{ value: "admin", label: "admin" }, { value: "super", label: "super" }]} /></Form.Item>
          <Form.Item name="permissions" label="权限选择"><Checkbox.Group options={PERMISSION_OPTIONS} className="admin-users-perm-grid" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`编辑权限：${editingUser?.email || ""}`} open={!!editingUser} onCancel={() => setEditingUser(null)} onOk={() => permForm.submit()} confirmLoading={permMutation.isPending} okText="保存" cancelText="取消" width={820}>
        <Form form={permForm} onFinish={(values) => editingUser && permMutation.mutate({ id: editingUser.id, permissions: values.permissions || [] })}>
          <Form.Item name="permissions"><Checkbox.Group options={PERMISSION_OPTIONS} className="admin-users-perm-grid" /></Form.Item>
        </Form>
      </Modal>
    </PermissionGuard>
  );
}
