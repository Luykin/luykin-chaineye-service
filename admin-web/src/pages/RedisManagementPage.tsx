import { useEffect, useMemo, useState } from "react";
import { Modal, message } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  deleteRedisKey,
  fetchRedisConfig,
  fetchRedisDiagnostics,
  fetchRedisInfo,
  fetchRedisSystemd,
  queryRedisKey,
  resetRedisSlowlog,
  scanRedisKeys,
  updateRedisConfig,
  updateRedisSystemd,
  updateRedisKey,
  type RedisConfigData,
  type RedisConfigItem,
  type RedisDiagnosticsData,
  type RedisDiagnosticsFinding,
  type RedisInfo,
  type RedisKeyInfo,
  type RedisSystemdConfigItem,
  type RedisSystemdData,
} from "@/services/redis";

const HISTORY_KEY = "redis_query_history";
const MAX_HISTORY_ITEMS = 20;

function formatCompactNumber(num?: number) {
  if (!num) return "0";
  const absNum = Math.abs(num);
  if (absNum < 1000) return String(num);
  if (absNum < 1000000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (absNum < 1000000000) return `${(num / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(num / 1000000000).toFixed(1).replace(/\.0$/, "")}B`;
}

function formatNumber(num?: number) {
  return num?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || "0";
}

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${Number((bytes / Math.pow(1024, index)).toFixed(2))} ${sizes[index]}`;
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "永不过期";
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

function hitRate(info?: RedisInfo | null) {
  const hits = info?.keyspaceHits || 0;
  const misses = info?.keyspaceMisses || 0;
  const total = hits + misses;
  return total > 0 ? `${((hits / total) * 100).toFixed(2)}%` : "-";
}


function riskLabel(risk: RedisConfigItem["risk"]) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需确认";
  return "安全项";
}

function riskTone(risk: RedisConfigItem["risk"]) {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "safe";
}

function displayConfigValue(value?: string | null) {
  if (value === null || value === undefined || value === "") return "空 / 关闭";
  return value;
}

function findingTone(severity: RedisDiagnosticsFinding["severity"]) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "safe") return "safe";
  return "info";
}

function findingLabel(severity: RedisDiagnosticsFinding["severity"]) {
  if (severity === "danger") return "高危";
  if (severity === "warning") return "警告";
  if (severity === "safe") return "正常";
  return "提示";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatUsecAsMs(usec?: number | null) {
  if (!usec) return "-";
  return `${(usec / 1000).toFixed(usec >= 100000 ? 0 : 1)}ms`;
}

function displaySystemdValue(value?: string | null) {
  if (value === null || value === undefined || value === "") return "系统默认";
  return value;
}

export function RedisManagementPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [configData, setConfigData] = useState<RedisConfigData | null>(null);
  const [diagnostics, setDiagnostics] = useState<RedisDiagnosticsData | null>(null);
  const [systemdData, setSystemdData] = useState<RedisSystemdData | null>(null);
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});
  const [systemdInputs, setSystemdInputs] = useState<Record<string, string>>({});
  const [systemdServiceName, setSystemdServiceName] = useState("redis-server.service");
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [systemdLoading, setSystemdLoading] = useState(false);
  const [systemdSaving, setSystemdSaving] = useState(false);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [pattern, setPattern] = useState("");
  const [scannedKeys, setScannedKeys] = useState<string[]>([]);
  const [current, setCurrent] = useState<RedisKeyInfo | null>(null);
  const [history, setHistory] = useState<string[]>(() => readHistory());
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editTtl, setEditTtl] = useState("");

  const currentValue = current?.value || "";
  const canEdit = !!current;

  async function loadInfo() {
    try {
      const resp = await fetchRedisInfo();
      setInfo(resp.data || null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 Redis 信息失败");
    }
  }


  async function loadConfig() {
    setConfigLoading(true);
    try {
      const resp = await fetchRedisConfig();
      const data = resp.data || null;
      setConfigData(data);
      if (data?.items) {
        setConfigInputs(Object.fromEntries(data.items.map((item) => [item.key, item.value ?? ""])));
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 Redis 配置失败");
    } finally {
      setConfigLoading(false);
    }
  }

  async function loadDiagnostics() {
    setDiagnosticsLoading(true);
    try {
      const resp = await fetchRedisDiagnostics(30);
      setDiagnostics(resp.data || null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 Redis 诊断失败");
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  async function loadSystemd(serviceName = systemdServiceName) {
    setSystemdLoading(true);
    try {
      const resp = await fetchRedisSystemd(serviceName);
      const data = resp.data || null;
      setSystemdData(data);
      if (data?.serviceName) setSystemdServiceName(data.serviceName);
      if (data?.items) {
        setSystemdInputs(Object.fromEntries(data.items.map((item) => [item.key, item.value ?? ""])));
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 systemd 配置失败");
    } finally {
      setSystemdLoading(false);
    }
  }

  useEffect(() => {
    void loadInfo();
    void loadConfig();
  }, []);

  useEffect(() => {
    if (configOpen && !diagnostics && !diagnosticsLoading) {
      void loadDiagnostics();
    }
  }, [configOpen, diagnostics, diagnosticsLoading]);

  useEffect(() => {
    if (configOpen && !systemdData && !systemdLoading) {
      void loadSystemd();
    }
  }, [configOpen, systemdData, systemdLoading]);

  function saveHistory(key: string) {
    const next = [key, ...history.filter((item) => item !== key)].slice(0, MAX_HISTORY_ITEMS);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  async function handleQuery(nextKey = keyInput.trim()) {
    if (!nextKey) {
      messageApi.warning("请输入 Key");
      return;
    }
    setLoading(true);
    try {
      const resp = await queryRedisKey(nextKey);
      if (resp.data) {
        setCurrent(resp.data);
        setKeyInput(nextKey);
        saveHistory(nextKey);
      } else {
        setCurrent(null);
        messageApi.warning(resp.message || "Key 不存在");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan() {
    setLoading(true);
    try {
      const resp = await scanRedisKeys(pattern.trim() || "*", 100);
      setScannedKeys(resp.data?.keys || []);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  function openEdit() {
    if (!current) return;
    setEditValue(current.value || "");
    setEditTtl(current.ttl && current.ttl > 0 ? String(current.ttl) : "");
    setEditOpen(true);
  }

  async function handleUpdate() {
    if (!current) return;
    let value: unknown = editValue;
    if (current.type !== "string") {
      try {
        value = JSON.parse(editValue || "null");
      } catch (error) {
        messageApi.error(error instanceof Error ? `JSON 格式错误：${error.message}` : "JSON 格式错误");
        return;
      }
    }

    try {
      await updateRedisKey({
        key: current.key,
        type: current.type,
        value,
        ttl: editTtl.trim() ? Number(editTtl) : null,
      });
      messageApi.success("更新成功");
      setEditOpen(false);
      await handleQuery(current.key);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function handleDelete() {
    if (!current) return;
    try {
      await deleteRedisKey(current.key);
      messageApi.success("删除成功");
      setDeleteOpen(false);
      setCurrent(null);
      setKeyInput("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function copyValue() {
    if (!currentValue) return;
    await navigator.clipboard.writeText(currentValue);
    messageApi.success("已复制到剪贴板");
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }


  function setConfigValue(key: string, value: string) {
    setConfigInputs((prev) => ({ ...prev, [key]: value }));
  }

  function setSystemdValue(key: string, value: string) {
    setSystemdInputs((prev) => ({ ...prev, [key]: value }));
  }

  async function saveConfigItem(item: RedisConfigItem, value = configInputs[item.key] ?? "") {
    const run = async () => {
      setSavingConfigKey(item.key);
      try {
        const resp = await updateRedisConfig({ key: item.key, value });
        messageApi.success(`${item.label} 已更新${resp.data?.rewriteResult && String(resp.data.rewriteResult).includes("失败") ? "（但持久化写入失败，请检查 redis.conf 权限）" : ""}`);
        await loadConfig();
        await loadInfo();
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "更新 Redis 配置失败");
      } finally {
        setSavingConfigKey(null);
      }
    };

    if (item.risk === "high") {
      Modal.confirm({
        title: `确认修改高风险配置：${item.label}`,
        content: `当前值：${displayConfigValue(item.value)}；新值：${displayConfigValue(value)}。该配置可能影响 Redis 持久化、数据保留或内存淘汰策略，请确认已经理解影响。`,
        okText: "确认修改",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: run,
      });
      return;
    }

    await run();
  }

  async function applyRecommendedConfig() {
    const candidates = (configData?.items || []).filter((item) => item.risk === "low" && String(item.value ?? "") !== String(item.recommendedValue));
    if (!candidates.length) {
      messageApi.info("没有可自动应用的低风险建议项");
      return;
    }

    Modal.confirm({
      title: "应用安全建议配置",
      content: `将更新 ${candidates.length} 个低风险配置；中/高风险配置（如 maxmemory、持久化、淘汰策略）不会自动修改。`,
      okText: "应用建议",
      cancelText: "取消",
      onOk: async () => {
        for (const item of candidates) {
          setSavingConfigKey(item.key);
          await updateRedisConfig({ key: item.key, value: item.recommendedValue });
        }
        setSavingConfigKey(null);
        messageApi.success("已应用安全建议配置");
        await loadConfig();
        await loadInfo();
      },
    });
  }

  async function refreshRuntimeConsole() {
    await Promise.all([loadConfig(), loadInfo(), loadDiagnostics(), loadSystemd()]);
  }

  async function handleSystemdServiceChange(nextServiceName: string) {
    setSystemdServiceName(nextServiceName);
    await loadSystemd(nextServiceName);
  }

  async function saveSystemdConfig(values = systemdInputs) {
    Modal.confirm({
      title: "确认写入 Redis systemd 限流配置",
      content: "该操作会写入 /etc/systemd/system/<service>.d/override.conf 并执行 daemon-reload，但不会自动重启 Redis。配置生效通常需要手动重启 Redis 服务，请避开业务高峰。",
      okText: "写入配置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setSystemdSaving(true);
        try {
          const resp = await updateRedisSystemd({ serviceName: systemdServiceName, values });
          const data = resp.data || null;
          setSystemdData(data);
          if (data?.items) {
            setSystemdInputs(Object.fromEntries(data.items.map((item) => [item.key, item.value ?? ""])));
          }
          messageApi.success(data?.daemonReload?.error ? "已写入，但 daemon-reload 失败，请到服务器检查权限" : "systemd 配置已写入，重启 Redis 后生效");
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "写入 systemd 配置失败");
        } finally {
          setSystemdSaving(false);
        }
      },
    });
  }

  function applyRecommendedSystemd() {
    const values = Object.fromEntries((systemdData?.items || []).map((item) => [item.key, item.recommendedValue]));
    setSystemdInputs(values);
  }

  async function handleResetSlowlog() {
    Modal.confirm({
      title: "清空 Redis 慢日志？",
      content: "清空后可以重新观察接下来出现的慢命令，适合调整配置或优化代码后重新排查。",
      okText: "清空慢日志",
      cancelText: "取消",
      onOk: async () => {
        try {
          await resetRedisSlowlog();
          messageApi.success("慢日志已清空");
          await loadDiagnostics();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "清空慢日志失败");
        }
      },
    });
  }

  const infoItems = useMemo(() => [
    ["版本", info?.version || "-"],
    ["模式", info?.mode || "-"],
    ["总 Keys", formatCompactNumber(info?.totalKeys), formatNumber(info?.totalKeys)],
    ["内存", info?.usedMemory || "-"],
    ["连接", String(info?.connectedClients ?? "-")],
    ["命中率", hitRate(info)],
  ], [info]);


  const configSummary = useMemo(() => {
    const items = configData?.items || [];
    return {
      total: items.length,
      matched: items.filter((item) => String(item.value ?? "") === String(item.recommendedValue)).length,
      highRiskDrift: items.filter((item) => item.risk === "high" && String(item.value ?? "") !== String(item.recommendedValue)).length,
    };
  }, [configData]);

  const diagnosticHeadline = useMemo(() => {
    const findings = diagnostics?.findings || [];
    const danger = findings.filter((item) => item.severity === "danger").length;
    const warning = findings.filter((item) => item.severity === "warning").length;
    if (danger) return { tone: "danger", text: `${danger} 个高危信号` };
    if (warning) return { tone: "warning", text: `${warning} 个警告信号` };
    if (findings.length) return { tone: "safe", text: "暂无明显热点" };
    return { tone: "info", text: "等待诊断" };
  }, [diagnostics]);

  return (
    <PermissionGuard permission="redis-management">
      {contextHolder}
      <div className="redis-section">
        <div className="redis-header">
          <div className="redis-header-title">
            <h2>Redis 数据管理</h2>
            <p>查询、修改和删除 Redis 缓存数据</p>
          </div>
          <button className="redis-btn redis-btn-secondary" onClick={loadInfo}>刷新</button>
        </div>

        <div className="redis-info-bar">
          {infoItems.map(([label, value, title], index) => (
            <div className="info-item" key={label}>
              {index > 0 ? null : null}
              <span className="info-label">{label}</span>
              <span className={label === "总 Keys" ? "info-value info-value-mono" : "info-value"} title={title || String(value)}>{value}</span>
            </div>
          )).reduce<React.ReactNode[]>((nodes, node, index) => {
            if (index > 0) nodes.push(<div className="info-divider" key={`d-${index}`} />);
            nodes.push(node);
            return nodes;
          }, [])}
        </div>

        <div className="redis-main">
          <div className="redis-panel redis-panel-query">
            <div className="panel-header"><h3>查询 Key</h3></div>
            <div className="query-form">
              <div className="input-group">
                <input className="redis-input" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleQuery(); }} placeholder="输入 Key，如: user:session:xxx" />
                <button className="redis-btn redis-btn-primary" disabled={loading} onClick={() => handleQuery()}>查询</button>
              </div>
              <div className="scan-section">
                <div className="input-group input-group-sm">
                  <input className="redis-input redis-input-sm" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleScan(); }} placeholder="扫描模式，如: user:*" />
                  <button className="redis-btn redis-btn-secondary" disabled={loading} onClick={handleScan}>扫描</button>
                </div>
                <span className="input-hint">最多返回 100 个匹配项</span>
              </div>
            </div>

            {scannedKeys.length ? (
              <div className="keys-list">
                <table className="redis-table redis-table-compact">
                  <thead><tr><th>Key</th><th className="col-action">操作</th></tr></thead>
                  <tbody>
                    {scannedKeys.map((key) => <tr key={key}><td>{key}</td><td className="col-action"><button className="redis-btn redis-btn-secondary" style={{ height: 28, padding: "0 10px", fontSize: "0.75rem" }} onClick={() => handleQuery(key)}>查询</button></td></tr>)}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="history-section">
              <div className="section-subheader"><span>最近查询</span><button className="btn-text" onClick={clearHistory}>清空</button></div>
              <div className="history-list">
                {history.length ? history.map((item) => (
                  <div className="history-item" key={item}>
                    <span className="history-item-key" title="点击复制" onClick={() => navigator.clipboard.writeText(item)}>{item}</span>
                    <div className="history-item-actions">
                      <button className="btn-text" onClick={() => handleQuery(item)}>查询</button>
                      <button className="btn-text" onClick={() => setHistory((list) => list.filter((x) => x !== item))}>删除</button>
                    </div>
                  </div>
                )) : <span className="empty-text">暂无记录</span>}
              </div>
            </div>
          </div>

          {current ? (
            <div className="redis-panel redis-panel-result">
              <div className="panel-header"><h3>查询结果</h3>{current.isSensitive ? <div className="badge badge-warning">敏感 Key</div> : null}</div>
              <div className="meta-grid">
                <div className="meta-item"><span className="meta-label">Key</span><span className="meta-value meta-value-mono">{current.key}</span></div>
                <div className="meta-item"><span className="meta-label">类型</span><span className="meta-value"><span className="badge badge-type">{current.type}</span></span></div>
                <div className="meta-item"><span className="meta-label">TTL</span><span className="meta-value">{formatDuration(current.ttl)}</span></div>
                <div className="meta-item"><span className="meta-label">大小</span><span className="meta-value">{formatBytes(current.size)}</span></div>
                <div className="meta-item"><span className="meta-label">元素数</span><span className="meta-value">{current.length || "-"}</span></div>
              </div>
              <div className="value-section">
                <div className="value-header"><span className="value-label">Value</span>{current.isJson ? <span className="badge badge-json">JSON</span> : null}</div>
                <textarea className="redis-textarea" rows={12} readOnly value={currentValue} />
              </div>
              <div className="panel-actions">
                <button className="redis-btn redis-btn-primary" disabled={!canEdit} onClick={openEdit}>编辑</button>
                <button className="redis-btn redis-btn-secondary" onClick={copyValue}>复制</button>
                <button className="redis-btn redis-btn-danger" onClick={() => setDeleteOpen(true)}>删除</button>
              </div>
            </div>
          ) : (
            <div className="redis-panel redis-panel-empty">
              <div className="empty-state-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
                <p>在左侧查询或扫描 Key</p><span>输入 Key 名称或模式来查看数据</span>
              </div>
            </div>
          )}
        </div>

        <div className={`redis-config-console ${configOpen ? "is-open" : "is-collapsed"}`}>
          <div className="config-hero">
            <div>
              <span className="config-eyebrow">Runtime tuning</span>
              <h3>Redis 运行配置</h3>
              <p>这些配置会直接影响 Redis CPU、内存和持久化行为。监控数据可丢，业务缓存优先。</p>
            </div>
            <div className="config-scoreboard">
              <div><strong>{configSummary.matched}</strong><span>符合建议</span></div>
              <div><strong>{configSummary.highRiskDrift}</strong><span>高风险偏离</span></div>
              <div><strong>{configData?.runtime?.latestForkUsec ? `${Math.round(configData.runtime.latestForkUsec / 1000)}ms` : "-"}</strong><span>最近 fork</span></div>
            </div>
            <div className="config-actions-top">
              <button className="redis-btn redis-btn-secondary" onClick={() => setConfigOpen((open) => !open)}>{configOpen ? "收起配置" : "展开配置"}</button>
              <button className="redis-btn redis-btn-secondary" disabled={configLoading || diagnosticsLoading} onClick={configOpen ? refreshRuntimeConsole : loadConfig}>{configOpen ? "刷新诊断" : "刷新配置"}</button>
              <button className="redis-btn redis-btn-primary" disabled={configLoading || !configData?.items?.length} onClick={applyRecommendedConfig}>应用低风险建议</button>
            </div>
          </div>

          {!configOpen ? <div className="config-collapsed-note">配置默认折叠，避免干扰日常 Key 查询。需要调整 Redis 内存、持久化或 lazyfree 时再展开。</div> : null}

          {configOpen ? (
            <div className="redis-diagnostics">
              <div className="diagnostics-head">
                <div>
                  <span className="config-eyebrow">Slowlog & command heat</span>
                  <h3>Redis 性能诊断</h3>
                  <p>从慢日志、命令统计、持久化状态和已知队列判断 CPU 飙升可能来源；诊断本身不扫描全量 Key。</p>
                </div>
                <div className={`diagnostics-status diagnostics-status-${diagnosticHeadline.tone}`}>
                  <span>{diagnosticsLoading ? "读取中" : "当前判断"}</span>
                  <strong>{diagnosticsLoading ? "诊断中…" : diagnosticHeadline.text}</strong>
                </div>
                <div className="diagnostics-actions">
                  <button className="redis-btn redis-btn-secondary" disabled={diagnosticsLoading} onClick={loadDiagnostics}>刷新诊断</button>
                  <button className="redis-btn redis-btn-secondary" disabled={diagnosticsLoading} onClick={handleResetSlowlog}>清空慢日志</button>
                </div>
              </div>

              <div className="diagnostics-metrics">
                <div className="diagnostic-metric"><span>OPS/sec</span><strong>{formatNumber(diagnostics?.runtime?.instantaneousOpsPerSec)}</strong></div>
                <div className="diagnostic-metric"><span>连接 / 阻塞</span><strong>{diagnostics?.runtime ? `${diagnostics.runtime.connectedClients || 0} / ${diagnostics.runtime.blockedClients || 0}` : "-"}</strong></div>
                <div className="diagnostic-metric"><span>内存 / 峰值</span><strong>{diagnostics?.runtime ? `${diagnostics.runtime.usedMemoryHuman || "-"} / ${diagnostics.runtime.usedMemoryPeakHuman || "-"}` : "-"}</strong></div>
                <div className="diagnostic-metric"><span>淘汰 Key</span><strong>{formatCompactNumber(diagnostics?.runtime?.evictedKeys)}</strong></div>
                <div className="diagnostic-metric"><span>慢日志</span><strong>{diagnostics?.slowlog?.total ?? "-"}</strong></div>
                <div className="diagnostic-metric"><span>最近 fork</span><strong>{formatUsecAsMs(diagnostics?.runtime?.latestForkUsec)}</strong></div>
              </div>

              <div className="diagnostics-grid">
                <div className="diagnostics-card diagnostics-card-findings">
                  <div className="diagnostics-card-head">
                    <h4>疑似原因</h4>
                    <span>{formatDateTime(diagnostics?.generatedAt)}</span>
                  </div>
                  <div className="finding-list">
                    {(diagnostics?.findings || []).map((finding) => (
                      <div className={`finding-item finding-item-${findingTone(finding.severity)}`} key={finding.id}>
                        <div className="finding-title-line">
                          <strong>{finding.title}</strong>
                          <span>{findingLabel(finding.severity)}</span>
                        </div>
                        <p>{finding.detail}</p>
                        <em>{finding.advice}</em>
                      </div>
                    ))}
                    {!diagnostics?.findings?.length ? <div className="diagnostics-empty">{diagnosticsLoading ? "正在读取 Redis 诊断数据…" : "暂无诊断数据，点击刷新诊断。"}</div> : null}
                  </div>
                </div>

                <div className="diagnostics-card">
                  <div className="diagnostics-card-head">
                    <h4>命令耗时 Top</h4>
                    <span>累计统计</span>
                  </div>
                  <div className="diagnostics-table-wrap">
                    <table className="redis-table diagnostics-table">
                      <thead><tr><th>命令</th><th>次数</th><th>累计耗时</th><th>均值</th></tr></thead>
                      <tbody>
                        {(diagnostics?.commandStats || []).slice(0, 10).map((stat) => (
                          <tr key={stat.command}>
                            <td><code>{stat.command.toUpperCase()}</code></td>
                            <td>{formatCompactNumber(stat.calls)}</td>
                            <td>{`${(stat.usec / 1000).toFixed(1)}ms`}</td>
                            <td>{`${stat.usecPerCall.toFixed(2)}µs`}</td>
                          </tr>
                        ))}
                        {!diagnostics?.commandStats?.length ? <tr><td colSpan={4}>{diagnosticsLoading ? "加载中…" : "暂无 commandstats 数据"}</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="diagnostics-card">
                  <div className="diagnostics-card-head">
                    <h4>已知队列</h4>
                    <span>LLEN 轻量读取</span>
                  </div>
                  <div className="queue-list">
                    {(diagnostics?.queues || []).map((queue) => {
                      const queueTone = queue.length >= queue.dangerAt ? "danger" : queue.length >= queue.warnAt ? "warning" : "safe";
                      const percent = Math.min(100, Math.round((queue.length / queue.dangerAt) * 100));
                      return (
                        <div className={`queue-item queue-item-${queueTone}`} key={queue.key}>
                          <div className="queue-line"><strong>{queue.label}</strong><span>{formatNumber(queue.length)}</span></div>
                          <div className="queue-key">{queue.key}</div>
                          <div className="queue-bar"><i style={{ width: `${percent}%` }} /></div>
                        </div>
                      );
                    })}
                    {!diagnostics?.queues?.length ? <div className="diagnostics-empty">{diagnosticsLoading ? "加载中…" : "暂无队列数据"}</div> : null}
                  </div>
                </div>

                <div className="diagnostics-card diagnostics-card-slowlog">
                  <div className="diagnostics-card-head">
                    <h4>最近慢命令</h4>
                    <span>超过 slowlog 阈值</span>
                  </div>
                  <div className="slowlog-list">
                    {(diagnostics?.slowlog?.entries || []).slice(0, 8).map((entry) => (
                      <div className="slowlog-item" key={entry.id}>
                        <div className="slowlog-meta">
                          <strong>{entry.commandName ? entry.commandName.toUpperCase() : "UNKNOWN"}</strong>
                          <span>{entry.durationMs}ms</span>
                          <time>{formatDateTime(entry.time)}</time>
                        </div>
                        <code>{entry.command || "-"}</code>
                        {entry.clientAddr || entry.clientName ? <div className="slowlog-client">来源：{entry.clientName || entry.clientAddr}</div> : null}
                      </div>
                    ))}
                    {!diagnostics?.slowlog?.entries?.length ? <div className="diagnostics-empty">{diagnosticsLoading ? "加载中…" : "暂无慢日志。可以把 slowlog-log-slower-than 调到 10000µs 后观察。"}</div> : null}
                  </div>
                </div>
              </div>

              {diagnostics?.notes?.length ? (
                <div className="diagnostics-notes">
                  {diagnostics.notes.map((note) => <span key={note}>{note}</span>)}
                </div>
              ) : null}
            </div>
          ) : null}

          {configOpen ? (
            <div className="redis-systemd-panel">
              <div className="systemd-head">
                <div>
                  <span className="config-eyebrow">Linux guardrail</span>
                  <h3>Redis systemd 限流</h3>
                  <p>这是最后一层保护：当 Redis 仍然抢 CPU 时，用 systemd 降低 Redis 的 CPU/IO 优先级。不会自动重启 Redis。</p>
                </div>
                <div className="systemd-service-picker">
                  <label>服务名</label>
                  <div className="systemd-service-row">
                    <select className="redis-input" value={systemdServiceName} onChange={(e) => { void handleSystemdServiceChange(e.target.value); }}>
                      {Array.from(new Set([systemdServiceName, ...(systemdData?.serviceCandidates || [])])).map((service) => (
                        <option value={service} key={service}>{service}</option>
                      ))}
                    </select>
                    <button className="redis-btn redis-btn-secondary" disabled={systemdLoading} onClick={() => loadSystemd()}>读取</button>
                  </div>
                </div>
                <div className="systemd-actions">
                  <button className="redis-btn redis-btn-secondary" disabled={systemdLoading || systemdSaving || !systemdData?.items?.length} onClick={applyRecommendedSystemd}>填入建议</button>
                  <button className="redis-btn redis-btn-primary" disabled={systemdLoading || systemdSaving || !systemdData?.supported} onClick={() => saveSystemdConfig()}>{systemdSaving ? "写入中" : "写入 systemd"}</button>
                </div>
              </div>

              {!systemdData?.supported ? (
                <div className="systemd-warning">
                  {systemdData?.reason || "当前环境不支持 systemd 配置。部署到 Linux 服务器后才可读取和写入。"}
                </div>
              ) : null}

              {systemdData?.systemctlError ? (
                <div className="systemd-warning systemd-warning-danger">
                  systemctl 读取失败：{systemdData.systemctlError}
                </div>
              ) : null}

              <div className="systemd-runtime">
                <div><span>Override 文件</span><strong title={systemdData?.overridePath}>{systemdData?.overridePath || "-"}</strong></div>
                <div><span>服务状态</span><strong>{systemdData?.effective?.ActiveState || "-"}</strong></div>
                <div><span>当前 CPUQuota</span><strong>{systemdData?.effective?.CPUQuotaPerSecUSec || "-"}</strong></div>
                <div><span>当前 CPUWeight</span><strong>{systemdData?.effective?.CPUWeight || "-"}</strong></div>
                <div><span>当前 Nice</span><strong>{systemdData?.effective?.Nice || "-"}</strong></div>
              </div>

              <div className="systemd-grid">
                {(systemdData?.items || []).map((item: RedisSystemdConfigItem) => {
                  const value = systemdInputs[item.key] ?? "";
                  const dirty = value !== (item.value ?? "");
                  return (
                    <div className="systemd-card" key={item.key}>
                      <div className="systemd-card-head">
                        <div>
                          <h4>{item.label}</h4>
                          <code>{item.key}</code>
                        </div>
                        <button type="button" onClick={() => setSystemdValue(item.key, item.recommendedValue)}>建议：{displaySystemdValue(item.recommendedValue)}</button>
                      </div>
                      <p>{item.description}</p>
                      <div className="systemd-current"><span>当前 override</span><strong>{displaySystemdValue(item.value)}</strong></div>
                      {item.type === "select" ? (
                        <select className="redis-input" value={value} onChange={(e) => setSystemdValue(item.key, e.target.value)}>
                          {(item.options || []).map((option) => <option value={option} key={option}>{displaySystemdValue(option)}</option>)}
                        </select>
                      ) : item.options?.length ? (
                        <div className="config-preset-input">
                          <select className="redis-input" value={item.options.includes(value) ? value : "__custom__"} onChange={(e) => { if (e.target.value !== "__custom__") setSystemdValue(item.key, e.target.value); }}>
                            {item.options.map((option) => <option value={option} key={option}>{displaySystemdValue(option)}</option>)}
                            <option value="__custom__">自定义</option>
                          </select>
                          <input className="redis-input" type={item.type === "number" ? "number" : "text"} value={value} placeholder={item.placeholder} onChange={(e) => setSystemdValue(item.key, e.target.value)} />
                        </div>
                      ) : (
                        <input className="redis-input" type={item.type === "number" ? "number" : "text"} value={value} placeholder={item.placeholder} onChange={(e) => setSystemdValue(item.key, e.target.value)} />
                      )}
                      <em>{item.recommendation}</em>
                      {dirty ? <span className="systemd-dirty">待写入</span> : null}
                    </div>
                  );
                })}
              </div>

              {systemdData?.pendingRestart ? (
                <div className="systemd-warning">
                  已写入 override 并 daemon-reload。为了业务安全，本页面不会自动重启 Redis；请在低峰期手动执行：<code>systemctl restart {systemdData.serviceName}</code>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="config-runtime-strip">
            <div className="runtime-pill"><span>当前内存</span><strong>{configData?.runtime?.usedMemoryHuman || info?.usedMemory || "-"}</strong></div>
            <div className="runtime-pill"><span>峰值内存</span><strong>{configData?.runtime?.usedMemoryPeakHuman || info?.usedMemoryPeak || "-"}</strong></div>
            <div className="runtime-pill"><span>Maxmemory</span><strong>{configData?.runtime?.maxmemoryHuman || "-"}</strong></div>
            <div className="runtime-pill"><span>淘汰策略</span><strong>{configData?.runtime?.maxmemoryPolicy || "-"}</strong></div>
            <div className={configData?.runtime?.rdbBgsaveInProgress ? "runtime-pill runtime-pill-hot" : "runtime-pill"}><span>RDB</span><strong>{configData?.runtime?.rdbBgsaveInProgress ? "BGSAVE 中" : "空闲"}</strong></div>
            <div className={configData?.runtime?.aofRewriteInProgress ? "runtime-pill runtime-pill-hot" : "runtime-pill"}><span>AOF</span><strong>{configData?.runtime?.aofRewriteInProgress ? "Rewrite 中" : configData?.runtime?.aofEnabled ? "开启" : "关闭"}</strong></div>
          </div>

          <div className="config-grid">
            {(configData?.items || []).map((item) => {
              const value = configInputs[item.key] ?? "";
              const dirty = value !== (item.value ?? "");
              const recommended = String(item.value ?? "") === String(item.recommendedValue);
              return (
                <div className={`config-card config-card-${riskTone(item.risk)}`} key={item.key}>
                  <div className="config-card-head">
                    <div>
                      <h4>{item.label}</h4>
                      <code>{item.key}</code>
                    </div>
                    <span className={`config-risk config-risk-${riskTone(item.risk)}`}>{riskLabel(item.risk)}</span>
                  </div>
                  <p className="config-description">{item.description}</p>
                  <div className="config-current-line"><span>当前</span><strong title={displayConfigValue(item.value)}>{displayConfigValue(item.value)}</strong></div>
                  <div className="config-input-line">
                    {item.type === "select" ? (
                      <select className="redis-input" value={value} onChange={(e) => setConfigValue(item.key, e.target.value)}>
                        {(item.options || []).map((option) => <option value={option} key={option}>{displayConfigValue(option)}</option>)}
                      </select>
                    ) : item.options?.length ? (
                      <div className="config-preset-input">
                        <select className="redis-input" value={item.options.includes(value) ? value : "__custom__"} onChange={(e) => { if (e.target.value !== "__custom__") setConfigValue(item.key, e.target.value); }}>
                          {item.options.map((option) => <option value={option} key={option}>{displayConfigValue(option)}</option>)}
                          <option value="__custom__">自定义</option>
                        </select>
                        <input className="redis-input" type={item.type === "number" ? "number" : "text"} value={value} placeholder={item.placeholder} onChange={(e) => setConfigValue(item.key, e.target.value)} />
                      </div>
                    ) : (
                      <input className="redis-input" type={item.type === "number" ? "number" : "text"} value={value} placeholder={item.placeholder} onChange={(e) => setConfigValue(item.key, e.target.value)} />
                    )}
                  </div>
                  <div className="config-recommendation">
                    <span>建议值</span>
                    <button className="config-recommend-value" type="button" onClick={() => setConfigValue(item.key, item.recommendedValue)}>{displayConfigValue(item.recommendedValue)}</button>
                  </div>
                  <p className="config-note">{item.recommendation}</p>
                  <div className="config-card-actions">
                    <span className={recommended ? "config-status config-status-ok" : "config-status"}>{recommended ? "已符合建议" : "可优化"}</span>
                    <button className="redis-btn redis-btn-secondary" disabled={!dirty || savingConfigKey === item.key} onClick={() => saveConfigItem(item)}>{savingConfigKey === item.key ? "保存中" : "保存"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>



        <Modal title="编辑 Value" open={editOpen} onCancel={() => setEditOpen(false)} onOk={handleUpdate} okText="保存" cancelText="取消" width={620}>
          <div className="form-row"><label>Key</label><div className="form-static">{current?.key}</div></div>
          <div className="form-row"><label>Value</label>{current?.type !== "string" ? <div className="type-hint">类型: {current?.type}（JSON 格式）</div> : null}<textarea className="redis-textarea" rows={8} value={editValue} onChange={(e) => setEditValue(e.target.value)} /></div>
          <div className="form-row"><label>TTL (秒，可选)</label><input className="redis-input" type="number" value={editTtl} onChange={(e) => setEditTtl(e.target.value)} placeholder="留空保持原 TTL，-1 表示永不过期" /><span className="form-hint">当前 TTL: {formatDuration(current?.ttl)}</span></div>
        </Modal>

        <Modal title="确认删除" open={deleteOpen} onCancel={() => setDeleteOpen(false)} onOk={handleDelete} okText="确认删除" okButtonProps={{ danger: true }} cancelText="取消">
          <p className="text-danger">此操作不可恢复，请确认是否删除：</p>
          <div className="delete-key-box">{current?.key}</div>
        </Modal>
      </div>
    </PermissionGuard>
  );
}
