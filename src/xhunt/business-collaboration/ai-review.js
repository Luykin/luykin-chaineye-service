/**
 * 定向合作草稿 AI 初审。
 * 由草稿提交接口以 fire-and-forget 方式触发；所有异常都在本模块内消化，不向上抛。
 */
const {
  BusinessCollaborationReviewRound,
  BusinessCollaboration,
  BusinessCollaborationInvitation,
  BusinessCollaborationActivity,
  BusinessCollaborationAuditLog,
} = require("../../models/postgres-start");
const { structuredChat } = require("../../lib/llm");
const llmConfig = require("../../lib/llm/config");
const { normalizeGoogleDocUrl, fetchGoogleDocText } = require("./google-doc");

const DRAFT_TEXT_MAX_LENGTH = 20000;
const AI_REVIEW_PROMPT_MAX_LENGTH = 10000;

const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          detail: { type: "string" },
        },
        required: ["point", "detail"],
      },
    },
    summary: { type: "string" },
  },
  required: ["pass", "issues", "summary"],
};

const DEFAULT_AI_REVIEW_SYSTEM_PROMPT = [
  "你是一名定向合作内容审核员，负责初审 KOL 为品牌合作提交的内容草稿。",
  "请根据邀约的 Brief、必须表达事项、内容形式、内容数量和语言要求，判断草稿是否满足合作要求。",
  "只有在草稿存在实质性不符（例如缺失必须表达的事项、内容形式或语言明显不符、内容与 Brief 完全无关）时才判定不通过；",
  "措辞、排版或细节风格问题不应成为不通过的理由。",
  "pass 表示草稿是否实质性满足邀约要求；issues 列出每个实质性问题及其说明；summary 用一两句话总结审核结论。",
].join("\n");

function resolveAiReviewSystemPrompt(activity, snapshot) {
  const candidate = [
    activity?.invitationTemplate?.aiReviewSystemPrompt,
    snapshot?.aiReviewSystemPrompt,
  ].find((item) => typeof item === "string" && item.trim());
  return candidate ? candidate.trim().slice(0, AI_REVIEW_PROMPT_MAX_LENGTH) : DEFAULT_AI_REVIEW_SYSTEM_PROMPT;
}

function formatMultiValue(value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || "").trim()).filter(Boolean);
    return items.length ? items.join("、") : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function resolveReviewRequirements(activity, snapshot = {}) {
  const template = activity?.invitationTemplate && typeof activity.invitationTemplate === "object"
    ? activity.invitationTemplate
    : {};
  const title = formatMultiValue(template.title) || formatMultiValue(snapshot.title) || formatMultiValue(activity?.name) || "（未配置）";
  const brief = formatMultiValue(template.brief) || formatMultiValue(snapshot.brief) || "（未配置）";
  const requiredPoints = formatMultiValue(template.requiredPoints) || formatMultiValue(snapshot.requiredPoints) || "（未配置）";
  const contentFormat = formatMultiValue(template.contentFormat) || formatMultiValue(snapshot.contentFormat) || "（未配置）";
  const language = formatMultiValue(template.language) || formatMultiValue(snapshot.language) || "（未配置）";
  const rawCount = template.contentCount !== undefined && template.contentCount !== null && template.contentCount !== ""
    ? template.contentCount
    : snapshot.contentCount;
  const contentCount = rawCount === null || rawCount === undefined || rawCount === "" ? "（未配置）" : rawCount;
  return { title, brief, requiredPoints, contentFormat, contentCount, language };
}

function buildReviewMessage(snapshot, draftText, activity = null) {
  const reqs = resolveReviewRequirements(activity, snapshot);
  return [
    `邀约标题：${reqs.title}`,
    `合作 Brief：${reqs.brief}`,
    `必须表达事项：${reqs.requiredPoints}`,
    `内容形式：${reqs.contentFormat}`,
    `内容数量：${reqs.contentCount}`,
    `内容语言：${reqs.language}`,
    "",
    "草稿正文：",
    draftText,
  ].join("\n");
}

async function runAiReviewForRound(roundId) {
  try {
    const round = await BusinessCollaborationReviewRound.findByPk(roundId, {
      include: [{
        model: BusinessCollaboration,
        as: "collaboration",
        include: [
          { model: BusinessCollaborationInvitation, as: "invitation" },
          { model: BusinessCollaborationActivity, as: "activity" },
        ],
      }],
    });
    if (!round || !round.collaboration) return;
    if (!["pending", "error"].includes(round.aiStatus)) return;
    const collaboration = round.collaboration;

    await round.update({ aiStatus: "processing" });

    const { documentId } = normalizeGoogleDocUrl(round.draftUrl);
    const fetched = await fetchGoogleDocText(documentId);
    if (!fetched.accessible) {
      await round.update({
        aiStatus: "error",
        aiResult: { error: "doc_fetch_failed", reason: fetched.reason },
        aiReviewedAt: new Date(),
      });
      return;
    }

    const snapshot = collaboration.invitation?.invitationSnapshot || {};
    const draftText = String(fetched.text || "").slice(0, DRAFT_TEXT_MAX_LENGTH);
    const modelVersion = llmConfig.defaultModel;
    const systemPrompt = resolveAiReviewSystemPrompt(collaboration.activity, snapshot);
    const startedAt = Date.now();
    const result = await structuredChat(buildReviewMessage(snapshot, draftText, collaboration.activity), REVIEW_JSON_SCHEMA, {
      systemPrompt,
    });
    const durationMs = Date.now() - startedAt;
    const pass = result?.pass === true;
    const aiResult = {
      pass,
      issues: Array.isArray(result?.issues) ? result.issues : [],
      summary: typeof result?.summary === "string" ? result.summary : "",
      modelVersion,
      durationMs,
    };

    // 写结果前复核：若本轮已被「卡顿兜底」标记为 error（KOL 重提了新草稿），丢弃过期结果，避免覆盖新轮次的流程状态。
    const latest = await BusinessCollaborationReviewRound.findByPk(roundId);
    if (!latest || latest.aiStatus !== "processing") return;

    await latest.update({
      aiStatus: pass ? "passed" : "failed",
      aiResult,
      aiReviewedAt: new Date(),
      ...(pass ? { humanStatus: "pending" } : {}),
    });
    await collaboration.update({ status: pass ? "human_review" : "ai_rejected" });
    await BusinessCollaborationAuditLog.create({
      activityId: collaboration.activityId,
      invitationId: collaboration.invitationId,
      collaborationId: collaboration.id,
      actorAuthCenterUserId: null,
      actorType: "system",
      action: pass ? "ai_review_passed" : "ai_review_failed",
      requestId: null,
      metadata: { roundId: latest.id, modelVersion, durationMs },
    });
  } catch (error) {
    console.error("[business-collaboration] ai review failed:", error);
    try {
      const round = await BusinessCollaborationReviewRound.findByPk(roundId);
      if (round && ["pending", "processing", "error"].includes(round.aiStatus)) {
        await round.update({
          aiStatus: "error",
          aiResult: { error: "llm_error", message: String(error.message || error).slice(0, 500) },
          aiReviewedAt: new Date(),
        });
      }
    } catch (updateError) {
      console.error("[business-collaboration] ai review error state update failed:", updateError);
    }
  }
}

module.exports = {
  AI_REVIEW_PROMPT_MAX_LENGTH,
  DEFAULT_AI_REVIEW_SYSTEM_PROMPT,
  resolveAiReviewSystemPrompt,
  runAiReviewForRound,
};
