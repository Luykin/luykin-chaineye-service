import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Input, Modal, Space, Table, Tag, Timeline, Typography, message } from "antd";
import { CheckCircleOutlined, CloudUploadOutlined, RocketOutlined, ReloadOutlined, RollbackOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchReleaseRemote,
  fetchReleaseStatus,
  releaseDeploy,
  type DeployCommit,
  type ReleaseStatusData,
} from "@/services/deploy";

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : "-";
}

function CommitText({ commit }: { commit?: DeployCommit | null }) {
  if (!commit) return <Typography.Text type="secondary">未读取到</Typography.Text>;
  return (
    <Space direction="vertical" size={2}>
      <Typography.Text code copyable={{ text: commit.hash }} className="deploy-hash">{commit.shortHash}</Typography.Text>
      <Typography.Text>{commit.message || "(无提交说明)"}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {commit.author} · {commit.relativeTime}
      </Typography.Text>
    </Space>
  );
}

function DeployMetric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="deploy-metric">
      <div className="deploy-metric__label">{label}</div>
      <div className="deploy-metric__value">{value}</div>
      {hint ? <div className="deploy-metric__hint">{hint}</div> : null}
    </div>
  );
}

function DeployStateAlert({ status }: { status?: ReleaseStatusData }) {
  if (!status) return null;
  if (status.aheadCommits.length > 0) {
    return (
      <Alert
        type="error"
        showIcon
        message="当前线上存在 origin/main 没有的提交"
        description="直接发布会覆盖这些本地提交。请先确认原因，必要时使用紧急回滚或终端处理。"
      />
    );
  }
  if (status.dirty) {
    return (
      <Alert
        type="warning"
        showIcon
        message="工作区有未提交改动"
        description="执行发布时会先自动 stash，再 reset 到 origin/main。"
      />
    );
  }
  if (!status.hasUpdate) {
    return <Alert type="success" showIcon message="当前已经是 origin/main 最新版本" />;
  }
  return (
    <Alert
      type="info"
      showIcon
      message={`发现 ${status.pendingCommits.length} 个待发布提交`}
      description="发布前请确认提交列表，执行时会更新到 origin/main 并重启 PM2。"
    />
  );
}

