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
} from "@/services/feature-flags";
import type { VipListItem } from "@/types/feature-flags";

function VipListCard({
  title,
  items,
  onAdd,
  onDelete,
  onBecomeCreator,
  creatorLoadingId,
  showCreatorAction,
  loading,
}: {
  title: string;
  items: VipListItem[];
  onAdd: (username: string) => void;
  onDelete: (id: number) => void;
  onBecomeCreator?: (item: VipListItem) => void;
  creatorLoadingId?: number | null;
  showCreatorAction?: boolean;
  loading?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="vip-card">
      <div className="vip-card-header"><span className="vip-card-title">{title}</span><span className="vip-card-count">{items.length} 人</span></div>
      <div className="vip-input-row">
        <Input value={value} onChange={(event) => setValue(event.target.value)} onPressEnter={() => { if (value.trim()) { onAdd(value.trim()); setValue(""); } }} placeholder="输入用户名，回车添加" />
        <Button type="primary" loading={loading} onClick={() => { if (value.trim()) { onAdd(value.trim()); setValue(""); } }}>添加</Button>
      </div>
      <div className="vip-list">
        {items.length ? items.map((item) => (
          <div className="vip-list-item" key={item.id}>
            <span>
              {item.username}
              {item.twitterId ? <Tag color="blue" style={{ marginLeft: 8 }}>ID: {item.twitterId}</Tag> : <Tag style={{ marginLeft: 8 }}>未同步ID</Tag>}
            </span>
            <Space size={6}>
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
              <Button size="small" danger onClick={() => onDelete(item.id)}>删除</Button>
            </Space>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无用户" />}
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

  const addMutation = useMutation({
    mutationFn: ({ listType, username }: { listType: "vip" | "internal_test"; username: string }) => addVipListUser(listType, username),
    onSuccess: () => { messageApi.success("添加成功"); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "添加失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVipListUser,
    onSuccess: () => { messageApi.success("删除成功"); void query.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
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
      messageApi.warning("该用户未同步 Twitter ID，请先同步ID信息");
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

  const empty = useMemo(() => vip.length === 0 && internalTest.length === 0, [vip.length, internalTest.length]);
  const missingIdCount = useMemo(() => [...vip, ...internalTest].filter((item) => !item.twitterId).length, [vip, internalTest]);

  return (
    <PermissionGuard permission="vip-management">
      {contextHolder}
      <div className="vip-management-container">
        <div className="vip-management-header"><h2>VIP / 内测名单管理</h2></div>
        <div className="vip-management-grid">
          <VipListCard title="VIP 名单" items={vip} loading={addMutation.isPending} onAdd={(username) => addMutation.mutate({ listType: "vip", username })} onDelete={(id) => deleteMutation.mutate(id)} showCreatorAction={isSuperAdmin} onBecomeCreator={confirmBecomeCreator} creatorLoadingId={creatorMutation.isPending ? creatorMutation.variables || null : null} />
          <VipListCard title="内测名单" items={internalTest} loading={addMutation.isPending} onAdd={(username) => addMutation.mutate({ listType: "internal_test", username })} onDelete={(id) => deleteMutation.mutate(id)} showCreatorAction={isSuperAdmin} onBecomeCreator={confirmBecomeCreator} creatorLoadingId={creatorMutation.isPending ? creatorMutation.variables || null : null} />
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
    </PermissionGuard>
  );
}
