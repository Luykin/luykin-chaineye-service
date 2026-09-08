const express = require("express");
const { Op, literal } = require("sequelize");
const { requirePermission } = require("../../../admin/middleware/adminAuth");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningBoardAccess,
  EchohuntSocialListeningJob,
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningAccessAuditLog,
} = require("../../../models/postgres-start");
const { SOCIAL_LISTENING_PERMISSION, BOARD_STATUSES } = require("../constants");
const {
  resolveMonitoredAccount,
  createMonitoredAccount,
  resumeBoard,
  recoverStaleJob,
  listMonitoredAccounts,
  updateBoard,
  grantBoardAccess,
  revokeBoardAccess,
  getBoardDetail,
  createManualRefreshJob,
  serializeAccess,
  serializeJob,
  serializePost,
  serializeAccountSignal,
  applySignalPostFilter,
  enrichSignalPostSources,
  serializeAlert,
  enrichSignalAvatars,
  enrichInfluentialAlertRanks,
  normalizePage,
  writeAudit,
} = require("../services/board-service");
const {
  normalizeRangeKey,
  getWindowForRange,
  buildSnapshotPayload,
  appendDerivedNegativeContentAlert,
  INFLUENTIAL_GLOBAL_RANK_LIMIT,
} = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const {
  applyRecallExcludeInfluentialSignalFilter,
  applyRecallExcludeAuthorAlertFilter,
} = require("../services/post-filter");
const { enableSocialListeningScheduler } = require("../services/scheduler");
const { buildTweetAnalysisPromptPreview } = require("../services/analysis-service");
const {
  getSocialListeningAiWorkerStatus,
  pauseSocialListeningAiWorker,
  resumeSocialListeningAiWorker,
} = require("../services/ai-backfill-scheduler");
const { nacosRequest } = require("../../services/nacosConfigClient");
const {
  SOCIAL_LISTENING_CONFIG_DATA_ID,
  SOCIAL_LISTENING_CONFIG_GROUP,
  normalizeConfig,
  getSocialListeningRuntimeConfig,
  getSocialListeningRuntimeConfigCacheInfo,
  clearSocialListeningRuntimeConfigCache,
} = require("../services/runtime-config");
const { sendJsonError, publicError } = require("../services/errors");

const router = express.Router();
router.use(requirePermission(SOCIAL_LISTENING_PERMISSION));

function getAdminId(req) {
  return req.adminUser?.id || null;
}

function normalizeAccountId(value) {
  return String(value || "").trim();
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function estimateAiCost(aiConfig = {}, postCount = 0) {
  const posts = Math.max(0, Math.floor(toFiniteNumber(postCount, 0)));
  const callsPerPost = aiConfig.contentEnabled || aiConfig.projectAttitudeEnabled ? 1 : 0;
  const inputPrice = Math.max(0, toFiniteNumber(aiConfig.estimateInputPricePerMillion, 0.25));
  const outputPrice = Math.max(0, toFiniteNumber(aiConfig.estimateOutputPricePerMillion, 1.5));
  // 内容标签、摘要和项目态度复用同一次结构化调用，不能把两套 token
  // 预算相加，否则会把每条推文的成本高估为两次请求。
  const combinedInputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateCombinedInputTokens, 1594));
  const combinedOutputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateCombinedOutputTokens, 246));
  const inputTokensPerPost = callsPerPost ? combinedInputTokens : 0;
  const outputTokensPerPost = callsPerPost ? combinedOutputTokens : 0;
  const inputTokens = posts * inputTokensPerPost;
  const outputTokens = posts * outputTokensPerPost;
  const usd = (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
  return {
    posts,
    calls: posts * callsPerPost,
    inputTokens,
    outputTokens,
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    estimatedUsd: Number(usd.toFixed(4)),
    assumption: "标签、摘要、项目态度已合并为每条推文 1 次结构化调用；默认按 gemini-3.1-flash-lite 实测 1,594 输入 / 246 输出 tokens 估算；费用仅用于上线前估算，实际以模型服务商账单为准。",
  };
}

async function getAiPendingStats(options = {}) {
  const boardIds = options.boardId ? [String(options.boardId)] : (await EchohuntSocialListeningBoard.findAll({
    attributes: ["id"],
    where: { status: { [Op.ne]: BOARD_STATUSES.DELETED } },
    raw: true,
  })).map((item) => item.id).filter(Boolean);
  if (!boardIds.length) {
    return {
      boardCount: 0,
      totalPosts: 0,
      contentPendingPosts: 0,
      projectAttitudePendingPosts: 0,
      contentAnalyzedPosts: 0,
      projectAttitudeAnalyzedPosts: 0,
    };
  }
  const baseWhere = { boardId: { [Op.in]: boardIds }, text: { [Op.ne]: null } };
  const [totalPosts, contentPendingPosts, projectAttitudePendingPosts, contentAnalyzedPosts, projectAttitudeAnalyzedPosts] = await Promise.all([
    EchohuntSocialListeningPost.count({ where: { boardId: { [Op.in]: boardIds } } }),
    EchohuntSocialListeningPost.count({
      where: {
        ...baseWhere,
        [Op.or]: [
          { tagStatus: null },
          { tagStatus: { [Op.in]: ["pending", "failed", "reused"] } },
          { summaryStatus: null },
          { summaryStatus: { [Op.in]: ["pending", "failed", "reused"] } },
          { aiSource: "dev_tweet_ai" },
        ],
      },
    }),
    EchohuntSocialListeningPost.count({
      where: {
        ...baseWhere,
        [Op.or]: [
          { attitudeStatus: null },
          { attitudeStatus: { [Op.in]: ["pending", "failed"] } },
        ],
      },
    }),
    EchohuntSocialListeningPost.count({
      where: {
        boardId: { [Op.in]: boardIds },
        [Op.or]: [
          { tagStatus: "generated" },
          { summaryStatus: "generated" },
        ],
      },
    }),
    EchohuntSocialListeningPost.count({
      where: {
        boardId: { [Op.in]: boardIds },
        attitudeStatus: "succeeded",
      },
    }),
  ]);
  return {
    boardCount: boardIds.length,
    totalPosts,
    contentPendingPosts,
    projectAttitudePendingPosts,
    contentAnalyzedPosts,
    projectAttitudeAnalyzedPosts,
  };
}

