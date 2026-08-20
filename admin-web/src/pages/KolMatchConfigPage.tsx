import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { JsonEditorCard } from "@/components/ui/JsonEditorCard";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { useAuth } from "@/app/auth";
import {
  fetchKolMatchConfig,
  fetchKolMatchConfigHistory,
  publishKolMatchConfig,
  refreshKolMatchConfigCache,
  validateKolMatchConfig,
} from "@/services/kol-match-config";
import type {
  KolMatchAppEnv,
  KolMatchEffectiveConfig,
  KolMatchHistoryItem,
  KolMatchRuntimeConfigDocument,
} from "@/types/kol-match-config";
import "@/styles/pages/kol-match-config.css";

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

type FormValues = {
  version: string;
  limits: KolMatchEffectiveConfig["limits"];
  strategyLlm: KolMatchEffectiveConfig["strategyLlm"];
  evaluatorLlm: KolMatchEffectiveConfig["evaluatorLlm"];
  strategyTaskPrompt: string;
  strategySystemPrompt: string;
  strategyExtraRules: string;
  evaluatorTaskPrompt: string;
  evaluatorSystemPrompt: string;
  evaluatorAuthoritativeRules: string;
  evaluatorScoreCalibration: string;
};

const DEFAULT_DOCUMENT: KolMatchRuntimeConfigDocument = {
  version: "2026-08-20-v1",
  defaults: {
    limits: {
      aiDailyLimit: 3,
      filterDailyLimit: 10,
      aiResultLimit: 50,
      aiRecallTopK: 100,
      filterResultLimit: 200,
      filterCandidateScanLimit: 2000,
    },
    strategyLlm: { enabled: true, model: "", timeoutMs: 10000, maxTokens: 1200, temperature: 0 },
    evaluatorLlm: { enabled: true, model: "", timeoutMs: 45000, batchSize: 10, maxTokensBase: 900, maxTokensPerCandidate: 300, maxTokensCap: 5000, temperature: 0 },
    prompts: {
      strategy: { taskPrompt: "", systemPrompt: "", extraRules: [] },
      candidateEvaluation: { taskPrompt: "", systemPrompt: "", authoritativeRules: [], scoreCalibration: [] },
    },
  },
  envs: { production: {}, test: {} },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base: Record<string, unknown>, override?: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = clone(base || {});
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      output[key] = value;
    }
  });
  return output;
}

