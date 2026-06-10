import { useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Modal, Segmented, Select, Switch, Tabs } from "antd";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { useAuth } from "@/app/auth";
import {
  fetchAllWebsiteCampaigns,
  fetchWebsiteCampaignByNacosId,
  saveManagedWebsiteCampaignsConfig,
  saveWebsiteCampaignConfig,
} from "@/services/nacos";
import type { WebsiteCampaignRecord } from "@/types/nacos";

const { TextArea } = Input;
const DEFAULT_RING = "ring-blue-400/20 hover:ring-blue-400/50";
const DEFAULT_WEBSITE_LIST_LEFT_LOGO = "https://xhunt.ai/whitexhunt.png";
const DEFAULT_WEBSITE_LIST_RIGHT_LOGO = "https://xhunt.ai/whitexhunt.png";
const DEFAULT_WEBSITE_LIST_CHEST_IMAGE = "https://xhunt.ai/usdc2.png";

const TAG_COLOR_SCHEMES = [
  { value: "green", label: "绿色", className: "tag-green" },
  { value: "purple", label: "紫色", className: "tag-purple" },
  { value: "yellow", label: "黄色", className: "tag-yellow" },
  { value: "blue", label: "蓝色", className: "tag-blue" },
  { value: "gray", label: "灰色", className: "tag-gray" },
  { value: "gold", label: "金色", className: "tag-gold" },
  { value: "red", label: "红色", className: "tag-red" },
  { value: "pink", label: "粉色", className: "tag-pink" },
  { value: "cyan", label: "青色", className: "tag-cyan" },
  { value: "orange", label: "橙色", className: "tag-orange" },
];

const LUCIDE_ICONS = [
  "FileText 📄",
  "Gift 🎁",
  "Trophy 🏆",
  "Users 👥",
  "Star ⭐",
  "Heart ❤️",
  "Zap ⚡",
  "Rocket 🚀",
  "Award 🏅",
  "Medal 🥇",
  "Crown 👑",
  "Sparkles ✨",
  "Flame 🔥",
  "Target 🎯",
  "TrendingUp 📈",
  "Coins 🪙",
  "Wallet 👛",
  "Shield 🛡️",
  "CheckCircle ✅",
  "Info ℹ️",
  "Bell 🔔",
  "Clock ⏰",
  "Calendar 📅",
  "Tag 🏷️",
  "Bookmark 🔖",
  "Flag 🚩",
  "MapPin 📍",
  "Globe 🌐",
  "Link 🔗",
  "Share2 🔄",
].map((label) => ({ value: label.split(" ")[0], label }));

type AnyObj = Record<string, any>;
type CampaignConfig = {
  version: number;
  campaigns: AnyObj[];
  [key: string]: any;
};
type ToastState = {
  message: string;
  type?: "success" | "error" | "info";
} | null;
type SelectionType = "nacos" | "website_only";
type Selection =
  | { type: "nacos"; index: number }
  | { type: "website_only"; id: string }
  | null;
