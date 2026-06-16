import { useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Input, Modal, Segmented, Space, Table, Tag, Typography, message } from "antd";
import { ExclamationCircleOutlined, ReloadOutlined, RollbackOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchDeployPreview,
  fetchDeployStatus,
  recoverDeploy,
  rollbackDeploy,
  type DeployCommit,
  type DeployTag,
  type DeployPreviewData,
} from "@/services/deploy";

type TargetType = "commit" | "tag";
type SelectedTarget = {
  type: TargetType;
  value: string;
  title: string;
  hash: string;
  shortHash: string;
  message: string;
};

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : "-";
}

function CommitMessage({ message }: { message?: string }) {
  return (
    <Typography.Text ellipsis style={{ maxWidth: 520 }}>
      {message || "(无提交说明)"}
    </Typography.Text>
  );
}

function TargetSummary({ target }: { target: SelectedTarget | null }) {
  if (!target) {
    return <Typography.Text type="secondary">请先从最近提交或 Tag 中选择一个回滚目标。</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={2}>
      <Space wrap>
        <Tag color={target.type === "tag" ? "purple" : "blue"}>{target.type === "tag" ? "TAG" : "COMMIT"}</Tag>
        <Typography.Text code>{target.title}</Typography.Text>
        <Typography.Text type="secondary">{target.shortHash}</Typography.Text>
      </Space>
      <Typography.Text>{target.message || "无说明"}</Typography.Text>
    </Space>
  );
}

