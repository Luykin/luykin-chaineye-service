import { useMemo, useState } from "react";
import { Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { useAuth } from "@/app/auth";
import { createAdminUser, deleteAdminUser, fetchAdminUsers, resetAdminRandomPassword, unlockAdminUser, updateAdminActiveStatus, updateAdminPermissions, type AdminUserItem } from "@/services/admin-users";


function isAdminUserLocked(row: AdminUserItem) {
  if (!row.canLogin) return true;
  if (row.loginLockedUntil) {
    const lockedUntil = new Date(row.loginLockedUntil).getTime();
    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) return true;
  }
  return false;
}

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
  { label: "Twitter ID转换", value: "twitter-id-handler" },
  { label: "接口调试", value: "api-debugger" },
  { label: "点评管理", value: "reviews-management" },
  { label: "舆论监控", value: "social-listening" },
  { label: "性能监控", value: "perf-monitor" },
  { label: "服务器命令", value: "server:execute" },
  { label: "采集脚本", value: "tampermonkey" },
  { label: "公告配置", value: "nacos-messages" },
  { label: "活动配置", value: "nacos_config" },
  { label: "活动报名删除", value: "campaign-registrations:delete" },
  { label: "热点投票", value: "hot-vote" },
  { label: "翻译配置", value: "nacos-i18n" },
  { label: "标签配置", value: "nacos-tags" },
  { label: "特殊标记配置", value: "special-markers" },
  { label: "净化规则配置", value: "cleaner-config" },
  { label: "功能开关", value: "feature_flags_config" },
  { label: "Banner配置", value: "banner-config" },
  { label: "图片上传", value: "assets:upload" },
  { label: "VIP 管理", value: "vip-management" },
  { label: "Redis 管理", value: "redis-management" },
  { label: "DB Admin 读取", value: "db-admin:read" },
  { label: "DB Admin 写入", value: "db-admin:write" },
  { label: "发布上线", value: "deploy:release" },
  { label: "紧急回滚", value: "deploy:rollback" },
  { label: "LLM 测试", value: "llm-test" },
  { label: "KOL Match配置读取", value: "kol-match-config:read" },
  { label: "KOL Match配置写入", value: "kol-match-config:write" },
  { label: "定向合作活动管理", value: "business_collaboration_manage" },
  { label: "Nacos配置中心", value: "nacos-admin" },
  { label: "管理员列表", value: "admin-users" },
  { label: "操作记录", value: "audit-logs:read" },
  { label: "权限管理", value: "admin:manage-permissions" },
];

