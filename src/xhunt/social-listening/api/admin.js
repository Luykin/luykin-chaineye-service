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
  enrichSignalAvatars,
  normalizePage,
  writeAudit,
} = require("../services/board-service");
const { normalizeRangeKey, getWindowForRange } = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const { enableSocialListeningScheduler } = require("../services/scheduler");
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
  const contentCallsPerPost = aiConfig.contentEnabled ? 3 : 0;
  const attitudeCallsPerPost = aiConfig.projectAttitudeEnabled ? 1 : 0;
  const inputPrice = Math.max(0, toFiniteNumber(aiConfig.estimateInputPricePerMillion, 0.25));
  const outputPrice = Math.max(0, toFiniteNumber(aiConfig.estimateOutputPricePerMillion, 1.5));
  const contentInputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateContentInputTokens, 1200));
  const contentOutputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateContentOutputTokens, 260));
  const attitudeInputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateProjectAttitudeInputTokens, 900));
  const attitudeOutputTokens = Math.max(0, toFiniteNumber(aiConfig.estimateProjectAttitudeOutputTokens, 180));
  const inputTokens = posts * (contentCallsPerPost * contentInputTokens + attitudeCallsPerPost * attitudeInputTokens);
  const outputTokens = posts * (contentCallsPerPost * contentOutputTokens + attitudeCallsPerPost * attitudeOutputTokens);
  const usd = (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
  return {
    posts,
    calls: posts * (contentCallsPerPost + attitudeCallsPerPost),
    inputTokens,
    outputTokens,
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    estimatedUsd: Number(usd.toFixed(4)),
    assumption: "内容分析按每条 3 次调用（标签、中文摘要、英文摘要），项目态度按每条 1 次调用；费用仅用于上线前估算，实际以模型服务商账单为准。",
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
  const contentModelReady = Boolean(boardModel || boardAi.tweetTagModel || boardAi.tweetSummaryModel);
  const attitudeModelReady = Boolean(boardModel || boardAi.projectAttitudeModel);
  return {
    ...runtimeAi,
    ...boardAi,
    apiKey: runtimeAi.apiKey || "",
    baseURL: boardAi.baseURL || runtimeAi.baseURL || "",
    model: boardModel,
    tweetTagModel: boardAi.tweetTagModel || boardModel,
    tweetSummaryModel: boardAi.tweetSummaryModel || boardModel,
    projectAttitudeModel: boardAi.projectAttitudeModel || boardModel,
    contentEnabled: Boolean(runtimeAi.contentEnabled && boardAi.contentEnabled && contentModelReady),
    projectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled && boardAi.projectAttitudeEnabled && attitudeModelReady),
  };
}

function sanitizeBoardAiRuntime(boardAi = {}, runtimeAi = {}) {
  const effective = getEffectiveBoardAiConfig(runtimeAi, boardAi);
  return {
    contentEnabled: Boolean(boardAi.contentEnabled),
    projectAttitudeEnabled: Boolean(boardAi.projectAttitudeEnabled),
    model: boardAi.model || "",
    tweetTagModel: boardAi.tweetTagModel || "",
    tweetSummaryModel: boardAi.tweetSummaryModel || "",
    projectAttitudeModel: boardAi.projectAttitudeModel || "",
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
      tweetTagModel: effective.tweetTagModel || effective.model,
      tweetSummaryModel: effective.tweetSummaryModel || effective.model,
      projectAttitudeModel: effective.projectAttitudeModel || effective.model,
      baseURL: effective.baseURL,
      apiKeyConfigured: Boolean(String(runtimeAi.apiKey || "").trim()),
      globalContentEnabled: Boolean(runtimeAi.contentEnabled),
      globalProjectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled),
      ready: Boolean(String(runtimeAi.apiKey || "").trim() && String(effective.baseURL || "").trim() && effective.model),
    },
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
  const next = {
    ...current,
    contentEnabled: Boolean(input.contentEnabled),
    projectAttitudeEnabled: Boolean(input.projectAttitudeEnabled),
    model: pickStringField(input, current, "model"),
    tweetTagModel: pickStringField(input, current, "tweetTagModel"),
    tweetSummaryModel: pickStringField(input, current, "tweetSummaryModel"),
    projectAttitudeModel: pickStringField(input, current, "projectAttitudeModel"),
    estimatePosts: Math.max(0, Math.floor(toFiniteNumber(hasOwnField(input, "estimatePosts") ? input.estimatePosts : current.estimatePosts, 10000))),
  };
  const wantsAi = next.contentEnabled || next.projectAttitudeEnabled;
  if (wantsAi) {
    const acceptCost = input.acceptCost === true || body.acceptCost === true || input.costAccepted === true || body.costAccepted === true;
    if (!String(runtimeAi.apiKey || "").trim()) throw publicError("AI_API_KEY_NOT_CONFIGURED", 400, "全局 API Key 未配置，不能开启该账号 AI。");
    if (!String(runtimeAi.baseURL || "").trim()) throw publicError("AI_BASE_URL_NOT_CONFIGURED", 400, "全局 Base URL 未配置，不能开启该账号 AI。");
    if (!next.model) throw publicError("BOARD_AI_MODEL_REQUIRED", 400, "开启账号 AI 前必须为这个被监控账号明确选择模型。");
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
  if (!String(boardAi.model || "").trim()) reasons.push("该账号尚未选择模型");
  if (boardAi.contentEnabled && !runtimeAi.contentEnabled) reasons.push("全局内容分析总开关未开启");
  if (boardAi.projectAttitudeEnabled && !runtimeAi.projectAttitudeEnabled) reasons.push("全局项目态度总开关未开启");
  return reasons;
}

