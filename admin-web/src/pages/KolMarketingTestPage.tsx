import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  fetchKolMarketingStatus,
  searchKolMarketingProfiles,
  type KolMarketingFilters,
  type KolMarketingSearchData,
  type KolMarketingSearchItem,
  type KolMarketingServiceStatus,
} from "@/services/kol-marketing";
import "@/styles/pages/kol-marketing-test.css";

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

const EXAMPLE_QUERIES = [
  "找适合 AI 项目早期增长合作的中文 KOL",
  "找粉丝 5 万以上、偏 Web3/交易所方向、愿意做合作的账号",
  "找英文区适合 DeFi 项目、互动质量高的营销账号",
];

const DEFAULT_QUERY = EXAMPLE_QUERIES[0];

function splitTags(value?: string) {
  return String(value || "")
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactFilters(values: Record<string, unknown>): KolMarketingFilters {
  const filters: KolMarketingFilters = {};
  const language = String(values.language || "").trim();
  const willingnessLevel = String(values.willingnessLevel || "").trim();
  const identityTier = String(values.identityTier || "").trim();

  if (language) filters.language = language;
  if (willingnessLevel) filters.willingnessLevel = willingnessLevel;
  if (identityTier) filters.identityTier = identityTier;

  const domains = splitTags(values.domains as string);
  const keywords = splitTags(values.keywords as string);
  const cooperationTypes = splitTags(values.cooperationTypes as string);
  const marketingGoals = splitTags(values.marketingGoals as string);
  const projectStages = splitTags(values.projectStages as string);

  if (domains.length) filters.domains = domains;
  if (keywords.length) filters.keywords = keywords;
  if (cooperationTypes.length) filters.cooperationTypes = cooperationTypes;
  if (marketingGoals.length) filters.marketingGoals = marketingGoals;
  if (projectStages.length) filters.projectStages = projectStages;

  const minFollowers = optionalNumber(values.minFollowers);
  const maxFollowers = optionalNumber(values.maxFollowers);
  if (minFollowers !== undefined) filters.minFollowers = minFollowers;
  if (maxFollowers !== undefined) filters.maxFollowers = maxFollowers;

  return filters;
}

function formatPercent(value?: string | number | null) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  return `${(numberValue * 100).toFixed(1)}%`;
}

function renderTags(values?: string[] | null, color = "blue") {
  if (!values?.length) return <Text type="secondary">-</Text>;
  return (
    <Space size={[4, 4]} wrap>
      {values.slice(0, 5).map((item) => <Tag color={color} key={item}>{item}</Tag>)}
      {values.length > 5 ? <Tag>+{values.length - 5}</Tag> : null}
    </Space>
  );
}

function statusColor(status?: KolMarketingServiceStatus | null) {
  if (!status) return "default";
  return status.ready ? "success" : "error";
}

