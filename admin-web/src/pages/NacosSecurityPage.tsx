import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Progress,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApiOutlined,
  BugOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  ExperimentOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { runNacosSecurityCheck } from "@/services/nacos";
import type {
  NacosSecurityCheckResponse,
  NacosSecurityRuntimeCheck,
  NacosSecuritySeverity,
  NacosSecurityStaticFinding,
} from "@/types/nacos";

const severityMeta: Record<NacosSecuritySeverity, { label: string; color: string; score: number; tone: string }> = {
  critical: { label: "Critical", color: "red", score: 100, tone: "立即处理" },
  high: { label: "High", color: "volcano", score: 82, tone: "高风险" },
  medium: { label: "Medium", color: "orange", score: 58, tone: "需确认" },
  low: { label: "Low", color: "blue", score: 28, tone: "提示" },
  pass: { label: "Pass", color: "green", score: 8, tone: "通过" },
};

function SeverityTag({ severity }: { severity: NacosSecuritySeverity }) {
  const meta = severityMeta[severity] || severityMeta.low;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function buildReport(data: NacosSecurityCheckResponse["data"]) {
  const lines = [
    `Nacos 安全检查报告`,
    `检查时间：${dayjs(data.summary.checkedAt).format("YYYY-MM-DD HH:mm:ss")}`,
    `检查目标：${data.summary.origin}`,
    `总体风险：${severityMeta[data.summary.severity].label}`,
    `Critical=${data.summary.critical} High=${data.summary.high} Medium=${data.summary.medium}`,
    "",
    "[Nginx 静态发现]",
    ...data.nginx.findings.map((item, index) => `${index + 1}. [${item.severity}] ${item.title} - ${item.conclusion}`),
    "",
    "[运行时探测]",
    ...data.runtimeChecks.map(
      (item, index) =>
        `${index + 1}. [${item.severity}] ${item.method} ${item.path} status=${item.status ?? "-"} - ${item.conclusion}`
    ),
  ];
  return lines.join("\n");
}

function findingIcon(severity: NacosSecuritySeverity) {
  if (severity === "critical" || severity === "high") return <ThunderboltOutlined />;
  if (severity === "pass") return <CheckCircleOutlined />;
  return <BugOutlined />;
}

export function NacosSecurityPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NacosSecurityCheckResponse["data"] | null>(null);

  async function runCheck() {
    setLoading(true);
    try {
      const resp = await runNacosSecurityCheck();
      setResult(resp.data);
      const severity = resp.data.summary.severity;
      if (severity === "critical" || severity === "high") {
        messageApi.warning("检查完成，发现高风险 Nacos 暴露面");
      } else {
        messageApi.success("检查完成，未发现明显高危暴露");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Nacos 安全检查失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyReport() {
    if (!result) return;
    await navigator.clipboard.writeText(buildReport(result));
    messageApi.success("检查报告已复制");
  }

  const runtimeColumns = useMemo<ColumnsType<NacosSecurityRuntimeCheck>>(
    () => [
      {
        title: "检查项",
        dataIndex: "title",
        key: "title",
        width: 260,
        render: (text, record) => (
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{text}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {record.category}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "请求",
        key: "request",
        width: 260,
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Space size={6}>
              <Tag>{record.method}</Tag>
              <Typography.Text code>{record.status ?? "-"}</Typography.Text>
            </Space>
            <Typography.Text copyable style={{ fontSize: 12 }}>
              {record.path}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "风险",
        dataIndex: "severity",
        key: "severity",
        width: 110,
        render: (severity: NacosSecuritySeverity) => <SeverityTag severity={severity} />,
        filters: Object.keys(severityMeta).map((value) => ({ text: severityMeta[value as NacosSecuritySeverity].label, value })),
        onFilter: (value, record) => record.severity === value,
      },
      {
        title: "结论",
        dataIndex: "conclusion",
        key: "conclusion",
        render: (text, record) => (
          <Space direction="vertical" size={4}>
            <Typography.Text>{text}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              耗时 {record.durationMs}ms · 响应 {formatBytes(record.bodySummary?.contentLength)}
            </Typography.Text>
          </Space>
        ),
      },
    ],
    []
  );

  const nginxColumns = useMemo<ColumnsType<NacosSecurityStaticFinding>>(
    () => [
      {
        title: "配置发现",
        dataIndex: "title",
        key: "title",
        width: 280,
        render: (text, record) => (
          <Space>
            {findingIcon(record.severity)}
            <Typography.Text strong>{text}</Typography.Text>
          </Space>
        ),
      },
      {
        title: "风险",
        dataIndex: "severity",
        key: "severity",
        width: 110,
        render: (severity: NacosSecuritySeverity) => <SeverityTag severity={severity} />,
      },
      {
        title: "结论与建议",
        key: "detail",
        render: (_, record) => (
          <Space direction="vertical" size={4}>
            <Typography.Text>{record.conclusion}</Typography.Text>
            <Typography.Text type="secondary">{record.recommendation}</Typography.Text>
          </Space>
        ),
      },
    ],
    []
  );

  const summary = result?.summary;
  const meta = summary ? severityMeta[summary.severity] : severityMeta.low;

  return (
    <PermissionGuard permission={["security-check", "nacos_config"]}>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div
          style={{
            background: "linear-gradient(135deg, #111827 0%, #1f2937 52%, #3f1d1d 100%)",
            borderRadius: 22,
            padding: 28,
            color: "#f9fafb",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              right: -90,
              top: -120,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "rgba(248,113,113,0.22)",
              filter: "blur(4px)",
            }}
          />
          <Space direction="vertical" size={16} style={{ width: "100%", position: "relative" }}>
            <Space size={12} wrap>
              <Tag color="red" icon={<SafetyCertificateOutlined />}>
                Nacos Exposure Audit
              </Tag>
              <Tag color="gold" icon={<ExperimentOutlined />}>
                只检测，不写真实配置
              </Tag>
            </Space>
            <div>
              <Typography.Title level={2} style={{ color: "#fff", margin: 0 }}>
                Nacos 暴露面检查
              </Typography.Title>
              <Typography.Paragraph style={{ color: "rgba(255,255,255,0.74)", maxWidth: 820, marginTop: 8, marginBottom: 0 }}>
                从管理后台触发服务端探测：检查 /nacos-configs、/nacos/v1 原生 API、Basic Auth 绕过和 Nginx 配置风险。响应内容只保留 hash、长度和脱敏摘要。
              </Typography.Paragraph>
            </div>
            <Space wrap>
              <Button type="primary" danger size="large" loading={loading} onClick={runCheck} icon={<ApiOutlined />}>
                开始检查
              </Button>
              <Button size="large" disabled={!result} onClick={copyReport} icon={<CopyOutlined />}>
                复制报告
              </Button>
            </Space>
          </Space>
        </div>

        <Alert
          type="warning"
          showIcon
          message="安全边界说明"
          description="该页面不允许输入任意 URL；后端只请求固定路径。POST/DELETE 探测使用无效参数或不存在 dataId，用于确认是否先被鉴权挡住，不会发布真实 Nacos 配置。"
        />

        {summary ? (
          <PageSection
            title="总体结论"
            description={`目标 ${summary.origin} · ${dayjs(summary.checkedAt).format("YYYY-MM-DD HH:mm:ss")}`}
            extra={<SeverityTag severity={summary.severity} />}
          >
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              <Space wrap size={16} style={{ width: "100%" }}>
                <Card style={{ minWidth: 260, flex: 1 }}>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">风险水位</Typography.Text>
                    <Progress percent={meta.score} showInfo={false} strokeColor={meta.color === "green" ? "#16a34a" : "#dc2626"} />
                    <Typography.Title level={3} style={{ margin: 0 }}>
                      {meta.label} · {meta.tone}
                    </Typography.Title>
                  </Space>
                </Card>
                <Card style={{ minWidth: 150 }}>
                  <Statistic title="Critical" value={summary.critical} valueStyle={{ color: "#dc2626" }} />
                </Card>
                <Card style={{ minWidth: 150 }}>
                  <Statistic title="High" value={summary.high} valueStyle={{ color: "#ea580c" }} />
                </Card>
                <Card style={{ minWidth: 150 }}>
                  <Statistic title="Medium" value={summary.medium} valueStyle={{ color: "#d97706" }} />
                </Card>
                <Card style={{ minWidth: 150 }}>
                  <Statistic title="耗时" value={summary.durationMs} suffix="ms" />
                </Card>
              </Space>
              <Alert
                type={summary.severity === "critical" || summary.severity === "high" ? "error" : "success"}
                showIcon
                message={
                  summary.severity === "critical" || summary.severity === "high"
                    ? "发现 Nacos 高风险暴露面，建议优先关闭 /nacos-configs 或保护整个 /nacos/ 前缀。"
                    : "未发现明显高危暴露，但仍建议确认 Nacos 仅内网可访问并开启鉴权。"
                }
              />
            </Space>
          </PageSection>
        ) : null}

        <PageSection
          title="Nginx 配置静态检查"
          description={result ? `配置文件：${result.nginx.path}` : "会检查 nginx/kb.cryptohunt.ai.conf 中与 Nacos 相关的暴露配置。"}
        >
          {result ? (
            <Table
              rowKey="id"
              columns={nginxColumns}
              dataSource={result.nginx.findings}
              pagination={false}
              expandable={{
                expandedRowRender: (record) => (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>证据行</Typography.Text>
                    {record.evidence?.length ? (
                      record.evidence.map((line) => (
                        <Typography.Text code key={`${record.id}-${line.line}`} style={{ display: "block" }}>
                          L{line.line}: {line.text}
                        </Typography.Text>
                      ))
                    ) : (
                      <Typography.Text type="secondary">无证据行</Typography.Text>
                    )}
                  </Space>
                ),
              }}
            />
          ) : (
            <Empty image={<LockOutlined style={{ fontSize: 42 }} />} description="点击开始检查后展示 Nginx 静态发现" />
          )}
        </PageSection>

        <PageSection title="运行时探测" description="从服务器侧模拟未登录请求，判断是否被 401/403/404/405 挡住。">
          {result ? (
            <Table
              rowKey="id"
              columns={runtimeColumns}
              dataSource={result.runtimeChecks}
              pagination={false}
              scroll={{ x: 980 }}
              expandable={{
                expandedRowRender: (record) => (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
                      <Descriptions.Item label="修复建议" span={2}>
                        {record.recommendation}
                      </Descriptions.Item>
                      <Descriptions.Item label="Content-Type">{record.headers?.["content-type"] || "-"}</Descriptions.Item>
                      <Descriptions.Item label="WWW-Authenticate">{record.headers?.["www-authenticate"] || "-"}</Descriptions.Item>
                      <Descriptions.Item label="CORS Origin">{record.headers?.["access-control-allow-origin"] || "-"}</Descriptions.Item>
                      <Descriptions.Item label="CORS Methods">{record.headers?.["access-control-allow-methods"] || "-"}</Descriptions.Item>
                      <Descriptions.Item label="Body SHA256" span={2}>
                        <Typography.Text copyable>{record.bodySummary?.bodySha256 || "-"}</Typography.Text>
                      </Descriptions.Item>
                    </Descriptions>
                    <Collapse
                      size="small"
                      items={[
                        {
                          key: "sample",
                          label: "脱敏响应 sample",
                          children: (
                            <pre style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 280, overflow: "auto" }}>
                              {record.bodySummary?.sample || "-"}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  </Space>
                ),
              }}
            />
          ) : (
            <Empty image={<SafetyCertificateOutlined style={{ fontSize: 42 }} />} description="还没有运行检查" />
          )}
        </PageSection>

        {result?.notes?.length ? (
          <PageSection title="检测策略说明">
            <Space direction="vertical">
              {result.notes.map((note) => (
                <Typography.Text key={note}>· {note}</Typography.Text>
              ))}
            </Space>
          </PageSection>
        ) : null}
      </Space>
    </PermissionGuard>
  );
}
