import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Collapse, Drawer, Input, Row, Select, Space, Steps, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  fetchExternalLeaderboardAdapter,
  fetchExternalLeaderboardSample,
  generateExternalLeaderboardMapping,
  previewExternalLeaderboardAdapter,
  publishExternalLeaderboardAdapter,
  saveExternalLeaderboardDraft,
  type ExternalLeaderboardAdapter,
  type ExternalLeaderboardAdapterConfig,
  type ExternalLeaderboardPreview,
} from "@/services/nacos";

const { TextArea } = Input;

const FIELD_LABELS: Array<[string, string, string]> = [
  ["rank", "排名", "例如 $.rank"],
  ["twitterId", "Twitter ID", "例如 $.twitter_id"],
  ["username", "用户名", "例如 $.username"],
  ["handle", "Handle", "例如 $.username"],
  ["name", "Hunter 名称", "例如 $.name"],
  ["avatar", "头像", "例如 $.avatar"],
  ["share", "声量占比（0~1）", "例如 $.mind_share"],
  ["score", "分数（可选）", "例如 $.score"],
  ["tweets", "推文数（可选）", "例如 $.tweet_count"],
  ["views", "浏览数（可选）", "例如 $.view_count"],
  ["likes", "互动数（可选）", "例如 $.like_count"],
];

const EMPTY_CONFIG: ExternalLeaderboardAdapterConfig = {
  requests: [{ key: "board", url: "", query: {}, required: true }],
  rowsPath: "",
  updatedAt: null,
  summary: null,
  fields: {},
  sort: { field: "share", direction: "desc" },
};

function cloneConfig(config?: ExternalLeaderboardAdapterConfig | null): ExternalLeaderboardAdapterConfig {
  return JSON.parse(JSON.stringify(config?.requests?.length ? config : EMPTY_CONFIG));
}

function statusMeta(adapter: ExternalLeaderboardAdapter | null, preview: ExternalLeaderboardPreview | null) {
  if (preview?.passed) return { color: "green", label: "预览通过" };
  if (adapter?.status === "published") return { color: "green", label: `已发布 v${adapter.publishedVersion}` };
  if (adapter?.lastSample && Object.keys(adapter.lastSample).length) return { color: "blue", label: "已取得接口样本" };
  if (adapter) return { color: "orange", label: "草稿未发布" };
  return { color: "default", label: "未配置" };
}

function percent(value?: number) {
  return Number.isFinite(value) ? `${((value || 0) * 100).toFixed(1)}%` : "-";
}