function getBoardAiRuntime(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  return metadata.aiRuntime && typeof metadata.aiRuntime === "object" ? metadata.aiRuntime : {};
}

function getEffectiveBoardAiConfig(runtimeAi = {}, boardAi = {}) {
  const boardModel = String(boardAi.model || "").trim();
  const tweetAnalysisModel = String(boardAi.tweetAnalysisModel || runtimeAi.tweetAnalysisModel || "").trim();
  const modelReady = Boolean(boardModel || tweetAnalysisModel);
  return {
    ...runtimeAi,
    ...boardAi,
    apiKey: runtimeAi.apiKey || "",
    baseURL: boardAi.baseURL || runtimeAi.baseURL || "",
    model: boardModel,
    tweetAnalysisModel,
    contentEnabled: Boolean(runtimeAi.contentEnabled && boardAi.contentEnabled && modelReady),
    projectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled && boardAi.projectAttitudeEnabled && modelReady),
  };
}

function sanitizeBoardAiRuntime(boardAi = {}, runtimeAi = {}) {
  const effective = getEffectiveBoardAiConfig(runtimeAi, boardAi);
  return {
    contentEnabled: Boolean(boardAi.contentEnabled),
    projectAttitudeEnabled: Boolean(boardAi.projectAttitudeEnabled),
    model: boardAi.model || "",
    tweetAnalysisModel: boardAi.tweetAnalysisModel || "",
    estimatePosts: Math.max(0, Math.floor(toFiniteNumber(boardAi.estimatePosts, 10000))),
    costAcceptedAt: boardAi.costAcceptedAt || null,
    costAcceptedByAdminId: boardAi.costAcceptedByAdminId || null,
    acceptedEstimatedUsd: toFiniteNumber(boardAi.acceptedEstimatedUsd, 0),
    acceptedCalls: Math.max(0, Math.floor(toFiniteNumber(boardAi.acceptedCalls, 0))),
    updatedAt: boardAi.updatedAt || null,
    effective: {
      contentEnabled: effective.contentEnabled,
      projectAttitudeEnabled: effective.projectAttitudeEnabled,
      model: effective.model,
      tweetAnalysisModel: effective.tweetAnalysisModel || effective.model,
      baseURL: effective.baseURL,
      apiKeyConfigured: Boolean(String(runtimeAi.apiKey || "").trim()),
      globalContentEnabled: Boolean(runtimeAi.contentEnabled),
      globalProjectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled),
      ready: Boolean(String(runtimeAi.apiKey || "").trim() && String(effective.baseURL || "").trim() && (effective.tweetAnalysisModel || effective.model)),
    },
  };
}

function normalizeBoardPromptOverride(value, maxLength = 30000) {
  return String(value || "").trim().slice(0, Math.max(200, Number(maxLength) || 30000));
}

function getBoardPromptSettings(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const prompts = metadata.aiPrompts && typeof metadata.aiPrompts === "object" ? metadata.aiPrompts : {};
  return {
    aiProjectName: String(metadata.aiProjectName || "").trim(),
    promptOverride: String(prompts.tweetAnalysis || "").trim(),
  };
}

function hasOwnField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function pickStringField(input = {}, current = {}, key) {
  if (hasOwnField(input, key)) return String(input[key] || "").trim();
  return String(current[key] || "").trim();
}

