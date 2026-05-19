import { useEffect, useMemo, useState } from "react";
import { Modal, message } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  deleteRedisKey,
  fetchRedisConfig,
  fetchRedisInfo,
  queryRedisKey,
  scanRedisKeys,
  updateRedisConfig,
  updateRedisKey,
  type RedisConfigData,
  type RedisConfigItem,
  type RedisInfo,
  type RedisKeyInfo,
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

export function RedisManagementPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [configData, setConfigData] = useState<RedisConfigData | null>(null);
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);
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

  useEffect(() => {
    void loadInfo();
    void loadConfig();
  }, []);

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

        <div className="redis-config-console">
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
              <button className="redis-btn redis-btn-secondary" disabled={configLoading} onClick={loadConfig}>刷新配置</button>
              <button className="redis-btn redis-btn-primary" disabled={configLoading || !configData?.items?.length} onClick={applyRecommendedConfig}>应用低风险建议</button>
            </div>
          </div>

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
                        {(item.options || []).map((option) => <option value={option} key={option}>{option}</option>)}
                      </select>
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
