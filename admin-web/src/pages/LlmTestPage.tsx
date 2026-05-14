import { useEffect, useMemo, useState } from "react";
import { message } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { fetchLlmModels, runLlmTest, type LlmModelOption } from "@/services/llm";

interface HistoryItem {
  prompt: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  outputFormat: "text" | "json";
  jsonSchema: string;
  time: number;
}

const HISTORY_KEY = "llm_test_history";
const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "sentiment": {
      "type": "string",
      "enum": ["positive", "negative", "neutral"],
      "description": "情感倾向"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "置信度"
    }
  },
  "required": ["sentiment", "confidence"]
}`;

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as HistoryItem[];
  } catch {
    return [];
  }
}

function formatResult(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function tempHint(value: number) {
  if (value <= 0.3) return `${value.toFixed(1)} - 精准`;
  if (value <= 0.7) return `${value.toFixed(1)} - 对话`;
  if (value <= 1.2) return `${value.toFixed(1)} - 创意`;
  return `${value.toFixed(1)} - 高随机`;
}

export function LlmTestPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("gemini-3.1-flash-lite-preview");
  const [temperature, setTemperature] = useState(0.7);
  const [outputFormat, setOutputFormat] = useState<"text" | "json">("text");
  const [jsonSchema, setJsonSchema] = useState(DEFAULT_SCHEMA);
  const [history, setHistory] = useState<HistoryItem[]>(() => readHistory());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchLlmModels()
      .then((resp) => {
        const nextModels = resp.data || [];
        setModels(nextModels);
        if (nextModels.length && !nextModels.some((item) => item.value === model)) setModel(nextModels[0].value);
      })
      .catch((error) => messageApi.error(error instanceof Error ? error.message : "加载模型列表失败"));
  }, [messageApi, model]);

  const resultVisible = result !== null || !!resultError;
  const resultText = useMemo(() => resultError || formatResult(result), [result, resultError]);

  function saveHistory(item: HistoryItem) {
    const next = [item, ...history].slice(0, 6);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  function fillFromHistory(item: HistoryItem) {
    setPrompt(item.prompt);
    setSystemPrompt(item.systemPrompt);
    setModel(item.model);
    setTemperature(item.temperature);
    setOutputFormat(item.outputFormat);
    setJsonSchema(item.jsonSchema);
  }

  async function runTest() {
    if (!prompt.trim()) {
      messageApi.warning("请输入提示词");
      return;
    }

    let schema: unknown = undefined;
    if (outputFormat === "json") {
      try {
        schema = JSON.parse(jsonSchema || "{}");
      } catch (error) {
        messageApi.error(error instanceof Error ? `Schema 解析失败：${error.message}` : "Schema 解析失败");
        return;
      }
    }

    setLoading(true);
    setResult(null);
    setResultError(null);
    setMeta(null);
    try {
      const resp = await runLlmTest({ prompt, model, temperature, outputFormat, jsonSchema: schema, systemPrompt });
      setMeta(resp.meta || null);
      if (resp.success) {
        setResult(resp.data);
        saveHistory({ prompt, systemPrompt, model, temperature, outputFormat, jsonSchema, time: Date.now() });
      } else {
        setResultError(typeof resp.error === "string" ? resp.error : resp.error?.message || "调用失败");
      }
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "调用失败");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPrompt("");
    setSystemPrompt("");
    setTemperature(0.7);
    setOutputFormat("text");
    setJsonSchema(DEFAULT_SCHEMA);
    setResult(null);
    setResultError(null);
    setMeta(null);
  }

  return (
    <PermissionGuard permission="llm-test">
      {contextHolder}
      <div className="llm-test-container" id="llm-test-container">
        <div className="panel history-panel">
          <div className="panel-header">
            <h3 className="panel-title">历史记录 <span className="hint">(最近6条，点击填充)</span></h3>
            <button className="btn-clear-history" onClick={() => { setHistory([]); localStorage.removeItem(HISTORY_KEY); }} title="清空历史">清空</button>
          </div>
          <div className="panel-body">
            <div className="history-list">
              {history.length ? history.map((item) => (
                <button key={`${item.time}-${item.model}`} className="history-item" onClick={() => fillFromHistory(item)}>
                  <div className="history-meta"><span className="history-model">{item.model}</span><span className="history-time">{new Date(item.time).toLocaleString()}</span></div>
                  <div className="history-prompt">{item.prompt}</div>
                </button>
              )) : <div className="history-empty">暂无历史记录</div>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3 className="panel-title">输入配置</h3></div>
          <div className="panel-body">
            <div className="form-group"><label className="form-label">提示词 <span className="hint">*</span></label><textarea className="form-textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="请输入你想让 AI 执行的任务..." /></div>
            <div className="form-group"><label className="form-label">系统提示词 <span className="hint">可选</span></label><textarea className="form-textarea" rows={2} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="例如：你是一个专业的区块链项目分析师。" /><div className="input-hint">系统提示词用于设定 AI 的角色和输出要求，使用 JSON 输出时请说明字段要求</div></div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">模型</label><select className="form-select" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((item) => <option key={item.value} value={item.value}>{item.label || item.value}</option>)}</select></div>
              <div className="form-group"><label className="form-label">温度 <span className="hint">{tempHint(temperature)}</span></label><div className="slider-wrap"><input className="slider" type="range" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /><span className="slider-value">{temperature.toFixed(1)}</span></div></div>
            </div>
            <div className="form-group"><label className="form-label">输出格式</label><div className="radio-group"><label className="radio-label"><input type="radio" checked={outputFormat === "text"} onChange={() => setOutputFormat("text")} /><span>文本</span></label><label className="radio-label"><input type="radio" checked={outputFormat === "json"} onChange={() => setOutputFormat("json")} /><span>JSON (结构化)</span></label></div></div>
            {outputFormat === "json" ? <div className="schema-section"><div className="form-group"><label className="form-label">JSON Schema</label><div className="schema-help"><strong>关键提醒：</strong>Schema 字段名必须与<strong>系统提示</strong>中要求的字段名完全一致</div><textarea className="form-textarea code" rows={10} value={jsonSchema} onChange={(e) => setJsonSchema(e.target.value)} /></div></div> : null}
            <div className="form-actions"><button className="btn btn-primary" disabled={loading} onClick={runTest}>{loading ? "运行中..." : "运行测试"}</button><button className="btn btn-secondary" onClick={reset}>重置</button></div>
            <div className="tips-box"><div className="tips-title">温度使用建议</div><ul className="tips-list"><li><strong>0 - 0.3</strong>：数据分析、字段提取（结果稳定）</li><li><strong>0.4 - 0.7</strong>：通用问答、项目评估（平衡）</li><li><strong>0.8 - 1.2</strong>：创意写作、头脑风暴（随机性高）</li></ul></div>
          </div>
        </div>

        {loading ? <div className="loading-state"><div className="spinner"></div><p>正在调用模型，请稍候...</p></div> : null}
        {resultVisible ? <div className="panel result-panel"><div className="panel-header"><h3 className="panel-title">输出结果 <span className="badge">{resultError ? "ERROR" : outputFormat.toUpperCase()}</span></h3><div className="panel-meta"><span>{String(meta?.model || model)}</span><span>temp {String(meta?.temperature ?? temperature)}</span><span>{String(meta?.duration || "-")}</span>{meta?.requestId ? <span className="request-id-tag">{String(meta.requestId)}</span> : null}</div></div><div className="panel-body"><pre className="result-code">{resultText}</pre></div></div> : null}
      </div>
    </PermissionGuard>
  );
}