function normalizeBoardAiRuntimeInput(current = {}, body = {}, runtimeAi = {}, adminId = null) {
  const input = body.ai && typeof body.ai === "object" ? body.ai : body;
  const currentAi = { ...current };
  delete currentAi.tweetTagModel;
  delete currentAi.tweetSummaryModel;
  delete currentAi.projectAttitudeModel;
  const combinedEnabled = hasOwnField(input, "enabled") ? Boolean(input.enabled) : null;
  const next = {
    ...currentAi,
    // 新界面只暴露一个综合开关；仍读写旧字段，保证已有 metadata 和旧客户端兼容。
    contentEnabled: combinedEnabled === null
      ? (hasOwnField(input, "contentEnabled") ? Boolean(input.contentEnabled) : Boolean(current.contentEnabled))
      : combinedEnabled,
    projectAttitudeEnabled: combinedEnabled === null
      ? (hasOwnField(input, "projectAttitudeEnabled") ? Boolean(input.projectAttitudeEnabled) : Boolean(current.projectAttitudeEnabled))
      : combinedEnabled,
    model: pickStringField(input, current, "model"),
    tweetAnalysisModel: pickStringField(input, current, "tweetAnalysisModel"),
    estimatePosts: Math.max(0, Math.floor(toFiniteNumber(hasOwnField(input, "estimatePosts") ? input.estimatePosts : current.estimatePosts, 10000))),
  };
  const wantsAi = next.contentEnabled || next.projectAttitudeEnabled;
  if (wantsAi) {
    const acceptCost = input.acceptCost === true || body.acceptCost === true || input.costAccepted === true || body.costAccepted === true;
    if (!String(runtimeAi.apiKey || "").trim()) throw publicError("AI_API_KEY_NOT_CONFIGURED", 400, "全局 API Key 未配置，不能开启该账号 AI。");
    if (!String(runtimeAi.baseURL || "").trim()) throw publicError("AI_BASE_URL_NOT_CONFIGURED", 400, "全局 Base URL 未配置，不能开启该账号 AI。");
    const effectiveModel = next.tweetAnalysisModel || runtimeAi.tweetAnalysisModel || next.model;
    if (!effectiveModel) throw publicError("BOARD_AI_MODEL_REQUIRED", 400, "开启账号 AI 前必须选择账号模型，或配置综合分析模型。");
    if (next.contentEnabled && !runtimeAi.contentEnabled) throw publicError("GLOBAL_CONTENT_AI_DISABLED", 400, "全局内容分析总开关未开启，不能开启该账号内容分析。");
    if (next.projectAttitudeEnabled && !runtimeAi.projectAttitudeEnabled) throw publicError("GLOBAL_ATTITUDE_AI_DISABLED", 400, "全局项目态度总开关未开启，不能开启该账号态度评价。");
    const estimate = estimateAiCost(getEffectiveBoardAiConfig(runtimeAi, next), next.estimatePosts);
    if (!acceptCost) throw publicError("BOARD_AI_COST_NOT_ACCEPTED", 400, `开启账号 AI 前必须确认预估成本：约 ${estimate.calls} 次调用，${estimate.estimatedUsd} USD。`);
    next.costAcceptedAt = new Date().toISOString();
    next.costAcceptedByAdminId = adminId;
    next.acceptedEstimatedUsd = estimate.estimatedUsd;
    next.acceptedCalls = estimate.calls;
  } else {
    next.costAcceptedAt = current.costAcceptedAt || null;
    next.costAcceptedByAdminId = current.costAcceptedByAdminId || null;
    next.acceptedEstimatedUsd = current.acceptedEstimatedUsd || 0;
    next.acceptedCalls = current.acceptedCalls || 0;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function sanitizeRuntimeConfig(config = {}) {
  const ai = config.ai || {};
  return {
    ...config,
    ai: {
      ...ai,
      apiKey: "",
      apiKeyConfigured: Boolean(String(ai.apiKey || "").trim()),
      apiKeyMasked: maskSecret(ai.apiKey),
    },
  };
}

function getBoardAiBlockingReasons(runtimeAi = {}, boardAi = {}) {
  const reasons = [];
  if (!String(runtimeAi.apiKey || "").trim()) reasons.push("全局 API Key 未配置");
  if (!String(runtimeAi.baseURL || "").trim()) reasons.push("全局 Base URL 未配置");
  if (!String(boardAi.model || boardAi.tweetAnalysisModel || runtimeAi.tweetAnalysisModel || "").trim()) reasons.push("尚未选择账号模型或综合分析模型");
  if (boardAi.contentEnabled && !runtimeAi.contentEnabled) reasons.push("全局内容分析总开关未开启");
  if (boardAi.projectAttitudeEnabled && !runtimeAi.projectAttitudeEnabled) reasons.push("全局项目态度总开关未开启");
  return reasons;
}

function buildAiProgressItem(done = 0, pending = 0, batchSize = 1, intervalMinutes = 15) {
  const safeDone = Math.max(0, Math.floor(toFiniteNumber(done, 0)));
  const safePending = Math.max(0, Math.floor(toFiniteNumber(pending, 0)));
  const total = safeDone + safePending;
  const safeBatchSize = Math.max(1, Math.floor(toFiniteNumber(batchSize, 1)));
  const safeIntervalMinutes = Math.max(0.01, toFiniteNumber(intervalMinutes, 15));
  const batchesRemaining = safePending > 0 ? Math.ceil(safePending / safeBatchSize) : 0;
  return {
    done: safeDone,
    pending: safePending,
    total,
    percent: total > 0 ? Number(((safeDone / total) * 100).toFixed(2)) : 100,
    batchSize: safeBatchSize,
    batchesRemaining,
    estimatedMinutesRemaining: batchesRemaining * safeIntervalMinutes,
  };
}

function buildBoardAiProgress(runtimeConfig = {}, stats = {}) {
  const worker = runtimeConfig.aiWorker || {};
  const activeDelaySeconds = 10;
  const intervalMinutes = activeDelaySeconds / 60;
  const content = buildAiProgressItem(
    stats.contentAnalyzedPosts,
    stats.contentPendingPosts,
    worker.contentBatchSize || runtimeConfig.ai?.contentBatchSize || 10,
    intervalMinutes
  );
  const projectAttitude = buildAiProgressItem(
    stats.projectAttitudeAnalyzedPosts,
    stats.projectAttitudePendingPosts,
    worker.projectAttitudeBatchSize || runtimeConfig.ai?.projectAttitudeBatchSize || 20,
    intervalMinutes
  );
  return {
    content,
    projectAttitude,
    intervalMinutes,
    activeDelaySeconds,
    estimatedMinutesRemaining: Math.max(content.estimatedMinutesRemaining, projectAttitude.estimatedMinutesRemaining),
    assumption: "按独立 AI Worker 的每轮批大小估算；有待处理时会连续跑，清空后才按间隔检查；实际耗时会受 LLM 响应、并发、失败重试、账号数量和队列影响。",
  };
}

async function buildBoardAiConfigResponse(board, runtimeConfig, estimatePostsInput = null) {
  const runtimeAi = runtimeConfig.ai || {};
  const boardAi = getBoardAiRuntime(board);
  const stats = await getAiPendingStats({ boardId: board.id });
  const sanitized = sanitizeBoardAiRuntime(boardAi, runtimeAi);
  const promptSettings = getBoardPromptSettings(board);
  const estimatePosts = Math.max(
    0,
    Math.floor(toFiniteNumber(estimatePostsInput, sanitized.estimatePosts || Math.max(stats.contentPendingPosts, stats.projectAttitudePendingPosts, 10000)))
  );
  const estimateBoardAi = { ...boardAi, estimatePosts };
  const costEstimate = estimateAiCost(getEffectiveBoardAiConfig(runtimeAi, estimateBoardAi), estimatePosts);
  const promptPreview = await buildTweetAnalysisPromptPreview(board);
  return {
    board: {
      id: board.id,
      officialHandle: board.officialHandle,
      projectName: board.projectName,
    },
    config: {
      ...sanitized,
      ...promptSettings,
      effectivePromptTemplate: String(promptPreview?.template || "").trim(),
    },
    runtime: sanitizeRuntimeConfig(runtimeConfig).ai,
    promptPreview,
    stats,
    progress: buildBoardAiProgress(runtimeConfig, stats),
    costEstimate,
    blockingReasons: getBoardAiBlockingReasons(runtimeAi, sanitized),
    rules: [
      "全局 AI 配置只提供 API Key、Base URL、价格估算和总开关。",
      "每个被监控账号的 AI 开关默认关闭；开启前需选择账号模型或综合分析模型，并确认预估成本。",
      "关闭该账号开关后，后续任务的内容分析/项目态度评价会直接跳过，不再产生该账号 AI 调用。",
    ],
    fieldDocs: AI_CONFIG_FIELD_DOCS,
  };
}

function buildRuntimeConfigDocument(currentConfig = {}, body = {}) {
  const currentAi = currentConfig.ai || {};
  const currentAiWorker = currentConfig.aiWorker || {};
  const currentMetricRefresh = currentConfig.metricRefresh || {};
  const inputAi = body.ai && typeof body.ai === "object" ? body.ai : {};
  const inputAiWorker = body.aiWorker && typeof body.aiWorker === "object" ? body.aiWorker : {};
  const inputMetricRefresh = body.metricRefresh && typeof body.metricRefresh === "object" ? body.metricRefresh : {};
  const nextAi = { ...currentAi, ...inputAi };
  const nextAiWorker = { ...currentAiWorker, ...inputAiWorker };
  delete nextAi.apiKeyMasked;
  delete nextAi.apiKeyConfigured;
  delete nextAi.apiKeyAction;
  delete nextAi.tweetTagModel;
  delete nextAi.tweetSummaryModel;
  delete nextAi.projectAttitudeModel;
  delete nextAi.tweetTagMaxTokens;
  delete nextAi.tweetSummaryMaxTokens;
  delete nextAi.projectAttitudeMaxTokens;

  // A non-empty value entered in the admin form takes effect immediately on
  // save.  The form deliberately submits an empty value when the field is
  // untouched, so saving other settings retains the current secret.
  const submittedApiKey = String(inputAi.apiKey || "").trim();
  nextAi.apiKey = submittedApiKey || currentAi.apiKey || "";

  return normalizeConfig({
    ...currentConfig,
    version: body.version || currentConfig.version,
    ai: nextAi,
    aiWorker: nextAiWorker,
    metricRefresh: { ...currentMetricRefresh, ...inputMetricRefresh },
  });
}

async function publishRuntimeConfig(config) {
  const content = JSON.stringify(config, null, 2);
  const form = new URLSearchParams({
    dataId: SOCIAL_LISTENING_CONFIG_DATA_ID,
    group: SOCIAL_LISTENING_CONFIG_GROUP,
    content,
    type: "json",
  });
  const resp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
    data: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const ok = resp.status === 200 && (resp.data === true || resp.data === "true");
  if (!ok) {
    throw publicError("NACOS_PUBLISH_FAILED", resp.status || 500, `发布 Nacos 配置失败: ${resp.status || "unknown"}`);
  }
  clearSocialListeningRuntimeConfigCache();
  return content;
}

function applyExcludeOfficialAccount(where, board) {
  const clauses = [];
  const officialTwitterId = normalizeAccountId(board?.officialTwitterId);
  const officialHandle = normalizeHandle(board?.officialHandle);
  if (officialTwitterId) clauses.push({ twitterId: { [Op.ne]: officialTwitterId } });
  if (officialHandle) {
    clauses.push({
      [Op.or]: [
        { handle: null },
        { handle: { [Op.notILike]: officialHandle } },
      ],
    });
  }
  if (clauses.length) where[Op.and] = [...(where[Op.and] || []), ...clauses];
  return where;
}

function applyInfluentialRankScope(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    {
      [Op.or]: [
        { signalType: { [Op.ne]: "influential_mention" } },
        { globalRank: { [Op.between]: [1, INFLUENTIAL_GLOBAL_RANK_LIMIT] } },
      ],
    },
  ];
  return where;
}

function applyExcludeSelfMentionAlerts(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    literal(`
      NOT (
        "EchohuntSocialListeningAlert"."alertType" = 'influential_mention'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE("EchohuntSocialListeningAlert"."evidenceTweetIds", '[]'::jsonb)) AS evidence(tweet_id)
          JOIN "EchohuntSocialListeningPosts" p
            ON p."boardId" = "EchohuntSocialListeningAlert"."boardId"
           AND p."tweetId" = evidence.tweet_id
          JOIN "EchohuntSocialListeningBoards" b
            ON b."id" = "EchohuntSocialListeningAlert"."boardId"
          WHERE (
            p."authorTwitterId" = b."officialTwitterId"
            OR lower(coalesce(p."authorHandle", '')) = lower(coalesce(b."officialHandle", ''))
          )
        )
      )
    `),
  ];
  return where;
}

