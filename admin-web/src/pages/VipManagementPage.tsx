import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import { CrownOutlined, ExperimentOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnsType } from "antd/es/table";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  addVipListUserAndSync,
  becomeCreator,
  deleteVipListUser,
  fetchVipLists,
  fetchVipMemberships,
  syncVipTwitterIds,
  updateVipTwitterId,
} from "@/services/feature-flags";
import type { VipListItem, VipMembershipItem } from "@/types/feature-flags";

function formatTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "-";
}

function InternalTestCard({
  items,
  onAdd,
  onDelete,
  onEditTwitterId,
  onBecomeCreator,
  creatorLoadingId,
  loading,
}: {
  items: VipListItem[];
  onAdd: (username: string, twitterId?: string) => void;
  onDelete: (id: number) => void;
  onEditTwitterId: (item: VipListItem) => void;
  onBecomeCreator: (item: VipListItem) => void;
  creatorLoadingId?: number | null;
  loading?: boolean;
}) {
  const [value, setValue] = useState("");
  const [twitterIdValue, setTwitterIdValue] = useState("");
  const handleAdd = () => {
    const username = value.trim();
    if (!username) return;
    onAdd(username, twitterIdValue.trim() || undefined);
    setValue("");
    setTwitterIdValue("");
  };

  return (
    <div className="vip-card vip-card--internal-test">
      <div className="vip-card-header">
        <div className="vip-card-heading">
          <span className="vip-card-icon"><ExperimentOutlined /></span>
          <div>
            <span className="vip-card-title">内测名单</span>
            <span className="vip-card-descriptor">继续由管理后台维护</span>
          </div>
        </div>
        <span className="vip-card-count">{items.length} 人</span>
      </div>
      <div className="vip-input-row">
        <Input value={value} onChange={(event) => setValue(event.target.value)} onPressEnter={handleAdd} placeholder="输入用户名" />
        <Input value={twitterIdValue} onChange={(event) => setTwitterIdValue(event.target.value)} onPressEnter={handleAdd} placeholder="X ID（可选）" className="vip-input-twitter-id" />
        <Button type="primary" loading={loading} onClick={handleAdd}>添加</Button>
      </div>
      <div className="vip-list">
        {items.length ? items.map((item) => (
          <div className="vip-list-item" key={item.id}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span title={`@${item.username || ""}`}>@{item.username || "-"}</span>
              <Tag color={item.twitterId ? "blue" : "warning"}>{item.twitterId ? `ID: ${item.twitterId}` : "未同步 ID"}</Tag>
            </span>
            <Space size={6}>
              <Button size="small" onClick={() => onEditTwitterId(item)}>{item.twitterId ? "修改 ID" : "补充 ID"}</Button>
              <Button size="small" disabled={!item.twitterId} loading={creatorLoadingId === item.id} onClick={() => onBecomeCreator(item)}>成为认证者</Button>
              <Button size="small" danger onClick={() => onDelete(item.id)}>删除</Button>
            </Space>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内测用户" />}
      </div>
    </div>
  );
}

export function VipManagementPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<"active" | "expired" | "all">("all");
  const [origin, setOrigin] = useState<"legacy_manual" | "membership_api" | undefined>();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const membershipQuery = useQuery({
    queryKey: ["vip-memberships", page, pageSize, status, origin, keyword],
    queryFn: () => fetchVipMemberships({ page, pageSize, status, origin, keyword }),
  });
  const listQuery = useQuery({ queryKey: ["vip-lists"], queryFn: fetchVipLists });
  const internalTest = listQuery.data?.data.internalTest || [];

  const [editingItem, setEditingItem] = useState<VipListItem | null>(null);
  const [editingTwitterId, setEditingTwitterId] = useState("");

  const addMutation = useMutation({
    mutationFn: ({ username, twitterId }: { username: string; twitterId?: string }) =>
      addVipListUserAndSync("internal_test", username, twitterId),
    onSuccess: ({ data: { idSync } }) => {
      messageApi.success(`内测用户添加完成：ID 更新 ${idSync.updated}，跳过 ${idSync.skipped}，失败 ${idSync.failed}`);
      void listQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "添加失败"),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteVipListUser,
    onSuccess: () => { messageApi.success("删除成功"); void listQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
  });
  const updateTwitterIdMutation = useMutation({
    mutationFn: ({ id, twitterId }: { id: number; twitterId: string | null }) => updateVipTwitterId(id, twitterId),
    onSuccess: () => { messageApi.success("X ID 保存成功"); setEditingItem(null); void listQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "更新 X ID 失败"),
  });
  const syncIdMutation = useMutation({
    mutationFn: () => syncVipTwitterIds(true),
    onSuccess: ({ data }) => { messageApi.success(`ID 同步完成：更新 ${data.updated}，跳过 ${data.skipped}，失败 ${data.failed}`); void listQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "同步 ID 失败"),
  });
  const creatorMutation = useMutation({
    mutationFn: becomeCreator,
    onSuccess: () => messageApi.success("已设置为认证者"),
    onError: (error: Error) => messageApi.error(error.message || "设置认证者失败"),
  });

  const columns = useMemo<ColumnsType<VipMembershipItem>>(() => [
    { title: "X ID", dataIndex: "twitterId", width: 180 },
    { title: "用户名快照", dataIndex: "username", render: (value: string | null) => value ? `@${value}` : "-" },
    { title: "状态", dataIndex: "status", width: 90, render: (value) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "有效" : "已过期"}</Tag> },
    { title: "过期时间", dataIndex: "expiresAt", width: 180, render: formatTime },
    { title: "首次来源", dataIndex: "origin", width: 130, render: (value) => value === "membership_api" ? "会员接口" : "历史手工" },
    { title: "最近接口开通", dataIndex: "lastApiGrantedAt", width: 180, render: formatTime },
    { title: "最近订单号", dataIndex: "lastApiOrderNo", ellipsis: true, render: (value) => value || "-" },
    { title: "强制过期时间", dataIndex: "forceExpiredAt", width: 180, render: formatTime },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: formatTime },
  ], []);

  const validateTwitterId = (value?: string) => !value || /^\d+$/.test(value);
  const openEdit = (item: VipListItem) => { setEditingItem(item); setEditingTwitterId(item.twitterId || ""); };
  const saveTwitterId = () => {
    if (!editingItem) return;
    const value = editingTwitterId.trim();
    if (!validateTwitterId(value)) return void messageApi.error("X ID 必须为纯数字");
    updateTwitterIdMutation.mutate({ id: editingItem.id, twitterId: value || null });
  };
  const becomeInternalCreator = (item: VipListItem) => {
    if (!item.twitterId) return void messageApi.warning("请先补充 X ID");
    Modal.confirm({ title: "确认成为认证者？", content: `将为 @${item.username || "-"}（ID: ${item.twitterId}）提交认证`, onOk: () => creatorMutation.mutate(item.id) });
  };

  return (
    <PermissionGuard permission="vip-management">
      {contextHolder}
      <div className="vip-management-container">
        <div className="vip-management-header"><h2>VIP 会员 / 内测名单</h2></div>
        <Card className="vip-card vip-card--vip" title={<Space><CrownOutlined />VIP 会员（只读）</Space>}>
          <Alert type="info" showIcon message="VIP 由内部会员服务按 X ID 开通；管理后台仅查看，不提供添加、删除、修改或派生权限同步。" style={{ marginBottom: 16 }} />
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} onSearch={(value) => { setPage(1); setKeyword(value.trim()); }} allowClear placeholder="搜索 X ID 或用户名" style={{ width: 280 }} />
            <Select value={status} onChange={(value) => { setPage(1); setStatus(value); }} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "有效" }, { value: "expired", label: "已过期" }]} style={{ width: 130 }} />
            <Select allowClear value={origin} onChange={(value) => { setPage(1); setOrigin(value); }} placeholder="全部来源" options={[{ value: "legacy_manual", label: "历史手工" }, { value: "membership_api", label: "会员接口" }]} style={{ width: 140 }} />
            <Button onClick={() => void membershipQuery.refetch()}>刷新</Button>
          </Space>
          <Table<VipMembershipItem>
            rowKey="id"
            columns={columns}
            dataSource={membershipQuery.data?.data.items || []}
            loading={membershipQuery.isLoading || membershipQuery.isFetching}
            scroll={{ x: 1450 }}
            pagination={{
              current: membershipQuery.data?.data.pagination.page || page,
              pageSize,
              total: membershipQuery.data?.data.pagination.total || 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              onChange: (nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); },
            }}
          />
        </Card>

        <div style={{ marginTop: 20 }}>
          <InternalTestCard
            items={internalTest}
            loading={addMutation.isPending}
            onAdd={(username, twitterId) => {
              if (!validateTwitterId(twitterId)) return void messageApi.error("X ID 必须为纯数字");
              addMutation.mutate({ username, twitterId });
            }}
            onDelete={(id) => deleteMutation.mutate(id)}
            onEditTwitterId={openEdit}
            onBecomeCreator={becomeInternalCreator}
            creatorLoadingId={creatorMutation.isPending ? creatorMutation.variables || null : null}
          />
          <Card size="small" className="vip-sync-section">
            <Space direction="vertical" size={8}>
              <Typography.Text strong>同步内测用户 ID</Typography.Text>
              <Typography.Text type="secondary">仅刷新内测名单，不会修改 VIP 会员。</Typography.Text>
              <Button disabled={!internalTest.length} loading={syncIdMutation.isPending} onClick={() => syncIdMutation.mutate()}>同步 ID 信息</Button>
            </Space>
          </Card>
        </div>
      </div>
      <Modal title={`修改 X ID - @${editingItem?.username || "-"}`} open={!!editingItem} onCancel={() => setEditingItem(null)} onOk={saveTwitterId} confirmLoading={updateTwitterIdMutation.isPending} destroyOnClose>
        <Typography.Paragraph type="secondary">只接受纯数字 X ID；清空后保存会移除当前记录。</Typography.Paragraph>
        <Input value={editingTwitterId} onChange={(event) => setEditingTwitterId(event.target.value.trim())} onPressEnter={saveTwitterId} allowClear autoFocus />
      </Modal>
    </PermissionGuard>
  );
}
