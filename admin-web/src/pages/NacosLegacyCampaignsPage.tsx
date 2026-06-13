import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag as AntTag, Typography } from "antd";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";
import { fetchVipLists } from "@/services/feature-flags";
import type { VipListItem } from "@/types/feature-flags";

const { TextArea } = Input;
const DATA_ID = "xhunt_campaigns";
const GROUP = "DEFAULT_GROUP";
const DEFAULT_RING = "ring-blue-400/20 hover:ring-blue-400/50";

type AnyObj = Record<string, any>;
type CampaignConfig = {
  version: number;
  campaigns: AnyObj[];
  [key: string]: any;
};
type ToastState = { message: string; type?: "success" | "error" | "info" } | null;

type JsonFieldName = "logos" | "tasks" | "tags" | "essayContestWinners" | "customLeaderboards";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function splitLinesToList(text: string) {
  if (!text) return [];
  return String(text)
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringList(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      list
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function listToLines(value: unknown) {
  return Array.isArray(value) ? value.map(String).join("\n") : "";
}

function toDatetimeLocal(isoZ: string) {
  if (!isoZ) return "";
  const d = new Date(isoZ);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalToIsoZ(localValue: string) {
  if (!localValue) return "";
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function setByPath(obj: AnyObj, path: string, value: any) {
  const parts = path.split(".");
  let cur = obj;
  parts.slice(0, -1).forEach((part) => {
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  });
  cur[parts[parts.length - 1]] = value;
}

function normalizeCampaign(input: AnyObj): AnyObj {
  const c = input && typeof input === "object" ? input : {};
  c.enrollmentWindow = c.enrollmentWindow && typeof c.enrollmentWindow === "object" ? c.enrollmentWindow : { startAt: "", endAt: "" };
  c.displayName = c.displayName && typeof c.displayName === "object" ? c.displayName : { zh: "", en: "" };
  c.copy = c.copy && typeof c.copy === "object" ? c.copy : {};
  c.copy.title = c.copy.title && typeof c.copy.title === "object" ? c.copy.title : { zh: "", en: "" };
  c.copy.shortTitle = c.copy.shortTitle && typeof c.copy.shortTitle === "object" ? c.copy.shortTitle : { zh: "", en: "" };
  c.copy.ctaText = c.copy.ctaText && typeof c.copy.ctaText === "object" ? c.copy.ctaText : { zh: "", en: "" };
  c.copy.goToOfficialText = c.copy.goToOfficialText && typeof c.copy.goToOfficialText === "object" ? c.copy.goToOfficialText : { zh: "", en: "" };
  c.copy.viewGuideText = c.copy.viewGuideText && typeof c.copy.viewGuideText === "object" ? c.copy.viewGuideText : { zh: "", en: "" };
  c.links = c.links && typeof c.links === "object" ? c.links : { guideUrl: "", activeUrl: "", showLeaderboardLink: false };
  if (!c.projectIntroduction || typeof c.projectIntroduction !== "object") {
    c.projectIntroduction = { zh: typeof c.projectIntroduction === "string" ? c.projectIntroduction : "", en: "" };
  }
  c.writingThemes = Array.isArray(c.writingThemes) && c.writingThemes.length ? c.writingThemes : [{ zh: "", en: "" }];
  c.writingThemes = c.writingThemes.map((item: any) => item && typeof item === "object" ? { zh: String(item.zh || ""), en: String(item.en || "") } : { zh: String(item || ""), en: "" });
  c.testList = Array.isArray(c.testList) ? c.testList : [];
  c.targetUserIds = Array.isArray(c.targetUserIds) ? c.targetUserIds : [];
  delete c.allowEmailRegistration;

  c.logos = Array.isArray(c.logos) ? c.logos : [];
  c.tasks = Array.isArray(c.tasks) ? c.tasks : [];
  c.essayContestWinners = Array.isArray(c.essayContestWinners) ? c.essayContestWinners : [];
  c.logos.forEach((logo: AnyObj) => {
    if (!logo.ringClassName) logo.ringClassName = DEFAULT_RING;
  });
  return c;
}

function normalizeConfig(obj: unknown): CampaignConfig {
  const out = obj && typeof obj === "object" ? (obj as CampaignConfig) : ({ version: 3, campaigns: [] } as CampaignConfig);
  if (!Array.isArray(out.campaigns)) out.campaigns = [];
  out.version = safeNumber(out.version, 3);
  out.campaigns = out.campaigns.map((campaign) => normalizeCampaign(campaign));
  return out;
}

function makeNewCampaign(): AnyObj {
  return normalizeCampaign({
    id: "",
    campaignKey: "",
    sortWeight: 0,
    enabled: false,
    testList: ["luoyukun4"],
    testingPhase: true,
    enrollmentWindow: { startAt: "", endAt: "" },
    displayName: { zh: "", en: "" },
    logos: [{ image: "REPLACE_WITH_XHUNT_AVATAR_URL", url: "https://x.com/xhunt_ai", label: "XHunt AI", ringClassName: DEFAULT_RING }],
    copy: {
      title: { zh: "", en: "" },
      shortTitle: { zh: "", en: "" },
      emoji: "🎉",
      ctaText: { zh: "立即参与", en: "Join Now" },
      goToOfficialText: { zh: "前往官方", en: "Go to Official" },
      viewGuideText: { zh: "查看官方指南", en: "View Official Guide" },
    },
    tasks: [{ id: "follow-xhunt", title: { zh: "关注 @xhunt_ai", en: "Follow @xhunt_ai" }, url: "https://x.com/xhunt_ai", type: "twitter", autoComplete: true }],
    links: { guideUrl: "https://", activeUrl: "https://xhunt.ai/leaderboard", showLeaderboardLink: false },
    projectIntroduction: { zh: "", en: "" },
    writingThemes: [{ zh: "", en: "" }],
    showExtraComponents: true,
    targetUserIds: [],
    hotTweetsKey: "",
    includeCreator: false,
    showSponsoredPolicy: true,
    enableEssayContest: false,
    enablePowLeaderboard: false,
  });
}

function escapeHtml(value: string) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatDiffValue(value: unknown) {
  if (value === undefined) return "undefined";
  const formatted = JSON.stringify(value, null, 2);
  return formatted === undefined ? String(value) : formatted;
}

function isSameJsonValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

type DiffLine = {
  path: string;
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

function collectDiffLines(
  oldValue: unknown,
  nextValue: unknown,
  path = "root",
  lines: DiffLine[] = [],
) {
  if (isSameJsonValue(oldValue, nextValue)) return lines;

  if (oldValue === undefined) {
    lines.push({ path, type: "added", after: nextValue });
    return lines;
  }
  if (nextValue === undefined) {
    lines.push({ path, type: "removed", before: oldValue });
    return lines;
  }

  if (isPlainObject(oldValue) && isPlainObject(nextValue)) {
    const keys = Array.from(
      new Set([...Object.keys(oldValue), ...Object.keys(nextValue)]),
    ).sort();
    keys.forEach((key) => {
      collectDiffLines(oldValue[key], nextValue[key], `${path}.${key}`, lines);
    });
    return lines;
  }

  if (Array.isArray(oldValue) && Array.isArray(nextValue)) {
    const max = Math.max(oldValue.length, nextValue.length);
    for (let index = 0; index < max; index += 1) {
      collectDiffLines(oldValue[index], nextValue[index], `${path}[${index}]`, lines);
    }
    return lines;
  }

  lines.push({ path, type: "changed", before: oldValue, after: nextValue });
  return lines;
}

function renderDiffBlock(prefix: string, value: unknown, className: string) {
  const formatted = formatDiffValue(value);
  return formatted
    .split("\n")
    .map((line, index) => {
      const marker = index === 0 ? prefix : " ";
      return `<span class="${className}">${escapeHtml(`${marker} ${line}`)}</span>`;
    })
    .join("\n");
}

function buildDiffHtml(oldConfig: unknown, nextConfig: unknown) {
  const lines = collectDiffLines(oldConfig || {}, nextConfig || {});
  if (!lines.length) return escapeHtml("无改动");

  return lines
    .map((line) => {
      const header = `<span class="diff-path">@@ ${escapeHtml(line.path)}</span>`;
      if (line.type === "added") {
        return `${header}\n${renderDiffBlock("+", line.after, "added")}`;
      }
      if (line.type === "removed") {
        return `${header}\n${renderDiffBlock("-", line.before, "removed")}`;
      }
      return [
        header,
        renderDiffBlock("-", line.before, "removed"),
        renderDiffBlock("+", line.after, "added"),
      ].join("\n");
    })
    .join("\n\n");
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

function parseJsonArray(value: string, fieldName: string) {
  const parsed = value.trim() ? JSON.parse(value) : [];
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} 必须是 JSON 数组`);
  return parsed;
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <Card size="small" title={title} style={{ marginBottom: 12 }}>{children}</Card>;
}

export function NacosLegacyCampaignsPage() {
  const [config, setConfig] = useState<CampaignConfig>({ version: 3, campaigns: [] });
  const [originalConfig, setOriginalConfig] = useState<CampaignConfig | null>(null);
  const [selectionIndex, setSelectionIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [jsonPreviewOpen, setJsonPreviewOpen] = useState(false);
  const [jsonPreviewHtml, setJsonPreviewHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem("nacos-legacy-campaigns-list-collapsed") === "1");
  const [jsonEdits, setJsonEdits] = useState<Partial<Record<JsonFieldName, string>>>({});
  const [internalTestUsers, setInternalTestUsers] = useState<VipListItem[]>([]);

  const selectedCampaign = selectionIndex == null ? null : config.campaigns[selectionIndex] || null;
  const editorEnabled = !!selectedCampaign;

  function showToast(message: string, type: "success" | "error" | "info" = "info") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2600);
  }

  function updateSelectedCampaign(mutator: (campaign: AnyObj) => void) {
    if (selectionIndex == null) return;
    setConfig((prev) => {
      const next = clone(prev);
      const campaign = next.campaigns[selectionIndex];
      if (!campaign) return prev;
      mutator(campaign);
      normalizeCampaign(campaign);
      return next;
    });
    setDirty(true);
  }

  function setCampaignPath(path: string, value: any) {
    updateSelectedCampaign((campaign) => {
      if (path === "campaignKey") {
        campaign.campaignKey = String(value || "").trim();
        campaign.hotTweetsKey = campaign.campaignKey;
        campaign.id = campaign.campaignKey ? `${campaign.campaignKey}-hunter` : "";
        return;
      }
      setByPath(campaign, path, value);
      if (path === "copy.shortTitle.zh") setByPath(campaign.copy, "title.zh", value);
      if (path === "copy.shortTitle.en") setByPath(campaign.copy, "title.en", value);
    });
  }

  async function loadFromNacos() {
    if (dirty && !window.confirm("你当前有未发布的老版 Nacos 修改，重新加载会丢失这些修改。\n确认重新加载？")) return;
    setLoading(true);
    try {
      showToast("正在从老版 Nacos 加载...", "info");
      const nacos = await fetchNacosConfig({ dataId: DATA_ID, group: GROUP });
      const parsed = normalizeConfig(JSON.parse(nacos.data.content || "{}"));
      setConfig(parsed);
      setOriginalConfig(clone(parsed));
      setSelectionIndex(null);
      setJsonEdits({});
      setDirty(false);
      showToast("老版 Nacos 加载完成", "success");
    } catch (error) {
      showToast(`加载失败：${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadInternalTestUsers() {
    try {
      const resp = await fetchVipLists();
      setInternalTestUsers(resp.data?.internalTest || []);
    } catch (error) {
      showToast(
        `内测用户列表加载失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    }
  }

  useEffect(() => {
    void loadFromNacos();
    void loadInternalTestUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return config.campaigns
      .map((campaign, index) => ({ campaign, index }))
      .filter(({ campaign }) => !q || [campaign.id, campaign.campaignKey, campaign.displayName?.zh, campaign.displayName?.en, campaign.copy?.title?.zh, campaign.copy?.title?.en].filter(Boolean).join(" ").toLowerCase().includes(q))
      .sort((a, b) => (Number(b.campaign.sortWeight) || 0) - (Number(a.campaign.sortWeight) || 0) || Number(!!b.campaign.enabled) - Number(!!a.campaign.enabled));
  }, [config.campaigns, search]);

  function selectCampaign(index: number) {
    setSelectionIndex(index);
    setJsonEdits({});
  }

  function newCampaign() {
    if (dirty && !window.confirm("你当前有未发布的修改，新增活动会保留当前修改但尚未发布。\n确认新增？")) return;
    const campaign = makeNewCampaign();
    setConfig((prev) => ({ ...prev, campaigns: [campaign, ...prev.campaigns] }));
    setSelectionIndex(0);
    setJsonEdits({});
    setDirty(true);
    showToast("已新增一条老版 Nacos 活动（未发布）", "info");
  }

  function duplicateCampaign() {
    if (!selectedCampaign || selectionIndex == null) return;
    const copy = clone(selectedCampaign);
    copy.id = "";
    copy.campaignKey = "";
    copy.hotTweetsKey = "";
    copy.enabled = false;
    copy.testingPhase = true;
    setConfig((prev) => {
      const next = clone(prev);
      next.campaigns.splice(selectionIndex + 1, 0, copy);
      return next;
    });
    setSelectionIndex(selectionIndex + 1);
    setJsonEdits({});
    setDirty(true);
    showToast("已复制活动（未发布）", "info");
  }

  async function deleteCampaign() {
    if (!selectedCampaign || selectionIndex == null) return;
    if (!window.confirm(`确认删除该老版 Nacos 活动？\n\nid=${selectedCampaign.id || ""}\n\n删除后需要发布才会生效。`)) return;
    setConfig((prev) => {
      const next = clone(prev);
      next.campaigns.splice(selectionIndex, 1);
      return next;
    });
    setSelectionIndex(null);
    setJsonEdits({});
    setDirty(true);
    showToast("已删除，点击发布后写入 Nacos", "info");
  }

  function validateCampaigns(targetConfig: CampaignConfig = config) {
    const errors: string[] = [];
    if (!targetConfig.campaigns.length) errors.push("至少需要配置一个活动");
    targetConfig.campaigns.forEach((campaign, index) => {
      const prefix = `活动 #${index + 1} (id: ${campaign.id || "未设置"})`;
      if (!campaign.campaignKey?.trim()) errors.push(`${prefix}: campaignKey 不能为空`);
      else campaign.id = `${campaign.campaignKey.trim()}-hunter`;
      if (!campaign.displayName?.zh?.trim() && !campaign.displayName?.en?.trim()) errors.push(`${prefix}: displayName 至少需要填写中文或英文`);
      if (!campaign.enrollmentWindow?.startAt || !campaign.enrollmentWindow?.endAt) errors.push(`${prefix}: enrollmentWindow 的 startAt 和 endAt 都必须填写`);
      if (!campaign.copy?.shortTitle?.zh?.trim() && !campaign.copy?.shortTitle?.en?.trim()) errors.push(`${prefix}: copy.shortTitle 至少需要填写中文或英文`);
      if (!Array.isArray(campaign.tasks) || !campaign.tasks.length) errors.push(`${prefix}: 至少需要配置一个 task`);
      if (!Array.isArray(campaign.logos) || !campaign.logos.length) errors.push(`${prefix}: 至少需要配置一个 logo`);
    });
    return errors;
  }

  function showPublishPreview() {
    try {
      applyJsonEdits();
    } catch (error) {
      const msg = `JSON 配置解析失败：${error instanceof Error ? error.message : "未知错误"}`;
      showToast(msg, "error");
      window.alert(msg);
      return;
    }
    const next = getConfigWithJsonEdits();
    const errors = validateCampaigns(next);
    if (errors.length) {
      const msg = `发布失败：以下必填字段未填写完整：\n\n${errors.join("\n")}\n\n请完善后再发布。`;
      showToast(msg, "error");
      window.alert(msg);
      return;
    }
    setConfig(next);
    setJsonEdits({});
    setJsonPreviewHtml(buildDiffHtml(originalConfig || {}, next));
    setJsonPreviewOpen(true);
  }

  async function confirmPublish() {
    setPublishing(true);
    try {
      const next = getConfigWithJsonEdits();
      await publishNacosConfig({
        dataId: DATA_ID,
        group: GROUP,
        content: JSON.stringify(next, null, 2),
        source: "nacos-legacy-campaigns",
      });
      setConfig(next);
      setJsonEdits({});
      setOriginalConfig(clone(next));
      setDirty(false);
      setJsonPreviewOpen(false);
      showToast("老版 Nacos 发布成功", "success");
    } catch (error) {
      showToast(`发布失败：${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setPublishing(false);
    }
  }

  function setListCollapsedAndStore(value: boolean) {
    setListCollapsed(value);
    localStorage.setItem("nacos-legacy-campaigns-list-collapsed", value ? "1" : "0");
  }

  function getConfigWithJsonEdits() {
    const next = clone(config);
    if (selectionIndex == null) return next;
    const entries = Object.entries(jsonEdits) as Array<[JsonFieldName, string]>;
    if (!entries.length) return next;
    const campaign = next.campaigns[selectionIndex];
    if (!campaign) return next;
    entries.forEach(([fieldName, raw]) => {
      campaign[fieldName] = parseJsonArray(raw, fieldName);
    });
    normalizeCampaign(campaign);
    return next;
  }

  function applyJsonEdits() {
    const next = getConfigWithJsonEdits();
    setConfig(next);
    setJsonEdits({});
    setDirty(true);
  }

  function updateJsonField(fieldName: JsonFieldName, value: string) {
    setJsonEdits((prev) => ({ ...prev, [fieldName]: value }));
  }

  const c = selectedCampaign;

  return (
    <PermissionGuard permission="nacos_config">
      <ConfigWorkbench
        id="nacos-legacy-campaigns"
        className="nacos-campaigns-admin campaigns-react-page"
        title="老版 Nacos 活动配置"
        collapsed={listCollapsed}
        toolbar={
          <>
            <div className="left">
              <div className="campaigns-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <Input variant="borderless" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索老版 Nacos 活动..." />
              </div>
            </div>
            <div className="right">
              <Button className="config-action config-action-secondary" onClick={() => { window.location.hash = "#/nacos-campaigns"; }}>返回数据库版</Button>
              <Button className="config-action config-action-secondary" onClick={() => void loadFromNacos()} loading={loading}>刷新 Nacos</Button>
              <Button className="config-action config-action-primary" onClick={newCampaign}>新增</Button>
              <Button className="config-action config-action-secondary" disabled={!editorEnabled} onClick={duplicateCampaign}>复制</Button>
              <Button className="config-action config-action-danger" danger disabled={!editorEnabled} onClick={() => void deleteCampaign()}>删除</Button>
              <Button className="config-action config-action-primary" disabled={!editorEnabled && !dirty} onClick={showPublishPreview}>发布到 Nacos</Button>
            </div>
          </>
        }
        sidebarTitle={
          <>
            <Button htmlType="button" className="config-workbench-collapse-button list-toggle" title={listCollapsed ? "展开列表" : "收起列表"} aria-label={listCollapsed ? "展开列表" : "收起列表"} onClick={() => setListCollapsedAndStore(!listCollapsed)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </Button>
            <span>老版 Nacos 活动</span>
          </>
        }
        sidebarMeta={listItems.length}
        sidebar={
          <div className="list-items">
            <ListGroup
              emptyText="暂无活动"
              items={listItems.map(({ campaign, index }) => ({
                key: `legacy-${index}`,
                active: selectionIndex === index,
                onClick: () => selectCampaign(index),
                title: campaign.displayName?.zh || campaign.displayName?.en || campaign.copy?.title?.zh || campaign.id || "(未命名)",
                meta: campaign.id || campaign.campaignKey || "-",
                chips: [campaign.enabled ? "展示" : "隐藏", campaign.testingPhase ? "testing" : "", Number(campaign.sortWeight) ? `权重 ${campaign.sortWeight}` : ""].filter(Boolean),
                logos: Array.isArray(campaign.logos) ? campaign.logos : [],
              }))}
            />
          </div>
        }
        editorTitle="编辑老版 Nacos"
        editorMeta={c ? `只读写 Nacos：${c.id || "(未设置 id)"}` : "选择左侧活动开始编辑"}
      >
        {!c ? (
          <div className="editor-empty">
            <div className="empty-title">请选择一个老版 Nacos 活动</div>
            <div className="empty-desc">此页面只读写 Nacos xhunt_campaigns，不加载、不同步、不保存网站数据库。</div>
          </div>
        ) : (
          <div id="campaigns-editor-body">
            <Card size="small" style={{ marginBottom: 12 }}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Space size={[6, 6]} wrap>
                  <AntTag color="orange">Legacy Nacos</AntTag>
                  <AntTag>{DATA_ID}</AntTag>
                  {dirty ? <AntTag color="red">未发布</AntTag> : null}
                </Space>
                <Typography.Text type="secondary">这个页面保留旧结构配置能力，只调用 Nacos 读写接口，和数据库活动配置完全隔离。</Typography.Text>
              </Space>
            </Card>
            <CampaignEditor
              c={c}
              setCampaignPath={setCampaignPath}
              updateSelectedCampaign={updateSelectedCampaign}
              internalTestUsers={internalTestUsers}
              jsonEdits={jsonEdits}
              updateJsonField={updateJsonField}
              applyJsonEdits={applyJsonEdits}
            />
          </div>
        )}
      </ConfigWorkbench>

      {toast ? <div className="campaigns-toast" style={{ background: toast.type === "error" ? "#991b1b" : toast.type === "success" ? "#065f46" : "#111827" }}>{toast.message}</div> : null}

      <Modal
        open={jsonPreviewOpen}
        title="预览老版 Nacos JSON"
        width="90%"
        style={{ maxWidth: 1400 }}
        onCancel={() => setJsonPreviewOpen(false)}
        footer={<><Button onClick={() => setJsonPreviewOpen(false)}>取消</Button><Button type="primary" loading={publishing} onClick={() => void confirmPublish()}>确认发布到 Nacos</Button></>}
      >
        <div className="json-preview-modal-body" style={{ padding: 0, maxHeight: "70vh" }}>
          <p className="json-preview-legend">只会发布到 Nacos <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 700 }}>不会写数据库</span> <span className="legend-removed">当前</span> | <span className="legend-added">即将发布</span></p>
          <pre dangerouslySetInnerHTML={{ __html: jsonPreviewHtml }} />
        </div>
      </Modal>
    </PermissionGuard>
  );
}

function ListGroup({ emptyText, items }: { emptyText: string; items: Array<{ key: string; active: boolean; onClick: () => void; title: string; meta: string; chips: string[]; logos: AnyObj[] }> }) {
  return items.length ? (
    <>
      {items.map((item) => (
        <div key={item.key} className={`item ${item.active ? "active" : ""}`} onClick={item.onClick}>
          <div className="item-content">
            <div className="item-logos">
              {item.logos.slice(0, 3).map((logo, index) => logo?.image ? <img key={index} className="item-logo" src={logo.image} alt="" onError={(event) => event.currentTarget.classList.add("error")} /> : null)}
            </div>
            <div className="item-title-wrapper">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="item-title"><span className="item-title-text">{item.title}</span></div>
                <div className="item-meta">{item.meta}</div>
                <div className="chips">{item.chips.map((chip) => <span key={chip} className={`chip ${chip === "展示" ? "on" : chip === "testing" ? "testing" : chip.startsWith("权重") ? "chip-weight" : ""}`}>{chip}</span>)}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  ) : <div className="list-group-empty">{emptyText}</div>;
}

function CampaignEditor({ c, setCampaignPath, updateSelectedCampaign, internalTestUsers, jsonEdits, updateJsonField, applyJsonEdits }: {
  c: AnyObj;
  setCampaignPath: (path: string, value: any) => void;
  updateSelectedCampaign: (fn: (campaign: AnyObj) => void) => void;
  internalTestUsers: VipListItem[];
  jsonEdits: Partial<Record<JsonFieldName, string>>;
  updateJsonField: (fieldName: JsonFieldName, value: string) => void;
  applyJsonEdits: () => void;
}) {
  const setJsonArray = (fieldName: JsonFieldName, value: string) => updateJsonField(fieldName, value);
  const internalTestUserOptions = internalTestUsers.map((item) => ({
    value: item.username,
    label: item.username,
  }));
  const changeThreshold = (value: string) => {
    updateSelectedCampaign((campaign) => {
      if (!value) {
        delete campaign.threshold;
        delete campaign.includeCreator;
      } else if (value === "200k+creator") {
        campaign.threshold = 200000;
        campaign.includeCreator = true;
      } else {
        campaign.threshold = value === "50k" ? 50000 : value === "100k" ? 100000 : 200000;
        campaign.includeCreator = false;
      }
    });
  };
  const thresholdValue = c.includeCreator === true && Number(c.threshold) === 200000 ? "200k+creator" : Number(c.threshold) === 50000 ? "50k" : Number(c.threshold) === 100000 ? "100k" : Number(c.threshold) === 200000 ? "200k" : "";
  const changeTestingPhase = (checked: boolean) => {
    if (!checked && c.testingPhase) {
      const confirmed = window.confirm("确认关闭测试模式？\n\n关闭后所有人都能看到此老版 Nacos 活动。");
      if (!confirmed) return;
    }
    setCampaignPath("testingPhase", checked);
  };

  return (
    <>
      <Section title="基础设置">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}><Field label="活动ID"><Input value={c.campaignKey || ""} onChange={(event) => setCampaignPath("campaignKey", event.target.value)} /></Field></Col>
          <Col xs={12} md={4}><Field label="排序权重"><InputNumber min={0} max={10000} style={{ width: "100%" }} value={Number(c.sortWeight) || 0} onChange={(value) => setCampaignPath("sortWeight", Math.min(10000, Math.max(0, Number(value) || 0)))} /></Field></Col>
          <Col xs={24} md={12}>
            <Space size={[18, 8]} wrap style={{ paddingTop: 28 }}>
              <Space><Switch checked={!!c.enabled} onChange={(value) => setCampaignPath("enabled", value)} />展示活动</Space>
              <Space><Switch checked={!!c.testingPhase} onChange={changeTestingPhase} />测试模式</Space>
              <Space><Switch checked={c.showExtraComponents !== false} onChange={(value) => setCampaignPath("showExtraComponents", value)} />显示写作/榜单扩展区</Space>
              <Space><Switch checked={c.showSponsoredPolicy === true} onChange={(value) => setCampaignPath("showSponsoredPolicy", value)} />推广政策</Space>
            </Space>
          </Col>
        </Row>
      </Section>

      <Section title="活动文案">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}><Field label="标题（中文）"><Input value={c.displayName?.zh || ""} onChange={(event) => setCampaignPath("displayName.zh", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="标题（English）"><Input value={c.displayName?.en || ""} onChange={(event) => setCampaignPath("displayName.en", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="短标题（中文）"><Input value={c.copy?.shortTitle?.zh || ""} onChange={(event) => setCampaignPath("copy.shortTitle.zh", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="短标题（English）"><Input value={c.copy?.shortTitle?.en || ""} onChange={(event) => setCampaignPath("copy.shortTitle.en", event.target.value)} /></Field></Col>
          <Col xs={12} md={4}><Field label="Emoji"><Input value={c.copy?.emoji || ""} onChange={(event) => setCampaignPath("copy.emoji", event.target.value)} /></Field></Col>
          <Col xs={24} md={10}><Field label="CTA 中文"><Input value={c.copy?.ctaText?.zh || ""} onChange={(event) => setCampaignPath("copy.ctaText.zh", event.target.value)} /></Field></Col>
          <Col xs={24} md={10}><Field label="CTA English"><Input value={c.copy?.ctaText?.en || ""} onChange={(event) => setCampaignPath("copy.ctaText.en", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="项目介绍（中文）"><TextArea rows={3} value={c.projectIntroduction?.zh || ""} onChange={(event) => setCampaignPath("projectIntroduction.zh", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="项目介绍（English）"><TextArea rows={3} value={c.projectIntroduction?.en || ""} onChange={(event) => setCampaignPath("projectIntroduction.en", event.target.value)} /></Field></Col>
        </Row>
      </Section>

      <Section title="时间、奖励与链接">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}><Field label="开始时间"><Input type="datetime-local" value={toDatetimeLocal(c.enrollmentWindow?.startAt)} onChange={(event) => setCampaignPath("enrollmentWindow.startAt", fromDatetimeLocalToIsoZ(event.target.value))} /></Field></Col>
          <Col xs={24} md={8}><Field label="结束时间"><Input type="datetime-local" value={toDatetimeLocal(c.enrollmentWindow?.endAt)} onChange={(event) => setCampaignPath("enrollmentWindow.endAt", fromDatetimeLocalToIsoZ(event.target.value))} /></Field></Col>
          <Col xs={24} md={8}><Field label="报名门槛"><Select value={thresholdValue} onChange={changeThreshold} options={[{ value: "", label: "请选择" }, { value: "50k", label: "50k" }, { value: "100k", label: "100k" }, { value: "200k", label: "200k" }, { value: "200k+creator", label: "200k+creator" }]} /></Field></Col>
          <Col xs={12} md={6}><Field label="POI 金额"><InputNumber min={0} style={{ width: "100%" }} value={c.rewardAmount} onChange={(value) => setCampaignPath("rewardAmount", value)} /></Field></Col>
          <Col xs={12} md={6}><Field label="POI 人数"><InputNumber min={0} style={{ width: "100%" }} value={c.rewardParticipantCount} onChange={(value) => setCampaignPath("rewardParticipantCount", value)} /></Field></Col>
          <Col xs={12} md={6}><Field label="分配机制"><Select value={c.rewardDistributionType || ""} onChange={(value) => setCampaignPath("rewardDistributionType", value)} options={[{ value: "", label: "请选择" }, { value: "equal", label: "平分" }, { value: "mindshare", label: "mindshare" }, { value: "workshare", label: "workshare" }]} /></Field></Col>
          <Col xs={12} md={6}><Field label="单位"><Input value={c.rewardUnit || ""} onChange={(event) => setCampaignPath("rewardUnit", event.target.value)} placeholder="USDT" /></Field></Col>
          <Col xs={24} md={12}><Field label="推特活动指南"><Input value={c.links?.guideUrl || ""} onChange={(event) => setCampaignPath("links.guideUrl", event.target.value)} /></Field></Col>
          <Col xs={24} md={12}><Field label="官网活动页面"><Input value={c.links?.activeUrl || ""} onChange={(event) => setCampaignPath("links.activeUrl", event.target.value)} /></Field></Col>
          <Col xs={24}><Space><Switch checked={!!c.links?.showLeaderboardLink} onChange={(value) => setCampaignPath("links.showLeaderboardLink", value)} />插件榜单底部显示官方排行榜入口</Space></Col>
        </Row>
      </Section>

      <Section title="名单与主题">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Field
              label="内部测试人员"
              hint="可从内测名单多选；也可以直接输入用户名并回车添加。"
            >
              <Select
                mode="tags"
                allowClear
                maxTagCount="responsive"
                placeholder="选择或输入用户名，回车添加"
                value={normalizeStringList(c.testList)}
                onChange={(values) => setCampaignPath("testList", normalizeStringList(values))}
                options={internalTestUserOptions}
                tokenSeparators={[",", "\n"]}
              />
            </Field>
          </Col>
          <Col xs={24} md={12}><Field label="插件右侧展示账号" hint="一行一个，也支持逗号分隔。"><TextArea rows={3} value={listToLines(c.targetUserIds)} onChange={(event) => setCampaignPath("targetUserIds", splitLinesToList(event.target.value))} /></Field></Col>
          <Col xs={24} md={12}><Field label="写作主题中文" hint="一行一个主题。"><TextArea rows={4} value={(Array.isArray(c.writingThemes) ? c.writingThemes : []).map((item: AnyObj) => item.zh || "").join("\n")} onChange={(event) => {
            const zh = event.target.value.split("\n");
            updateSelectedCampaign((campaign) => { campaign.writingThemes = zh.map((text, index) => ({ zh: text.trim(), en: campaign.writingThemes?.[index]?.en || "" })).filter((item: AnyObj) => item.zh || item.en); });
          }} /></Field></Col>
          <Col xs={24} md={12}><Field label="Writing Themes EN" hint="一行一个主题，和中文按行对应。"><TextArea rows={4} value={(Array.isArray(c.writingThemes) ? c.writingThemes : []).map((item: AnyObj) => item.en || "").join("\n")} onChange={(event) => {
            const en = event.target.value.split("\n");
            updateSelectedCampaign((campaign) => { campaign.writingThemes = en.map((text, index) => ({ zh: campaign.writingThemes?.[index]?.zh || "", en: text.trim() })).filter((item: AnyObj) => item.zh || item.en); });
          }} /></Field></Col>
        </Row>
      </Section>

      <Section title="高级 JSON（老结构原样发布）">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Typography.Text type="secondary">Logo、任务、Tags、征文获奖者等结构差异较多，这里保留 JSON 数组编辑；点击“应用 JSON”后再发布。</Typography.Text>
          <Button size="small" onClick={() => {
            try { applyJsonEdits(); } catch (error) { window.alert(error instanceof Error ? error.message : "JSON 解析失败"); }
          }}>应用 JSON</Button>
          <JsonArrayField title="logos" fieldName="logos" value={jsonEdits.logos ?? formatJson(c.logos)} onChange={setJsonArray} />
          <JsonArrayField title="tasks" fieldName="tasks" value={jsonEdits.tasks ?? formatJson(c.tasks)} onChange={setJsonArray} />
          <JsonArrayField title="tags" fieldName="tags" value={jsonEdits.tags ?? formatJson(c.tags || [])} onChange={setJsonArray} />
          <JsonArrayField title="essayContestWinners" fieldName="essayContestWinners" value={jsonEdits.essayContestWinners ?? formatJson(c.essayContestWinners || [])} onChange={setJsonArray} />
          <JsonArrayField title="customLeaderboards" fieldName="customLeaderboards" value={jsonEdits.customLeaderboards ?? formatJson(c.customLeaderboards || [])} onChange={setJsonArray} />
        </Space>
      </Section>
    </>
  );
}

function JsonArrayField({ title, fieldName, value, onChange }: { title: string; fieldName: JsonFieldName; value: string; onChange: (fieldName: JsonFieldName, value: string) => void }) {
  return (
    <Field label={title}>
      <TextArea rows={8} value={value} onChange={(event) => onChange(fieldName, event.target.value)} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }} />
    </Field>
  );
}