function buildAiProgressItem(done = 0, pending = 0, batchSize = 1, intervalMinutes = 15) {
  const safeDone = Math.max(0, Math.floor(toFiniteNumber(done, 0)));
  const safePending = Math.max(0, Math.floor(toFiniteNumber(pending, 0)));
  const total = safeDone + safePending;
  const safeBatchSize = Math.max(1, Math.floor(toFiniteNumber(batchSize, 1)));
  const safeIntervalMinutes = Math.max(1, Math.floor(toFiniteNumber(intervalMinutes, 15)));
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
  const intervalMinutes = 1;
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
    estimatedMinutesRemaining: Math.max(content.estimatedMinutesRemaining, projectAttitude.estimatedMinutesRemaining),
    assumption: "按独立 AI Worker 的每轮批大小估算；有待处理时会连续跑，清空后才按间隔检查；实际耗时会受 LLM 响应、并发、失败重试、账号数量和队列影响。",
  };
}

async function buildBoardAiConfigResponse(board, runtimeConfig, estimatePostsInput = null) {
  const runtimeAi = runtimeConfig.ai || {};
  const boardAi = getBoardAiRuntime(board);
  const stats = await getAiPendingStats({ boardId: board.id });
  const sanitized = sanitizeBoardAiRuntime(boardAi, runtimeAi);
  const estimatePosts = Math.max(
    0,
    Math.floor(toFiniteNumber(estimatePostsInput, sanitized.estimatePosts || Math.max(stats.contentPendingPosts, stats.projectAttitudePendingPosts, 10000)))
  );
  const estimateBoardAi = { ...boardAi, estimatePosts };
  const costEstimate = estimateAiCost(getEffectiveBoardAiConfig(runtimeAi, estimateBoardAi), estimatePosts);
  return {
    board: {
      id: board.id,
      officialHandle: board.officialHandle,
      projectName: board.projectName,
    },
    config: sanitized,
    runtime: sanitizeRuntimeConfig(runtimeConfig).ai,
    stats,
    progress: buildBoardAiProgress(runtimeConfig, stats),
    costEstimate,
    blockingReasons: getBoardAiBlockingReasons(runtimeAi, sanitized),
    rules: [
      "全局 AI 配置只提供 API Key、Base URL、价格估算和总开关。",
      "每个被监控账号的 AI 开关默认关闭；开启前必须为该账号选择模型并确认预估成本。",
      "关闭该账号开关后，后续任务的内容分析/项目态度评价会直接跳过，不再产生该账号 AI 调用。",
    ],
    fieldDocs: AI_CONFIG_FIELD_DOCS,
  };
}