const AI_CONFIG_FIELD_DOCS = [
  { field: "apiKey", label: "API Key", desc: "调用 OpenAI-compatible / Gemini 代理服务的密钥。后台只脱敏展示；保存时可选择保持、替换或清空。" },
  { field: "baseURL", label: "Base URL", desc: "模型服务地址，例如 https://api.openai.com/v1 或内部代理 https://aaii.xclaw.info/v1/。" },
  { field: "model", label: "默认模型", desc: "AI 默认使用的模型；综合分析模型为空时回落到它。" },
  { field: "tweetAnalysisModel", label: "综合分析模型", desc: "可单独指定综合分析模型；一次调用同时生成标签、摘要和项目态度。为空则使用默认模型。" },
  { field: "contentEnabled", label: "内容分析开关", desc: "开启后参与综合 AI 调用，回填标签和中英文摘要；不再生成全文翻译。" },
  { field: "projectAttitudeEnabled", label: "项目态度开关", desc: "开启后参与综合 AI 调用，回填 0-10 分、positive/neutral/negative/unknown 和中文原因；无关、证据不足、无法可靠判断不强行归为 neutral。" },
  { field: "contentBatchSize", label: "内容批大小", desc: "AI Worker 每轮每个账号最多选取多少条内容待处理帖子；采集任务不再内联跑 AI。" },
  { field: "projectAttitudeBatchSize", label: "态度批大小", desc: "AI Worker 每轮每个账号最多选取多少条态度待处理帖子；综合调用会合并同一条推文的任务。" },
  { field: "contentConcurrency", label: "内容并发", desc: "综合 AI Worker 的并发帖子数；会和态度并发取较大值。" },
  { field: "projectAttitudeConcurrency", label: "态度并发", desc: "综合 AI Worker 的并发帖子数；会和内容并发取较大值。" },
  { field: "maxTextLength", label: "推文截断长度", desc: "进入 AI Prompt 前的正文硬截断字符数；超长推文会截断并在日志记录 truncated=true。" },
  { field: "negativeScoreThreshold", label: "负面阈值", desc: "项目态度分低于该值时判定为 negative。默认 4。" },
  { field: "positiveScoreThreshold", label: "正面阈值", desc: "项目态度分高于该值时判定为 positive；介于负面和正面阈值之间为 neutral。默认 6。" },
  { field: "temperature", label: "温度", desc: "模型随机性，舆情分类建议保持 0，保证结果稳定可复现。" },
  { field: "maxTokens", label: "默认输出上限", desc: "未配置综合分析 maxTokens 时使用的输出 token 上限。" },
  { field: "tweetAnalysisMaxTokens", label: "综合输出上限", desc: "综合分析结构化输出的 maxTokens。" },
  { field: "timeoutMs", label: "超时时间", desc: "单次模型请求超时时间，单位毫秒。" },
  { field: "maxRetries", label: "重试次数", desc: "模型请求失败后的最大重试次数；过高会放大延迟和潜在费用。" },
  { field: "summaryWords", label: "摘要词数", desc: "传给摘要 Prompt 的目标词数/短语长度。" },
  { field: "promptMaxLength", label: "Prompt 最大长度", desc: "运行时或看板级 Prompt 的最大字符长度，防止错误配置导致超长请求。" },
  { field: "estimateInputPricePerMillion", label: "输入单价估算", desc: "用于费用估算的输入 token 单价，单位 USD / 100万 tokens，不影响真实调用。" },
  { field: "estimateOutputPricePerMillion", label: "输出单价估算", desc: "用于费用估算的输出 token 单价，单位 USD / 100万 tokens，不影响真实调用。" },
  { field: "estimateCombinedInputTokens", label: "综合调用输入 token", desc: "每条推文只会发起一次综合分析；默认 1,594，来自 gemini-3.1-flash-lite 的实测请求。" },
  { field: "estimateCombinedOutputTokens", label: "综合调用输出 token", desc: "每条推文只会发起一次综合分析；默认 246，来自 gemini-3.1-flash-lite 的实测请求。" },
  { field: "prompts", label: "全局 Prompt 覆盖", desc: "配置 tweetAnalysis 综合 Prompt；看板级 Prompt 优先级更高。" },
];