type WebsiteForm = {
  slug: string;
  webStatus: string;
  pageTemplate: string;
  webAnnouncementZh: string;
  webAnnouncementEn: string;
  webRewardTextZh: string;
  webRewardTextEn: string;
  webNoteZh: string;
  webNoteEn: string;
  listLeftLogo: string;
  listRightLogo: string;
  listChestImage: string;
  claimPoiContractAddress: string;
  claimPowContractAddress: string;
  claimEssayContractAddress: string;
  templateConfig: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeConfig(obj: unknown): CampaignConfig {
  const out =
    obj && typeof obj === "object"
      ? (obj as CampaignConfig)
      : ({ version: 3, campaigns: [] } as CampaignConfig);
  if (!Array.isArray(out.campaigns)) out.campaigns = [];
  out.version = safeNumber(out.version, 3);
  out.campaigns = out.campaigns.map(normalizeCampaign);
  return out;
}

function normalizeCampaign(input: AnyObj): AnyObj {
  const c = input && typeof input === "object" ? input : {};
  c.enrollmentWindow =
    c.enrollmentWindow && typeof c.enrollmentWindow === "object"
      ? c.enrollmentWindow
      : { startAt: "", endAt: "" };
  c.displayName =
    c.displayName && typeof c.displayName === "object"
      ? c.displayName
      : { zh: "", en: "" };
  c.copy = c.copy && typeof c.copy === "object" ? c.copy : {};
  c.copy.title =
    c.copy.title && typeof c.copy.title === "object"
      ? c.copy.title
      : { zh: "", en: "" };
  c.copy.shortTitle =
    c.copy.shortTitle && typeof c.copy.shortTitle === "object"
      ? c.copy.shortTitle
      : { zh: "", en: "" };
  c.copy.ctaText =
    c.copy.ctaText && typeof c.copy.ctaText === "object"
      ? c.copy.ctaText
      : { zh: "", en: "" };
  c.copy.goToOfficialText =
    c.copy.goToOfficialText && typeof c.copy.goToOfficialText === "object"
      ? c.copy.goToOfficialText
      : { zh: "", en: "" };
  c.copy.viewGuideText =
    c.copy.viewGuideText && typeof c.copy.viewGuideText === "object"
      ? c.copy.viewGuideText
      : { zh: "", en: "" };
  c.links =
    c.links && typeof c.links === "object"
      ? c.links
      : { guideUrl: "", activeUrl: "", showLeaderboardLink: false };
  if (!c.projectIntroduction || typeof c.projectIntroduction !== "object") {
    c.projectIntroduction = {
      zh:
        typeof c.projectIntroduction === "string" ? c.projectIntroduction : "",
      en: "",
    };
  }
  c.writingThemes = Array.isArray(c.writingThemes)
    ? c.writingThemes
    : [{ zh: "", en: "" }];
  c.writingThemes = c.writingThemes.length
    ? c.writingThemes.map((it: any) =>
        it && typeof it === "object"
          ? { zh: String(it.zh || ""), en: String(it.en || "") }
          : { zh: String(it || ""), en: "" },
      )
    : [{ zh: "", en: "" }];
  c.testList = Array.isArray(c.testList) ? c.testList : [];
  c.targetUserIds = Array.isArray(c.targetUserIds) ? c.targetUserIds : [];
  c.logos = Array.isArray(c.logos) ? c.logos : [];
  c.tasks = Array.isArray(c.tasks) ? c.tasks : [];
  c.essayContestWinners = Array.isArray(c.essayContestWinners)
    ? c.essayContestWinners
    : [];
  c.leaderboardMode =
    c.leaderboardMode === "custom" || c.leaderboardMode === "traditional"
      ? c.leaderboardMode
      : "traditional";
  c.leaderboardApiUrl =
    typeof c.leaderboardApiUrl === "string" ? c.leaderboardApiUrl : "";
  c.customLeaderboards = Array.isArray(c.customLeaderboards)
    ? c.customLeaderboards
    : [];
  c.customLeaderboards = c.customLeaderboards.map((it: AnyObj) => ({
    name:
      it?.name && typeof it.name === "object"
        ? { zh: String(it.name.zh || ""), en: String(it.name.en || "") }
        : { zh: String(it?.name || ""), en: "" },
    amount: it?.amount,
    participantCount: it?.participantCount,
    distributionType: it?.distributionType || "",
    unit: it?.unit || "",
  }));
  c.logos.forEach((logo: AnyObj) => {
    if (!logo.ringClassName) logo.ringClassName = DEFAULT_RING;
  });
  return c;
}

function splitLinesToList(text: string) {
  if (!text) return [];
  return String(text)
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(arr: unknown) {
  return Array.isArray(arr) ? arr.map(String).join("\n") : "";
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

function getByPath(obj: AnyObj | undefined, path: string, fallback: any = "") {
  return (
    path
      .split(".")
      .reduce((cur: any, part) => (cur == null ? undefined : cur[part]), obj) ??
    fallback
  );
}

function generateTaskId(campaignKey: string, type: string, url: string) {
  if (!campaignKey || !type || !url) return "";
  try {
    const base64 = btoa(unescape(encodeURIComponent(url)));
    return `${campaignKey}-${type}-${base64.substring(0, 6)}-${base64.substring(base64.length - 6)}`;
  } catch {
    return "";
  }
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
    logos: [
      {
        image: "REPLACE_WITH_XHUNT_AVATAR_URL",
        url: "https://x.com/xhunt_ai",
        label: "XHunt AI",
        ringClassName: DEFAULT_RING,
      },
    ],
    copy: {
      title: { zh: "", en: "" },
      shortTitle: { zh: "", en: "" },
      emoji: "🎉",
      ctaText: { zh: "立即参与", en: "Join Now" },
      goToOfficialText: { zh: "前往官方", en: "Go to Official" },
      viewGuideText: { zh: "查看官方指南", en: "View Official Guide" },
    },
    tasks: [
      {
        id: "follow-xhunt",
        title: { zh: "关注 @xhunt_ai", en: "Follow @xhunt_ai" },
        url: "https://x.com/xhunt_ai",
        type: "twitter",
        autoComplete: true,
      },
    ],
    links: {
      guideUrl: "https://",
      activeUrl: "https://xhunt.ai/leaderboard",
      showLeaderboardLink: false,
    },
    projectIntroduction: { zh: "", en: "" },
    writingThemes: [{ zh: "", en: "" }],
    showExtraComponents: true,
    targetUserIds: [],
    hotTweetsKey: "",
    includeCreator: false,
    showSponsoredPolicy: true,
    allowEmailRegistration: false,
    leaderboardMode: "traditional",
    leaderboardApiUrl: "",
    customLeaderboards: [],
    enableEssayContest: false,
    enablePowLeaderboard: false,
  });
}

function campaignFromWebsiteRecord(record: AnyObj): AnyObj {
  const payload =
    record?.nacosPayload && typeof record.nacosPayload === "object"
      ? clone(record.nacosPayload)
      : {};
  return normalizeCampaign({
    id: payload.id || record.nacosCampaignId || "",
    campaignKey: payload.campaignKey || record.campaignKey || "",
    sortWeight: payload.sortWeight ?? record.sortWeight ?? 0,
    enabled: payload.enabled ?? record.enabled ?? false,
    testingPhase: payload.testingPhase ?? record.testingPhase ?? false,
    enrollmentWindow: payload.enrollmentWindow || {
      startAt: record.startAt || "",
      endAt: record.endAt || "",
    },
    displayName: payload.displayName || {
      zh: record.displayNameZh || "",
      en: record.displayNameEn || "",
    },
    projectIntroduction: payload.projectIntroduction || {
      zh: record.projectIntroductionZh || "",
      en: record.projectIntroductionEn || "",
    },
    links: payload.links || {
      guideUrl: record.guideUrl || "",
      activeUrl: record.activeUrl || "",
      showLeaderboardLink: false,
    },
    logos: payload.logos || record.logos || [],
    tags: payload.tags || record.tags || [],
    writingThemes: payload.writingThemes || record.writingThemes || [],
    ...payload,
  });
}

function configFromWebsiteRecords(records: AnyObj[]): CampaignConfig {
  return normalizeConfig({
    version: 3,
    campaigns: records
      .filter((record) => !record?.isDeleted)
      .map(campaignFromWebsiteRecord),
  });
}

function getWebsiteListAssets(record: AnyObj | null) {
  const listAssets =
    record?.websiteExtra?.listAssets &&
    typeof record.websiteExtra.listAssets === "object"
      ? record.websiteExtra.listAssets
      : {};
  return {
    leftLogo: listAssets.leftLogo || DEFAULT_WEBSITE_LIST_LEFT_LOGO,
    rightLogo: listAssets.rightLogo || DEFAULT_WEBSITE_LIST_RIGHT_LOGO,
    chestImage: listAssets.chestImage || DEFAULT_WEBSITE_LIST_CHEST_IMAGE,
  };
}

function makeWebsiteForm(
  record?: AnyObj | null,
  campaign?: AnyObj | null,
): WebsiteForm {
  const assets = getWebsiteListAssets(record || null);
  return {
    slug: record?.slug || campaign?.campaignKey || "",
    webStatus: record?.webStatus || "draft",
    pageTemplate: record?.pageTemplate || "standard",
    webAnnouncementZh: record?.webAnnouncementZh || "",
    webAnnouncementEn: record?.webAnnouncementEn || "",
    webRewardTextZh: record?.webRewardTextZh || "",
    webRewardTextEn: record?.webRewardTextEn || "",
    webNoteZh: record?.webNoteZh || "",
    webNoteEn: record?.webNoteEn || "",
    listLeftLogo: assets.leftLogo,
    listRightLogo: assets.rightLogo,
    listChestImage: assets.chestImage,
    claimPoiContractAddress: record?.claimPoiContractAddress || "",
    claimPowContractAddress: record?.claimPowContractAddress || "",
    claimEssayContractAddress: record?.claimEssayContractAddress || "",
    templateConfig: JSON.stringify(record?.templateConfig || {}, null, 2),
  };
}

function buildDiffHtml(oldConfig: unknown, nextConfig: unknown) {
  if (window.Diff?.diffJson) {
    return window.Diff.diffJson(oldConfig || {}, nextConfig || {})
      .map((part) => {
        const cls = part.added ? "added" : part.removed ? "removed" : "";
        const text = document.createElement("div");
        text.textContent = part.value;
        return cls
          ? `<span class="${cls}">${text.innerHTML}</span>`
          : text.innerHTML;
      })
      .join("");
  }
  const div = document.createElement("div");
  div.textContent = JSON.stringify(nextConfig, null, 2);
  return div.innerHTML;
}

function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={`field ${inline ? "field-inline" : ""}`}>
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

function Section({
  title,
  children,
  compact = true,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`section ${compact ? "section-compact" : ""}`}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section section-collapsible ${open ? "expanded" : ""}`}>
      <div
        className="section-title section-title-collapsible"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <span className="section-toggle">▼</span>
      </div>
      <div
        className="section-content"
        style={{ display: open ? "block" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}

export function NacosCampaignsPage() {
  const [config, setConfig] = useState<CampaignConfig>({
    version: 3,
    campaigns: [],
  });
  const [originalConfig, setOriginalConfig] = useState<CampaignConfig | null>(
    null,
  );
  const [websiteRecords, setWebsiteRecords] = useState<WebsiteCampaignRecord[]>(
    [],
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [websiteDirty, setWebsiteDirty] = useState(false);
  const [websiteForm, setWebsiteForm] = useState<WebsiteForm>(() =>
    makeWebsiteForm(null, null),
  );
  const [websiteMeta, setWebsiteMeta] = useState("尚未加载网站配置");
  const [toast, setToast] = useState<ToastState>(null);
  const [jsonPreviewOpen, setJsonPreviewOpen] = useState(false);
  const [jsonPreviewHtml, setJsonPreviewHtml] = useState("");
  const [jsonDiffHint, setJsonDiffHint] = useState("");
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [newCampaignMode, setNewCampaignMode] = useState<"blank" | "copy">(
    "blank",
  );
  const [newCampaignSourceIndex, setNewCampaignSourceIndex] = useState<
    number | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(
    () => localStorage.getItem("nacos-campaigns-list-collapsed") === "1",
  );
  const { user } = useAuth();
  const canEditCampaignId = user?.role === "super";

  const selectedCampaign =
    selection?.type === "nacos" ? config.campaigns[selection.index] : null;
  const selectedWebsiteRecord =
    selection?.type === "website_only"
      ? websiteRecords.find(
          (item) => String(item.nacosCampaignId) === selection.id,
        ) || null
      : null;
  const editorEnabled = !!selectedCampaign;
  const websiteTarget = selectedWebsiteRecord || selectedCampaign;
  const websiteConfigKey = selectedWebsiteRecord
    ? selectedWebsiteRecord.nacosCampaignId || selectedWebsiteRecord.id
    : selectedCampaign?.id || selectedCampaign?.nacosCampaignId;

  function showToast(
    message: string,
    type: "success" | "error" | "info" = "info",
  ) {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2600);
  }

  function confirmDiscardWebsite() {
    if (!websiteDirty) return true;
    return window.confirm(
      "你当前有未保存的网站配置修改，继续操作会丢失这些修改。\n确认继续？",
    );
  }

  function updateSelectedCampaign(mutator: (campaign: AnyObj) => void) {
    if (selection?.type !== "nacos") return;
    setConfig((prev) => {
      const next = clone(prev);
      const campaign = next.campaigns[selection.index];
      if (!campaign) return prev;
      mutator(campaign);
      normalizeCampaign(campaign);
      return next;
    });
    setDirty(true);
  }

  function setCampaignPath(path: string, value: any) {
    updateSelectedCampaign((c) => {
      if (path === "campaignKey") {
        c.campaignKey = String(value || "").trim();
        c.hotTweetsKey = c.campaignKey;
        c.id = c.campaignKey ? `${c.campaignKey}-hunter` : "";
        return;
      }
      setByPath(c, path, value);
      if (path === "copy.shortTitle.zh") setByPath(c.copy, "title.zh", value);
      if (path === "copy.shortTitle.en") setByPath(c.copy, "title.en", value);
    });
  }

  function changeThreshold(value: string) {
    updateSelectedCampaign((c) => {
      if (!value) {
        delete c.threshold;
        delete c.includeCreator;
      } else if (value === "200k+creator") {
        c.threshold = 200000;
        c.includeCreator = true;
      } else {
        c.threshold =
          value === "50k" ? 50000 : value === "100k" ? 100000 : 200000;
        c.includeCreator = false;
      }
    });
  }

  function thresholdValue(c?: AnyObj | null) {
    if (!c || c.threshold == null) return "";
    if (c.includeCreator === true && Number(c.threshold) === 200000)
      return "200k+creator";
    if (Number(c.threshold) === 50000) return "50k";
    if (Number(c.threshold) === 100000) return "100k";
    if (Number(c.threshold) === 200000) return "200k";
    return String(c.threshold);
  }

  function changeRiskConfirm(checked: boolean) {
    updateSelectedCampaign((c) => {
      c.riskConfirmHtml = checked
        ? {
            zh: "<p><strong>重要提示：</strong>该项目为 Early-stage 项目，信息由项目方提供，请在参与前自行判断。点击继续即表示理解并接受。</p>",
            en: "<p><strong>Important Notice:</strong> The project is in its early stage. The information is provided by the project team. Please make an informed decision before participating. Proceeding indicates that you understand and accept this.</p>",
          }
        : null;
    });
  }

  async function loadFromDatabase() {
    if (!confirmDiscardWebsite()) return;
    if (
      dirty &&
      !window.confirm(
        "你当前有未发布的修改，重新加载会丢失这些修改。\n确认重新加载？",
      )
    )
      return;
    setLoading(true);
    try {
      showToast("正在从数据库加载...", "info");
      const records = await fetchAllWebsiteCampaigns();
      const recordList = Array.isArray(records.data) ? records.data : [];
      const parsed = configFromWebsiteRecords(recordList as AnyObj[]);
      setConfig(parsed);
      setOriginalConfig(clone(parsed));
      setWebsiteRecords(recordList);
      setSelection(null);
      setDirty(false);
      setWebsiteDirty(false);
      setWebsiteForm(makeWebsiteForm(null, null));
      setWebsiteMeta("请先选择活动");
      showToast("加载完成", "success");
    } catch (error) {
      showToast(
        `加载失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFromDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadWebsiteConfig(
    target: AnyObj | null,
    selectionType: SelectionType = "nacos",
  ) {
    if (!target) {
      setWebsiteForm(makeWebsiteForm(null, null));
      setWebsiteMeta("请先选择活动");
      return;
    }
    const key =
      selectionType === "website_only"
        ? target.nacosCampaignId || target.id
        : target.id || target.nacosCampaignId;
    if (!key) {
      setWebsiteForm(makeWebsiteForm(null, target));
      setWebsiteMeta("请先发布活动保存到数据库");
      return;
    }
    try {
      const resp = await fetchWebsiteCampaignByNacosId(String(key));
      const record = resp.data as AnyObj | null;
      if (!record) {
        setWebsiteForm(makeWebsiteForm(null, target));
        setWebsiteMeta("该活动尚未保存到数据库，请先点击“发布”");
        return;
      }
      setWebsiteRecords((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (item) =>
            String(item.nacosCampaignId || item.id) ===
            String(record.nacosCampaignId || record.id),
        );
        if (idx >= 0) next[idx] = record as WebsiteCampaignRecord;
        else next.push(record as WebsiteCampaignRecord);
        return next;
      });
      setWebsiteForm(makeWebsiteForm(record, target));
      const updatedAt = record.updatedAt
        ? new Date(record.updatedAt).toLocaleString()
        : "-";
      const syncedAt = record.lastSyncedAt
        ? new Date(record.lastSyncedAt).toLocaleString()
        : "-";
      setWebsiteMeta(
        `网站配置：${record.nacosCampaignId || key}｜状态：${record.webStatus || "draft"}｜更新：${updatedAt}｜同步：${syncedAt}${record.isDeleted ? "｜已软删除" : ""}`,
      );
      setWebsiteDirty(false);
    } catch (error) {
      setWebsiteForm(makeWebsiteForm(null, target));
      setWebsiteMeta(
        `加载网站配置失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  function selectCampaign(index: number) {
    if (!confirmDiscardWebsite()) return;
    const c = config.campaigns[index];
    if (!c) return;
    setSelection({ type: "nacos", index });
    void loadWebsiteConfig(c, "nacos");
  }

  function selectWebsiteOnly(id: string) {
    if (!confirmDiscardWebsite()) return;
    const record = websiteRecords.find(
      (item) => String(item.nacosCampaignId) === id,
    ) as AnyObj | undefined;
    if (!record) return;
    setSelection({ type: "website_only", id });
    setWebsiteForm(makeWebsiteForm(record, record));
    void loadWebsiteConfig(record, "website_only");
  }

  const listData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nacosItems = config.campaigns
      .map((c, idx) => ({ c, idx }))
      .filter(
        ({ c }) =>
          !q ||
          [
            c.id,
            c.campaignKey,
            c.displayName?.zh,
            c.displayName?.en,
            c.copy?.title?.zh,
            c.copy?.title?.en,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort(
        (a, b) =>
          (Number(b.c.sortWeight) || 0) - (Number(a.c.sortWeight) || 0) ||
          Number(!!b.c.enabled) - Number(!!a.c.enabled) ||
          (Date.parse(b.c.enrollmentWindow?.startAt || "") || 0) -
            (Date.parse(a.c.enrollmentWindow?.startAt || "") || 0),
      );
    const nacosIds = new Set(
      config.campaigns
        .map((c) => String(c.id || c.nacosCampaignId || ""))
        .filter(Boolean),
    );
    const websiteOnly = websiteRecords
      .filter(
        (item: AnyObj) =>
          item?.nacosCampaignId && !nacosIds.has(String(item.nacosCampaignId)),
      )
      .filter(
        (item: AnyObj) =>
          !q ||
          [
            item.nacosCampaignId,
            item.campaignKey,
            item.slug,
            item.displayNameZh,
            item.displayNameEn,
            item.webAnnouncementZh,
            item.webAnnouncementEn,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
      );
    return { nacosItems, websiteOnly };
  }, [config.campaigns, websiteRecords, search]);

  function openNewCampaignModal() {
    if (!confirmDiscardWebsite()) return;
    if (
      dirty &&
      !window.confirm(
        "你当前有未发布的修改，新增活动会丢失这些修改。\n确认继续新增？",
      )
    )
      return;
    setNewCampaignMode("blank");
    setNewCampaignSourceIndex(
      selection?.type === "nacos" ? selection.index : null,
    );
    setNewCampaignOpen(true);
  }

  function makeCampaignFromTemplate(index: number | null) {
    if (index == null) return makeNewCampaign();
    const source = config.campaigns[index];
    if (!source) return makeNewCampaign();
    const copy = clone(source);
    copy.id = "";
    copy.campaignKey = "";
    copy.hotTweetsKey = "";
    copy.enabled = false;
    copy.testingPhase = true;
    copy.sortWeight = 0;
    return normalizeCampaign(copy);
  }

  function confirmNewCampaign() {
    const c =
      newCampaignMode === "copy"
        ? makeCampaignFromTemplate(newCampaignSourceIndex)
        : makeNewCampaign();
    setConfig((prev) => ({ ...prev, campaigns: [c, ...prev.campaigns] }));
    setSelection({ type: "nacos", index: 0 });
    setDirty(true);
    setWebsiteForm(makeWebsiteForm(null, c));
    setWebsiteMeta("新活动尚未发布到数据库");
    setNewCampaignOpen(false);
    showToast(
      newCampaignMode === "copy"
        ? "已从模板新增一条活动（未发布）"
        : "已新增一条活动（未发布）",
      "info",
    );
  }

  function duplicateCampaign() {
    if (
      !selectedCampaign ||
      selection?.type !== "nacos" ||
      !confirmDiscardWebsite()
    )
      return;
    const copy = clone(selectedCampaign);
    copy.id = "";
    copy.enabled = false;
    copy.testingPhase = false;
    setConfig((prev) => {
      const next = clone(prev);
      next.campaigns.splice(selection.index + 1, 0, copy);
      return next;
    });
    setSelection({ type: "nacos", index: selection.index + 1 });
    setDirty(true);
    showToast("已复制活动（未发布）", "info");
  }

  async function deleteCampaign() {
    if (
      !selectedCampaign ||
      selection?.type !== "nacos" ||
      !confirmDiscardWebsite()
    )
      return;
    if (
      !window.confirm(
        `确认删除该活动？\n\nid=${selectedCampaign.id || ""}\n\n提示：删除后将立即保存到数据库。`,
      )
    )
      return;
    if (
      !window.confirm(
        "确定删除该活动？\n\n此操作将立即保存到数据库，并将该活动软删除。",
      )
    )
      return;
    const nextConfig = clone(config);
    nextConfig.campaigns.splice(selection.index, 1);
    setConfig(nextConfig);
    setSelection(null);
    setDirty(true);
    try {
      showToast("正在删除并保存到数据库...", "info");
      await saveManagedWebsiteCampaignsConfig(nextConfig);
      const records = await fetchAllWebsiteCampaigns();
      setWebsiteRecords(records.data || []);
      setOriginalConfig(clone(nextConfig));
      setDirty(false);
      showToast("删除已生效（已保存）", "success");
    } catch (error) {
      showToast(
        `删除未能保存：${error instanceof Error ? error.message : "未知错误"}（可点击「发布」重试）`,
        "error",
      );
    }
  }

  function validateCampaigns() {
    const errors: string[] = [];
    if (!config.campaigns.length) errors.push("至少需要配置一个活动");
    config.campaigns.forEach((c, idx) => {
      const prefix = `活动 #${idx + 1} (id: ${c.id || "未设置"})`;
      if (!c.campaignKey?.trim())
        errors.push(`${prefix}: campaignKey 不能为空`);
      else c.id = `${c.campaignKey.trim()}-hunter`;
      if (!c.displayName?.zh?.trim() && !c.displayName?.en?.trim())
        errors.push(`${prefix}: displayName 至少需要填写中文或英文`);
      if (!c.enrollmentWindow?.startAt || !c.enrollmentWindow?.endAt)
        errors.push(
          `${prefix}: enrollmentWindow 的 startAt 和 endAt 都必须填写`,
        );
      if (!c.copy?.shortTitle?.zh?.trim() && !c.copy?.shortTitle?.en?.trim())
        errors.push(
          `${prefix}: copy.shortTitle 至少需要填写中文或英文（title 会自动同步）`,
        );
      if (!c.copy?.emoji?.trim()) errors.push(`${prefix}: copy.emoji 不能为空`);
      if (!c.copy?.ctaText?.zh?.trim() && !c.copy?.ctaText?.en?.trim())
        errors.push(`${prefix}: copy.ctaText 至少需要填写中文或英文`);
      if (!c.links?.guideUrl?.trim() && !c.links?.activeUrl?.trim())
        errors.push(
          `${prefix}: links 的 guideUrl 或 activeUrl 至少需要填写一个`,
        );
      if (!Array.isArray(c.writingThemes) || !c.writingThemes.length)
        errors.push(
          `${prefix}: 写作相关主题（writingThemes）至少需要添加一个主题`,
        );
      const hasNewFields = [
        "rewardAmount",
        "rewardParticipantCount",
        "rewardDistributionType",
        "threshold",
        "includeCreator",
      ].some((key) => key in c);
      if (hasNewFields) {
        if (
          !Number.isFinite(Number(c.rewardAmount)) ||
          Number(c.rewardAmount) < 1 ||
          Number(c.rewardAmount) > 99999999
        )
          errors.push(
            `${prefix}: rewardAmount（奖励金额）必须填写，范围：1-99999999 U`,
          );
        if (
          !Number.isFinite(Number(c.rewardParticipantCount)) ||
          Number(c.rewardParticipantCount) < 10 ||
          Number(c.rewardParticipantCount) > 1000
        )
          errors.push(
            `${prefix}: rewardParticipantCount（人数）必须填写，范围：10-1000 人`,
          );
        if (
          !["equal", "mindshare"].includes(
            String(c.rewardDistributionType || ""),
          )
        )
          errors.push(
            `${prefix}: rewardDistributionType（分配机制）必须选择：平分 或 mindshare分`,
          );
        if (![50000, 100000, 200000].includes(Number(c.threshold)))
          errors.push(
            `${prefix}: threshold（门槛）必须选择：50k / 100k / 200k / 200k+creator`,
          );
        if (
          c.includeCreator !== undefined &&
          typeof c.includeCreator !== "boolean"
        )
          errors.push(`${prefix}: includeCreator 必须是布尔值（true/false）`);
      }
      if (c.leaderboardMode === "custom") {
        if (!String(c.leaderboardApiUrl || "").trim())
          errors.push(`${prefix}: 自定义模式下榜单接口 URL 不能为空`);
        if (
          !Array.isArray(c.customLeaderboards) ||
          !c.customLeaderboards.length
        )
          errors.push(`${prefix}: 自定义模式下至少需要添加一个榜单`);
        (Array.isArray(c.customLeaderboards) ? c.customLeaderboards : []).forEach(
          (item: AnyObj, leaderboardIdx: number) => {
            const label = `${prefix}: 自定义榜单 #${leaderboardIdx + 1}`;
            if (!item.name?.zh?.trim() && !item.name?.en?.trim())
              errors.push(`${label} 名字至少需要填写中文或英文`);
            if (
              !Number.isFinite(Number(item.amount)) ||
              Number(item.amount) < 0
            )
              errors.push(`${label} 金额必须填写，且不能小于 0`);
            if (
              !Number.isFinite(Number(item.participantCount)) ||
              Number(item.participantCount) < 1
            )
              errors.push(`${label} 人数必须填写，且不能小于 1`);
            if (
              !["equal", "mindshare", "workshare"].includes(
                String(item.distributionType || ""),
              )
            )
              errors.push(
                `${label} 分配机制必须选择：平分 / mindshare / workshare`,
              );
            if (!String(item.unit || "").trim())
              errors.push(`${label} 奖励单位不能为空`);
          },
        );
      }
      if (!Array.isArray(c.tasks) || !c.tasks.length)
        errors.push(`${prefix}: 至少需要配置一个 task`);
      else
        c.tasks.forEach((task: AnyObj, taskIdx: number) => {
          if (!task.id?.trim())
            task.id = generateTaskId(
              c.campaignKey || "",
              task.type || "",
              task.url || "",
            );
          if (!task.id?.trim())
            errors.push(`${prefix}: task #${taskIdx + 1} 的 id 无法自动生成`);
          if (!task.title?.zh?.trim() && !task.title?.en?.trim())
            errors.push(
              `${prefix}: task #${taskIdx + 1} 的 title 至少需要填写中文或英文`,
            );
          if (!task.url?.trim())
            errors.push(`${prefix}: task #${taskIdx + 1} 的 url 不能为空`);
        });
      if (!Array.isArray(c.logos) || !c.logos.length)
        errors.push(`${prefix}: 至少需要配置一个 logo`);
      else
        c.logos.forEach((logo: AnyObj, logoIdx: number) => {
          if (!logo.image?.trim())
            errors.push(`${prefix}: logo #${logoIdx + 1} 的 image 不能为空`);
          if (!logo.url?.trim())
            errors.push(`${prefix}: logo #${logoIdx + 1} 的 url 不能为空`);
          if (!logo.label?.trim())
            errors.push(`${prefix}: logo #${logoIdx + 1} 的 label 不能为空`);
        });
    });
    return errors;
  }

  function showPublishPreview() {
    const errors = validateCampaigns();
    if (errors.length) {
      const msg = `发布失败：以下必填字段未填写完整：\n\n${errors.join("\n")}\n\n请完善所有必填字段后再发布。`;
      showToast(msg, "error");
      window.alert(msg);
      return;
    }
    const next = clone(config);
    setJsonPreviewHtml(buildDiffHtml(originalConfig || {}, next));
    setJsonDiffHint(
      originalConfig ? "（与当前数据库配置对比）" : "（首次保存，无原始配置）",
    );
    setJsonPreviewOpen(true);
  }

  async function confirmPublish() {
    setPublishing(true);
    try {
      await saveManagedWebsiteCampaignsConfig(config);
      const records = await fetchAllWebsiteCampaigns();
      setWebsiteRecords(records.data || []);
      setOriginalConfig(clone(config));
      setDirty(false);
      setJsonPreviewOpen(false);
      showToast("保存成功", "success");
    } catch (error) {
      showToast(
        `保存失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setPublishing(false);
    }
  }

  async function refreshWebsiteRecords() {
    try {
      showToast("正在刷新数据库活动...", "info");
      const records = await fetchAllWebsiteCampaigns();
      const recordList = (records.data || []) as AnyObj[];
      const parsed = configFromWebsiteRecords(recordList);
      setConfig(parsed);
      setOriginalConfig(clone(parsed));
      setWebsiteRecords(records.data || []);
      setDirty(false);
      showToast("刷新完成", "success");
      if (websiteTarget)
        await loadWebsiteConfig(websiteTarget, selection?.type || "nacos");
    } catch (error) {
      showToast(
        `刷新失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    }
  }

  function updateWebsiteForm(patch: Partial<WebsiteForm>) {
    setWebsiteForm((prev) => ({ ...prev, ...patch }));
    setWebsiteDirty(true);
  }

  function parseTemplateConfig() {
    const raw = websiteForm.templateConfig.trim();
    if (!raw) return {};
    return JSON.parse(raw);
  }

  async function saveWebsiteConfig() {
    if (!websiteConfigKey) {
      showToast("请先选择已保存活动", "error");
      return;
    }
    try {
      const templateConfig = parseTemplateConfig();
      const status = websiteForm.webStatus;
      const powEnabled = !!(
        websiteTarget?.enablePowLeaderboard ||
        websiteTarget?.nacosPayload?.enablePowLeaderboard
      );
      const essayEnabled = !!(
        websiteTarget?.enableEssayContest ||
        websiteTarget?.nacosPayload?.enableEssayContest
      );
      if (status === "claim") {
        if (!websiteForm.claimPoiContractAddress.trim())
          throw new Error("claim 状态下必须填写 POI 合约地址");
        if (powEnabled && !websiteForm.claimPowContractAddress.trim())
          throw new Error(
            "当前活动已开启 POW，claim 状态下必须填写 POW 合约地址",
          );
        if (essayEnabled && !websiteForm.claimEssayContractAddress.trim())
          throw new Error(
            "当前活动已开启征文大赛，claim 状态下必须填写征文大赛合约地址",
          );
      }
      await saveWebsiteCampaignConfig(String(websiteConfigKey), {
        slug: websiteForm.slug.trim(),
        webStatus: websiteForm.webStatus,
        webAnnouncementZh: websiteForm.webAnnouncementZh,
        webAnnouncementEn: websiteForm.webAnnouncementEn,
        webRewardTextZh: websiteForm.webRewardTextZh,
        webRewardTextEn: websiteForm.webRewardTextEn,
        webNoteZh: websiteForm.webNoteZh,
        webNoteEn: websiteForm.webNoteEn,
        claimPoiContractAddress: websiteForm.claimPoiContractAddress,
        claimPowContractAddress: websiteForm.claimPowContractAddress,
        claimEssayContractAddress: websiteForm.claimEssayContractAddress,
        pageTemplate: websiteForm.pageTemplate.trim() || "standard",
        templateConfig,
        websiteExtra: {
          listAssets: {
            leftLogo: websiteForm.listLeftLogo.trim(),
            rightLogo: websiteForm.listRightLogo.trim(),
            chestImage: websiteForm.listChestImage.trim(),
          },
        },
      });
      const record = await fetchWebsiteCampaignByNacosId(
        String(websiteConfigKey),
      );
      if (record.data) {
        setWebsiteRecords((prev) => {
          const next = [...prev];
          const idx = next.findIndex(
            (item) =>
              String(item.nacosCampaignId || item.id) ===
              String(
                (record.data as AnyObj).nacosCampaignId ||
                  (record.data as AnyObj).id,
              ),
          );
          if (idx >= 0) next[idx] = record.data as WebsiteCampaignRecord;
          else next.push(record.data as WebsiteCampaignRecord);
          return next;
        });
        setWebsiteForm(makeWebsiteForm(record.data as AnyObj, websiteTarget));
      }
      setWebsiteDirty(false);
      showToast("网站配置保存成功", "success");
    } catch (error) {
      showToast(
        `保存网站配置失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    }
  }

  function setListCollapsedAndStore(value: boolean) {
    setListCollapsed(value);
    localStorage.setItem("nacos-campaigns-list-collapsed", value ? "1" : "0");
  }

  function addArrayItem(
    kind:
      | "logos"
      | "tasks"
      | "essayContestWinners"
      | "writingThemes"
      | "tags"
      | "customLeaderboards",
  ) {
    updateSelectedCampaign((c) => {
      c[kind] = Array.isArray(c[kind]) ? c[kind] : [];
      if (kind === "logos")
        c[kind].push({
          image: "",
          url: "",
          label: "",
          ringClassName: DEFAULT_RING,
        });
      if (kind === "tasks")
        c[kind].push({
          id: "",
          title: { zh: "", en: "" },
          url: "",
          type: "twitter",
          autoComplete: false,
        });
      if (kind === "essayContestWinners")
        c[kind].push({ name: "", handler: "", avatar: "", reward: "" });
      if (kind === "writingThemes") c[kind].push({ zh: "", en: "" });
      if (kind === "customLeaderboards")
        c[kind].push({
          name: { zh: "", en: "" },
          amount: undefined,
          participantCount: undefined,
          distributionType: "equal",
          unit: "USDT",
        });
      if (kind === "tags")
        c[kind].push({
          colorScheme: "blue",
          icon: "Tag",
          label: "",
          label_en: "",
          hoverTips: "",
          hoverTips_en: "",
        });
    });
  }

  function updateArrayItem(
    kind: string,
    index: number,
    path: string,
    value: any,
  ) {
    updateSelectedCampaign((c) => {
      const arr = Array.isArray(c[kind]) ? c[kind] : [];
      if (!arr[index]) return;
      if (kind === "tasks" && path === "type" && value === "custom") {
        arr[index].url = "https://";
        arr[index].autoComplete = false;
      }
      if (path.includes(".")) setByPath(arr[index], path, value);
      else arr[index][path] = value;
      if (kind === "tasks" && ["type", "url"].includes(path)) {
        const task = arr[index];
        task.id = generateTaskId(
          c.campaignKey || "",
          task.type || "",
          task.type === "custom" ? "https://" : task.url || "",
        );
      }
      if (kind === "tags" && (!arr[index].colorScheme || !arr[index].icon)) {
        arr[index].colorScheme ||= "blue";
        arr[index].icon ||= "Tag";
      }
    });
  }

  function moveArrayItem(kind: string, index: number, delta: number) {
    updateSelectedCampaign((c) => {
      const arr = Array.isArray(c[kind]) ? c[kind] : [];
      const to = index + delta;
      if (index < 0 || to < 0 || index >= arr.length || to >= arr.length)
        return;
      const item = arr.splice(index, 1)[0];
      arr.splice(to, 0, item);
    });
  }

  function removeArrayItem(kind: string, index: number) {
    updateSelectedCampaign((c) => {
      const arr = Array.isArray(c[kind]) ? c[kind] : [];
      if (kind === "writingThemes" && arr.length <= 1) return;
      arr.splice(index, 1);
      if (kind === "tags" && arr.length === 0) delete c.tags;
    });
  }

  const c = selectedCampaign;
  const websiteOnlyMode = selection?.type === "website_only";
  const websiteControlsEnabled = !!websiteConfigKey;
  const claimVisible = websiteForm.webStatus === "claim";
  const powEnabled = !!(
    websiteTarget?.enablePowLeaderboard ||
    websiteTarget?.nacosPayload?.enablePowLeaderboard
  );
  const essayEnabled = !!(
    websiteTarget?.enableEssayContest ||
    websiteTarget?.nacosPayload?.enableEssayContest
  );

  return (
    <PermissionGuard permission="nacos_config">
      <ConfigWorkbench
        id="nacos-campaigns"
        className="campaigns-container campaigns-react-page"
        title="Xhunt Earn 活动配置"
        collapsed={listCollapsed}
        toolbar={
          <>
            <div className="left">
              <div className="campaigns-search">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <Input
                  variant="borderless"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索活动..."
                />
              </div>
            </div>
            <div className="right">
              <Button
                className="config-action config-action-secondary"
                onClick={() => void loadFromDatabase()}
                loading={loading}
              >
                刷新
              </Button>
              <Button
                className="config-action config-action-primary"
                onClick={openNewCampaignModal}
              >
                新增
              </Button>
              <Button
                className="config-action config-action-secondary"
                disabled={!editorEnabled}
                onClick={duplicateCampaign}
              >
                复制
              </Button>
              <Button
                className="config-action config-action-danger"
                danger
                disabled={!editorEnabled}
                onClick={() => void deleteCampaign()}
              >
                删除
              </Button>
              <Button
                className="config-action config-action-primary"
                disabled={!editorEnabled && !dirty}
                onClick={showPublishPreview}
              >
                发布
              </Button>
              <Button
                className="config-action config-action-secondary"
                onClick={() => void refreshWebsiteRecords()}
              >
                从数据库刷新
              </Button>
            </div>
          </>
        }
        sidebarTitle={
          <>
            <Button
              htmlType="button"
              className="config-workbench-collapse-button list-toggle"
              title={listCollapsed ? "展开列表" : "收起列表"}
              aria-label={listCollapsed ? "展开列表" : "收起列表"}
              onClick={() => setListCollapsedAndStore(!listCollapsed)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Button>
            <span>活动列表</span>
          </>
        }
        sidebarMeta={listData.nacosItems.length + listData.websiteOnly.length}
        sidebar={
          <div className="list-items">
            <ListGroup
              emptyText="暂无活动"
              items={listData.nacosItems.map(({ c: item, idx }) => ({
                key: `nacos-${idx}`,
                active: selection?.type === "nacos" && selection.index === idx,
                onClick: () => selectCampaign(idx),
                title:
                  item.displayName?.zh ||
                  item.displayName?.en ||
                  item.copy?.title?.zh ||
                  item.id ||
                  "(未命名)",
                meta: item.id || item.campaignKey || "-",
                chips: [
                  item.enabled ? "展示" : "隐藏",
                  item.testingPhase ? "testing" : "",
                  Number(item.sortWeight) ? `权重 ${item.sortWeight}` : "",
                ].filter(Boolean),
                logos: Array.isArray(item.logos) ? item.logos : [],
              }))}
            />
            <ListGroup
              emptyText="暂无网页独有数据"
              items={listData.websiteOnly.map((item: AnyObj) => ({
                key: `web-${item.nacosCampaignId}`,
                active:
                  selection?.type === "website_only" &&
                  selection.id === String(item.nacosCampaignId),
                onClick: () => selectWebsiteOnly(String(item.nacosCampaignId)),
                title:
                  item.displayNameZh ||
                  item.displayNameEn ||
                  item.campaignKey ||
                  item.slug ||
                  item.nacosCampaignId ||
                  "(未命名)",
                meta: item.nacosCampaignId || "-",
                chips: [item.webStatus || "draft", "website-only"].filter(
                  Boolean,
                ),
                logos: [],
              }))}
            />
          </div>
        }
        editorTitle="编辑活动"
        editorMeta={
          c
            ? `正在编辑：${c.id || "(未设置 id)"}`
            : websiteOnlyMode
              ? `正在编辑网页独有数据：${selectedWebsiteRecord?.campaignKey || selectedWebsiteRecord?.slug || selectedWebsiteRecord?.nacosCampaignId || ""}`
              : "选择左侧活动开始编辑"
        }
      >
        {!c && !websiteOnlyMode ? (
          <div className="editor-empty">
            <div className="empty-title">请选择一个活动</div>
            <div className="empty-desc">
              从左侧列表选择活动进行编辑，或点击「新增」创建活动
            </div>
          </div>
        ) : (
          <div id="campaigns-editor-body">
            {websiteOnlyMode ? (
              <div
                className="field-row field-row-1"
                style={{ marginBottom: 12 }}
              >
                <div className="field">
                  <div
                    className="muted"
                    style={{
                      padding: "10px 12px",
                      border: "1px dashed #f59e0b",
                      borderRadius: 10,
                      background: "#fffbeb",
                      color: "#92400e",
                      lineHeight: 1.6,
                    }}
                  >
                    ℹ️ 当前正在编辑“网页独有数据 /
                    插件已下架数据”。这类活动已从主活动配置中移除，
                    所以只支持网站数据库配置，不展示活动主配置部分。
                  </div>
                </div>
              </div>
            ) : null}
            {c ? (
              <CampaignEditor
                c={c}
                canEditCampaignId={canEditCampaignId}
                setCampaignPath={setCampaignPath}
                updateSelectedCampaign={updateSelectedCampaign}
                changeThreshold={changeThreshold}
                thresholdValue={thresholdValue(c)}
                changeRiskConfirm={changeRiskConfirm}
                addArrayItem={addArrayItem}
                updateArrayItem={updateArrayItem}
                moveArrayItem={moveArrayItem}
                removeArrayItem={removeArrayItem}
              />
            ) : null}
            <WebsiteSection
              form={websiteForm}
              update={updateWebsiteForm}
              enabled={websiteControlsEnabled}
              meta={websiteMeta}
              claimVisible={claimVisible}
              powEnabled={powEnabled}
              essayEnabled={essayEnabled}
              onSave={() => void saveWebsiteConfig()}
            />
          </div>
        )}
      </ConfigWorkbench>

      {toast ? (
        <div
          className="campaigns-toast"
          style={{
            background:
              toast.type === "error"
                ? "#991b1b"
                : toast.type === "success"
                  ? "#065f46"
                  : "#111827",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <Modal
        open={newCampaignOpen}
        title="新增活动"
        okText="创建"
        cancelText="取消"
        onCancel={() => setNewCampaignOpen(false)}
        onOk={confirmNewCampaign}
        okButtonProps={{
          disabled: newCampaignMode === "copy" && newCampaignSourceIndex == null,
        }}
      >
        <div className="field-row field-row-1">
          <Field label="创建方式">
            <Segmented
              value={newCampaignMode}
              onChange={(value) => {
                const mode = String(value) as "blank" | "copy";
                setNewCampaignMode(mode);
                if (mode === "copy" && newCampaignSourceIndex == null) {
                  setNewCampaignSourceIndex(config.campaigns.length ? 0 : null);
                }
              }}
              options={[
                { value: "blank", label: "完全新建" },
                {
                  value: "copy",
                  label: "从活动复制",
                  disabled: !config.campaigns.length,
                },
              ]}
            />
          </Field>
        </div>
        {newCampaignMode === "copy" ? (
          <div className="field-row field-row-1">
            <Field
              label="选择模板活动"
              hint="会复制活动内容，但清空活动ID，并默认关闭展示。"
            >
              <Select
                value={newCampaignSourceIndex ?? undefined}
                onChange={(value) => setNewCampaignSourceIndex(Number(value))}
                placeholder="请选择要复制的活动"
                options={config.campaigns.map((item, index) => ({
                  value: index,
                  label:
                    item.displayName?.zh ||
                    item.displayName?.en ||
                    item.campaignKey ||
                    item.id ||
                    `活动 #${index + 1}`,
                }))}
              />
            </Field>
          </div>
        ) : (
          <div className="muted" style={{ lineHeight: 1.6 }}>
            将创建一条空白活动，带默认任务、Logo 和基础文案。
          </div>
        )}
      </Modal>

      <Modal
        open={jsonPreviewOpen}
        title="预览 JSON 配置"
        width="90%"
        style={{ maxWidth: 1400 }}
        onCancel={() => setJsonPreviewOpen(false)}
        footer={
          <>
            <Button onClick={() => setJsonPreviewOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={publishing}
              onClick={() => void confirmPublish()}
            >
              确认发布
            </Button>
          </>
        }
      >
        <div
          className="json-preview-modal-body"
          style={{ padding: 0, maxHeight: "70vh" }}
        >
          <p className="json-preview-legend">
            即将保存到数据库
            <span style={{ marginLeft: 8, color: "#3b82f6", fontWeight: 600 }}>
              {jsonDiffHint}
            </span>{" "}
            <span className="legend-removed">删除</span> |{" "}
            <span className="legend-added">新增</span>
          </p>
          <pre dangerouslySetInnerHTML={{ __html: jsonPreviewHtml }} />
        </div>
      </Modal>
    </PermissionGuard>
  );
}

