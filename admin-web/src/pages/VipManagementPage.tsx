import { Button, Card, Empty, Input, Modal, Space, Tag, Typography, message } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuth } from "@/app/auth";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  addVipListUser,
  becomeCreator,
  deleteVipListUser,
  fetchFeatureFlagsConfig,
  fetchVipLists,
  publishFeatureFlagsConfig,
  syncVipTwitterIds,
  updateVipTwitterId,
} from "@/services/feature-flags";
import type { VipListItem } from "@/types/feature-flags";

function VipListCard({
  title,
  items,
  onAdd,
  onDelete,
  onEditTwitterId,
  onBecomeCreator,
  creatorLoadingId,
  showCreatorAction,
  loading,
}: {
  title: string;
  items: VipListItem[];
  onAdd: (username: string, twitterId?: string) => void;
  onDelete: (id: number) => void;
  onEditTwitterId: (item: VipListItem) => void;
  onBecomeCreator?: (item: VipListItem) => void;
  creatorLoadingId?: number | null;
  showCreatorAction?: boolean;
  loading?: boolean;
}) {
  const [value, setValue] = useState("");
  const [twitterIdValue, setTwitterIdValue] = useState("");

  const handleAdd = () => {
    const trimmedUser = value.trim();
    if (!trimmedUser) return;
    onAdd(trimmedUser, twitterIdValue.trim() || undefined);
    setValue("");
    setTwitterIdValue("");
  };

  return (
    <div className="vip-card">
      <div className="vip-card-header">
        <span className="vip-card-title">{title}</span>
        <span className="vip-card-count">{items.length} 人</span>
      </div>
      <div className="vip-input-row">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPressEnter={handleAdd}
          placeholder="输入用户名"
          style={{ flex: 1 }}
        />
        <Input
          value={twitterIdValue}
          onChange={(event) => setTwitterIdValue(event.target.value)}
          onPressEnter={handleAdd}
          placeholder="推特 ID（可选）"
          className="vip-input-twitter-id"
        />
        <Button type="primary" loading={loading} onClick={handleAdd}>
          添加
        </Button>
      </div>
      <div className="vip-list">
        {items.length ? (
          items.map((item) => (
            <div className="vip-list-item" key={item.id}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={`@${item.username}`}
                >
                  {item.username}
                </span>
                {item.twitterId ? (
                  <Tag
                    color="blue"
                    style={{ cursor: "pointer", margin: 0, flexShrink: 0 }}
                    onClick={() => onEditTwitterId(item)}
                    title="点击修改 Twitter ID"
                  >
                    ID: {item.twitterId}
                  </Tag>
                ) : (
                  <Tag
                    color="warning"
                    style={{ cursor: "pointer", margin: 0, flexShrink: 0 }}
                    onClick={() => onEditTwitterId(item)}
                    title="点击补充 Twitter ID"
                  >
                    未同步ID
                  </Tag>
                )}
              </span>
              <Space size={6} style={{ flexShrink: 0 }}>
                <Button size="small" onClick={() => onEditTwitterId(item)}>
                  {item.twitterId ? "修改ID" : "补充ID"}
                </Button>
                {showCreatorAction ? (
                  <Button
                    size="small"
                    disabled={!item.twitterId}
                    loading={creatorLoadingId === item.id}
                    onClick={() => onBecomeCreator?.(item)}
                  >
                    成为认证者
                  </Button>
                ) : null}
                <Button size="small" danger onClick={() => onDelete(item.id)}>
                  删除
                </Button>
              </Space>
            </div>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无用户" />
        )}
      </div>
    </div>
  );
}

export function VipManagementPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["vip-lists"], queryFn: fetchVipLists });
  const vip = query.data?.data.vip || [];
  const internalTest = query.data?.data.internalTest || [];
  const isSuperAdmin = user?.role === "super";

  const [editingItem, setEditingItem] = useState<VipListItem | null>(null);
  const [editingTwitterId, setEditingTwitterId] = useState("");

  const addMutation = useMutation({
    mutationFn: ({
      listType,
      username,
      twitterId,
    }: {
      listType: "vip" | "internal_test";
      username: string;
      twitterId?: string;
    }) => addVipListUser(listType, username, twitterId),
    onSuccess: () => {
      messageApi.success("添加成功");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "添加失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVipListUser,
    onSuccess: () => {
      messageApi.success("删除成功");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
  });

  const updateTwitterIdMutation = useMutation({
    mutationFn: ({ id, twitterId }: { id: number; twitterId: string | null }) =>
      updateVipTwitterId(id, twitterId),
    onSuccess: () => {
      messageApi.success("Twitter ID 保存成功");
      setEditingItem(null);
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "更新 Twitter ID 失败"),
  });

  const syncIdMutation = useMutation({
    mutationFn: () => syncVipTwitterIds(true),
    onSuccess: (result) => {
      const data = result.data;
      messageApi.success(`ID同步完成：更新 ${data.updated}，跳过 ${data.skipped}，失败 ${data.failed}`);
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "同步ID失败"),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const read = await fetchFeatureFlagsConfig();
      const config = JSON.parse(read.data.content || "{}");
      if (!config.canaryConfig) config.canaryConfig = { features: [], canaries: [] };
      if (!config.testConfig) config.testConfig = { features: [], testers: [] };
      const vipNames = vip.map((item) => item.username);
      const internalNames = internalTest.map((item) => item.username);
      config.canaryConfig.canaries = Array.from(new Set([...(config.canaryConfig.canaries || []), ...vipNames]));
      config.testConfig.testers = Array.from(new Set([...(config.testConfig.testers || []), ...internalNames]));
      return publishFeatureFlagsConfig(JSON.stringify(config, null, 2));
    },
    onSuccess: () => messageApi.success("已同步到功能开关"),
    onError: (error: Error) => messageApi.error(error.message || "同步失败"),
  });

  const creatorMutation = useMutation({
    mutationFn: becomeCreator,
    onSuccess: () => messageApi.success("已设置为认证者"),
    onError: (error: Error) => messageApi.error(error.message || "设置认证者失败"),
  });

  const confirmBecomeCreator = (item: VipListItem) => {
    if (!item.twitterId) {
      messageApi.warning("该用户未同步 Twitter ID，请先补充或同步ID信息");
      return;
    }
    Modal.confirm({
      title: "确认成为认证者？",
      content: `将为 @${item.username}（ID: ${item.twitterId}）提交认证并在 1 秒后设置认证成功，是否继续？`,
      okText: "继续",
      cancelText: "取消",
      onOk: () => creatorMutation.mutate(item.id),
    });
  };

  const handleOpenEdit = (item: VipListItem) => {
    setEditingItem(item);
    setEditingTwitterId(item.twitterId || "");
  };

  const handleSaveTwitterId = () => {
    if (!editingItem) return;
    const trimmed = editingTwitterId.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      messageApi.error("Twitter ID 必须为纯数字（例如 44196397）");
      return;
    }
    updateTwitterIdMutation.mutate({
      id: editingItem.id,
      twitterId: trimmed || null,
    });
  };

  const handleAddUser = (
    listType: "vip" | "internal_test",
    username: string,
    twitterId?: string
  ) => {
    if (twitterId && !/^\d+$/.test(twitterId)) {
      messageApi.error("Twitter ID 必须为纯数字（例如 44196397）");
      return;
    }
    addMutation.mutate({ listType, username, twitterId });
  };

  const empty = useMemo(() => vip.length === 0 && internalTest.length === 0, [vip.length, internalTest.length]);
  const missingIdCount = useMemo(() => [...vip, ...internalTest].filter((item) => !item.twitterId).length, [vip, internalTest]);

  return (
    <PermissionGuard permission="vip-management">
      {contextHolder}
      <div className="vip-management-container">
        <div className="vip-management-header"><h2>VIP / 内测名单管理</h2></div>
        <div className="vip-management-grid">
          <VipListCard
            title="VIP 名单"
            items={vip}
            loading={addMutation.isPending}
            onAdd={(username, twitterId) => handleAddUser("vip", username, twitterId)}
            onDelete={(id) => deleteMutation.mutate(id)}
            onEditTwitterId={handleOpenEdit}
            showCreatorAction={isSuperAdmin}
            onBecomeCreator={confirmBecomeCreator}
            creatorLoadingId={creatorMutation.isPending ? creatorMutation.variables || null : null}
          />
          <VipListCard
            title="内测名单"
            items={internalTest}
            loading={addMutation.isPending}
            onAdd={(username, twitterId) => handleAddUser("internal_test", username, twitterId)}
            onDelete={(id) => deleteMutation.mutate(id)}
            onEditTwitterId={handleOpenEdit}
            showCreatorAction={isSuperAdmin}
            onBecomeCreator={confirmBecomeCreator}
            creatorLoadingId={creatorMutation.isPending ? creatorMutation.variables || null : null}
          />
        </div>
        <Card size="small" className="vip-sync-section">
          <Space direction="vertical" size={8}>
            <Typography.Text strong>同步ID信息</Typography.Text>
            <Typography.Text type="secondary">根据 username 调用 data.cryptohunt.ai 查询 Twitter ID，并写入数据库。当前待同步 {missingIdCount} 人。</Typography.Text>
            <Button disabled={empty} loading={syncIdMutation.isPending} onClick={() => Modal.confirm({ title: "确认同步ID信息？", content: `将为 VIP ${vip.length} 人、内测 ${internalTest.length} 人刷新 Twitter ID 信息`, onOk: () => syncIdMutation.mutate() })}>同步id信息</Button>
          </Space>
        </Card>
        <Card size="small" className="vip-sync-section">
          <Space direction="vertical" size={8}>
            <Typography.Text strong>同步到功能开关</Typography.Text>
            <Typography.Text type="secondary">将当前 VIP 名单追加到【金丝雀】分组，将内测用户追加到【测试组】。操作仅增加用户，不会删除已有用户。</Typography.Text>
            <Button type="primary" disabled={empty} loading={syncMutation.isPending} onClick={() => Modal.confirm({ title: "确认同步？", content: `VIP ${vip.length} 人，内测 ${internalTest.length} 人`, onOk: () => syncMutation.mutate() })}>一键同步到功能开关</Button>
          </Space>
        </Card>
      </div>
      <Modal
        title={editingItem?.twitterId ? `修改 Twitter ID - @${editingItem.username}` : `补充 Twitter ID - @${editingItem?.username}`}
        open={!!editingItem}
        onCancel={() => setEditingItem(null)}
        onOk={handleSaveTwitterId}
        confirmLoading={updateTwitterIdMutation.isPending}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ padding: "8px 0" }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            部分用户的 Twitter ID 无法通过接口自动获取。手动补充纯数字 Twitter ID（Snowflake ID）后，即可直接开通创作者认证。
          </Typography.Paragraph>
          <div style={{ marginBottom: 8 }}>
            <Typography.Text strong>Twitter ID（纯数字）：</Typography.Text>
          </div>
          <Input
            placeholder="请输入纯数字 Twitter ID，例如 44196397"
            value={editingTwitterId}
            onChange={(event) => setEditingTwitterId(event.target.value.trim())}
            onPressEnter={handleSaveTwitterId}
            autoFocus
            allowClear
          />
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              提示：若清空输入并保存，将清除该用户的 Twitter ID 记录。
            </Typography.Text>
          </div>
        </div>
      </Modal>
    </PermissionGuard>
  );
}