router.get("/runtime-config", async (req, res) => {
  try {
    const config = await getSocialListeningRuntimeConfig({ force: true });
    const stats = await getAiPendingStats();
    const estimatePosts = Math.max(
      Number(req.query.estimatePosts || 0) || 0,
      stats.contentPendingPosts,
      stats.projectAttitudePendingPosts
    );
    const cache = getSocialListeningRuntimeConfigCacheInfo();
    return res.json({
      success: true,
      data: {
        dataId: SOCIAL_LISTENING_CONFIG_DATA_ID,
        group: SOCIAL_LISTENING_CONFIG_GROUP,
        config: sanitizeRuntimeConfig(config),
        source: cache.source,
        loadError: cache.error || null,
        stats,
        costEstimate: estimateAiCost(config.ai || {}, estimatePosts || 10000),
        fieldDocs: AI_CONFIG_FIELD_DOCS,
        aiWorkerStatus: await getSocialListeningAiWorkerStatus(req.redisClient),
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RUNTIME_CONFIG_FAILED");
  }
});

router.post("/runtime-config", async (req, res) => {
  try {
    const currentConfig = await getSocialListeningRuntimeConfig({ force: true });
    const nextConfig = buildRuntimeConfigDocument(currentConfig, req.body || {});
    await publishRuntimeConfig(nextConfig);
    const { apiKey, ...safeAi } = nextConfig.ai || {};
    await writeAudit({
      adminId: getAdminId(req),
      action: "runtime_config_update",
      payload: {
        dataId: SOCIAL_LISTENING_CONFIG_DATA_ID,
        group: SOCIAL_LISTENING_CONFIG_GROUP,
        apiKeyUpdated: Boolean(String(req.body?.ai?.apiKey || "").trim()),
        ai: {
          ...safeAi,
          apiKeyConfigured: Boolean(apiKey),
        },
        aiWorker: nextConfig.aiWorker || {},
      },
    });
    const stats = await getAiPendingStats();
    return res.json({
      success: true,
      data: {
        dataId: SOCIAL_LISTENING_CONFIG_DATA_ID,
        group: SOCIAL_LISTENING_CONFIG_GROUP,
        config: sanitizeRuntimeConfig(nextConfig),
        source: "nacos",
        stats,
        costEstimate: estimateAiCost(nextConfig.ai || {}, Math.max(stats.contentPendingPosts, stats.projectAttitudePendingPosts, 10000)),
        fieldDocs: AI_CONFIG_FIELD_DOCS,
        aiWorkerStatus: await getSocialListeningAiWorkerStatus(req.redisClient),
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RUNTIME_CONFIG_UPDATE_FAILED");
  }
});

router.get("/ai-worker/status", async (req, res) => {
  try {
    return res.json({ success: true, data: await getSocialListeningAiWorkerStatus(req.redisClient) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_AI_WORKER_STATUS_FAILED");
  }
});

router.post("/ai-worker/pause", async (req, res) => {
  try {
    const result = await pauseSocialListeningAiWorker(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    await writeAudit({ adminId: getAdminId(req), action: "ai_worker_pause", payload: result });
    return res.json({ success: true, data: await getSocialListeningAiWorkerStatus(req.redisClient) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_AI_WORKER_PAUSE_FAILED");
  }
});

router.post("/ai-worker/resume", async (req, res) => {
  try {
    const result = await resumeSocialListeningAiWorker(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    await writeAudit({ adminId: getAdminId(req), action: "ai_worker_resume", payload: result });
    return res.json({ success: true, data: await getSocialListeningAiWorkerStatus(req.redisClient) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_AI_WORKER_RESUME_FAILED");
  }
});

router.get("/monitored-accounts", async (req, res) => {
  try {
    return res.json({ success: true, data: await listMonitoredAccounts(req.query) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_LIST_FAILED");
  }
});

router.post("/monitored-accounts/resolve", async (req, res) => {
  try {
    const data = await resolveMonitoredAccount(req.body?.handle || req.body?.officialHandle);
    return res.json({ success: true, data });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RESOLVE_FAILED");
  }
});

router.post("/monitored-accounts", async (req, res) => {
  try {
    const result = await createMonitoredAccount(req.body || {}, getAdminId(req));
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(result.board.id),
        created: result.created,
        job: result.job ? serializeJob(result.job) : null,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_CREATE_FAILED");
  }
});

router.get("/monitored-accounts/:boardId", async (req, res) => {
  try {
    return res.json({ success: true, data: await getBoardDetail(req.params.boardId) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_DETAIL_FAILED");
  }
});

router.patch("/monitored-accounts/:boardId", async (req, res) => {
  try {
    const board = await updateBoard(req.params.boardId, req.body || {}, getAdminId(req));
    return res.json({ success: true, data: await getBoardDetail(board.id) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_UPDATE_FAILED");
  }
});

router.post("/boards/:boardId/pause", async (req, res) => {
  try {
    const board = await updateBoard(req.params.boardId, { status: BOARD_STATUSES.PAUSED }, getAdminId(req));
    await writeAudit({ boardId: board.id, adminId: getAdminId(req), action: "board_pause" });
    return res.json({ success: true, data: await getBoardDetail(board.id) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_PAUSE_FAILED");
  }
});

router.post("/boards/:boardId/resume", async (req, res) => {
  try {
    const result = await resumeBoard(req.params.boardId, getAdminId(req), req.redisClient);
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(result.board.id),
        job: serializeJob(result.job),
        reused: result.reused,
        firstActivation: result.firstActivation,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RESUME_FAILED");
  }
});

router.delete("/boards/:boardId", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    await board.update({ status: BOARD_STATUSES.DELETED, updatedByAdminId: getAdminId(req) });
    await writeAudit({ boardId: board.id, adminId: getAdminId(req), action: "board_delete", targetTwitterHandle: board.officialHandle });
    return res.json({ success: true });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_DELETE_FAILED");
  }
});

router.post("/boards/:boardId/refresh", async (req, res) => {
  try {
    const result = await createManualRefreshJob(req.params.boardId, { type: "admin", adminId: getAdminId(req) }, req.redisClient);
    await enableSocialListeningScheduler(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    return res.json({ success: true, data: { job: serializeJob(result.job), reused: result.reused } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_REFRESH_FAILED");
  }
});

router.get("/boards/:boardId/ai-config", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board || board.status === BOARD_STATUSES.DELETED) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const runtimeConfig = await getSocialListeningRuntimeConfig({ force: true });
    return res.json({
      success: true,
      data: await buildBoardAiConfigResponse(board, runtimeConfig, req.query.estimatePosts),
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_BOARD_AI_CONFIG_FAILED");
  }
});

router.post("/boards/:boardId/ai-config", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board || board.status === BOARD_STATUSES.DELETED) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const runtimeConfig = await getSocialListeningRuntimeConfig({ force: true });
    const current = getBoardAiRuntime(board);
    const next = normalizeBoardAiRuntimeInput(current, req.body || {}, runtimeConfig.ai || {}, getAdminId(req));
    const metadata = board.metadata && typeof board.metadata === "object" ? { ...board.metadata } : {};
    const inputAi = req.body?.ai && typeof req.body.ai === "object" ? req.body.ai : req.body || {};
    const currentPrompts = metadata.aiPrompts && typeof metadata.aiPrompts === "object" ? { ...metadata.aiPrompts } : {};
    if (hasOwnField(inputAi, "promptOverride")) {
      const promptOverride = normalizeBoardPromptOverride(inputAi.promptOverride, runtimeConfig.ai?.promptMaxLength);
      if (promptOverride) currentPrompts.tweetAnalysis = promptOverride;
      else delete currentPrompts.tweetAnalysis;
      if (Object.keys(currentPrompts).length) metadata.aiPrompts = currentPrompts;
      else delete metadata.aiPrompts;
    }
    if (hasOwnField(inputAi, "aiProjectName")) {
      const aiProjectName = String(inputAi.aiProjectName || "").trim().slice(0, 255);
      if (aiProjectName) metadata.aiProjectName = aiProjectName;
      else delete metadata.aiProjectName;
    }
    metadata.aiRuntime = next;
    await board.update({ metadata, updatedByAdminId: getAdminId(req) });
    await writeAudit({
      boardId: board.id,
      adminId: getAdminId(req),
      action: "board_ai_config_update",
      targetTwitterHandle: board.officialHandle,
      payload: {
        contentEnabled: next.contentEnabled,
        projectAttitudeEnabled: next.projectAttitudeEnabled,
        model: next.model,
        tweetAnalysisModel: next.tweetAnalysisModel,
        estimatePosts: next.estimatePosts,
        costAcceptedAt: next.costAcceptedAt,
        acceptedEstimatedUsd: next.acceptedEstimatedUsd,
        acceptedCalls: next.acceptedCalls,
        promptOverrideConfigured: Boolean(metadata.aiPrompts?.tweetAnalysis),
        aiProjectName: metadata.aiProjectName || null,
      },
    });
    const reloaded = await EchohuntSocialListeningBoard.findByPk(board.id);
    return res.json({
      success: true,
      data: await buildBoardAiConfigResponse(reloaded, runtimeConfig, next.estimatePosts),
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_BOARD_AI_CONFIG_UPDATE_FAILED");
  }
});

router.get("/boards/:boardId/overview", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const rangeKey = normalizeRangeKey(req.query.range);
    const storedSnapshot = await EchohuntSocialListeningSnapshot.findOne({
      where: { boardId: board.id, rangeKey },
      order: [["generatedAt", "DESC"]],
      raw: true,
    });
    const snapshot = storedSnapshot || await buildSnapshotPayload(board, rangeKey);
    const accountSummary = snapshot?.accountSummary && typeof snapshot.accountSummary === "object" ? snapshot.accountSummary : {};
    const responseSnapshot = snapshot ? { ...snapshot } : null;
    if (responseSnapshot && Array.isArray(snapshot.topViewedPosts)) responseSnapshot.topViewedPosts = snapshot.topViewedPosts;
    else if (responseSnapshot && Array.isArray(accountSummary.topViewedPosts)) responseSnapshot.topViewedPosts = accountSummary.topViewedPosts;
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(board.id),
        rangeKey,
        state: snapshot ? "ready" : (board.status === "failed" ? "failed" : "processing"),
        snapshot: responseSnapshot,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_OVERVIEW_FAILED");
  }
});

router.get("/boards/:boardId/posts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const { where, rangeKey } = buildPostWhere(board, req.query);
    const result = await EchohuntSocialListeningPost.findAndCountAll({
      where,
      order: buildPostOrder(req.query.sort),
      offset,
      limit,
    });
    return res.json({ success: true, data: { rangeKey, items: result.rows.map(serializePost), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_POSTS_FAILED");
  }
});

router.get("/boards/:boardId/posts/export", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const result = await exportPostsXlsx(board, req.query, {
      type: "admin",
      adminId: getAdminId(req),
    }, req.redisClient);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.filename)}"`);
    return res.send(result.buffer);
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_EXPORT_FAILED");
  }
});

router.get("/boards/:boardId/accounts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = applyInfluentialRankScope(applyExcludeOfficialAccount(
      { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } },
      board
    ));
    applyRecallExcludeInfluentialSignalFilter(where, board);
    if (req.query.type) where.signalType = String(req.query.type);
    applySignalPostFilter(where, req.query);
    const result = await EchohuntSocialListeningAccountSignal.findAndCountAll({
      where,
      order: [["occurredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    const rows = await enrichSignalAvatars(await enrichSignalPostSources(result.rows, board.id));
    return res.json({ success: true, data: { rangeKey, items: rows.map(serializeAccountSignal), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_SIGNALS_FAILED");
  }
});

router.get("/boards/:boardId/alerts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = applyRecallExcludeAuthorAlertFilter(applyExcludeSelfMentionAlerts({ boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } }));
    if (req.query.type) where.alertType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({
      where,
      order: [["triggeredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    const derived = offset === 0 && (!req.query.status || String(req.query.status) === "active")
      ? await appendDerivedNegativeContentAlert(board, window, result.rows, { type: req.query.type })
      : { rows: result.rows, appended: false };
    const items = await enrichInfluentialAlertRanks(derived.rows.slice(0, limit), board.id);
    return res.json({ success: true, data: { rangeKey, items: items.map((item) => serializeAlert(item, { lang: req.query.lang })), page, pageSize, total: result.count + (derived.appended ? 1 : 0) } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_BOARD_ALERTS_FAILED");
  }
});

router.get("/boards/:boardId/accesses", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = { boardId: req.params.boardId };
    if (req.query.status) where.status = String(req.query.status);
    const result = await EchohuntSocialListeningBoardAccess.findAndCountAll({
      where,
      order: [["updatedAt", "DESC"]],
      offset,
      limit,
    });
    return res.json({ success: true, data: { items: result.rows.map(serializeAccess), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_ACCESSES_FAILED");
  }
});

router.post("/boards/:boardId/accesses", async (req, res) => {
  try {
    const result = await grantBoardAccess(req.params.boardId, req.body || {}, getAdminId(req));
    return res.json({ success: true, data: { access: serializeAccess(result.access), created: result.created } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_GRANT_FAILED");
  }
});

router.delete("/boards/:boardId/accesses/:accessId", async (req, res) => {
  try {
    const access = await revokeBoardAccess(req.params.boardId, req.params.accessId, getAdminId(req));
    return res.json({ success: true, data: serializeAccess(access) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_REVOKE_FAILED");
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.jobType) where.jobType = String(req.query.jobType);
    const result = await EchohuntSocialListeningJob.findAndCountAll({ where, order: [["createdAt", "DESC"]], offset, limit });
    return res.json({ success: true, data: { items: result.rows.map(serializeJob), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOBS_FAILED");
  }
});

router.get("/alerts", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = applyRecallExcludeAuthorAlertFilter(applyExcludeSelfMentionAlerts({}));
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.type) where.alertType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.severity) where.severity = String(req.query.severity);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({
      where,
      order: [["triggeredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    const items = await enrichInfluentialAlertRanks(result.rows);
    return res.json({ success: true, data: { items: items.map((item) => serializeAlert(item, { lang: req.query.lang })), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_ALERTS_FAILED");
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = {};
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.adminId) where.adminId = Number(req.query.adminId);
    const result = await EchohuntSocialListeningAccessAuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    return res.json({ success: true, data: { items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_AUDIT_FAILED");
  }
});

router.post("/jobs/:jobId/retry", async (req, res) => {
  try {
    const job = await EchohuntSocialListeningJob.findByPk(req.params.jobId);
    if (!job) throw publicError("JOB_NOT_FOUND", 404, "任务不存在。");
    const retry = await EchohuntSocialListeningJob.create({
      boardId: job.boardId,
      jobType: job.jobType,
      status: "pending",
      rangeStartAt: job.rangeStartAt,
      rangeEndAt: job.rangeEndAt,
      triggeredBy: "admin",
      triggeredByAdminId: getAdminId(req),
      metadata: { ...(job.metadata || {}), retryFromJobId: job.id },
    });
    await enableSocialListeningScheduler(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    return res.json({ success: true, data: serializeJob(retry) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOB_RETRY_FAILED");
  }
});

router.post("/jobs/:jobId/recover", async (req, res) => {
  try {
    const result = await recoverStaleJob(req.params.jobId, getAdminId(req), req.redisClient);
    return res.json({
      success: true,
      data: {
        job: serializeJob(result.job),
        retry: serializeJob(result.retry),
        boardLockReleased: result.boardLockReleased,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOB_RECOVER_FAILED");
  }
});

module.exports = router;
