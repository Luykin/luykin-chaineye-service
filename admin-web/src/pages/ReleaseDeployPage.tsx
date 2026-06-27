import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Input, Modal, Space, Table, Tag, Timeline, Typography, message } from "antd";
import { CheckCircleOutlined, CloudUploadOutlined, RocketOutlined, ReloadOutlined, RollbackOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  createReleaseTag,
  fetchReleaseRemote,
  fetchReleaseStatus,
  generateReleaseTagMessage,
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
  if (!status.hasUpdate) {
    return <Alert type="success" showIcon message="当前已经是 origin/main 最新版本" />;
  }
  return (
    <Alert
      type="info"
      showIcon
      message={`发现 ${status.pendingCommits.length} 个待发布提交`}
      description="发布前请确认提交列表，执行时会更新到 origin/main，并按所选发布选项执行。"
    />
  );
}

export function ReleaseDeployPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [deployOpen, setDeployOpen] = useState(false);
  const [rebuildAdminWeb, setRebuildAdminWeb] = useState(true);
  const [restartAfterDeploy, setRestartAfterDeploy] = useState(true);
  const [runDbMigratePg, setRunDbMigratePg] = useState(false);
  const [updateNginxConfig, setUpdateNginxConfig] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagMessageText, setTagMessageText] = useState("");
  const [tagMessageSource, setTagMessageSource] = useState<"ai" | "fallback" | "manual" | string>("");
  const [tagMessageTagName, setTagMessageTagName] = useState("");
  const [createdTagName, setCreatedTagName] = useState("");

  const statusQuery = useQuery({
    queryKey: ["release-status"],
    queryFn: fetchReleaseStatus,
    refetchOnWindowFocus: false,
  });
  const status = statusQuery.data?.data;

  const fetchMutation = useMutation({
    mutationFn: fetchReleaseRemote,
    onSuccess: (response) => {
      const cleanup = response.data.outputs?.find((item) => item.step === "release-tag-cleanup")?.stdout;
      messageApi.success(cleanup?.includes("deletedLocal=none") ? "远程版本已刷新" : "远程版本已刷新，旧发布 Tag 已清理");
      void statusQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "刷新失败"),
  });

  const releaseMutation = useMutation({
    mutationFn: () => releaseDeploy({
      rebuildAdminWeb,
      restartAfterDeploy,
      runDbMigratePg,
      updateNginxConfig,
      tagMessage: tagMessageText.trim() || undefined,
      tagMessageSource: tagMessageText.trim() ? tagMessageSource || "manual" : undefined,
      releaseTagName: createdTagName || undefined,
    }),
    onSuccess: (response) => {
      const restartText = response.data.restartScheduled ? "，服务即将重启" : "";
      const tagText = response.data.releaseTag?.tagName ? `，Tag: ${response.data.releaseTag.tagName}` : "";
      messageApi.success(`发布完成：${shortHash(response.data.before)} → ${shortHash(response.data.after)}${tagText}${restartText}`);
      setDeployOpen(false);
      setCreatedTagName("");
      setTimeout(() => void statusQuery.refetch(), 3000);
    },
    onError: (error: Error) => messageApi.error(error.message || "发布失败"),
  });

  const tagMessageMutation = useMutation({
    mutationFn: generateReleaseTagMessage,
    onSuccess: (response) => {
      setTagMessageText(response.data.message);
      setTagMessageSource(response.data.messageSource);
      setTagMessageTagName(response.data.suggestedTagName);
      setTagName((current) => current || response.data.suggestedTagName);
      setCreatedTagName("");
      if (response.data.messageSource === "ai") {
        messageApi.success("AI Tag 描述生成成功");
      } else {
        messageApi.warning("AI 不可用，已生成兜底 Tag 描述");
      }
    },
    onError: (error: Error) => {
      setTagMessageSource("");
      messageApi.error(error.message || "生成 Tag 描述失败");
    },
  });

  const createTagMutation = useMutation({
    mutationFn: () => createReleaseTag({
      tagName: tagName.trim(),
      tagMessage: tagMessageText.trim() || undefined,
      tagMessageSource: tagMessageText.trim() ? tagMessageSource || "manual" : undefined,
    }),
    onSuccess: (response) => {
      setCreatedTagName(response.data.releaseTag.tagName);
      setTagName(response.data.releaseTag.tagName);
      if (!tagMessageText.trim()) {
        setTagMessageText(response.data.releaseTag.message);
        setTagMessageSource(response.data.releaseTag.messageSource);
      }
      const cleanupText = response.data.tagCleanup?.deletedLocal?.length
        ? `，已清理旧 Tag ${response.data.tagCleanup.deletedLocal.length} 个`
        : "";
      messageApi.success(`发布 Tag 已创建：${response.data.releaseTag.tagName}${cleanupText}`);
    },
    onError: (error: Error) => {
      setCreatedTagName("");
      messageApi.error(error.message || "创建发布 Tag 失败");
    },
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
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    disabled={!canDeploy}
                    onClick={() => {
                      setDeployOpen(true);
                      setTagName(status?.suggestedTagName || "");
                      setTagMessageText("");
                      setTagMessageSource("");
                      setTagMessageTagName("");
                      setCreatedTagName("");
                      setRunDbMigratePg(false);
                      setUpdateNginxConfig(false);
                    }}
                  >
                    发布 origin/main
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <div className="deploy-metrics">
            <DeployMetric label="待发布提交" value={status?.pendingCommits.length ?? "-"} hint="HEAD..origin/main" />
            <DeployMetric label="本地超前" value={status?.aheadCommits.length ?? "-"} hint="origin/main..HEAD" />
            <DeployMetric label="发布 Tag" value={status?.suggestedTagName ? "Ready" : "-"} hint={status?.suggestedTagName || "等待远程版本"} />
            <DeployMetric label="重启命令" value={status?.restartTarget || "npm run restart"} hint="发布后执行" />
          </div>

          <DeployStateAlert status={status} />

          <div className="deploy-version-grid">
            <Card size="small" title="当前线上版本" className="deploy-card">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="分支">{status?.branch || "-"}</Descriptions.Item>
                <Descriptions.Item label="HEAD"><CommitText commit={status?.current} /></Descriptions.Item>
                <Descriptions.Item label="重启命令">{status?.restartTarget || "npm run restart"}</Descriptions.Item>
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
        okText="确认发布"
        okButtonProps={{ disabled: !canDeploy || !createdTagName, danger: true }}
        confirmLoading={releaseMutation.isPending}
        onOk={() => releaseMutation.mutate()}
        width={780}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="这是生产发布操作"
            description={`将从 ${shortHash(status?.current?.hash)} 更新到 ${shortHash(status?.remote?.hash)}，共 ${status?.pendingCommits.length || 0} 个提交。请先创建发布 Tag，成功后再点击发布重启。`}
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
          <Card
            size="small"
            title="发布 Tag"
            className="deploy-card"
            extra={
              <Space>
                <Button
                  size="small"
                  icon={<RocketOutlined />}
                  loading={tagMessageMutation.isPending}
                  disabled={!canDeploy || !!createdTagName}
                  onClick={() => tagMessageMutation.mutate()}
                >
                  生成 AI 描述
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={createTagMutation.isPending}
                  disabled={!canDeploy || !tagName.trim() || !!createdTagName}
                  onClick={() => createTagMutation.mutate()}
                >
                  创建 Tag
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Input
                addonBefore="Tag"
                value={tagName}
                onChange={(event) => {
                  setTagName(event.target.value);
                  setCreatedTagName("");
                }}
                placeholder={tagMessageTagName || status?.suggestedTagName || "prod-YYYYMMDD-HHmm-abcdef0"}
                disabled={!!createdTagName}
              />
              {createdTagName ? (
                <Alert
                  type="success"
                  showIcon
                  message={`发布 Tag 已创建：${createdTagName}`}
                  description="现在可以直接点击发布重启。发布步骤不会重复创建 Tag，只会校验该 Tag 指向本次发布目标。"
                />
              ) : null}
              {tagMessageSource ? (
                <Alert
                  type={tagMessageSource === "ai" ? "success" : "warning"}
                  showIcon
                  message={tagMessageSource === "ai" ? "AI 描述已生成" : "已使用兜底描述"}
                  description={tagMessageSource === "ai" ? "请确认下方描述，然后点击「创建 Tag」。" : "AI 未成功返回，请确认兜底描述，然后点击「创建 Tag」。"}
                />
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="第一步：生成或填写 Tag 描述"
                  description="点击「生成 AI 描述」提前确认 AI 是否可用；也可以直接手动填写描述后创建 Tag。"
                />
              )}
              <Input.TextArea
                value={tagMessageText}
                onChange={(event) => {
                  setTagMessageText(event.target.value);
                  if (event.target.value.trim()) setTagMessageSource("manual");
                  setCreatedTagName("");
                }}
                autoSize={{ minRows: 4, maxRows: 8 }}
                maxLength={1800}
                showCount
                disabled={!!createdTagName}
                placeholder="点击「生成 AI 描述」预览 tag 描述；也可以在这里手动编辑。"
              />
              <Typography.Text type="secondary">
                {status?.pushTagsEnabled ? "当前已开启远程推送 tag。" : "当前未开启远程推送 tag，只会创建在服务器本地仓库。"}
                {` 发布 Tag 仅保留最近 ${status?.tagKeepLimit || 10} 个${status?.pruneRemoteTagsEnabled ? "，会同步清理远程旧 Tag" : "。"}`}
              </Typography.Text>
            </Space>
          </Card>
          <Timeline
            items={[
              { color: "blue", children: "git fetch origin --tags" },
              { color: "blue", children: "git reset --hard origin/main" },
              { color: rebuildAdminWeb ? "blue" : "gray", children: rebuildAdminWeb ? "npm run admin-web:build" : "跳过 admin-web 构建" },
              { color: createdTagName ? "green" : "purple", children: createdTagName ? `使用已创建 Tag：${createdTagName}` : "等待手动创建 annotated release tag" },
              { color: runDbMigratePg ? "blue" : "gray", children: runDbMigratePg ? "npm run db:migrate:pg" : "跳过数据库迁移" },
              { color: updateNginxConfig ? "blue" : "gray", children: updateNginxConfig ? "node scripts/update-nginx-config.js" : "跳过 Nginx 配置更新" },
              { color: restartAfterDeploy ? "green" : "gray", children: restartAfterDeploy ? (status?.restartTarget || "npm run restart") : "跳过服务重启" },
            ]}
          />
          <Space direction="vertical" size={8}>
            <Checkbox checked={rebuildAdminWeb} onChange={(event) => setRebuildAdminWeb(event.target.checked)}>
              发布后重新构建 admin-web
            </Checkbox>
            <Checkbox checked={runDbMigratePg} onChange={(event) => setRunDbMigratePg(event.target.checked)}>
              发布后运行数据库迁移（npm run db:migrate:pg）
            </Checkbox>
            <Checkbox checked={updateNginxConfig} onChange={(event) => setUpdateNginxConfig(event.target.checked)}>
              发布后更新并重载 Nginx 配置（node scripts/update-nginx-config.js）
            </Checkbox>
            <Checkbox checked={restartAfterDeploy} onChange={(event) => setRestartAfterDeploy(event.target.checked)}>
              发布后重启服务（npm run restart）
            </Checkbox>
          </Space>
        </Space>
      </Modal>
    </PermissionGuard>
  );
}