export function AdminUsersPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [copyMode, setCopyMode] = useState(false);
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);
  const [form] = Form.useForm();
  const [permForm] = Form.useForm();
  const { user, hasPermission } = useAuth();

  const query = useQuery({ queryKey: ["admin-users"], queryFn: fetchAdminUsers });
  const rows = query.data?.data || [];

  const createMutation = useMutation({
    mutationFn: (values: { email: string; password: string; role: "admin" | "super"; permissions: string[] }) => createAdminUser(values),
    onSuccess: () => { messageApi.success("管理员已创建"); setCreateOpen(false); form.resetFields(); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "创建失败"),
  });

  const permMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: number; permissions: string[] }) => updateAdminPermissions(id, permissions),
    onSuccess: () => { messageApi.success("权限已更新"); setEditingUser(null); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "权限更新失败"),
  });

  const activeStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updateAdminActiveStatus(id, isActive),
    onSuccess: (_response, variables) => {
      messageApi.success(variables.isActive ? "账号已启用" : "账号已停用，已强制退出当前会话");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "账号状态更新失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: AdminUserItem) => deleteAdminUser(row.id),
    onSuccess: () => {
      messageApi.success("管理员账号已删除");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除管理员账号失败"),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (row: AdminUserItem) => resetAdminRandomPassword(row.id),
    onSuccess: (response) => {
      messageApi.success("密码已重置");
      setResetResult({
        email: response.data.email,
        password: response.data.password,
      });
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "重置失败"),
  });

  const unlockMutation = useMutation({
    mutationFn: (row: AdminUserItem) => unlockAdminUser(row.id),
    onSuccess: () => {
      messageApi.success("账号已解锁");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "解锁失败"),
  });

  function confirmUnlock(row: AdminUserItem) {
    Modal.confirm({
      title: "解锁管理员账号",
      content: `确定要解锁 ${row.email} 吗？将恢复登录并清空失败次数。`,
      okText: "解锁",
      cancelText: "取消",
      onOk: () => unlockMutation.mutateAsync(row),
    });
  }

  function confirmResetPassword(row: AdminUserItem) {
    if (Number(user?.id) === Number(row.id)) {
      messageApi.warning("不能重置自己的密码");
      return;
    }
    Modal.confirm({
      title: "重置管理员密码",
      content: `确定要将 ${row.email} 的登录密码重置为随机密码吗？新密码只会显示一次。`,
      okText: "重置",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => resetPasswordMutation.mutateAsync(row),
    });
  }

  function openPermissionEditor(row: AdminUserItem, shouldCopy = false) {
    setEditingUser(row);
    setCopyMode(shouldCopy);
    permForm.setFieldsValue({ permissions: row.permissions || [], copyFromAdminId: undefined });
  }

  function copyPermissionsFrom(sourceId: number) {
    const source = rows.find((row) => Number(row.id) === Number(sourceId));
    if (!source) return;
    permForm.setFieldsValue({ permissions: source.permissions || [] });
    messageApi.info(`已复制 ${source.email} 的权限，可继续修改后保存`);
  }

  function changeAdminActiveStatus(row: AdminUserItem, isActive: boolean) {
    if (isActive) {
      activeStatusMutation.mutate({ id: row.id, isActive });
      return;
    }
    Modal.confirm({
      title: "停用管理员账号",
      content: `确定要停用 ${row.email} 吗？该账号将立即无法继续使用管理后台。`,
      okText: "停用",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => activeStatusMutation.mutateAsync({ id: row.id, isActive }),
    });
  }

  function confirmDeleteAdmin(row: AdminUserItem) {
    Modal.confirm({
      title: "删除管理员账号",
      content: `确定要永久删除 ${row.email} 吗？该账号的生物识别凭证会一并删除，且无法恢复。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => deleteMutation.mutateAsync(row),
    });
  }

  const columns = useMemo(() => [
    { title: "ID", dataIndex: "id", width: 64 },
    { title: "邮箱", dataIndex: "email", render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: "角色", dataIndex: "role", width: 110, render: (value: string) => <Tag color={value === "super" ? "gold" : "blue"}>{value}</Tag> },
    { title: "状态", width: 180, render: (_: unknown, row: AdminUserItem) => {
      const locked = isAdminUserLocked(row);
      const isSelf = Number(user?.id) === Number(row.id);
      const isProtectedSuper = row.role === "super";
      const canManageAccounts = hasPermission("admin:manage-permissions");
      return (
        <Space size={4} wrap>
          <Switch
            size="small"
            checked={row.isActive}
            checkedChildren="启用"
            unCheckedChildren="停用"
            aria-label={`切换 ${row.email} 的账号状态`}
            disabled={!canManageAccounts || isSelf || isProtectedSuper || activeStatusMutation.isPending}
            loading={activeStatusMutation.isPending}
            title={isProtectedSuper ? "超级管理员账号不能停用" : undefined}
            onChange={(isActive) => changeAdminActiveStatus(row, isActive)}
          />
          {isProtectedSuper ? <Tag color="gold">受保护</Tag> : null}
          {locked ? <Tag color="error">锁定</Tag> : null}
        </Space>
      );
    } },
    { title: "生物识别", dataIndex: "webauthnCount", width: 100, render: (value: number) => `${value || 0} 个` },
    { title: "权限", dataIndex: "permissions", render: (values: string[]) => <Space wrap size={[4, 4]} className="admin-users-perm-tags">{(values || []).slice(0, 8).map((item) => <Tag key={item}>{item}</Tag>)}{(values || []).length > 8 ? <Tag>+{values.length - 8}</Tag> : null}</Space> },
    {
      title: "操作",
      width: 360,
      render: (_: unknown, row: AdminUserItem) => {
        const isSelf = Number(user?.id) === Number(row.id);
        const canUnlock = user?.role === "super";
        return (
          <Space size={6} wrap>
            <Button size="small" onClick={() => openPermissionEditor(row)}>权限</Button>
            <Button size="small" onClick={() => openPermissionEditor(row, true)}>复制权限</Button>
            {canUnlock && isAdminUserLocked(row) ? (
              <Button
                size="small"
                type="primary"
                disabled={isSelf}
                loading={unlockMutation.isPending}
                onClick={() => confirmUnlock(row)}
              >
                解锁
              </Button>
            ) : null}
            <Button
              size="small"
              danger
              disabled={isSelf}
              loading={resetPasswordMutation.isPending}
              onClick={() => confirmResetPassword(row)}
            >
              重置密码
            </Button>
            {user?.role === "super" && row.role !== "super" && !isSelf ? (
              <Button
                size="small"
                danger
                loading={deleteMutation.isPending}
                onClick={() => confirmDeleteAdmin(row)}
              >
                删除账号
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ], [activeStatusMutation.isPending, deleteMutation.isPending, hasPermission, permForm, resetPasswordMutation.isPending, rows, unlockMutation.isPending, user?.id, user?.role]);

  return (
    <PermissionGuard permission="admin-users">
      {contextHolder}
      <PageSection
        title="管理员列表"
        description="管理后台账号、日报接收开关和权限清单。"
        extra={<Space><Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增管理员</Button></Space>}
      >
        <Table rowKey="id" size="small" columns={columns} dataSource={rows} loading={query.isFetching} scroll={{ x: 1340 }} pagination={false} />
      </PageSection>

      <Modal title="新增管理员" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} confirmLoading={createMutation.isPending} okText="创建" cancelText="取消" width={760}>
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)} initialValues={{ role: "admin", permissions: [] }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true }, { type: "email" }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>
          <Form.Item name="role" label="角色"><Select options={[{ value: "admin", label: "admin" }, { value: "super", label: "super" }]} /></Form.Item>
          <Form.Item name="permissions" label="权限选择"><Checkbox.Group options={PERMISSION_OPTIONS} className="admin-users-perm-grid" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`${copyMode ? "复制权限" : "编辑权限"}：${editingUser?.email || ""}`} open={!!editingUser} onCancel={() => { setEditingUser(null); setCopyMode(false); }} onOk={() => permForm.submit()} confirmLoading={permMutation.isPending} okText="保存" cancelText="取消" width={820}>
        <Form form={permForm} onFinish={(values) => editingUser && permMutation.mutate({ id: editingUser.id, permissions: values.permissions || [] })}>
          {copyMode ? (
            <Form.Item name="copyFromAdminId" label="复制自">
              <Select
                placeholder="选择要复制权限的管理员"
                options={rows.filter((row) => Number(row.id) !== Number(editingUser?.id)).map((row) => ({ value: row.id, label: `${row.email}（${row.role}）` }))}
                onChange={copyPermissionsFrom}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="permissions"><Checkbox.Group options={PERMISSION_OPTIONS} className="admin-users-perm-grid" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="随机密码已生成"
        open={!!resetResult}
        onCancel={() => setResetResult(null)}
        footer={<Button type="primary" onClick={() => setResetResult(null)}>我已保存</Button>}
      >
        <Typography.Paragraph>
          管理员：<Typography.Text strong>{resetResult?.email}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Paragraph copyable={{ text: resetResult?.password || "" }}>
          <Typography.Text code>{resetResult?.password}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Text type="secondary">该随机密码只在此处显示一次，请立即复制给对应管理员。</Typography.Text>
      </Modal>
    </PermissionGuard>
  );
}