function linesToArray(value?: string) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToLines(value?: string[]) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function effectiveConfig(document: KolMatchRuntimeConfigDocument, env: KolMatchAppEnv): KolMatchEffectiveConfig {
  const merged = deepMerge(document.defaults as Record<string, unknown>, document.envs?.[env] as Record<string, unknown>) as unknown as KolMatchEffectiveConfig;
  return { ...merged, version: (document.envs?.[env]?.version as string) || document.version, appEnv: env };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function productionSignature(document: KolMatchRuntimeConfigDocument) {
  const {
    source,
    configSource,
    fallbackReason,
    contentSha256,
    ...production
  } = clone(effectiveConfig(document, "production"));
  void source;
  void configSource;
  void fallbackReason;
  void contentSha256;
  return stableJson(production);
}

function hasProductionConfigChange(beforeDocument: KolMatchRuntimeConfigDocument, afterDocument: KolMatchRuntimeConfigDocument) {
  return productionSignature(beforeDocument) !== productionSignature(afterDocument);
}

function valuesFromConfig(document: KolMatchRuntimeConfigDocument, env: KolMatchAppEnv): FormValues {
  const config = effectiveConfig(document, env);
  return {
    version: document.version,
    limits: config.limits,
    strategyLlm: config.strategyLlm,
    evaluatorLlm: config.evaluatorLlm,
    strategyTaskPrompt: config.prompts?.strategy?.taskPrompt || "",
    strategySystemPrompt: config.prompts?.strategy?.systemPrompt || "",
    strategyExtraRules: arrayToLines(config.prompts?.strategy?.extraRules),
    evaluatorTaskPrompt: config.prompts?.candidateEvaluation?.taskPrompt || "",
    evaluatorSystemPrompt: config.prompts?.candidateEvaluation?.systemPrompt || "",
    evaluatorAuthoritativeRules: arrayToLines(config.prompts?.candidateEvaluation?.authoritativeRules),
    evaluatorScoreCalibration: arrayToLines(config.prompts?.candidateEvaluation?.scoreCalibration),
  };
}

function applyValues(document: KolMatchRuntimeConfigDocument, env: KolMatchAppEnv, values: FormValues) {
  const next = clone(document || DEFAULT_DOCUMENT);
  next.version = values.version || next.version;
  next.envs = next.envs || { production: {}, test: {} };
  next.envs[env] = {
    ...(next.envs[env] || {}),
    limits: values.limits,
    strategyLlm: values.strategyLlm,
    evaluatorLlm: values.evaluatorLlm,
    prompts: {
      strategy: {
        taskPrompt: values.strategyTaskPrompt || "",
        systemPrompt: values.strategySystemPrompt || "",
        extraRules: linesToArray(values.strategyExtraRules),
      },
      candidateEvaluation: {
        taskPrompt: values.evaluatorTaskPrompt || "",
        systemPrompt: values.evaluatorSystemPrompt || "",
        authoritativeRules: linesToArray(values.evaluatorAuthoritativeRules),
        scoreCalibration: linesToArray(values.evaluatorScoreCalibration),
      },
    },
  };
  return next;
}

function envLabel(env: KolMatchAppEnv) {
  return env === "production" ? "正式 production" : "测试 test";
}

export function KolMatchConfigPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const { hasPermission } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const [activeEnv, setActiveEnv] = useState<KolMatchAppEnv>("test");
  const [document, setDocument] = useState<KolMatchRuntimeConfigDocument>(DEFAULT_DOCUMENT);
  const [baselineDocument, setBaselineDocument] = useState<KolMatchRuntimeConfigDocument>(DEFAULT_DOCUMENT);
  const [jsonText, setJsonText] = useState(JSON.stringify(DEFAULT_DOCUMENT, null, 2));
  const [source, setSource] = useState("defaults");
  const [sha, setSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [history, setHistory] = useState<KolMatchHistoryItem[]>([]);

  const current = useMemo(() => effectiveConfig(document, activeEnv), [document, activeEnv]);
  const canWrite = hasPermission(["kol-match-config:write", "nacos-admin"]);

  function syncForm(nextDoc = document, env = activeEnv) {
    form.setFieldsValue(valuesFromConfig(nextDoc, env));
  }

  async function loadConfig() {
    setLoading(true);
    try {
      const resp = await fetchKolMatchConfig();
      const parsed = JSON.parse(resp.data.content || JSON.stringify(DEFAULT_DOCUMENT));
      setDocument(parsed);
      setBaselineDocument(parsed);
      setJsonText(JSON.stringify(parsed, null, 2));
      setSource(resp.data.source);
      setSha(resp.data.contentSha256 || "");
      form.setFieldsValue(valuesFromConfig(parsed, activeEnv));
      const historyResp = await fetchKolMatchConfigHistory(12).catch(() => null);
      if (historyResp?.data) setHistory(historyResp.data);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 KOL Match 配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncForm(document, activeEnv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnv]);

  function updateDocumentFromForm() {
    const values = form.getFieldsValue(true) as FormValues;
    const next = applyValues(document, activeEnv, values);
    setDocument(next);
    setJsonText(JSON.stringify(next, null, 2));
    return next;
  }

  function handleJsonChange(value: string) {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value || "{}");
      setDocument(parsed);
      setValidationErrors([]);
      form.setFieldsValue(valuesFromConfig(parsed, activeEnv));
    } catch (error) {
      setValidationErrors(["JSON 解析失败，修正后才能保存"]);
    }
  }

  async function validateCurrent() {
    try {
      const next = updateDocumentFromForm();
      const resp = await validateKolMatchConfig(next, reason);
      setValidationErrors(resp.data.errors || []);
      messageApi.success("配置校验通过");
      return true;
    } catch (error) {
      const data = (error as { data?: { data?: { errors?: string[] } } }).data;
      const errors = data?.data?.errors || [error instanceof Error ? error.message : "配置校验失败"];
      setValidationErrors(errors);
      messageApi.error("配置校验失败");
      return false;
    }
  }

  async function saveConfig() {
    if (!canWrite) {
      messageApi.error("当前账号只有查看权限，不能发布 KOL Match 配置");
      return;
    }
    const valid = await validateCurrent();
    if (!valid) return;
    const next = updateDocumentFromForm();
    const productionChanged = hasProductionConfigChange(baselineDocument, next);
    let productionConfirm = "";
    if (productionChanged) {
      if (!reason.trim()) {
        messageApi.error("检测到正式环境配置变更，请填写保存原因");
        return;
      }
      const confirmText = window.prompt("检测到正式 production 配置变更。请输入 CONFIRM 继续保存。", "");
      if (confirmText !== "CONFIRM") return;
      productionConfirm = confirmText;
    }
    setSaving(true);
    try {
      const resp = await publishKolMatchConfig({
        config: next,
        reason: reason.trim() || `${envLabel(activeEnv)} 配置调整`,
        productionConfirm,
      });
      setSha(resp.data.afterSha256 || "");
      messageApi.success("已保存到 Nacos，并刷新当前进程缓存");
      await loadConfig();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function refreshCache() {
    if (!canWrite) {
      messageApi.error("当前账号只有查看权限，不能刷新后端配置缓存");
      return;
    }
    setSaving(true);
    try {
      await refreshKolMatchConfigCache();
      messageApi.success("后端缓存已刷新");
      await loadConfig();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "刷新缓存失败");
    } finally {
      setSaving(false);
    }
  }

  function copyProductionToTest() {
    const next = clone(document);
    next.envs.test = clone(next.envs.production || {});
    setDocument(next);
    setJsonText(JSON.stringify(next, null, 2));
    if (activeEnv === "test") form.setFieldsValue(valuesFromConfig(next, "test"));
    messageApi.success("已复制正式配置到测试环境，保存后生效");
  }

  return (
    <PermissionGuard permission={["kol-match-config:read", "kol-match-config:write", "nacos-admin"]}>
    <div className="kol-match-config-page">
      {contextHolder}
      <section className="kol-match-hero">
        <div>
          <Text className="kol-match-kicker">EchoHunt runtime control</Text>
          <Title level={2}>KOL Match 配置</Title>
          <Paragraph>把正式和测试环境的名单数量、Quota、LLM 参数与 Prompt 收口到同一份 Nacos JSON。</Paragraph>
        </div>
        <Space wrap>
          <Tag color={source === "nacos" ? "green" : "orange"}>source: {source}</Tag>
          <Tag>version: {document.version || "-"}</Tag>
          <Tag>{sha ? sha.slice(0, 12) : "no-sha"}</Tag>
          <Button onClick={loadConfig} loading={loading}>刷新</Button>
        </Space>
      </section>

      {validationErrors.length ? (
        <Alert className="kol-match-alert" type="error" showIcon message="配置校验未通过" description={validationErrors.map((item) => <div key={item}>{item}</div>)} />
      ) : null}

      <Card className="kol-match-toolbar">
        <Space wrap align="center">
          <Segmented
            value={activeEnv}
            onChange={(value) => setActiveEnv(value as KolMatchAppEnv)}
            options={[{ label: "测试环境", value: "test" }, { label: "正式环境", value: "production" }]}
          />
          <Input className="kol-match-reason" placeholder="保存原因，生产环境必填建议写清楚" value={reason} onChange={(event) => setReason(event.target.value)} />
          <Button onClick={copyProductionToTest}>复制正式到测试</Button>
          <Button onClick={validateCurrent}>校验配置</Button>
          <Button onClick={refreshCache} loading={saving} disabled={!canWrite}>刷新后端缓存</Button>
          <Button type="primary" danger={activeEnv === "production"} onClick={saveConfig} loading={saving} disabled={!canWrite}>保存到 Nacos</Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]} className="kol-match-metrics">
        <Col xs={12} lg={6}><Card><Text type="secondary">AI 展示</Text><strong>{current.limits?.aiResultLimit}</strong></Card></Col>
        <Col xs={12} lg={6}><Card><Text type="secondary">Embedding 召回</Text><strong>{current.limits?.aiRecallTopK}</strong></Card></Col>
        <Col xs={12} lg={6}><Card><Text type="secondary">Evaluator Batch</Text><strong>{current.evaluatorLlm?.batchSize}</strong></Card></Col>
        <Col xs={12} lg={6}><Card><Text type="secondary">Prompt Rules</Text><strong>{current.prompts?.strategy?.extraRules?.length || 0}</strong></Card></Col>
      </Row>

      <Tabs
        items={[
          {
            key: "form",
            label: "表单配置",
            children: (
              <Form form={form} layout="vertical" onValuesChange={updateDocumentFromForm} initialValues={valuesFromConfig(document, activeEnv)}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={8}>
                    <Card title="基础数量 / Quota" className="kol-match-panel">
                      <Form.Item label="配置版本" name="version"><Input /></Form.Item>
                      <Row gutter={12}>
                        <Col span={12}><Form.Item label="AI 每日次数" name={["limits", "aiDailyLimit"]}><InputNumber min={1} max={100} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Filter 每日次数" name={["limits", "filterDailyLimit"]}><InputNumber min={1} max={100} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="AI 展示数量" name={["limits", "aiResultLimit"]}><InputNumber min={1} max={200} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="AI 召回 TopK" name={["limits", "aiRecallTopK"]}><InputNumber min={1} max={600} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Filter 展示数量" name={["limits", "filterResultLimit"]}><InputNumber min={1} max={200} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Filter 预扫描" name={["limits", "filterCandidateScanLimit"]}><InputNumber min={1} max={5000} className="full" /></Form.Item></Col>
                      </Row>
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="Strategy LLM" className="kol-match-panel">
                      <Form.Item label="启用" name={["strategyLlm", "enabled"]} valuePropName="checked"><Switch /></Form.Item>
                      <Form.Item label="模型（空则使用默认 LLM_MODEL）" name={["strategyLlm", "model"]}><Input /></Form.Item>
                      <Row gutter={12}>
                        <Col span={8}><Form.Item label="Timeout" name={["strategyLlm", "timeoutMs"]}><InputNumber min={1000} max={60000} className="full" /></Form.Item></Col>
                        <Col span={8}><Form.Item label="Max tokens" name={["strategyLlm", "maxTokens"]}><InputNumber min={100} max={12000} className="full" /></Form.Item></Col>
                        <Col span={8}><Form.Item label="Temperature" name={["strategyLlm", "temperature"]}><InputNumber min={0} max={2} step={0.1} className="full" /></Form.Item></Col>
                      </Row>
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="Candidate Evaluator LLM" className="kol-match-panel">
                      <Form.Item label="启用" name={["evaluatorLlm", "enabled"]} valuePropName="checked"><Switch /></Form.Item>
                      <Form.Item label="模型（空则使用默认 LLM_MODEL）" name={["evaluatorLlm", "model"]}><Input /></Form.Item>
                      <Row gutter={12}>
                        <Col span={8}><Form.Item label="Timeout" name={["evaluatorLlm", "timeoutMs"]}><InputNumber min={5000} max={120000} className="full" /></Form.Item></Col>
                        <Col span={8}><Form.Item label="Batch" name={["evaluatorLlm", "batchSize"]}><InputNumber min={1} max={20} className="full" /></Form.Item></Col>
                        <Col span={8}><Form.Item label="Token cap" name={["evaluatorLlm", "maxTokensCap"]}><InputNumber min={500} max={12000} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Base tokens" name={["evaluatorLlm", "maxTokensBase"]}><InputNumber min={100} max={12000} className="full" /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Per candidate" name={["evaluatorLlm", "maxTokensPerCandidate"]}><InputNumber min={50} max={2000} className="full" /></Form.Item></Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>

                <Divider />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card title="Strategy Prompt" className="kol-match-panel">
                      <Form.Item label="Task Prompt" name="strategyTaskPrompt"><TextArea rows={5} /></Form.Item>
                      <Form.Item label="System Prompt（追加在不可变安全规则后）" name="strategySystemPrompt"><TextArea rows={5} /></Form.Item>
                      <Form.Item label="Extra Rules（一行一条）" name="strategyExtraRules"><TextArea rows={8} /></Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="Candidate Evaluation Prompt" className="kol-match-panel">
                      <Form.Item label="Task Prompt" name="evaluatorTaskPrompt"><TextArea rows={5} /></Form.Item>
                      <Form.Item label="System Prompt（追加在不可变安全规则后）" name="evaluatorSystemPrompt"><TextArea rows={5} /></Form.Item>
                      <Form.Item label="Authoritative Rules（一行一条）" name="evaluatorAuthoritativeRules"><TextArea rows={5} /></Form.Item>
                      <Form.Item label="Score Calibration（一行一条）" name="evaluatorScoreCalibration"><TextArea rows={5} /></Form.Item>
                    </Card>
                  </Col>
                </Row>
              </Form>
            ),
          },
          {
            key: "json",
            label: "高级 JSON",
            children: (
              <JsonEditorCard
                title="完整 Nacos JSON"
                description="表单覆盖不到的字段可在这里编辑；JSON 合法后会同步到表单。"
                value={jsonText}
                onChange={handleJsonChange}
                height={620}
              />
            ),
          },
          {
            key: "history",
            label: "历史",
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={history}
                columns={[
                  { title: "时间", dataIndex: "createdAt" },
                  { title: "操作", dataIndex: "action" },
                  { title: "操作者", dataIndex: "operatorEmail" },
                  { title: "Hash", dataIndex: "contentSha256", render: (value: string) => <Text code>{value?.slice(0, 12)}</Text> },
                  { title: "原因", dataIndex: "reason" },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
    </PermissionGuard>
  );
}
