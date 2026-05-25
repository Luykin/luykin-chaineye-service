import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, EyeOutlined, KeyOutlined, LinkOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  createCollectorToken,
  fetchCollectorTokens,
  fetchTampermonkeyScriptContent,
  fetchTampermonkeyScripts,
  revokeCollectorToken,
  type CollectorTokenItem,
  type TampermonkeyScriptItem,
} from "@/services/tampermonkey";

const COLLECTOR_STATS_HASH =
  "#/generic-stats?type=collector.tampermonkey.crawl&subjectId=rootdata-fundraising";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function TampermonkeyPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<{ name: string }>();
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);

  const tokensQuery = useQuery({ queryKey: ["tampermonkey", "tokens"], queryFn: fetchCollectorTokens });
  const scriptsQuery = useQuery({ queryKey: ["tampermonkey", "scripts"], queryFn: fetchTampermonkeyScripts });
  const scriptContentQuery = useQuery({
    queryKey: ["tampermonkey", "script", previewFileName],
    queryFn: () => fetchTampermonkeyScriptContent(previewFileName!),
    enabled: Boolean(previewFileName),
  });

  const createMutation = useMutation({
    mutationFn: createCollectorToken,
    onSuccess: (resp) => {
      setGeneratedToken(resp.data.token);
      messageApi.success("Token 已生成，仅本次展示明文");
      form.resetFields();
      void tokensQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "生成 token 失败"),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeCollectorToken,
    onSuccess: () => {
      messageApi.success("Token 已停用");
      void tokensQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "停用 token 失败"),
  });

  const tokenRows = tokensQuery.data?.data || [];
  const activeTokenCount = tokenRows.filter((item) => item.isActive && !item.expired).length;
  const scriptRows = scriptsQuery.data?.data || [];
  const previewContent = scriptContentQuery.data?.data.content || "";

  const tokenColumns: ColumnsType<CollectorTokenItem> = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        render: (value: string, row) => (
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{value}</Typography.Text>
            <Typography.Text type="secondary" className="tm-mono">
              prefix: {row.tokenPrefix}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "状态",
        key: "status",
        width: 120,
        render: (_, row) => {
          if (row.expired) return <Tag color="error">已过期</Tag>;
          return row.isActive ? <Tag color="success">有效</Tag> : <Tag color="default">已停用</Tag>;
        },
      },
      {
        title: "过期时间",
        dataIndex: "expiresAt",
        key: "expiresAt",
        width: 190,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "最近使用",
        dataIndex: "lastUsedAt",
        key: "lastUsedAt",
        width: 190,
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: "创建人",
        dataIndex: "createdByAdminEmail",
        key: "createdByAdminEmail",
        width: 220,
        ellipsis: true,
        render: (value?: string | null) => value || "-",
      },
      {
        title: "操作",
        key: "action",
        width: 120,
        render: (_, row) => (
          <Button
            danger
            size="small"
            icon={<StopOutlined />}
            disabled={!row.isActive || row.expired}
            loading={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate(row.id)}
          >
            停用
          </Button>
        ),
      },
    ],
    [revokeMutation]
  );

  const scriptColumns: ColumnsType<TampermonkeyScriptItem> = useMemo(
    () => [
      {
        title: "脚本文件",
        dataIndex: "fileName",
        key: "fileName",
        render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
      },
      {
        title: "大小",
        dataIndex: "size",
        key: "size",
        width: 120,
        render: (value: number) => formatBytes(value),
      },
      {
        title: "更新时间",
        dataIndex: "updatedAt",
        key: "updatedAt",
        width: 190,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "操作",
        key: "action",
        width: 190,
        render: (_, row) => (
          <Space>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewFileName(row.fileName)}>
              预览
            </Button>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={async () => {
                const resp = await fetchTampermonkeyScriptContent(row.fileName);
                await copyText(resp.data.content);
                messageApi.success("脚本已复制");
              }}
            >
              复制
            </Button>
          </Space>
        ),
      },
    ],
    [messageApi]
  );

  return (
    <PermissionGuard permission="tampermonkey">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }} className="tampermonkey-page">
        <section className="tm-hero">
          <div>
            <div className="tm-eyebrow">Collector Console</div>
            <h1>Tampermonkey 采集管理</h1>
            <p>统一管理浏览器采集脚本、12 个月 token 与采集结果统计，避免每个网站重复造一套接入方式。</p>
          </div>
          <div className="tm-hero-actions">
            <Button
              href={COLLECTOR_STATS_HASH}
              icon={<LinkOutlined />}
            >
              查看采集统计
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => {
                void tokensQuery.refetch();
                void scriptsQuery.refetch();
              }}
              loading={tokensQuery.isFetching || scriptsQuery.isFetching}
            >
              刷新
            </Button>
          </div>
        </section>

        <div className="tm-kpi-grid">
          <Card className="tm-kpi-card"><Typography.Text type="secondary">有效 Token</Typography.Text><strong>{activeTokenCount}</strong></Card>
          <Card className="tm-kpi-card"><Typography.Text type="secondary">脚本数量</Typography.Text><strong>{scriptRows.length}</strong></Card>
          <Card className="tm-kpi-card"><Typography.Text type="secondary">统计 Type</Typography.Text><strong className="tm-kpi-code">collector.tampermonkey.crawl</strong></Card>
        </div>

        <PageSection
          title="生成采集 Token"
          description="生成的 token 有效期固定 12 个月。明文只展示一次，复制后填入 Tampermonkey 脚本的 CLIENT_TOKEN。"
        >
          <Form
            form={form}
            layout="inline"
            initialValues={{ name: "Windows RootData Tampermonkey" }}
            onFinish={(values) => createMutation.mutate({ name: values.name })}
          >
            <Form.Item name="name" rules={[{ required: true, message: "请输入 token 名称" }]} style={{ minWidth: 320 }}>
              <Input prefix={<KeyOutlined />} placeholder="例如 Windows RootData Tampermonkey" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                生成 12 个月 Token
              </Button>
            </Form.Item>
          </Form>

          {generatedToken ? (
            <Alert
              className="tm-token-alert"
              type="warning"
              showIcon
              message="请立即复制 token，刷新页面后不会再显示明文"
              description={
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text className="tm-token-value" copyable>{generatedToken}</Typography.Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(generatedToken).then(() => messageApi.success("Token 已复制"))}>
                    复制 Token
                  </Button>
                </Space>
              }
            />
          ) : null}
        </PageSection>

        <PageSection title="Token 列表" description="这里只展示 token 前缀和状态，不保存明文。">
          <Table
            rowKey={(row) => String(row.id)}
            columns={tokenColumns}
            dataSource={tokenRows}
            loading={tokensQuery.isLoading || tokensQuery.isFetching}
            pagination={false}
            locale={{ emptyText: <Empty description="暂无 token，先生成一个" /> }}
            scroll={{ x: 980 }}
          />
        </PageSection>

        <PageSection title="脚本仓库" description="自动读取项目 tampermonkey 目录下的 .user.js 文件，可预览和复制。">
          <Table
            rowKey={(row) => row.fileName}
            columns={scriptColumns}
            dataSource={scriptRows}
            loading={scriptsQuery.isLoading || scriptsQuery.isFetching}
            pagination={false}
            locale={{ emptyText: <Empty description="tampermonkey 目录下暂无 .user.js 脚本" /> }}
          />
        </PageSection>

        <PageSection title="统计入口" description="采集成功、失败、告警都会写入通用统计，点击下方入口可直接带筛选条件跳转。">
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Type"><Typography.Text copyable>collector.tampermonkey.crawl</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="Subject"><Typography.Text copyable>rootdata-fundraising</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="动作"><Space><Tag color="success">success</Tag><Tag color="error">failure</Tag><Tag color="warning">alert</Tag></Space></Descriptions.Item>
            <Descriptions.Item label="跳转"><Button href={COLLECTOR_STATS_HASH} icon={<LinkOutlined />}>打开通用统计</Button></Descriptions.Item>
          </Descriptions>
        </PageSection>

        <Modal
          title={previewFileName || "脚本预览"}
          open={Boolean(previewFileName)}
          width="min(1100px, 92vw)"
          onCancel={() => setPreviewFileName(null)}
          footer={[
            <Button key="copy" icon={<CopyOutlined />} disabled={!previewContent} onClick={() => copyText(previewContent).then(() => messageApi.success("脚本已复制"))}>复制</Button>,
            <Button key="close" type="primary" onClick={() => setPreviewFileName(null)}>关闭</Button>,
          ]}
        >
          {scriptContentQuery.isLoading ? (
            <Empty description="正在读取脚本..." />
          ) : scriptContentQuery.isError ? (
            <Empty description="脚本读取失败" />
          ) : (
            <Tooltip title="复制后可粘贴到 Tampermonkey 新建脚本">
              <pre className="tm-script-preview">{previewContent}</pre>
            </Tooltip>
          )}
        </Modal>
      </Space>
    </PermissionGuard>
  );
}