export function KolMarketingTestPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [status, setStatus] = useState<KolMarketingServiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [result, setResult] = useState<KolMarketingSearchData | null>(null);
  const [errorText, setErrorText] = useState("");

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const resp = await fetchKolMarketingStatus();
      setStatus(resp.data);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载服务状态失败");
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function runSearch() {
    const values = await form.validateFields();
    const query = String(values.query || "").trim();
    const limit = Number(values.limit || 20);
    const filters = compactFilters(values);

    setSearchLoading(true);
    setErrorText("");
    setResult(null);
    try {
      const resp = await searchKolMarketingProfiles({ query, filters, limit });
      setResult(resp.data);
      if (resp.data.serviceStatus) setStatus(resp.data.serviceStatus);
      messageApi.success(`检索完成，返回 ${resp.data.items.length} 条`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "KOL Marketing 搜索失败";
      setErrorText(text);
      messageApi.error(text);
    } finally {
      setSearchLoading(false);
    }
  }

  function applyExample(query: string) {
    form.setFieldsValue({ query });
  }

  const columns = useMemo<ColumnsType<KolMarketingSearchItem>>(() => [
    {
      title: "KOL",
      key: "kol",
      width: 220,
      fixed: "left",
      render: (_, record) => (
        <div className="kol-result-identity">
          <strong>{record.name || record.handle || record.twitterUserId}</strong>
          <Text copyable className="kol-result-handle">@{record.handle || "-"}</Text>
          <Text type="secondary" className="kol-result-id">{record.twitterUserId}</Text>
        </div>
      ),
    },
    {
      title: "相似度",
      dataIndex: "similarity",
      width: 100,
      render: (value) => <Tag color="green">{formatPercent(value)}</Tag>,
      sorter: (a, b) => Number(a.similarity || 0) - Number(b.similarity || 0),
    },
    {
      title: "粉丝",
      dataIndex: "followers",
      width: 110,
      render: (value) => typeof value === "number" ? value.toLocaleString() : "-",
      sorter: (a, b) => Number(a.followers || 0) - Number(b.followers || 0),
    },
    {
      title: "语言 / 层级",
      key: "profile",
      width: 130,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Tag>{record.language || "unknown"}</Tag>
          {record.identityTier ? <Tag color="purple">{record.identityTier}</Tag> : null}
        </Space>
      ),
    },
    {
      title: "领域",
      dataIndex: "domains",
      width: 180,
      render: (values) => renderTags(values, "geekblue"),
    },
    {
      title: "关键词",
      dataIndex: "keywords",
      width: 220,
      render: (values) => renderTags(values, "cyan"),
    },
    {
      title: "合作意愿",
      key: "willingness",
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.willingnessLevel ? "orange" : "default"}>{record.willingnessLevel || "-"}</Tag>
          <Text type="secondary">score {record.willingnessScore ?? "-"}</Text>
        </Space>
      ),
    },
    {
      title: "画像摘要",
      dataIndex: "marketingSummaryCn",
      width: 360,
      render: (value, record) => (
        <Paragraph className="kol-summary" ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}>
          {value || record.marketingSummaryEn || "-"}
        </Paragraph>
      ),
    },
    {
      title: "Embedding",
      key: "embedding",
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text type="secondary">{record.embeddingModel || "-"}</Text>
          <Tag>{record.embeddingVersion || "-"}</Tag>
        </Space>
      ),
    },
  ], []);

  const items = result?.items || [];

  return (
    <PermissionGuard permission="llm-test">
      {contextHolder}
      <div className="kol-marketing-test-page">
        <section className="kol-marketing-hero">
          <div>
            <Text className="kol-marketing-kicker">Readonly pgvector Lab</Text>
            <Title level={2}>KOL Marketing 向量检索联调台</Title>
            <Paragraph>
              这里通过管理后台代理调用 <Text code>/api/admin/kol-marketing/search</Text>，后端复用正式 KOL Marketing 搜索 service，
              用同一套 embedding + 只读从库 pgvector 查询链路验证结果。
            </Paragraph>
          </div>
          <Space wrap>
            <Tag color={statusColor(status)} className="kol-status-tag">
              {status?.ready ? "服务可用" : "服务未就绪"}
            </Tag>
            <Button loading={statusLoading} onClick={loadStatus}>刷新状态</Button>
          </Space>
        </section>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={9}>
            <Card className="kol-control-card" title="搜索条件">
              <Form
                form={form}
                layout="vertical"
                initialValues={{ query: DEFAULT_QUERY, limit: 20, language: "zh" }}
              >
                <Form.Item name="query" label="自然语言 Query" rules={[{ required: true, min: 2, message: "请输入至少 2 个字符" }]}>
                  <TextArea rows={4} placeholder="例如：找适合 AI 项目早期增长合作的中文 KOL" />
                </Form.Item>

                <div className="kol-example-strip">
                  {EXAMPLE_QUERIES.map((item) => (
                    <button type="button" key={item} onClick={() => applyExample(item)}>{item}</button>
                  ))}
                </div>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="limit" label="返回条数">
                      <InputNumber min={1} max={50} className="kol-full" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="language" label="语言">
                      <Select allowClear options={[{ value: "zh", label: "zh" }, { value: "en", label: "en" }]} />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item name="domains" label="domains（逗号分隔）">
                  <Input placeholder="ai, web3, defi" />
                </Form.Item>
                <Form.Item name="keywords" label="keywords（逗号分隔）">
                  <Input placeholder="growth, exchange, trading" />
                </Form.Item>
                <Form.Item name="cooperationTypes" label="cooperationTypes（逗号分隔）">
                  <Input placeholder="campaign, content, community" />
                </Form.Item>
                <Form.Item name="marketingGoals" label="marketingGoals（逗号分隔）">
                  <Input placeholder="awareness, conversion, launch" />
                </Form.Item>
                <Form.Item name="projectStages" label="projectStages（逗号分隔）">
                  <Input placeholder="early, growth, mature" />
                </Form.Item>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="minFollowers" label="最小粉丝">
                      <InputNumber min={0} className="kol-full" placeholder="50000" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxFollowers" label="最大粉丝">
                      <InputNumber min={0} className="kol-full" />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="willingnessLevel" label="意愿等级">
                      <Input placeholder="high / medium" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="identityTier" label="身份层级">
                      <Input placeholder="tier_1" />
                    </Form.Item>
                  </Col>
                </Row>

                <Space wrap>
                  <Button type="primary" loading={searchLoading} onClick={runSearch}>运行检索</Button>
                  <Button onClick={() => form.resetFields()}>重置</Button>
                </Space>
              </Form>
            </Card>
          </Col>

          <Col xs={24} xl={15}>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Card className="kol-metric-card"><Statistic title="结果数" value={items.length} suffix={`/ ${result?.limit || 20}`} /></Card>
              </Col>
              <Col xs={24} md={8}>
                <Card className="kol-metric-card"><Statistic title="DB 耗时" value={result?.dbCostMs ?? 0} suffix="ms" /></Card>
              </Col>
              <Col xs={24} md={8}>
                <Card className="kol-metric-card"><Statistic title="Embedding 缓存" value={result?.embeddingCacheHit ? "命中" : result ? "未命中" : "-"} /></Card>
              </Col>
            </Row>

            <Card className="kol-status-card" title="服务状态">
              <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
                <Descriptions.Item label="ready">{String(status?.ready ?? false)}</Descriptions.Item>
                <Descriptions.Item label="embeddingModel">{status?.embeddingModel || "-"}</Descriptions.Item>
                <Descriptions.Item label="pgConfigured">{String(status?.pgConfigured ?? false)}</Descriptions.Item>
                <Descriptions.Item label="pgReady">{String(status?.pgRead?.ready ?? false)}</Descriptions.Item>
                <Descriptions.Item label="database">{status?.pgRead?.server?.databaseName || "-"}</Descriptions.Item>
                <Descriptions.Item label="server">{status?.pgRead?.server ? `${status.pgRead.server.serverAddr}:${status.pgRead.server.serverPort}` : "-"}</Descriptions.Item>
                <Descriptions.Item label="inRecovery">{String(status?.pgRead?.server?.inRecovery ?? "-")}</Descriptions.Item>
                <Descriptions.Item label="readonly">{status?.pgRead?.server?.transactionReadOnly || "-"}</Descriptions.Item>
              </Descriptions>
              {status?.pgRead?.error ? <Alert type="warning" showIcon message={status.pgRead.error} className="kol-status-alert" /> : null}
            </Card>

            {errorText ? <Alert type="error" showIcon message={errorText} className="kol-status-alert" /> : null}

            <Card
              className="kol-result-card"
              title="检索结果"
              extra={result?.semanticQuery ? <Text type="secondary">semantic: {result.semanticQuery}</Text> : null}
            >
              {items.length ? (
                <Table
                  rowKey={(record) => record.twitterUserId || record.handle}
                  columns={columns}
                  dataSource={items}
                  loading={searchLoading}
                  scroll={{ x: 1650 }}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  size="middle"
                />
              ) : (
                <Empty description="输入 query 后运行检索，这里会展示 KOL 列表和相似度" />
              )}
            </Card>
          </Col>
        </Row>
      </div>
    </PermissionGuard>
  );
}