export function EmergencyRollbackPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [mode, setMode] = useState<TargetType>("commit");
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [recoverConfirmText, setRecoverConfirmText] = useState("");
  const [rebuildAdminWeb, setRebuildAdminWeb] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["deploy-status"],
    queryFn: fetchDeployStatus,
    refetchOnWindowFocus: false,
  });
  const status = statusQuery.data?.data;

  const previewQuery = useQuery({
    queryKey: ["deploy-preview", selected?.type, selected?.value],
    queryFn: () => fetchDeployPreview(selected!.value, selected!.type),
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const preview: DeployPreviewData | null = previewQuery.data?.data || null;

  const rollbackMutation = useMutation({
    mutationFn: () => rollbackDeploy({
      target: selected!.value,
      targetType: selected!.type,
      confirmText,
      rebuildAdminWeb,
    }),
    onSuccess: (response) => {
      messageApi.success(`已回滚到 ${shortHash(response.data.after)}，PM2 即将重启`);
      setRollbackOpen(false);
      setConfirmText("");
      setTimeout(() => void statusQuery.refetch(), 3000);
    },
    onError: (error: Error) => messageApi.error(error.message || "回滚失败"),
  });

  const recoverMutation = useMutation({
    mutationFn: () => recoverDeploy({ confirmText: recoverConfirmText, rebuildAdminWeb }),
    onSuccess: (response) => {
      messageApi.success(`已恢复到 ${shortHash(response.data.after)}，PM2 即将重启`);
      setRecoverOpen(false);
      setRecoverConfirmText("");
      setTimeout(() => void statusQuery.refetch(), 3000);
    },
    onError: (error: Error) => messageApi.error(error.message || "恢复失败"),
  });

  const commitColumns = useMemo(() => [
    {
      title: "提交",
      width: 130,
      render: (_: unknown, row: DeployCommit) => <Typography.Text code>{row.shortHash}</Typography.Text>,
    },
    { title: "Message", dataIndex: "message", render: (value: string) => <CommitMessage message={value} /> },
    { title: "作者", dataIndex: "author", width: 150 },
    { title: "时间", dataIndex: "relativeTime", width: 130 },
  ], []);

  const tagColumns = useMemo(() => [
    {
      title: "Tag",
      width: 180,
      render: (_: unknown, row: DeployTag) => <Typography.Text code>{row.name}</Typography.Text>,
    },
    { title: "说明", dataIndex: "message", render: (value: string) => <CommitMessage message={value} /> },
    {
      title: "指向提交",
      width: 130,
      render: (_: unknown, row: DeployTag) => <Typography.Text code>{row.shortHash}</Typography.Text>,
    },
    { title: "时间", dataIndex: "relativeTime", width: 130 },
  ], []);

  const lostCommitColumns = useMemo(() => [
    { title: "提交", width: 110, render: (_: unknown, row: DeployCommit) => <Typography.Text code>{row.shortHash}</Typography.Text> },
    { title: "将丢失的改动", dataIndex: "message", render: (value: string) => <CommitMessage message={value} /> },
    { title: "时间", dataIndex: "relativeTime", width: 120 },
  ], []);

  function selectCommit(row: DeployCommit) {
    setSelected({
      type: "commit",
      value: row.hash,
      title: row.shortHash,
      hash: row.hash,
      shortHash: row.shortHash,
      message: row.message,
    });
  }

  function selectTag(row: DeployTag) {
    setSelected({
      type: "tag",
      value: row.name,
      title: row.name,
      hash: row.hash,
      shortHash: row.shortHash,
      message: row.message,
    });
  }

  return (
    <PermissionGuard permission="deploy:rollback">
      {contextHolder}
      <PageSection
        title="紧急回滚"
        description="super 专用：按提交 message 或 tag 可视化选择版本，一键回滚并重启 PM2。"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={statusQuery.isFetching} onClick={() => statusQuery.refetch()}>
              刷新状态
            </Button>
            <Button danger icon={<ThunderboltOutlined />} onClick={() => { setRecoverOpen(true); setRecoverConfirmText(""); }}>
              恢复 origin/main
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="这是生产高危操作"
            description="回滚会执行 git reset --hard，并在响应返回后触发 PM2 restart。若回滚到没有此页面/API 的旧版本，后续恢复需要走终端 yarn emergency:recover。"
          />

          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)", gap: 16 }}>
            <Card size="small" title="当前版本">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="分支">{status?.branch || "-"}</Descriptions.Item>
                <Descriptions.Item label="HEAD">
                  <Space direction="vertical" size={2}>
                    <Typography.Text code copyable={{ text: status?.current?.hash || "" }}>{status?.current?.shortHash || "-"}</Typography.Text>
                    <CommitMessage message={status?.current?.message} />
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="PM2 重启目标">{status?.restartTarget || "all"}</Descriptions.Item>
                <Descriptions.Item label="工作区">
                  {status?.dirty ? <Tag color="error">有未提交改动，将先 stash</Tag> : <Tag color="success">干净</Tag>}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="已选择目标">
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <TargetSummary target={selected} />
                <Button
                  type="primary"
                  danger
                  icon={<RollbackOutlined />}
                  disabled={!selected}
                  loading={previewQuery.isFetching}
                  onClick={() => { setRollbackOpen(true); setConfirmText(""); }}
                >
                  预览并回滚到此版本
                </Button>
              </Space>
            </Card>
          </div>

          {status?.dirty && (
            <Card size="small" title="未提交改动">
              <Space wrap size={[4, 4]}>
                {status.dirtyFiles.map((item) => <Tag key={item}>{item}</Tag>)}
              </Space>
            </Card>
          )}

          <Card
            title="选择回滚目标"
            extra={
              <Segmented
                value={mode}
                onChange={(value) => setMode(value as TargetType)}
                options={[
                  { label: "最近提交", value: "commit" },
                  { label: "Tags", value: "tag" },
                ]}
              />
            }
          >
            {mode === "commit" ? (
              <Table
                rowKey="hash"
                size="small"
                columns={commitColumns}
                dataSource={status?.recentCommits || []}
                loading={statusQuery.isFetching}
                pagination={{ pageSize: 12, showSizeChanger: false }}
                scroll={{ x: 900 }}
                rowSelection={{
                  type: "radio",
                  selectedRowKeys: selected?.type === "commit" ? [selected.hash] : [],
                  onSelect: selectCommit,
                }}
                onRow={(row) => ({ onClick: () => selectCommit(row) })}
                locale={{ emptyText: <Empty description="没有读取到提交记录" /> }}
              />
            ) : (
              <Table
                rowKey="name"
                size="small"
                columns={tagColumns}
                dataSource={status?.tags || []}
                loading={statusQuery.isFetching}
                pagination={{ pageSize: 12, showSizeChanger: false }}
                scroll={{ x: 900 }}
                rowSelection={{
                  type: "radio",
                  selectedRowKeys: selected?.type === "tag" ? [selected.value] : [],
                  onSelect: selectTag,
                }}
                onRow={(row) => ({ onClick: () => selectTag(row) })}
                locale={{ emptyText: <Empty description="没有读取到 Tag；可以先用 git tag 打安全点" /> }}
              />
            )}
          </Card>
        </Space>
      </PageSection>

      <Modal
        title="确认生产回滚"
        open={rollbackOpen}
        onCancel={() => setRollbackOpen(false)}
        okText="确认回滚并重启"
        okButtonProps={{ danger: true, disabled: confirmText !== "ROLLBACK" || !selected }}
        confirmLoading={rollbackMutation.isPending}
        onOk={() => rollbackMutation.mutate()}
        width={820}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="error"
            showIcon
            message="请确认你知道这会影响线上服务"
            description="后端会先 stash 未提交改动，再 reset 到目标版本，最后重启 PM2。"
          />
          <TargetSummary target={selected} />
          <Checkbox checked={rebuildAdminWeb} onChange={(event) => setRebuildAdminWeb(event.target.checked)}>
            回滚后重新构建 admin-web（耗时更长；如果只是服务端紧急回滚，一般不勾）
          </Checkbox>
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="输入 ROLLBACK 才能执行"
          />
          <Card size="small" title={`将从当前版本移除的提交（${preview?.lostCommits?.length ?? 0} 条）`}>
            <Table
              rowKey="hash"
              size="small"
              columns={lostCommitColumns}
              dataSource={preview?.lostCommits || []}
              loading={previewQuery.isFetching}
              pagination={false}
              scroll={{ y: 260, x: 760 }}
              locale={{ emptyText: <Empty description="目标就是当前版本，或没有可展示差异" /> }}
            />
          </Card>
        </Space>
      </Modal>

      <Modal
        title="恢复到 origin/main"
        open={recoverOpen}
        onCancel={() => setRecoverOpen(false)}
        okText="确认恢复并重启"
        okButtonProps={{ danger: true, disabled: recoverConfirmText !== "RECOVER" }}
        confirmLoading={recoverMutation.isPending}
        onOk={() => recoverMutation.mutate()}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="恢复会执行 git fetch origin --tags && git reset --hard origin/main"
            description="如果当前工作区有未提交改动，会先 stash。"
          />
          <Checkbox checked={rebuildAdminWeb} onChange={(event) => setRebuildAdminWeb(event.target.checked)}>
            恢复后重新构建 admin-web
          </Checkbox>
          <Input
            value={recoverConfirmText}
            onChange={(event) => setRecoverConfirmText(event.target.value)}
            placeholder="输入 RECOVER 才能执行"
          />
        </Space>
      </Modal>
    </PermissionGuard>
  );
}