function buildRuntimeConfigDocument(currentConfig = {}, body = {}) {
  const currentAi = currentConfig.ai || {};
  const currentAiWorker = currentConfig.aiWorker || {};
  const inputAi = body.ai && typeof body.ai === "object" ? body.ai : {};
  const inputAiWorker = body.aiWorker && typeof body.aiWorker === "object" ? body.aiWorker : {};
  const apiKeyAction = String(body.apiKeyAction || inputAi.apiKeyAction || "keep").trim().toLowerCase();
  const nextAi = { ...currentAi, ...inputAi };
  const nextAiWorker = { ...currentAiWorker, ...inputAiWorker };
  delete nextAi.apiKeyMasked;
  delete nextAi.apiKeyConfigured;
  delete nextAi.apiKeyAction;

  if (apiKeyAction === "replace") {
    nextAi.apiKey = String(inputAi.apiKey || "").trim();
    if (!nextAi.apiKey) throw publicError("AI_API_KEY_REQUIRED", 400, "选择替换 API Key 时必须填写新 Key。");
  } else if (apiKeyAction === "clear") {
    nextAi.apiKey = "";
  } else {
    nextAi.apiKey = currentAi.apiKey || "";
  }

  return normalizeConfig({
    ...currentConfig,
    version: body.version || currentConfig.version,
    ai: nextAi,
    aiWorker: nextAiWorker,
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
  { field: "model", label: "默认模型", desc: "内容分析和项目态度评价默认使用的模型；专项模型为空时都会回落到它。" },
  { field: "tweetTagModel", label: "标签模型", desc: "可单独指定推文标签/热词生成模型；为空则使用默认模型。" },
  { field: "tweetSummaryModel", label: "摘要模型", desc: "可单独指定中英文摘要模型；为空则使用默认模型。" },
  { field: "projectAttitudeModel", label: "态度模型", desc: "可单独指定项目态度评分模型；为空则使用默认模型。" },
  { field: "contentEnabled", label: "内容分析开关", desc: "开启后每条待处理帖子最多会调用 3 次 AI：标签、中文摘要、英文摘要。" },
  { field: "projectAttitudeEnabled", label: "项目态度开关", desc: "开启后每条待处理帖子调用 1 次 AI，生成 0-10 分、positive/neutral/negative/unknown 和中文原因；无关、证据不足、无法可靠判断不强行归为 neutral。" },
  { field: "contentBatchSize", label: "内容批大小", desc: "AI Worker 每轮每个账号最多分析多少条内容字段；采集任务不再内联跑 AI。" },
  { field: "projectAttitudeBatchSize", label: "态度批大小", desc: "AI Worker 每轮每个账号最多评价多少条项目态度。" },
  { field: "contentConcurrency", label: "内容并发", desc: "内容 AI 的并发帖子数；单帖内部仍可能并行调用中英文摘要。" },
  { field: "projectAttitudeConcurrency", label: "态度并发", desc: "项目态度 AI 的并发帖子数。" },
  { field: "maxTextLength", label: "推文截断长度", desc: "进入 AI Prompt 前的正文硬截断字符数；超长推文会截断并在日志记录 truncated=true。" },
  { field: "negativeScoreThreshold", label: "负面阈值", desc: "项目态度分低于该值时判定为 negative。默认 4。" },
  { field: "positiveScoreThreshold", label: "正面阈值", desc: "项目态度分高于该值时判定为 positive；介于负面和正面阈值之间为 neutral。默认 6。" },
  { field: "temperature", label: "温度", desc: "模型随机性，舆情分类建议保持 0，保证结果稳定可复现。" },
  { field: "maxTokens", label: "默认输出上限", desc: "未配置专项 maxTokens 时使用的输出 token 上限。" },
  { field: "tweetTagMaxTokens", label: "标签输出上限", desc: "推文标签/热词结构化输出的 maxTokens。" },
  { field: "tweetSummaryMaxTokens", label: "摘要输出上限", desc: "单次摘要输出的 maxTokens；中文和英文摘要会分别调用。" },
  { field: "projectAttitudeMaxTokens", label: "态度输出上限", desc: "项目态度评分输出的 maxTokens。" },
  { field: "timeoutMs", label: "超时时间", desc: "单次模型请求超时时间，单位毫秒。" },
  { field: "maxRetries", label: "重试次数", desc: "模型请求失败后的最大重试次数；过高会放大延迟和潜在费用。" },
  { field: "summaryWords", label: "摘要词数", desc: "传给摘要 Prompt 的目标词数/短语长度。" },
  { field: "promptMaxLength", label: "Prompt 最大长度", desc: "运行时或看板级 Prompt 的最大字符长度，防止错误配置导致超长请求。" },
  { field: "estimateInputPricePerMillion", label: "输入单价估算", desc: "用于费用估算的输入 token 单价，单位 USD / 100万 tokens，不影响真实调用。" },
  { field: "estimateOutputPricePerMillion", label: "输出单价估算", desc: "用于费用估算的输出 token 单价，单位 USD / 100万 tokens，不影响真实调用。" },
  { field: "prompts", label: "全局 Prompt 覆盖", desc: "可覆盖 projectAttitude、tweetTag、tweetSummary 的默认 Prompt；看板级 Prompt 优先级更高。" },
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
        apiKeyAction: String(req.body?.apiKeyAction || req.body?.ai?.apiKeyAction || "keep"),
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
        tweetTagModel: next.tweetTagModel,
        tweetSummaryModel: next.tweetSummaryModel,
        projectAttitudeModel: next.projectAttitudeModel,
        estimatePosts: next.estimatePosts,
        costAcceptedAt: next.costAcceptedAt,
        acceptedEstimatedUsd: next.acceptedEstimatedUsd,
        acceptedCalls: next.acceptedCalls,
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
    const snapshot = await EchohuntSocialListeningSnapshot.findOne({
      where: { boardId: board.id, rangeKey },
      order: [["generatedAt", "DESC"]],
      raw: true,
    });
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(board.id),
        rangeKey,
        state: snapshot ? "ready" : (board.status === "failed" ? "failed" : "processing"),
        snapshot: snapshot || null,
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
    const { where, rangeKey } = buildPostWhere(board.id, req.query);
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
    const where = applyExcludeOfficialAccount(
      { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } },
      board
    );
    if (req.query.type) where.signalType = String(req.query.type);
    const result = await EchohuntSocialListeningAccountSignal.findAndCountAll({
      where,
      order: [["occurredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    const rows = await enrichSignalAvatars(result.rows);
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
    const where = applyExcludeSelfMentionAlerts({ boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } });
    if (req.query.type) where.alertType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({
      where,
      order: [["triggeredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    return res.json({ success: true, data: { rangeKey, items: result.rows, page, pageSize, total: result.count } });
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
    const where = applyExcludeSelfMentionAlerts({});
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
    return res.json({ success: true, data: { items: result.rows, page, pageSize, total: result.count } });
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

module.exports = router;