function ListGroup({
  emptyText,
  items,
}: {
  emptyText: string;
  items: Array<{
    key: string;
    active: boolean;
    onClick: () => void;
    title: string;
    meta: string;
    chips: string[];
    logos: AnyObj[];
  }>;
}) {
  return (
    <div className="list-group">
      {items.length ? (
        items.map((item) => (
          <div
            key={item.key}
            className={`item ${item.active ? "active" : ""}`}
            onClick={item.onClick}
          >
            <div className="item-content">
              <div className="item-logos">
                {item.logos
                  .slice(0, 3)
                  .map((logo, i) =>
                    logo?.image ? (
                      <img
                        key={i}
                        className="item-logo"
                        src={logo.image}
                        alt=""
                        onError={(e) => e.currentTarget.classList.add("error")}
                      />
                    ) : null,
                  )}
              </div>
              <div className="item-title-wrapper">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="item-title">
                    <span className="item-title-text">{item.title}</span>
                  </div>
                  <div className="item-meta">{item.meta}</div>
                  <div className="chips">
                    {item.chips.map((chip) => (
                      <span
                        key={chip}
                        className={`chip ${chip === "展示" ? "on" : chip === "testing" ? "testing" : chip.startsWith("权重") ? "chip-weight" : ""}`}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="list-group-empty">{emptyText}</div>
      )}
    </div>
  );
}

function CampaignEditor(props: {
  c: AnyObj;
  canEditCampaignId: boolean;
  setCampaignPath: (path: string, value: any) => void;
  updateSelectedCampaign: (fn: (c: AnyObj) => void) => void;
  changeThreshold: (value: string) => void;
  thresholdValue: string;
  changeRiskConfirm: (checked: boolean) => void;
  addArrayItem: (kind: any) => void;
  updateArrayItem: (
    kind: string,
    index: number,
    path: string,
    value: any,
  ) => void;
  moveArrayItem: (kind: string, index: number, delta: number) => void;
  removeArrayItem: (kind: string, index: number) => void;
}) {
  const {
    c,
    canEditCampaignId,
    setCampaignPath,
    updateSelectedCampaign,
    changeThreshold,
    thresholdValue,
    changeRiskConfirm,
    addArrayItem,
    updateArrayItem,
    moveArrayItem,
    removeArrayItem,
  } = props;
  const saved = !!c.id?.trim();
  const campaignIdDisabled = saved && !canEditCampaignId;
  const switchLabel = (
    text: React.ReactNode,
    checked: boolean,
    onChange: (checked: boolean) => void,
    primary = false,
  ) => (
    <>
      <label
        className={`switch-label ${primary ? "switch-label-primary" : ""}`}
      >
        {text}
      </label>
      <Switch checked={checked} onChange={onChange} />
    </>
  );
  return (
    <>
      <div className="campaign-status-control">
        <div className="status-control-primary">
          {switchLabel(
            "展示活动",
            !!c.enabled,
            (v) => setCampaignPath("enabled", v),
            true,
          )}
        </div>
        <div className="status-control-secondary">
          {switchLabel("测试模式（仅内部可见）", !!c.testingPhase, (v) =>
            setCampaignPath("testingPhase", v),
          )}
        </div>
      </div>
      <div className="field-row field-row-basic">
        <Field
          label="活动ID"
          hint={
            campaignIdDisabled
              ? "已保存活动仅超级管理员可修改 ID"
              : "例如：mantle3,bybit2，可找技术确认"
          }
        >
          <Input
            value={c.campaignKey || ""}
            disabled={campaignIdDisabled}
            onChange={(e) => setCampaignPath("campaignKey", e.target.value)}
            placeholder="例如：mantle"
          />
        </Field>
        <Field label="排序权重" hint="0-10000，数值越大越靠前">
          <InputNumber
            min={0}
            max={10000}
            step={1}
            value={Number(c.sortWeight) || 0}
            onChange={(v) =>
              setCampaignPath(
                "sortWeight",
                Math.min(10000, Math.max(0, Number(v) || 0)),
              )
            }
          />
        </Field>
      </div>
      <div className="campaign-options">
        <div className="option-item">
          <label className="switch-label">
            <span>早期项目风险提示</span>
            <span
              className="risk-preview-trigger"
              title="中文预览：重要提示：该项目为 Early-stage 项目，信息由项目方提供，请在参与前自行判断。"
            >
              ℹ️
            </span>
          </label>
          <Switch checked={!!c.riskConfirmHtml} onChange={changeRiskConfirm} />
          <div className="field-hint">在活动页面显示早期项目风险提示</div>
        </div>
        <div className="option-item">
          <label className="switch-label">显示付费推广政策</label>
          <Switch
            checked={c.showSponsoredPolicy === true}
            onChange={(v) => setCampaignPath("showSponsoredPolicy", v)}
          />
          <div className="field-hint">
            在报名按钮上方显示「付费推广政策」提示
          </div>
        </div>
        <div className="option-item">
          <label className="switch-label">允许 Email 注册</label>
          <Switch
            checked={c.allowEmailRegistration === true}
            onChange={(v) => setCampaignPath("allowEmailRegistration", v)}
          />
          <div className="field-hint">开启后活动允许用户通过 Email 注册</div>
        </div>
      </div>
      <Section title="活动信息">
        <div className="field-row field-row-2">
          <Field label="标题（中文）">
            <Input
              value={c.displayName?.zh || ""}
              onChange={(e) =>
                setCampaignPath("displayName.zh", e.target.value)
              }
            />
          </Field>
          <Field label="标题（English）">
            <Input
              value={c.displayName?.en || ""}
              onChange={(e) =>
                setCampaignPath("displayName.en", e.target.value)
              }
            />
          </Field>
        </div>
        <div className="field-row field-row-2">
          <Field label="短标题（中文）">
            <Input
              value={c.copy?.shortTitle?.zh || ""}
              onChange={(e) =>
                setCampaignPath("copy.shortTitle.zh", e.target.value)
              }
            />
          </Field>
          <Field label="短标题（English）">
            <Input
              value={c.copy?.shortTitle?.en || ""}
              onChange={(e) =>
                setCampaignPath("copy.shortTitle.en", e.target.value)
              }
            />
          </Field>
        </div>
        <div className="section-block">
          <div className="field-row field-row-2">
            <Field label="项目介绍（中文）">
              <TextArea
                rows={2}
                value={c.projectIntroduction?.zh || ""}
                onChange={(e) =>
                  setCampaignPath("projectIntroduction.zh", e.target.value)
                }
                placeholder="纯文本介绍..."
              />
            </Field>
            <Field label="项目介绍（English）">
              <TextArea
                rows={2}
                value={c.projectIntroduction?.en || ""}
                onChange={(e) =>
                  setCampaignPath("projectIntroduction.en", e.target.value)
                }
                placeholder="Plain text introduction..."
              />
            </Field>
          </div>
        </div>
        <RepeaterHeader
          title="写作主题"
          onAdd={() => addArrayItem("writingThemes")}
        />
        <WritingThemes
          items={c.writingThemes || []}
          update={updateArrayItem}
          move={moveArrayItem}
          remove={removeArrayItem}
        />
      </Section>
      <Section title="时间、奖励与门槛">
        <div className="section-sub">
          <div className="section-title-sm">⏰ 活动时间</div>
          <div className="field-row field-row-2">
            <Field label="开始时间">
              <Input
                type="datetime-local"
                value={toDatetimeLocal(c.enrollmentWindow?.startAt)}
                onChange={(e) =>
                  setCampaignPath(
                    "enrollmentWindow.startAt",
                    fromDatetimeLocalToIsoZ(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="结束时间">
              <Input
                type="datetime-local"
                value={toDatetimeLocal(c.enrollmentWindow?.endAt)}
                onChange={(e) =>
                  setCampaignPath(
                    "enrollmentWindow.endAt",
                    fromDatetimeLocalToIsoZ(e.target.value),
                  )
                }
              />
            </Field>
          </div>
        </div>
        <div className="section-sub">
          <div className="field-row field-row-1">
            <Field
              label="活动模式"
              hint="该字段决定下方展示哪套榜单配置；下方 Tab 只跟随这里，不支持手动切换。"
            >
              <Segmented
                value={c.leaderboardMode || "traditional"}
                onChange={(value) =>
                  setCampaignPath("leaderboardMode", String(value))
                }
                options={[
                  { value: "traditional", label: "传统模式" },
                  { value: "custom", label: "自定义模式" },
                ]}
              />
            </Field>
          </div>
          <Tabs
            activeKey={c.leaderboardMode || "traditional"}
            onChange={() => undefined}
            items={[
              {
                key: "traditional",
                label: "传统模式",
                disabled: (c.leaderboardMode || "traditional") !== "traditional",
                children: (
                  <>
                    <div className="section-sub reward-tier reward-tier-primary">
                      <div className="reward-tier-header">
                        <span className="reward-tier-title">🎯 POI 基础奖励</span>
                        <span className="reward-tier-badge">核心</span>
                      </div>
                      <div className="field-row field-row-3">
                        <Field label="奖励金额">
                          <InputNumber
                            min={1}
                            max={99999999}
                            value={c.rewardAmount}
                            onChange={(v) => setCampaignPath("rewardAmount", v)}
                            placeholder="1-99999999"
                          />
                        </Field>
                        <Field label="人数">
                          <InputNumber
                            min={10}
                            max={1000}
                            value={c.rewardParticipantCount}
                            onChange={(v) =>
                              setCampaignPath("rewardParticipantCount", v)
                            }
                            placeholder="10-1000"
                          />
                        </Field>
                        <Field label="分配机制">
                          <Select
                            value={c.rewardDistributionType || ""}
                            onChange={(v) =>
                              setCampaignPath("rewardDistributionType", v)
                            }
                            options={[
                              { value: "", label: "请选择" },
                              { value: "equal", label: "平分" },
                              { value: "mindshare", label: "mindshare" },
                              { value: "workshare", label: "workshare" },
                            ]}
                          />
                        </Field>
                      </div>
                      <div className="field-row field-row-2">
                        <Field label="奖励单位">
                          <Input
                            value={c.rewardUnit || ""}
                            onChange={(e) =>
                              setCampaignPath("rewardUnit", e.target.value)
                            }
                            placeholder="USDT"
                          />
                        </Field>
                      </div>
                    </div>
                    <RewardOptional
                      c={c}
                      type="pow"
                      enabled={!!c.enablePowLeaderboard}
                      setCampaignPath={setCampaignPath}
                      updateSelectedCampaign={updateSelectedCampaign}
                    />
                    <RewardOptional
                      c={c}
                      type="essay"
                      enabled={!!c.enableEssayContest}
                      setCampaignPath={setCampaignPath}
                      updateSelectedCampaign={updateSelectedCampaign}
                      addWinner={() => addArrayItem("essayContestWinners")}
                      update={updateArrayItem}
                      move={moveArrayItem}
                      remove={removeArrayItem}
                    />
                  </>
                ),
              },
              {
                key: "custom",
                label: "自定义模式",
                disabled: (c.leaderboardMode || "traditional") !== "custom",
                children: (
                  <CustomLeaderboards
                    apiUrl={c.leaderboardApiUrl || ""}
                    items={c.customLeaderboards || []}
                    setCampaignPath={setCampaignPath}
                    add={() => addArrayItem("customLeaderboards")}
                    update={updateArrayItem}
                    move={moveArrayItem}
                    remove={removeArrayItem}
                  />
                ),
              },
            ]}
          />
        </div>
        <div className="section-sub">
          <div className="section-title-sm">🚪 报名门槛</div>
          <div className="field-row">
            <Field>
              <Select
                value={thresholdValue}
                onChange={changeThreshold}
                options={[
                  { value: "", label: "请选择" },
                  { value: "50k", label: "50k" },
                  { value: "100k", label: "100k" },
                  { value: "200k", label: "200k" },
                  { value: "200k+creator", label: "200k+creator" },
                ]}
              />
              <div className="muted" style={{ marginTop: 3, fontSize: 11 }}>
                硬性条件：注册早于1个月且分数≥50
              </div>
            </Field>
          </div>
        </div>
      </Section>
      <Section title="链接 · 名单 · 报名文案">
        <div className="section-sub">
          <div className="section-title-sm">相关链接</div>
          <div className="field-row field-row-2">
            <Field label="A.推特活动指南链接">
              <Input
                value={c.links?.guideUrl || ""}
                onChange={(e) =>
                  setCampaignPath("links.guideUrl", e.target.value)
                }
                placeholder="https://..."
              />
            </Field>
            <Field label="B.官网活动页面链接">
              <Input
                value={c.links?.activeUrl || ""}
                onChange={(e) =>
                  setCampaignPath("links.activeUrl", e.target.value)
                }
                placeholder="https://..."
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="插件榜单底部显示「查看官方排行榜」（跳转到 B.官网活动页面链接）">
              <Switch
                checked={!!c.links?.showLeaderboardLink}
                onChange={(v) =>
                  setCampaignPath("links.showLeaderboardLink", v)
                }
              />
            </Field>
          </div>
        </div>
        <div className="section-sub">
          <div className="section-title-sm">相关名单（每行一个）</div>
          <div className="field-row field-row-2">
            <Field label="内部测试人员（测试阶段可见的人）">
              <TextArea
                rows={2}
                value={listToLines(c.testList)}
                onChange={(e) =>
                  setCampaignPath("testList", splitLinesToList(e.target.value))
                }
                placeholder="luoyukun4"
              />
            </Field>
            <Field label="‼️在插件里面哪些推特号右侧展示本活动">
              <TextArea
                rows={2}
                value={listToLines(c.targetUserIds)}
                onChange={(e) =>
                  setCampaignPath(
                    "targetUserIds",
                    splitLinesToList(e.target.value),
                  )
                }
                placeholder={"bybit_web3\nBybit__Alpha"}
              />
            </Field>
          </div>
        </div>
        <CollapsibleSection title="报名按钮文案（通常不改)">
          <div className="field-row field-row-3">
            <Field label="emoji">
              <Input
                value={c.copy?.emoji || ""}
                onChange={(e) => setCampaignPath("copy.emoji", e.target.value)}
              />
            </Field>
            <Field label="ctaText（zh）">
              <Input
                value={c.copy?.ctaText?.zh || ""}
                onChange={(e) =>
                  setCampaignPath("copy.ctaText.zh", e.target.value)
                }
              />
            </Field>
            <Field label="ctaText（en）">
              <Input
                value={c.copy?.ctaText?.en || ""}
                onChange={(e) =>
                  setCampaignPath("copy.ctaText.en", e.target.value)
                }
              />
            </Field>
          </div>
          <div className="field-row field-row-2">
            <Field label="去官方（zh/en）">
              <Input
                value={c.copy?.goToOfficialText?.zh || ""}
                onChange={(e) =>
                  setCampaignPath("copy.goToOfficialText.zh", e.target.value)
                }
                placeholder="zh"
                style={{ marginBottom: 4 }}
              />
              <Input
                value={c.copy?.goToOfficialText?.en || ""}
                onChange={(e) =>
                  setCampaignPath("copy.goToOfficialText.en", e.target.value)
                }
                placeholder="en"
              />
            </Field>
            <Field label="查看指南（zh/en）">
              <Input
                value={c.copy?.viewGuideText?.zh || ""}
                onChange={(e) =>
                  setCampaignPath("copy.viewGuideText.zh", e.target.value)
                }
                placeholder="zh"
                style={{ marginBottom: 4 }}
              />
              <Input
                value={c.copy?.viewGuideText?.en || ""}
                onChange={(e) =>
                  setCampaignPath("copy.viewGuideText.en", e.target.value)
                }
                placeholder="en"
              />
            </Field>
          </div>
        </CollapsibleSection>
      </Section>
      <Section title="Logo · 任务 · Tags">
        <div className="section-sub">
          <RepeaterHeader
            title="活动方 logo"
            onAdd={() => addArrayItem("logos")}
          />
          <Logos
            items={c.logos || []}
            update={updateArrayItem}
            move={moveArrayItem}
            remove={removeArrayItem}
          />
        </div>
        <div className="section-sub">
          <RepeaterHeader
            title="报名前需完成的任务"
            onAdd={() => addArrayItem("tasks")}
          />
          <Tasks
            items={c.tasks || []}
            update={updateArrayItem}
            move={moveArrayItem}
            remove={removeArrayItem}
          />
        </div>
        <div className="section-sub">
          <RepeaterHeader
            title="活动 Tags（可选）"
            onAdd={() => addArrayItem("tags")}
          />
          <div className="tag-notice">
            <span className="tag-notice-icon">ℹ️</span>
            <span className="tag-notice-text">
              如果配置了自定义
              Tag，前端本身会自动生成的【按贡献】【征文大赛】【TOP200】都将被替换
            </span>
          </div>
          <Tags
            items={c.tags || []}
            update={updateArrayItem}
            move={moveArrayItem}
            remove={removeArrayItem}
          />
        </div>
      </Section>
      <CollapsibleSection title="高级配置（id / campaignKey / hotTweetsKey）">
        <div className="field-row">
          <Field
            label="id（唯一）"
            hint="内部索引使用，无需手动维护（自动生成：campaignKey + '-hunter'）"
          >
            <Input value={c.id || ""} disabled />
          </Field>
          <Field
            label="campaignKey"
            hint="需要后端协商一致，一般也是投放者推特号，用于存储报名数据和排名数据"
          >
            <Input value={c.campaignKey || ""} disabled />
          </Field>
          <Field
            label="hotTweetsKey"
            hint="建议填写投放者的推特号，目的是获取热门推文数据 hot?project=hotTweetsKey"
          >
            <Input value={c.hotTweetsKey || ""} disabled />
          </Field>
        </div>
      </CollapsibleSection>
    </>
  );
}

function RepeaterHeader({
  title,
  onAdd,
}: {
  title: React.ReactNode;
  onAdd: () => void;
}) {
  return (
    <div className="section-title-inline">
      <span>{title}</span>
      <Button size="small" onClick={onAdd}>
        +添加
      </Button>
    </div>
  );
}
function RepActions({
  onUp,
  onDown,
  onRemove,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rep-actions">
      <Button size="small" onClick={onUp}>
        ←
      </Button>
      <Button size="small" onClick={onDown}>
        →
      </Button>
      <Button size="small" danger onClick={onRemove}>
        删除
      </Button>
    </div>
  );
}
function Logos({ items, update, move, remove }: any) {
  return (
    <div className="repeaters">
      {items.length ? (
        items.map((it: AnyObj, i: number) => (
          <div className="rep-card" key={i}>
            <div className="rep-header">
              <div className="rep-title">#{i + 1} Logo</div>
              <RepActions
                onUp={() => move("logos", i, -1)}
                onDown={() => move("logos", i, 1)}
                onRemove={() => remove("logos", i)}
              />
            </div>
            <div className="field-row">
              <Field label="图片（必填）">
                <Input
                  value={it.image || ""}
                  onChange={(e) => update("logos", i, "image", e.target.value)}
                />
              </Field>
              <Field label="推特链接（必填）">
                <Input
                  value={it.url || ""}
                  onChange={(e) => update("logos", i, "url", e.target.value)}
                />
              </Field>
              <Field label="推特账号（必填）">
                <Input
                  value={it.label || ""}
                  onChange={(e) => update("logos", i, "label", e.target.value)}
                />
              </Field>
            </div>
          </div>
        ))
      ) : (
        <div className="muted campaigns-react-empty-inline">
          暂无 logos，可点击上方“添加 Logo”。
        </div>
      )}
    </div>
  );
}
function WritingThemes({ items, update, move, remove }: any) {
  return (
    <div className="repeaters-horizontal">
      {items.map((it: AnyObj, i: number) => (
        <div className="rep-card" key={i}>
          <div className="rep-header">
            <div className="rep-title">主题 #{i + 1}</div>
            <RepActions
              onUp={() => move("writingThemes", i, -1)}
              onDown={() => move("writingThemes", i, 1)}
              onRemove={() => remove("writingThemes", i)}
            />
          </div>
          <div className="field-row field-row-2">
            <Field label="主题内容（中文）">
              <TextArea
                rows={3}
                value={it.zh || ""}
                onChange={(e) =>
                  update("writingThemes", i, "zh", e.target.value)
                }
                placeholder="输入本活动的写作主题描述..."
              />
            </Field>
            <Field label="主题内容（English）">
              <TextArea
                rows={3}
                value={it.en || ""}
                onChange={(e) =>
                  update("writingThemes", i, "en", e.target.value)
                }
                placeholder="Writing theme description..."
              />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}
function Tasks({ items, update, move, remove }: any) {
  return (
    <div className="repeaters">
      {items.length ? (
        items.map((it: AnyObj, i: number) => {
          const isCustom = (it.type || "twitter") === "custom";
          return (
            <div className="rep-card task-card" key={i}>
              <div className="rep-header">
                <div className="rep-title">#{i + 1} Task</div>
                <RepActions
                  onUp={() => move("tasks", i, -1)}
                  onDown={() => move("tasks", i, 1)}
                  onRemove={() => remove("tasks", i)}
                />
              </div>
              <div className="task-grid">
                <div className="task-field task-field-id">
                  <label>
                    ID <span className="task-label-note">自动生成</span>
                  </label>
                  <Input
                    value={it.id || ""}
                    disabled
                    className="task-input-id"
                  />
                </div>
                <div className="task-field task-field-type">
                  <label>Type</label>
                  <Select
                    value={it.type || "twitter"}
                    onChange={(v) => update("tasks", i, "type", v)}
                    options={["twitter", "telegram", "other", "custom"].map(
                      (v) => ({
                        value: v,
                        label: v === "custom" ? "backend-custom" : v,
                      }),
                    )}
                  />
                </div>
                <div
                  className={`task-field task-field-autocomplete ${isCustom ? "is-disabled" : ""}`}
                >
                  <label>Auto Complete</label>
                  <div className="task-autocomplete-wrapper">
                    <Switch
                      disabled={isCustom}
                      checked={!isCustom && !!it.autoComplete}
                      onChange={(v) => update("tasks", i, "autoComplete", v)}
                    />
                    <span className="task-autocomplete-hint">
                      点击链接即完成任务
                    </span>
                  </div>
                </div>
                <div className="task-field task-field-title">
                  <label>任务标题（中文）</label>
                  <Input
                    value={it.title?.zh || ""}
                    onChange={(e) =>
                      update("tasks", i, "title.zh", e.target.value)
                    }
                    placeholder="输入中文标题..."
                  />
                </div>
                <div className="task-field task-field-title">
                  <label>任务标题（English）</label>
                  <Input
                    value={it.title?.en || ""}
                    onChange={(e) =>
                      update("tasks", i, "title.en", e.target.value)
                    }
                    placeholder="Enter English title..."
                  />
                </div>
                <div className="task-field task-field-url">
                  <label>跳转链接</label>
                  <Input
                    value={isCustom ? "https://" : it.url || ""}
                    readOnly={isCustom}
                    onChange={(e) => update("tasks", i, "url", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="muted campaigns-react-empty-inline">
          暂无 tasks，可点击上方“添加 Task”。
        </div>
      )}
    </div>
  );
}
function Winners({ items, update, move, remove }: any) {
  return (
    <div className="repeaters">
      {items.length ? (
        items.map((it: AnyObj, i: number) => (
          <div className="rep-card" key={i}>
            <div className="rep-header">
              <div className="rep-title">#{i + 1} 获奖者</div>
              <RepActions
                onUp={() => move("essayContestWinners", i, -1)}
                onDown={() => move("essayContestWinners", i, 1)}
                onRemove={() => remove("essayContestWinners", i)}
              />
            </div>
            <div className="field-row field-row-2">
              <Field label="姓名（name）">
                <Input
                  value={it.name || ""}
                  onChange={(e) =>
                    update("essayContestWinners", i, "name", e.target.value)
                  }
                />
              </Field>
              <Field label="推特账号（handler）">
                <Input
                  value={it.handler || ""}
                  onChange={(e) =>
                    update("essayContestWinners", i, "handler", e.target.value)
                  }
                />
              </Field>
            </div>
            <div className="field-row field-row-2">
              <Field label="头像地址（avatar）">
                <Input
                  value={it.avatar || ""}
                  onChange={(e) =>
                    update("essayContestWinners", i, "avatar", e.target.value)
                  }
                  placeholder="https://..."
                />
              </Field>
              <Field label="奖励金额（reward）">
                <Input
                  value={it.reward || ""}
                  onChange={(e) =>
                    update("essayContestWinners", i, "reward", e.target.value)
                  }
                  placeholder="例如：1000"
                />
              </Field>
            </div>
          </div>
        ))
      ) : (
        <div className="muted campaigns-react-empty-inline">
          暂无获奖者，可点击上方“添加获奖者”。
        </div>
      )}
    </div>
  );
}
function Tags({ items, update, move, remove }: any) {
  return (
    <div className="repeaters">
      {items.length ? (
        items.map((it: AnyObj, i: number) => {
          const scheme =
            TAG_COLOR_SCHEMES.find(
              (s) => s.value === (it.colorScheme || "blue"),
            ) || TAG_COLOR_SCHEMES[3];
          return (
            <div className={`rep-card tag-card ${scheme.className}`} key={i}>
              <div className="rep-header">
                <div className="rep-title">Tag #{i + 1}</div>
                <RepActions
                  onUp={() => move("tags", i, -1)}
                  onDown={() => move("tags", i, 1)}
                  onRemove={() => remove("tags", i)}
                />
              </div>
              <div className="tag-preview">
                <span className="tag-preview-badge">
                  <span className="tag-preview-icon">{it.icon || "Tag"}</span>
                  <span className="tag-preview-label">
                    {it.label || "未命名"}
                  </span>
                </span>
              </div>
              <div className="tag-fields">
                <div className="tag-field">
                  <label>颜色系</label>
                  <Select
                    value={it.colorScheme || "blue"}
                    onChange={(v) => update("tags", i, "colorScheme", v)}
                    options={TAG_COLOR_SCHEMES.map(({ value, label }) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
                <div className="tag-field">
                  <label>图标</label>
                  <Select
                    value={it.icon || "Tag"}
                    onChange={(v) => update("tags", i, "icon", v)}
                    options={LUCIDE_ICONS}
                  />
                </div>
                <div className="tag-field tag-field-full">
                  <label>标签文本（中文）</label>
                  <Input
                    value={it.label || ""}
                    onChange={(e) => update("tags", i, "label", e.target.value)}
                  />
                </div>
                <div className="tag-field tag-field-full">
                  <label>标签文本（English）</label>
                  <Input
                    value={it.label_en || ""}
                    onChange={(e) =>
                      update("tags", i, "label_en", e.target.value)
                    }
                  />
                </div>
                <div className="tag-field tag-field-full">
                  <label>Hover 提示（中文，支持 HTML）</label>
                  <TextArea
                    rows={2}
                    value={it.hoverTips || ""}
                    onChange={(e) =>
                      update("tags", i, "hoverTips", e.target.value)
                    }
                  />
                </div>
                <div className="tag-field tag-field-full">
                  <label>Hover 提示（English，支持 HTML）</label>
                  <TextArea
                    rows={2}
                    value={it.hoverTips_en || ""}
                    onChange={(e) =>
                      update("tags", i, "hoverTips_en", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="muted campaigns-react-empty-inline">
          暂无 tags，可点击上方“添加”
        </div>
      )}
    </div>
  );
}
function CustomLeaderboards({
  apiUrl,
  items,
  setCampaignPath,
  add,
  update,
  move,
  remove,
}: any) {
  return (
    <div className="reward-tier-content">
      <div className="field-row field-row-1">
        <Field
          label="榜单接口 URL"
          hint="可填写完整 URL，也可填写 /x/api 这种相对路径；会原样保存到数据库。"
        >
          <Input
            value={apiUrl}
            onChange={(e) => setCampaignPath("leaderboardApiUrl", e.target.value)}
            placeholder="/x/api"
          />
        </Field>
      </div>
      <RepeaterHeader title="自定义榜单" onAdd={add} />
      <div className="repeaters">
        {items.length ? (
          items.map((it: AnyObj, i: number) => (
            <div className="rep-card" key={i}>
              <div className="rep-header">
                <div className="rep-title">榜单 #{i + 1}</div>
                <RepActions
                  onUp={() => move("customLeaderboards", i, -1)}
                  onDown={() => move("customLeaderboards", i, 1)}
                  onRemove={() => remove("customLeaderboards", i)}
                />
              </div>
              <div className="field-row field-row-2">
                <Field label="榜单名字（中文）">
                  <Input
                    value={it.name?.zh || ""}
                    onChange={(e) =>
                      update("customLeaderboards", i, "name.zh", e.target.value)
                    }
                  />
                </Field>
                <Field label="榜单名字（English）">
                  <Input
                    value={it.name?.en || ""}
                    onChange={(e) =>
                      update("customLeaderboards", i, "name.en", e.target.value)
                    }
                  />
                </Field>
              </div>
              <div className="field-row field-row-2">
                <Field label="金额">
                  <InputNumber
                    min={0}
                    value={it.amount}
                    onChange={(v) => update("customLeaderboards", i, "amount", v)}
                  />
                </Field>
                <Field label="人数">
                  <InputNumber
                    min={1}
                    value={it.participantCount}
                    onChange={(v) =>
                      update("customLeaderboards", i, "participantCount", v)
                    }
                  />
                </Field>
                <Field label="分配机制">
                  <Select
                    value={it.distributionType || ""}
                    onChange={(v) =>
                      update("customLeaderboards", i, "distributionType", v)
                    }
                    options={[
                      { value: "", label: "请选择" },
                      { value: "equal", label: "平分" },
                      { value: "mindshare", label: "mindshare" },
                      { value: "workshare", label: "workshare" },
                    ]}
                  />
                </Field>
                <Field label="奖励单位">
                  <Input
                    value={it.unit || ""}
                    onChange={(e) =>
                      update("customLeaderboards", i, "unit", e.target.value)
                    }
                    placeholder="USDT"
                  />
                </Field>
              </div>
            </div>
          ))
        ) : (
          <div className="muted campaigns-react-empty-inline">
            暂无自定义榜单，可点击上方“添加”
          </div>
        )}
      </div>
    </div>
  );
}
function RewardOptional({
  c,
  type,
  enabled,
  setCampaignPath,
  updateSelectedCampaign,
  addWinner,
  update,
  move,
  remove,
}: any) {
  const isPow = type === "pow";
  return (
    <div className="section-sub reward-tier reward-tier-optional">
      <div className="reward-tier-header">
        <div className="reward-tier-title-wrapper">
          <span className="reward-tier-title">
            {isPow ? "⛏️ POW 榜单" : "✍️ 征文大赛"}
          </span>
          <span className="reward-tier-desc">
            {isPow ? "按工作量证明排名发奖" : "高质量内容创作奖励"}
          </span>
        </div>
        <div className="field field-inline" style={{ margin: 0 }}>
          <label className="switch-label">开启</label>
          <Switch
            checked={enabled}
            onChange={(v) =>
              updateSelectedCampaign((campaign: AnyObj) => {
                if (isPow) campaign.enablePowLeaderboard = v;
                else campaign.enableEssayContest = v;
              })
            }
          />
        </div>
      </div>
      {enabled ? (
        <div className="reward-tier-content">
          {isPow ? (
            <>
              <div className="field-row field-row-3">
                <Field label="POW奖励金额">
                  <InputNumber
                    min={0}
                    value={c.powAmount}
                    onChange={(v) => setCampaignPath("powAmount", v)}
                  />
                </Field>
                <Field label="POW获奖人数">
                  <InputNumber
                    min={1}
                    value={c.powWinnerCount}
                    onChange={(v) => setCampaignPath("powWinnerCount", v)}
                  />
                </Field>
                <Field label="POW分配机制">
                  <Select
                    value={c.powDistributionType || ""}
                    onChange={(v) => setCampaignPath("powDistributionType", v)}
                    options={[
                      { value: "", label: "请选择" },
                      { value: "equal", label: "平分" },
                      { value: "mindshare", label: "mindshare" },
                      { value: "workshare", label: "workshare" },
                    ]}
                  />
                </Field>
              </div>
              <div className="field-row field-row-2">
                <Field label="POW奖励单位">
                  <Input
                    value={c.powUnit || ""}
                    onChange={(e) => setCampaignPath("powUnit", e.target.value)}
                    placeholder="USDT"
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="field-row field-row-3">
                <Field label="征文大赛金额">
                  <InputNumber
                    min={0}
                    value={c.essayContestAmount}
                    onChange={(v) => setCampaignPath("essayContestAmount", v)}
                  />
                </Field>
                <Field label="获奖人数">
                  <InputNumber
                    min={1}
                    value={c.essayContestWinnerCount}
                    onChange={(v) =>
                      setCampaignPath("essayContestWinnerCount", v)
                    }
                  />
                </Field>
                <Field label="奖励单位（选填）">
                  <Input
                    value={c.essayContestUnit || ""}
                    onChange={(e) =>
                      setCampaignPath("essayContestUnit", e.target.value)
                    }
                    placeholder="USDT"
                  />
                </Field>
              </div>
              <CollapsibleSection
                title={
                  <>
                    <span>征文大赛获奖名单</span>
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        addWinner();
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      +添加
                    </Button>
                  </>
                }
              >
                <Winners
                  items={c.essayContestWinners || []}
                  update={update}
                  move={move}
                  remove={remove}
                />
              </CollapsibleSection>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
function WebsiteSection({
  form,
  update,
  enabled,
  meta,
  claimVisible,
  powEnabled,
  essayEnabled,
  onSave,
}: any) {
  return (
    <div className="section section-compact campaigns-website-section">
      <div className="section-title">网站专属配置</div>
      <div className="field-row field-row-3">
        <Field label="网站状态">
          <Select
            disabled={!enabled}
            value={form.webStatus}
            onChange={(v) => update({ webStatus: v })}
            options={[
              "draft",
              "coming_soon",
              "live",
              "claim",
              "ended",
              "archived",
            ].map((v) => ({ value: v, label: v }))}
          />
        </Field>
        <Field label="详情页 slug">
          <Input
            disabled={!enabled}
            value={form.slug}
            onChange={(e) => update({ slug: e.target.value })}
            placeholder="默认等于 campaignKey"
          />
        </Field>
        <Field label="页面模板">
          <Input
            disabled={!enabled}
            value={form.pageTemplate}
            onChange={(e) => update({ pageTemplate: e.target.value })}
            placeholder="standard"
          />
        </Field>
      </div>
      <div className="field-row field-row-2">
        <Field label="网站公告（中文）">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webAnnouncementZh}
            onChange={(e) => update({ webAnnouncementZh: e.target.value })}
          />
        </Field>
        <Field label="Website Announcement (English)">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webAnnouncementEn}
            onChange={(e) => update({ webAnnouncementEn: e.target.value })}
          />
        </Field>
      </div>
      <div className="field-row field-row-2">
        <Field label="奖励文案（中文）">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webRewardTextZh}
            onChange={(e) => update({ webRewardTextZh: e.target.value })}
          />
        </Field>
        <Field label="Reward Text (English)">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webRewardTextEn}
            onChange={(e) => update({ webRewardTextEn: e.target.value })}
          />
        </Field>
      </div>
      <div className="field-row field-row-2">
        <Field label="备注（中文）">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webNoteZh}
            onChange={(e) => update({ webNoteZh: e.target.value })}
          />
        </Field>
        <Field label="Note (English)">
          <TextArea
            disabled={!enabled}
            rows={2}
            value={form.webNoteEn}
            onChange={(e) => update({ webNoteEn: e.target.value })}
          />
        </Field>
      </div>
      <div className="section-sub">
        <div className="section-title-sm">列表卡片图片</div>
        <div className="field-row field-row-3">
          <Field
            label="XHunt 图标 URL"
            hint="列表卡片左侧图标；不填则使用同步过来的第 1 个 logo"
          >
            <Input
              disabled={!enabled}
              value={form.listLeftLogo}
              onChange={(e) => update({ listLeftLogo: e.target.value })}
            />
          </Field>
          <Field
            label="活动方 Logo URL"
            hint="列表卡片右侧 logo；不填则使用同步过来的第 2 个 logo"
          >
            <Input
              disabled={!enabled}
              value={form.listRightLogo}
              onChange={(e) => update({ listRightLogo: e.target.value })}
            />
          </Field>
          <Field
            label="奖励图片 URL"
            hint="旧网站列表中间展示的奖池图片 / 宝箱图"
          >
            <Input
              disabled={!enabled}
              value={form.listChestImage}
              onChange={(e) => update({ listChestImage: e.target.value })}
            />
          </Field>
        </div>
      </div>
      {claimVisible ? (
        <div className="section-sub">
          <div className="section-title-sm">领奖配置（claim 状态必填校验）</div>
          <div className="muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
            claim 状态下需要填写领奖相关字段
            {powEnabled ? "；当前活动已开启 POW" : ""}
            {essayEnabled ? "；当前活动已开启征文大赛" : ""}
          </div>
          <div className="field-row field-row-1">
            <Field label="POI 合约地址（必填）">
              <Input
                disabled={!enabled}
                value={form.claimPoiContractAddress}
                onChange={(e) =>
                  update({ claimPoiContractAddress: e.target.value })
                }
                placeholder="0x..."
              />
            </Field>
          </div>
          <div className="field-row field-row-2">
            <Field label="POW 合约地址（按活动开关校验）">
              <Input
                disabled={!enabled}
                value={form.claimPowContractAddress}
                onChange={(e) =>
                  update({ claimPowContractAddress: e.target.value })
                }
                placeholder="0x..."
              />
            </Field>
            <Field label="征文大赛合约地址（按活动开关校验）">
              <Input
                disabled={!enabled}
                value={form.claimEssayContractAddress}
                onChange={(e) =>
                  update({ claimEssayContractAddress: e.target.value })
                }
                placeholder="0x..."
              />
            </Field>
          </div>
        </div>
      ) : null}
      <div className="section-sub">
        <div className="section-title-inline">
          <span>模板配置（JSON）</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              size="small"
              disabled={!enabled}
              onClick={() => {
                const parsed = JSON.parse(form.templateConfig || "{}");
                update({ templateConfig: JSON.stringify(parsed, null, 2) });
              }}
            >
              格式化 JSON
            </Button>
            <Button
              size="small"
              disabled={!enabled}
              onClick={() =>
                navigator.clipboard.writeText(form.templateConfig || "{}")
              }
            >
              复制 JSON
            </Button>
          </div>
        </div>
        <div className="field-row field-row-1">
          <Field hint="建议填写合法 JSON。保存前会自动校验；可先点“格式化 JSON”检查结构。">
            <TextArea
              disabled={!enabled}
              rows={10}
              value={form.templateConfig}
              onChange={(e) => update({ templateConfig: e.target.value })}
              placeholder='{"claimStatusBadge":"Claim is live"}'
            />
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
              JSON 状态：
              {(() => {
                try {
                  JSON.parse(form.templateConfig || "{}");
                  return "合法";
                } catch {
                  return "有错误";
                }
              })()}
            </div>
          </Field>
        </div>
      </div>
      <div className="field-row field-row-1">
        <Field>
          <div className="muted">{meta}</div>
        </Field>
      </div>
      <div
        className="section-actions"
        style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
      >
        <Button disabled={!enabled} onClick={onSave}>
          保存网站配置
        </Button>
      </div>
    </div>
  );
}