function fullRequestUrl(request: { url?: string; query?: Record<string, string> }) {
  const base = String(request.url || "");
  const queryText = new URLSearchParams(request.query || {}).toString();
  if (!queryText) return base;
  if (base.includes(`?${queryText}`) || base.includes(`&${queryText}`)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${queryText}`;
}

export function ExternalLeaderboardAdapterCard({
  nacosCampaignId,
  leaderboardKey,
  leaderboardTitle,
  isSuperAdmin,
  disabled,
  disabledReason,
  onMessage,
}: {
  nacosCampaignId?: string | null;
  leaderboardKey: string;
  leaderboardTitle: string;
  isSuperAdmin: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onMessage: (message: string, type?: "success" | "error" | "info") => void;
}) {
  const [adapter, setAdapter] = useState<ExternalLeaderboardAdapter | null>(null);
  const [config, setConfig] = useState<ExternalLeaderboardAdapterConfig>(cloneConfig());
  const [preview, setPreview] = useState<ExternalLeaderboardPreview | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const canOperate = !!nacosCampaignId && !!leaderboardKey && isSuperAdmin && !disabled;
  const status = statusMeta(adapter, preview);

  useEffect(() => {
    if (!nacosCampaignId || !leaderboardKey || !isSuperAdmin || disabled) {
      setAdapter(null);
      setConfig(cloneConfig());
      setPreview(null);
      return;
    }
    setLoading("load");
    fetchExternalLeaderboardAdapter(nacosCampaignId, leaderboardKey)
      .then((result) => {
        setAdapter(result.data || null);
        setConfig(cloneConfig(result.data?.draftConfig));
        setPreview(result.data?.lastPreview?.passed || result.data?.lastPreview?.issues ? result.data.lastPreview : null);
      })
      .catch((cause) => onMessage(`读取外部榜单适配器失败：${cause instanceof Error ? cause.message : "未知错误"}`, "error"))
      .finally(() => setLoading(""));
  // 仅在切换活动或权限状态时重新读取；toast 回调变化不应清空正在编辑的草稿。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nacosCampaignId, leaderboardKey, isSuperAdmin, disabled]);

  const sampleText = useMemo(() => {
    const sample = adapter?.lastSample;
    return sample && Object.keys(sample).length ? JSON.stringify(sample, null, 2) : "尚未取得接口样本";
  }, [adapter]);

  const updateConfig = (mutate: (next: ExternalLeaderboardAdapterConfig) => void) => {
    setConfig((current) => {
      const next = cloneConfig(current);
      mutate(next);
      return next;
    });
    setPreview(null);
    setConfirmed(false);
  };

  const execute = async (kind: string, operation: () => Promise<void>) => {
    if (!canOperate) return;
    setLoading(kind);
    try {
      await operation();
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "操作失败", "error");
    } finally {
      setLoading("");
    }
  };

  const saveDraft = () => execute("draft", async () => {
    const result = await saveExternalLeaderboardDraft(nacosCampaignId!, leaderboardKey, config);
    setAdapter(result.data);
    onMessage("适配器草稿已保存", "success");
  });

  const fetchSample = () => execute("sample", async () => {
    const result = await fetchExternalLeaderboardSample(nacosCampaignId!, leaderboardKey, config);
    setAdapter(result.data.adapter);
    setConfig(cloneConfig(result.data.adapter.draftConfig));
    onMessage("接口样本获取成功，可以生成转换规则", "success");
  });

  const generate = () => execute("generate", async () => {
    const result = await generateExternalLeaderboardMapping(nacosCampaignId!, leaderboardKey, config, instruction);
    setAdapter(result.data.adapter);
    setConfig(cloneConfig(result.data.config));
    onMessage(result.data.source === "llm" ? "AI 已生成映射草稿，请检查字段后预览" : "已按接口样本生成映射草稿，请检查字段后预览", "success");
  });

  const runPreview = () => execute("preview", async () => {
    const result = await previewExternalLeaderboardAdapter(nacosCampaignId!, leaderboardKey, config);
    setAdapter(result.data.adapter);
    setPreview(result.data.preview);
    setPreviewOpen(true);
    onMessage(result.data.preview.passed ? "转换预览通过，可以确认发布" : "转换预览发现阻断问题，请修改规则", result.data.preview.passed ? "success" : "error");
  });

  const publish = () => execute("publish", async () => {
    if (!preview?.passed || !confirmed) return;
    const result = await publishExternalLeaderboardAdapter(nacosCampaignId!, leaderboardKey, {
      confirmed,
      configFingerprint: preview.configFingerprint,
      responseFingerprint: preview.responseFingerprint,
    });
    setAdapter(result.data);
    setPreview(null);
    setConfirmed(false);
    setPreviewOpen(false);
    onMessage(`转换规则已发布为 v${result.data.publishedVersion}`, "success");
  });

  const columns: ColumnsType<Record<string, unknown>> = [
    { title: "排名", dataIndex: "rank", width: 92, render: (value) => `#${value || "-"}` },
    {
      title: "Hunter",
      dataIndex: "name",
      render: (_, row) => (
        <Space size={8}>
          {row.avatar ? <img src={String(row.avatar)} alt="" width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#e2e8f0", display: "inline-block" }} />}
          <span><strong>{String(row.name || "-")}</strong><br /><small style={{ color: "#64748b" }}>{String(row.handle || "-")}</small></span>
        </Space>
      ),
    },
    { title: "声量占比", dataIndex: "shareText", width: 140, render: (value, row) => <Space size={5}>{String(value || "-")}{row.binanceSquareAccelerated ? <Tag color="gold">BN 加速</Tag> : null}</Space> },
  ];

  if (!isSuperAdmin) {
    return <Card size="small" title={`外部榜单数据适配器 · ${leaderboardTitle}`} style={{ marginBottom: 12 }}><Alert type="info" showIcon message="仅超级管理员可配置外部榜单数据适配器。" /></Card>;
  }

  return (
    <Card
      size="small"
      title={<Space><span>外部榜单数据适配器 · {leaderboardTitle}</span><Tag color={status.color}>{status.label}</Tag>{adapter?.publishedAt ? <span style={{ color: "#64748b", fontSize: 12 }}>发布于 {new Date(adapter.publishedAt).toLocaleString()}</span> : null}</Space>}
      style={{ marginBottom: 12 }}
      extra={<Tooltip title="接口样本、AI 映射、转换预览和发布均仅允许超级管理员操作。"><span style={{ color: "#64748b", fontSize: 12 }}>仅超级管理员</span></Tooltip>}
    >
      {disabled ? <Alert type="warning" showIcon message={disabledReason || "请先发布活动基础信息，再配置外部榜单适配器。"} /> : null}
      <Steps size="small" current={preview?.passed ? 3 : adapter?.lastSample && Object.keys(adapter.lastSample).length ? 1 : 0} items={[{ title: "接口样本" }, { title: "AI 转换规则" }, { title: "转换预览" }, { title: "发布" }]} style={{ margin: "8px 0 18px" }} />
      <Collapse
        defaultActiveKey={["request"]}
        items={[
          {
            key: "request",
            label: "① 接口样本",
            children: <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {config.requests.map((request, index) => (
                <Row gutter={[12, 8]} key={`${request.key}-${index}`} align="bottom">
                  <Col xs={24} md={5}><label>请求 key <Tooltip title="该请求在接口样本中的命名，固定为 board；AI 转换规则引用它取榜单数据。"><span style={{ color: "#94a3b8", cursor: "help" }}>?</span></Tooltip></label><Input disabled={index === 0} value={request.key} onChange={(event) => updateConfig((next) => { next.requests[index].key = event.target.value; })} /></Col>
                  <Col xs={24} md={13}><label>内部接口 URL</label><Input value={fullRequestUrl(request)} placeholder="https://data.cryptohunt.ai/info/board/top?project=yzilabs&fetch_type=mind_share" onChange={(event) => updateConfig((next) => { next.requests[index].url = event.target.value; next.requests[index].query = {}; })} /></Col>
                  <Col xs={12} md={3}><Checkbox checked={request.required !== false} onChange={(event) => updateConfig((next) => { next.requests[index].required = event.target.checked; })}>必需</Checkbox></Col>
                  <Col xs={12} md={3}>{index > 0 ? <Button danger onClick={() => updateConfig((next) => { next.requests.splice(index, 1); })}>删除</Button> : null}</Col>
                </Row>
              ))}
              <Space wrap>
                <Button disabled={!canOperate} onClick={() => updateConfig((next) => { next.requests.push({ key: "detail", url: "", query: {}, required: false }); })}>+ 补充请求</Button>
                <Button disabled={!canOperate} loading={loading === "draft"} onClick={saveDraft}>保存草稿</Button>
                <Button type="primary" disabled={!canOperate} loading={loading === "sample"} onClick={fetchSample}>试拉取接口</Button>
              </Space>
              <TextArea readOnly value={sampleText} autoSize={{ minRows: 4, maxRows: 12 }} aria-label="接口样本" />
            </Space>,
          },
          {
            key: "mapping",
            label: "② AI 转换规则",
            children: <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert type="info" showIcon message="AI 只生成受限 JSONPath 映射，不会生成或执行 JavaScript。share 必须映射为 0~1。" />
              <label>业务补充说明（可选）</label>
              <TextArea rows={2} value={instruction} placeholder="例如：score 大于 0 才上榜；share 已经是 0~1" onChange={(event) => setInstruction(event.target.value)} />
              <Button type="primary" disabled={!canOperate || !adapter?.lastSample || !Object.keys(adapter.lastSample).length} loading={loading === "generate"} onClick={generate}>AI 生成转换规则</Button>
              <Row gutter={[12, 12]}>
                <Col xs={24} md={12}><label>榜单数组路径 rowsPath</label><Input value={config.rowsPath || ""} placeholder="$.data.data.data" onChange={(event) => updateConfig((next) => { next.rowsPath = event.target.value; })} /></Col>
                <Col xs={24} md={8}><label>上游更新时间请求（可选）</label><Select allowClear value={config.updatedAt?.requestKey || undefined} placeholder="默认 board" options={config.requests.map((request) => ({ value: request.key, label: request.key }))} onChange={(value) => updateConfig((next) => { next.updatedAt = value ? { requestKey: value, path: next.updatedAt?.path || "" } : null; })} style={{ width: "100%" }} /></Col>
                <Col xs={24} md={16}><label>上游更新时间路径（可选）</label><Input value={config.updatedAt?.path || ""} placeholder="$.data.data.data[0].create_time" onChange={(event) => updateConfig((next) => { next.updatedAt = { requestKey: next.updatedAt?.requestKey || "board", path: event.target.value }; })} /></Col>
                <Col xs={24} md={8}><label>上游汇总统计请求（可选）</label><Select allowClear value={config.summary?.requestKey || undefined} placeholder="默认 board" options={config.requests.map((request) => ({ value: request.key, label: request.key }))} onChange={(value) => updateConfig((next) => { next.summary = value ? { requestKey: value, path: next.summary?.path || "" } : null; })} style={{ width: "100%" }} /></Col>
                <Col xs={24} md={16}><label>上游汇总统计路径（可选，默认自动识别）</label><Input value={config.summary?.path || ""} placeholder="$.data.summary" onChange={(event) => updateConfig((next) => { next.summary = { requestKey: next.summary?.requestKey || "board", path: event.target.value }; })} /></Col>
                <Col xs={24} md={6}><label>排序字段</label><Select value={config.sort?.field || "share"} options={[{ value: "share", label: "share" }, { value: "score", label: "score" }, { value: "rank", label: "rank" }]} onChange={(value) => updateConfig((next) => { next.sort = { field: value, direction: next.sort?.direction || "desc" }; })} style={{ width: "100%" }} /></Col>
                <Col xs={24} md={6}><label>排序方向</label><Select value={config.sort?.direction || "desc"} options={[{ value: "desc", label: "从高到低" }, { value: "asc", label: "从低到高" }]} onChange={(value) => updateConfig((next) => { next.sort = { field: next.sort?.field || "share", direction: value }; })} style={{ width: "100%" }} /></Col>
                {FIELD_LABELS.map(([key, label, placeholder]) => <Col xs={24} md={12} key={key}><label>{label}</label><Input value={(config.fields?.[key] || []).join(" | ")} placeholder={placeholder} onChange={(event) => updateConfig((next) => { next.fields ||= {}; next.fields[key] = event.target.value.split("|").map((item) => item.trim()).filter(Boolean); })} /></Col>)}
              </Row>
            </Space>,
          },
          {
            key: "preview",
            label: "③ 转换预览",
            children: <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert type={preview?.passed ? "success" : "warning"} showIcon message={preview?.passed ? "最近一次预览已通过；修改规则或上游结构变化后必须重新预览。" : "必须用真实接口响应完成无错误预览，才可以发布。"} />
              <Button type="primary" disabled={!canOperate || !config.rowsPath} loading={loading === "preview"} onClick={runPreview}>预览转换结果</Button>
            </Space>,
          },
        ]}
      />
      <Drawer title="转换结果预览" open={previewOpen} onClose={() => setPreviewOpen(false)} width="min(1080px, 100vw)" extra={<Space><Button onClick={() => setPreviewOpen(false)}>返回修改规则</Button><Button type="primary" disabled={!preview?.passed || !confirmed} loading={loading === "publish"} onClick={publish}>发布转换规则</Button></Space>}>
        {preview ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type={preview.passed ? "success" : "error"}
            showIcon
            message={
              preview.passed
                ? preview.rows.length === 0
                  ? "转换预览通过（当前榜单暂无上榜行，已自动识别汇总数据）"
                  : "转换预览通过"
                : "转换预览不可发布"
            }
            description={
              preview.issues.length
                ? preview.issues.slice(0, 5).map((issue) => `第 ${issue.row} 行：${issue.message}`).join("；")
                : preview.rows.length === 0
                  ? "上游接口返回数据为空列表，允许空榜单正常发布上线并展示汇总总计数据。"
                  : "所有必填字段均已通过检查。"
            }
          />
          <Row gutter={[12, 12]}><Col xs={12} md={6}><Card size="small">总行数<br /><strong>{preview.metrics.total}</strong></Card></Col><Col xs={12} md={6}><Card size="small">Twitter ID 覆盖率<br /><strong>{percent(preview.metrics.twitterIdCoverage)}</strong></Card></Col><Col xs={12} md={6}><Card size="small">头像覆盖率<br /><strong>{percent(preview.metrics.avatarCoverage)}</strong></Card></Col><Col xs={12} md={6}><Card size="small">share 合法率<br /><strong>{percent(preview.metrics.shareCoverage)}</strong></Card></Col></Row>
          {preview.summary ? (
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small">参与人数<br /><strong>{preview.summary.participants ?? 0}</strong></Card></Col>
              <Col xs={12} md={6}><Card size="small">总推文数<br /><strong>{preview.summary.tweets ?? 0}</strong></Card></Col>
              <Col xs={12} md={6}><Card size="small">总浏览数<br /><strong>{preview.summary.views !== undefined && preview.summary.views !== null ? preview.summary.views.toLocaleString() : 0}</strong></Card></Col>
              <Col xs={12} md={6}><Card size="small">总互动数<br /><strong>{preview.summary.engagement !== undefined && preview.summary.engagement !== null ? preview.summary.engagement.toLocaleString() : 0}</strong></Card></Col>
            </Row>
          ) : null}
          <Table rowKey={(row, index) => `${row.twitterId || "row"}-${index}`} columns={columns} dataSource={preview.rows} pagination={false} scroll={{ x: 620 }} />
          <Checkbox checked={confirmed} disabled={!preview.passed} onChange={(event) => setConfirmed(event.target.checked)}>我已确认当前转换结果可用于公开榜单</Checkbox>
        </Space> : null}
      </Drawer>
    </Card>
  );
}