export function ReleaseDeployPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [deployOpen, setDeployOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [rebuildAdminWeb, setRebuildAdminWeb] = useState(true);
  const [restartAfterDeploy, setRestartAfterDeploy] = useState(true);

  const statusQuery = useQuery({
    queryKey: ["release-status"],
    queryFn: fetchReleaseStatus,
    refetchOnWindowFocus: false,
  });
  const status = statusQuery.data?.data;

  const fetchMutation = useMutation({
    mutationFn: fetchReleaseRemote,
    onSuccess: () => {
      messageApi.success("远程版本已刷新");
      void statusQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "刷新失败"),
  });

  const releaseMutation = useMutation({
    mutationFn: () => releaseDeploy({ confirmText, rebuildAdminWeb, restartAfterDeploy }),
    onSuccess: (response) => {
      const restartText = response.data.restartScheduled ? "，PM2 即将重启" : "";
      const tagText = response.data.releaseTag?.tagName ? `，Tag: ${response.data.releaseTag.tagName}` : "";
      messageApi.success(`发布完成：${shortHash(response.data.before)} → ${shortHash(response.data.after)}${tagText}${restartText}`);
      setDeployOpen(false);
      setConfirmText("");
      setTimeout(() => void statusQuery.refetch(), 3000);
    },
    onError: (error: Error) => messageApi.error(error.message || "发布失败"),
  });

  const commitColumns: ColumnsType<DeployCommit> = useMemo(() => [
    {
      title: "提交",
      width: 130,
      render: (_: unknown, row: DeployCommit) => <Typography.Text code copyable={{ text: row.hash }}>{row.shortHash}</Typography.Text>,
    },
    {
      title: "Message",
      dataIndex: "message",
      render: (value: string) => <Typography.Text ellipsis style={{ maxWidth: 560 }}>{value || "(无提交说明)"}</Typography.Text>,
    },
    { title: "作者", dataIndex: "author", width: 150 },
    { title: "时间", dataIndex: "relativeTime", width: 130 },
  ], []);

  const canDeploy = !!status?.hasUpdate && status.aheadCommits.length === 0;

  return (
    <PermissionGuard permission="deploy:release">
      {contextHolder}
      <PageSection
        title="发布上线"
        description="按大厂变更发布台设计：先拉取、再比对、确认后发布，并自动生成发布 Tag。"
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }} className="deploy-workbench deploy-workbench--release">
          <section className="deploy-hero">
            <div className="deploy-hero__content">
              <div>
                <div className="deploy-kicker"><RocketOutlined /> RELEASE CONTROL</div>
                <h2 className="deploy-hero__title">把 origin/main 安全发布到生产</h2>
                <div className="deploy-hero__subtitle">
                  每次发布都会先展示版本差异和风险状态；确认后固定执行白名单流程，并自动生成可回溯的 annotated tag。
                </div>
                <div className="deploy-hero__actions">
                  <Button icon={<RollbackOutlined />}>
                    <Link to="/emergency-rollback">去紧急回滚</Link>
                  </Button>
                  <Button icon={<ReloadOutlined />} loading={fetchMutation.isPending} onClick={() => fetchMutation.mutate()}>
                    拉取远程状态
                  </Button>
                  <Button type="primary" icon={<CloudUploadOutlined />} disabled={!canDeploy} onClick={() => { setDeployOpen(true); setConfirmText(""); }}>
                    发布 origin/main
                  </Button>
                </div>
              </div>
              <div className="deploy-command-card">
                <div className="deploy-command-card__label">Release pipeline</div>
                <div className="deploy-command-card__row"><span>target</span><span className="deploy-command-card__value">origin/main</span></div>
                <div className="deploy-command-card__row"><span>current</span><span className="deploy-command-card__value">{status?.current?.shortHash || "-"}</span></div>
                <div className="deploy-command-card__row"><span>remote</span><span className="deploy-command-card__value">{status?.remote?.shortHash || "-"}</span></div>
                <div className="deploy-command-card__row"><span>tag</span><span className="deploy-command-card__value">{status?.suggestedTagName || "-"}</span></div>
              </div>
            </div>
          </section>

          <div className="deploy-metrics">
            <DeployMetric label="待发布提交" value={status?.pendingCommits.length ?? "-"} hint="HEAD..origin/main" />
            <DeployMetric label="本地超前" value={status?.aheadCommits.length ?? "-"} hint="origin/main..HEAD" />
            <DeployMetric label="工作区状态" value={status?.dirty ? "Dirty" : "Clean"} hint={status?.dirty ? "发布前会 stash" : "可直接发布"} />
            <DeployMetric label="PM2 目标" value={status?.restartTarget || "all"} hint="发布后重启" />
          </div>

          <DeployStateAlert status={status} />

          <div className="deploy-version-grid">
            <Card size="small" title="当前线上版本" className="deploy-card">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="分支">{status?.branch || "-"}</Descriptions.Item>
                <Descriptions.Item label="HEAD"><CommitText commit={status?.current} /></Descriptions.Item>
                <Descriptions.Item label="工作区">
                  {status?.dirty ? <Tag color="error">有未提交改动</Tag> : <Tag color="success">干净</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="PM2 目标">{status?.restartTarget || "all"}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="远程目标版本" className="deploy-card">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="目标">origin/main</Descriptions.Item>
                <Descriptions.Item label="HEAD"><CommitText commit={status?.remote} /></Descriptions.Item>
                <Descriptions.Item label="待发布">
                  {status?.pendingCommits?.length ? <Tag color="blue">{status.pendingCommits.length} 个提交</Tag> : <Tag color="success">无更新</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="发布 Tag">
                  {status?.suggestedTagName ? (
                    <Space direction="vertical" size={2}>
                      <Typography.Text code>{status.suggestedTagName}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        发布时自动生成{status.pushTagsEnabled ? "并推送到远程" : "，仅保存在服务器本地仓库"}
                      </Typography.Text>
                    </Space>
                  ) : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="本地超前">
                  {status?.aheadCommits?.length ? <Tag color="error">{status.aheadCommits.length} 个提交</Tag> : <Tag color="success">无</Tag>}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>

          {status?.dirty ? (
            <Card size="small" title="未提交改动" className="deploy-card">
              <Space wrap size={[4, 4]}>
                {status.dirtyFiles.map((item) => <Tag key={item}>{item}</Tag>)}
              </Space>
            </Card>
          ) : null}

          {status?.aheadCommits?.length ? (
            <Card size="small" title="origin/main 没有的本地提交" className="deploy-card deploy-table-card">
              <Table
                rowKey="hash"
                size="small"
                columns={commitColumns}
                dataSource={status.aheadCommits}
                pagination={false}
                scroll={{ x: 900, y: 220 }}
              />
            </Card>
          ) : null}

          <Card
            title="待发布提交"
            className="deploy-card deploy-table-card"
            extra={<Button icon={<ReloadOutlined />} loading={statusQuery.isFetching} onClick={() => statusQuery.refetch()}>刷新页面状态</Button>}
          >
            <Table
              rowKey="hash"
              size="small"
              columns={commitColumns}
              dataSource={status?.pendingCommits || []}
              loading={statusQuery.isFetching}
              pagination={{ pageSize: 12, showSizeChanger: false }}
              scroll={{ x: 900 }}
              locale={{ emptyText: <Empty description="当前没有待发布提交" /> }}
            />
          </Card>
        </Space>
      </PageSection>

      <Modal
        title="确认发布 origin/main"
        open={deployOpen}
        onCancel={() => setDeployOpen(false)}
        okText="确认发布并重启"
        okButtonProps={{ disabled: confirmText !== "DEPLOY" || !canDeploy, danger: true }}
        confirmLoading={releaseMutation.isPending}
        onOk={() => releaseMutation.mutate()}
        width={780}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="这是生产发布操作"
            description={`将从 ${shortHash(status?.current?.hash)} 更新到 ${shortHash(status?.remote?.hash)}，共 ${status?.pendingCommits.length || 0} 个提交，并自动生成发布 tag。`}
          />
          <div className="deploy-modal-summary">
            <Space>
              <CheckCircleOutlined style={{ color: "#059669" }} />
              <Typography.Text strong>发布窗口已锁定：</Typography.Text>
              <Typography.Text code>{status?.current?.shortHash || "-"}</Typography.Text>
              <Typography.Text>→</Typography.Text>
              <Typography.Text code>{status?.remote?.shortHash || "-"}</Typography.Text>
            </Space>
          </div>
          <Card size="small" title="发布 Tag" className="deploy-card">
            <Space direction="vertical" size={4}>
              <Typography.Text>
                预计格式：<Typography.Text code>{status?.suggestedTagName || "prod-YYYYMMDD-HHmm-abcdef0"}</Typography.Text>
              </Typography.Text>
              <Typography.Text type="secondary">
                Tag 描述会优先由 AI 根据待发布提交生成；如果 AI 不可用，会自动用提交列表生成兜底描述。
              </Typography.Text>
              <Typography.Text type="secondary">
                {status?.pushTagsEnabled ? "当前已开启远程推送 tag。" : "当前未开启远程推送 tag，只会创建在服务器本地仓库。"}
              </Typography.Text>
            </Space>
          </Card>
          <Timeline
            items={[
              { color: "blue", children: "git fetch origin --tags" },
              { color: status?.dirty ? "orange" : "gray", children: status?.dirty ? "检测到未提交改动，先执行 git stash" : "工作区干净，跳过 stash" },
              { color: "blue", children: "git reset --hard origin/main" },
              { color: rebuildAdminWeb ? "blue" : "gray", children: rebuildAdminWeb ? "npm run admin-web:build" : "跳过 admin-web 构建" },
              { color: "purple", children: "生成 annotated release tag（AI 描述，失败自动兜底）" },
              { color: restartAfterDeploy ? "green" : "gray", children: restartAfterDeploy ? `pm2 restart ${status?.restartTarget || "all"}` : "跳过 PM2 重启" },
            ]}
          />
          <Space direction="vertical" size={8}>
            <Checkbox checked={rebuildAdminWeb} onChange={(event) => setRebuildAdminWeb(event.target.checked)}>
              发布后重新构建 admin-web
            </Checkbox>
            <Checkbox checked={restartAfterDeploy} onChange={(event) => setRestartAfterDeploy(event.target.checked)}>
              发布后重启 PM2
            </Checkbox>
          </Space>
          <Input
            className="deploy-confirm-input"
            prefix={<SafetyCertificateOutlined />}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="输入 DEPLOY 才能执行发布"
          />
        </Space>
      </Modal>
    </PermissionGuard>
  );
}
