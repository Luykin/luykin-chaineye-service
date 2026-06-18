const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { XhuntAdminManager, XhuntAdminAuditLog, XhuntAdminWebAuthnCredential } = require("../../models/postgres-start");
const jwt = require("jsonwebtoken");
const base64url = require("base64url");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { adminAuth, requireRole, requirePermission, setSessionCookie } = require("../middleware/adminAuth");
const { randomBytes, randomUUID } = require("crypto");
const { handleUpload } = require("@vercel/blob/client");
const { chat: llmChat } = require("../../lib/llm");

const router = express.Router();
const execFileAsync = promisify(execFile);

// WebAuthn 配置
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "XHunt Admin";
const RP_ID = process.env.WEBAUTHN_RP_ID || (process.env.ADMIN_COOKIE_DOMAIN || "localhost");
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;
const TEMP_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-me";
const LINK_SECRET = process.env.SUPABASE_LINK_SECRET || "change-me-link";

const ADMIN_BLOB_PREFIX = (process.env.ADMIN_BLOB_PREFIX || "admin-images")
  .replace(/^\/+|\/+$/g, "") || "admin-images";
const ADMIN_BLOB_MAX_SIZE_MB = Math.max(1, Number(process.env.ADMIN_BLOB_MAX_SIZE_MB || 10));
const ADMIN_BLOB_ALLOWED_CONTENT_TYPES = (process.env.ADMIN_BLOB_ALLOWED_CONTENT_TYPES || "image/jpeg,image/png,image/webp,image/gif")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, "../../..");
const GIT_TARGET_RE = /^[0-9A-Za-z._/@+-]{1,160}$/;
const RELEASE_TAG_PREFIX = process.env.ADMIN_DEPLOY_TAG_PREFIX || "prod";

async function runDeployCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: PROJECT_ROOT,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    timeout: options.timeout || 15000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
  });
  return {
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function parseGitCommitLine(line) {
  const [hash, shortHash, author, relativeTime, ...messageParts] = String(line || "").split("\t");
  if (!hash || !shortHash) return null;
  return {
    hash,
    shortHash,
    author: author || "",
    relativeTime: relativeTime || "",
    message: messageParts.join("\t") || "",
  };
}

function parseGitTagLine(line) {
  const [name, hash, shortHash, relativeTime, ...messageParts] = String(line || "").split("\t");
  if (!name || !hash) return null;
  return {
    name,
    hash,
    shortHash: shortHash || hash.slice(0, 7),
    relativeTime: relativeTime || "",
    message: messageParts.join("\t") || "",
  };
}

function getBeijingTimestampForTag(date = new Date()) {
  const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const iso = beijingDate.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 16).replace(":", "")}`;
}

function buildReleaseTagName(commitHash, date = new Date()) {
  return `${RELEASE_TAG_PREFIX}-${getBeijingTimestampForTag(date)}-${String(commitHash || "").slice(0, 7)}`;
}

function buildFallbackReleaseTagMessage(commits, afterHash) {
  const lines = Array.isArray(commits) && commits.length > 0
    ? commits.slice(0, 20).map((commit) => `- ${commit.shortHash || String(commit.hash || "").slice(0, 7)} ${commit.message || "(无提交说明)"}`)
    : [`- 发布 ${String(afterHash || "").slice(0, 12)}`];
  return [
    "生产发布",
    "",
    `目标提交: ${afterHash}`,
    `提交数量: ${Array.isArray(commits) ? commits.length : 0}`,
    "",
    "变更摘要:",
    ...lines,
  ].join("\n").slice(0, 1800);
}

function sanitizeReleaseTagMessage(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, 1800);
}

function extractLlmTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          if (typeof item.text === "string") return item.text;
          if (typeof item.content === "string") return item.content;
          if (typeof item.output_text === "string") return item.output_text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.output_text === "string") return content.output_text;
    if (Array.isArray(content.blocks)) return extractLlmTextContent(content.blocks);
  }
  return "";
}

function sanitizeReleaseTagName(value) {
  const tagName = String(value || "").trim();
  if (!/^[0-9A-Za-z._-]{3,120}$/.test(tagName) || tagName.startsWith("-") || tagName.includes("..")) {
    const err = new Error("Tag 名称不合法，仅支持字母、数字、点、下划线和中划线");
    err.statusCode = 400;
    throw err;
  }
  return tagName;
}

async function generateReleaseTagMessage(commits, beforeHash, afterHash) {
  const fallback = buildFallbackReleaseTagMessage(commits, afterHash);
  if (!process.env.LLM_API_KEY) {
    return { message: fallback, source: "fallback" };
  }

  try {
    const commitText = (commits || [])
      .slice(0, 30)
      .map((commit) => `${commit.shortHash || String(commit.hash || "").slice(0, 7)} ${commit.message || ""}`)
      .join("\n");
    const content = await llmChat(
      [
        `发布前版本: ${beforeHash}`,
        `发布后版本: ${afterHash}`,
        "本次发布提交:",
        commitText || "(无提交列表)",
      ].join("\n"),
      {
        temperature: 0.2,
        maxTokens: 500,
        systemPrompt: [
          "你是生产发布助手。请根据 Git commit 列表生成一段中文 Git annotated tag 描述。",
          "要求:",
          "1. 只输出 tag 描述正文，不要 Markdown 代码块。",
          "2. 第一行是 20 字以内中文标题。",
          "3. 后面用 3-6 条中文要点总结主要改动。",
          "4. 不要编造 commit 中没有的信息。",
        ].join("\n"),
      }
    );
    const message = extractLlmTextContent(content).trim();
    return { message: message ? message.slice(0, 1800) : fallback, source: message ? "ai" : "fallback" };
  } catch (e) {
    console.warn("[admin-deploy] AI tag message generation failed:", e?.message);
    return { message: fallback, source: "fallback" };
  }
}

async function createReleaseTag({ commits, beforeHash, afterHash, tagNameOverride, tagMessageOverride, tagMessageSource }) {
  let tagName;
  if (tagNameOverride) {
    tagName = sanitizeReleaseTagName(tagNameOverride);
    if ((await runDeployCommand("git", ["tag", "--list", tagName])).stdout.trim()) {
      const err = new Error(`Tag 已存在：${tagName}`);
      err.statusCode = 409;
      throw err;
    }
  } else {
    const baseName = buildReleaseTagName(afterHash);
    tagName = baseName;
    for (let index = 2; index <= 20; index += 1) {
      const exists = (await runDeployCommand("git", ["tag", "--list", tagName])).stdout.trim();
      if (!exists) break;
      tagName = `${baseName}-${index}`;
    }
    if ((await runDeployCommand("git", ["tag", "--list", tagName])).stdout.trim()) {
      throw new Error("无法生成唯一发布 tag");
    }
  }

  const sanitizedOverride = sanitizeReleaseTagMessage(tagMessageOverride);
  const overrideSource = ["ai", "fallback", "manual"].includes(tagMessageSource) ? tagMessageSource : "manual";
  const tagMessage = sanitizedOverride
    ? { message: sanitizedOverride, source: overrideSource }
    : await generateReleaseTagMessage(commits, beforeHash, afterHash);
  const tagResult = await runDeployCommand("git", ["tag", "-a", tagName, afterHash, "-m", tagMessage.message], {
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      GIT_AUTHOR_NAME: process.env.ADMIN_DEPLOY_GIT_NAME || "XHunt Admin Deploy",
      GIT_AUTHOR_EMAIL: process.env.ADMIN_DEPLOY_GIT_EMAIL || "admin@cryptohunt.ai",
      GIT_COMMITTER_NAME: process.env.ADMIN_DEPLOY_GIT_NAME || "XHunt Admin Deploy",
      GIT_COMMITTER_EMAIL: process.env.ADMIN_DEPLOY_GIT_EMAIL || "admin@cryptohunt.ai",
    },
  });

  let pushed = false;
  let pushOutput = null;
  if (process.env.ADMIN_DEPLOY_PUSH_TAGS === "true") {
    const pushResult = await runDeployCommand("git", ["push", "origin", tagName], {
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    pushed = true;
    pushOutput = { stdout: pushResult.stdout.slice(-4000), stderr: pushResult.stderr.slice(-4000) };
  }

  return {
    tagName,
    message: tagMessage.message,
    messageSource: tagMessage.source,
    pushed,
    pushOutput,
    stdout: tagResult.stdout,
    stderr: tagResult.stderr,
  };
}

async function getExistingReleaseTag(tagName, expectedHash) {
  const sanitizedTagName = sanitizeReleaseTagName(tagName);
  const exists = (await runDeployCommand("git", ["tag", "--list", sanitizedTagName])).stdout.trim();
  if (!exists) {
    const err = new Error(`请先创建发布 Tag：${sanitizedTagName}`);
    err.statusCode = 409;
    throw err;
  }
  const tagHash = (await runDeployCommand("git", ["rev-parse", `${sanitizedTagName}^{commit}`])).stdout;
  if (expectedHash && tagHash !== expectedHash) {
    const err = new Error(`Tag ${sanitizedTagName} 指向 ${tagHash.slice(0, 12)}，不是本次发布目标 ${expectedHash.slice(0, 12)}`);
    err.statusCode = 409;
    throw err;
  }
  const message = (await runDeployCommand("git", ["tag", "-l", sanitizedTagName, "--format=%(contents)"], { maxBuffer: 1024 * 1024 })).stdout;
  return {
    tagName: sanitizedTagName,
    message,
    messageSource: "existing",
    pushed: false,
    pushOutput: null,
    stdout: "",
    stderr: "",
  };
}

function isSafeGitTarget(target) {
  const value = String(target || "").trim();
  return !!value && !value.startsWith("-") && GIT_TARGET_RE.test(value);
}

async function getDeployStatusData() {
  const [currentRaw, branchRaw, statusRaw, commitsRaw, tagsRaw, originMainRaw] = await Promise.all([
    runDeployCommand("git", ["log", "-1", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s"]),
    runDeployCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runDeployCommand("git", ["status", "--porcelain"], { maxBuffer: 512 * 1024 }),
    runDeployCommand("git", ["log", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s", "-40"], { maxBuffer: 2 * 1024 * 1024 }),
    runDeployCommand("git", [
      "for-each-ref",
      "--sort=-creatordate",
      "--count=40",
      "--format=%(refname:short)%09%(objectname)%09%(objectname:short)%09%(creatordate:relative)%09%(subject)",
      "refs/tags",
    ], { maxBuffer: 1024 * 1024 }),
    runDeployCommand("git", ["rev-parse", "--verify", "origin/main"], { timeout: 8000 }).catch(() => ({ stdout: "", stderr: "" })),
  ]);

  const current = parseGitCommitLine(currentRaw.stdout);
  return {
    projectRoot: PROJECT_ROOT,
    current,
    branch: branchRaw.stdout || "",
    dirty: !!statusRaw.stdout,
    dirtyFiles: statusRaw.stdout ? statusRaw.stdout.split("\n").filter(Boolean).slice(0, 80) : [],
    recentCommits: commitsRaw.stdout.split("\n").map(parseGitCommitLine).filter(Boolean),
    tags: tagsRaw.stdout.split("\n").map(parseGitTagLine).filter(Boolean),
    originMain: originMainRaw.stdout || "",
    restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
  };
}

async function getReleaseStatusData() {
  const [currentRaw, remoteRaw, branchRaw, statusRaw, pendingRaw, aheadRaw] = await Promise.all([
    runDeployCommand("git", ["log", "-1", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s"]),
    runDeployCommand("git", ["log", "-1", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s", "origin/main"]).catch(() => ({ stdout: "", stderr: "" })),
    runDeployCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runDeployCommand("git", ["status", "--porcelain"], { maxBuffer: 512 * 1024 }),
    runDeployCommand("git", ["log", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s", "HEAD..origin/main"], { maxBuffer: 2 * 1024 * 1024 }).catch(() => ({ stdout: "", stderr: "" })),
    runDeployCommand("git", ["log", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s", "origin/main..HEAD"], { maxBuffer: 2 * 1024 * 1024 }).catch(() => ({ stdout: "", stderr: "" })),
  ]);
  const current = parseGitCommitLine(currentRaw.stdout);
  const remote = parseGitCommitLine(remoteRaw.stdout);
  const pendingCommits = pendingRaw.stdout.split("\n").map(parseGitCommitLine).filter(Boolean);
  const aheadCommits = aheadRaw.stdout.split("\n").map(parseGitCommitLine).filter(Boolean);

  return {
    projectRoot: PROJECT_ROOT,
    branch: branchRaw.stdout || "",
    dirty: !!statusRaw.stdout,
    dirtyFiles: statusRaw.stdout ? statusRaw.stdout.split("\n").filter(Boolean).slice(0, 80) : [],
    current,
    remote,
    pendingCommits,
    aheadCommits,
    hasUpdate: pendingCommits.length > 0,
    suggestedTagName: remote?.hash ? buildReleaseTagName(remote.hash) : null,
    tagPrefix: RELEASE_TAG_PREFIX,
    pushTagsEnabled: process.env.ADMIN_DEPLOY_PUSH_TAGS === "true",
    restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
  };
}

async function assertGitTarget(target, targetType) {
  const value = String(target || "").trim();
  if (!isSafeGitTarget(value)) {
    const err = new Error("回滚目标不合法");
    err.statusCode = 400;
    throw err;
  }

  if (targetType === "tag") {
    const tags = (await runDeployCommand("git", ["tag", "--list", value])).stdout.split("\n").filter(Boolean);
    if (!tags.includes(value)) {
      const err = new Error("Tag 不存在");
      err.statusCode = 400;
      throw err;
    }
  } else if (targetType === "commit") {
    if (!/^[0-9a-fA-F]{7,40}$/.test(value)) {
      const err = new Error("提交必须使用 7-40 位 commit hash");
      err.statusCode = 400;
      throw err;
    }
  } else {
    const err = new Error("targetType 只能是 commit 或 tag");
    err.statusCode = 400;
    throw err;
  }

  await runDeployCommand("git", ["cat-file", "-e", `${value}^{commit}`]);
  const resolved = (await runDeployCommand("git", ["rev-parse", `${value}^{commit}`])).stdout;
  return { target: value, resolvedHash: resolved };
}

async function getLostCommits(target) {
  const range = `${target}..HEAD`;
  const raw = await runDeployCommand("git", ["log", "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s", range], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return raw.stdout.split("\n").map(parseGitCommitLine).filter(Boolean);
}

function schedulePm2Restart(reason) {
  const target = process.env.ADMIN_DEPLOY_PM2_TARGET || "all";
  setTimeout(async () => {
    try {
      console.log(`[admin-deploy] restarting pm2 target=${target}, reason=${reason}`);
      await runDeployCommand("pm2", ["restart", target], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      console.log(`[admin-deploy] pm2 restart done, target=${target}`);
    } catch (e) {
      console.error("[admin-deploy] pm2 restart failed:", e?.message);
    }
  }, 1200);
}

async function createDeployAudit(req, action, success, message) {
  try {
    await XhuntAdminAuditLog.create({
      adminId: req.adminUser?.id,
      email: req.adminUser?.email,
      action,
      route: req.originalUrl || req.path,
      method: req.method,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      success,
      message: typeof message === "string" ? message : JSON.stringify(message),
    });
  } catch (_) {}
}

function parseRawCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) continue;
    out[key] = decodeURIComponent(valueParts.join("="));
  }
  return out;
}

async function getAdminFromRequest(req) {
  const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
  const cookies = { ...parseRawCookies(req.headers.cookie || ""), ...(req.cookies || {}) };
  const token = cookies[cookieName];
  if (!token) return null;

  let session;
  try {
    session = jwt.verify(token, process.env.ADMIN_JWT_SECRET || "change-me");
  } catch (e) {
    return null;
  }

  const admin = await XhuntAdminManager.findByPk(session.id);
  if (!admin || !admin.isActive || !admin.canLogin) return null;
  return admin;
}

function adminCanUploadAssets(admin) {
  if (!admin) return false;
  if (admin.role === "super") return true;
  const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
  return permissions.includes("*") || permissions.includes("assets:upload");
}

function assertValidBlobPath(pathname) {
  const value = String(pathname || "").replace(/\\+/g, "/");
  if (!value || value.length > 220) {
    throw new Error("上传路径无效");
  }
  if (value.startsWith("/") || value.includes("..") || value.includes("//")) {
    throw new Error("上传路径不允许包含危险字符");
  }
  if (!value.startsWith(`${ADMIN_BLOB_PREFIX}/`)) {
    throw new Error(`上传路径必须位于 ${ADMIN_BLOB_PREFIX}/ 目录下`);
  }
  if (!/\.(jpe?g|png|webp|gif)$/i.test(value)) {
    throw new Error("仅支持 jpg、png、webp、gif 图片");
  }
  return value;
}


function getCredentialKeyFromAssertion(assertion) {
  if (typeof assertion?.id === "string") return assertion.id;
  if (typeof assertion?.rawId === "string") return assertion.rawId;
  return null;
}

function buildAuthenticatorFromCredential(row) {
  return {
    credentialID: base64url.toBuffer(row.credentialId),
    credentialPublicKey: base64url.toBuffer(row.publicKey),
    counter: Number(row.counter || 0),
  };
}

function getBackupRestoreReauthKey(adminId) {
  return `admin:webauthn:reauth:backup-restore:${adminId}`;
}

function generateAdminLoginPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "";
  const bytes = randomBytes(18);
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }
  return password;
}

async function getLoggedInAdminForJson(req, res) {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "请先登录" });
    return null;
  }
  return admin;
}

function parseClientPayload(payload) {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

// 登录页面由 React Admin 承载；保留 /admin/login 作为兼容入口。
router.get("/login", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const nextRaw = typeof req.query?.next === "string" ? req.query.next : "/overview";
  const next = nextRaw.startsWith("/admin-react/") ? nextRaw.replace("/admin-react", "") : nextRaw.startsWith("/") ? nextRaw : "/overview";
  return res.redirect(302, `/api/xhunt/stats#/login?next=${encodeURIComponent(next)}`);
});

// 提供给 Nginx auth_request 的轻量会话校验端点：会话有效返回 204
router.get("/auth-check", adminAuth, async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    return res.status(204).end();
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

// 提供给 React Admin 的当前管理员会话信息
router.get("/session", adminAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const admin = req.adminUser;
    return res.json({
      success: true,
      loggedIn: true,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
        receivesDailyReport: !!admin.receivesDailyReport,
        isActive: !!admin.isActive,
        canLogin: !!admin.canLogin,
        lastLoginAt: admin.lastLoginAt || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "获取会话信息失败" });
  }
});

// ========== WebAuthn 注册（添加指纹/人脸） ==========
router.get("/webauthn/registration/options", async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    // 手动校验已登录会话（避免使用 adminAuth 导致 HTML 重定向）
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const rawCookie = req.cookies?.[cookieName] || (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.split('=')[1];
    if (!rawCookie) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    let session;
    try { session = jwt.verify(rawCookie, process.env.ADMIN_JWT_SECRET || 'change-me'); } catch (e) { return res.status(401).json({ success: false, error: 'UNAUTHORIZED' }); }
    const admin = await XhuntAdminManager.findByPk(session.id);
    if (!admin || !admin.isActive || !admin.canLogin) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const existing = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const excludeCredentials = existing.map(c => ({ id: base64url.toBuffer(c.credentialId), type: "public-key" }));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: String(admin.id),
      userName: admin.email,
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred", authenticatorAttachment: "platform" },
    });
    const challengeKey = `webauthn:reg:challenge:${admin.id}`;
    await req.redisClient.set(challengeKey, options.challenge, { EX: 300 });
    res.json({ success: true, options });
  } catch (e) {
    res.status(500).json({ success: false, error: "生成注册参数失败" });
  }
});

router.post("/webauthn/registration/verify", express.json(), async (req, res) => {
  try {
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const rawCookie = req.cookies?.[cookieName] || (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.split('=')[1];
    if (!rawCookie) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    let session;
    try { session = jwt.verify(rawCookie, process.env.ADMIN_JWT_SECRET || 'change-me'); } catch (e) { return res.status(401).json({ success: false, error: 'UNAUTHORIZED' }); }
    const admin = await XhuntAdminManager.findByPk(session.id);
    if (!admin || !admin.isActive || !admin.canLogin) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const { attResp, nickname } = req.body || {};
    const challengeKey = `webauthn:reg:challenge:${admin.id}`;
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "注册超时" });

    const verification = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) return res.status(400).json({ success: false, error: "注册校验失败" });

    const { credentialPublicKey, credentialID, counter, aaguid } = registrationInfo;
    const credentialIdB64 = base64url.encode(Buffer.from(credentialID));
    const publicKeyB64 = base64url.encode(Buffer.from(credentialPublicKey));

    await XhuntAdminWebAuthnCredential.create({
      adminId: admin.id,
      credentialId: credentialIdB64,
      publicKey: publicKeyB64,
      counter: counter || 0,
      aaguid: aaguid || null,
      deviceType: registrationInfo.credentialDeviceType || null,
      backedUp: registrationInfo.credentialBackedUp ?? null,
      nickname: (typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : null,
      lastUsedAt: null,
    });

    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-register", route: "/admin/webauthn/registration/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    await req.redisClient.del(challengeKey);
    res.json({ success: true });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: null, email: null, action: "webauthn-register", route: "/admin/webauthn/registration/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "注册失败" });
  }
});

// ========== WebAuthn 认证（登录二次验证） ==========
router.get("/webauthn/authentication/options", async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    const { tempToken } = req.query || {};
    if (!tempToken) return res.status(400).json({ success: false, error: "缺少参数" });
    let decoded;
    try { decoded = jwt.verify(String(tempToken), TEMP_JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: "无效的会话" }); }
    if (decoded.step !== "pwd-ok") return res.status(401).json({ success: false, error: "无效的会话" });

    const admin = await XhuntAdminManager.findByPk(decoded.aid);
    if (!admin) return res.status(404).json({ success: false, error: "管理员不存在" });

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const allowCredentials = creds.map(c => ({ id: base64url.toBuffer(c.credentialId), type: "public-key" }));
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
      allowCredentials,
    });
    const challengeKey = `webauthn:auth:challenge:${admin.id}`;
    await req.redisClient.set(challengeKey, options.challenge, { EX: 300 });
    res.json({ success: true, options });
  } catch (e) {
    res.status(500).json({ success: false, error: "生成认证参数失败" });
  }
});

router.post("/webauthn/authentication/verify", express.json(), async (req, res) => {
  try {
    const { tempToken, assertion } = req.body || {};
    if (!tempToken || !assertion) return res.status(400).json({ success: false, error: "缺少参数" });
    let decoded;
    try { decoded = jwt.verify(String(tempToken), TEMP_JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: "无效的会话" }); }
    if (decoded.step !== "pwd-ok") return res.status(401).json({ success: false, error: "无效的会话" });

    const admin = await XhuntAdminManager.findByPk(decoded.aid);
    if (!admin) return res.status(404).json({ success: false, error: "管理员不存在" });
    const challengeKey = `webauthn:auth:challenge:${admin.id}`;
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "认证超时" });

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const credentialLookup = new Map(creds.map(c => [c.credentialId, c]));

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: (function () {
        // SimpleWebAuthn Browser 返回的 assertion.id 通常为 base64url 字符串，与我们存储的一致
        const credKey = getCredentialKeyFromAssertion(assertion);
        const found = credKey ? credentialLookup.get(credKey) : null;
        return found ? buildAuthenticatorFromCredential(found) : null;
      })(),
    });

    const { verified, authenticationInfo } = verification;
    if (!verified || !authenticationInfo) return res.status(401).json({ success: false, error: "验证失败" });

    // 更新 counter 与 lastUsedAt
    const credId = base64url.encode(Buffer.from(authenticationInfo.credentialID));
    const row = await XhuntAdminWebAuthnCredential.findOne({ where: { credentialId: credId, adminId: admin.id } });
    if (row) {
      row.counter = Number(authenticationInfo.newCounter || authenticationInfo.counter || 0);
      row.lastUsedAt = new Date();
      await row.save();
    }

    await admin.update({ lastLoginAt: new Date() });
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-auth", route: "/admin/webauthn/authentication/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    await req.redisClient.del(challengeKey);
    res.json({ success: true, redirect: "/overview" });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: null, email: null, action: "webauthn-auth", route: "/admin/webauthn/authentication/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "验证失败" });
  }
});


// ========== WebAuthn 二次验证：备份恢复高危入口 ==========
router.get("/webauthn/backup-restore/options", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const admin = await getLoggedInAdminForJson(req, res);
    if (!admin) return;

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    if (!creds.length) {
      return res.status(403).json({
        success: false,
        error: "需要先录入生物识别",
        code: "WEBAUTHN_NOT_ENROLLED",
        message: "备份恢复必须先在当前管理员账号录入指纹 / Face ID / 通行密钥",
      });
    }

    const allowCredentials = creds.map((credential) => ({
      id: base64url.toBuffer(credential.credentialId),
      type: "public-key",
    }));
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
      allowCredentials,
    });
    const challengeKey = `webauthn:backup-restore:challenge:${admin.id}`;
    await req.redisClient.set(challengeKey, options.challenge, { EX: 300 });
    res.json({ success: true, options });
  } catch (e) {
    console.error("[webauthn backup restore options] error:", e);
    res.status(500).json({ success: false, error: "生成备份恢复验证参数失败" });
  }
});

router.post("/webauthn/backup-restore/verify", express.json(), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const admin = await getLoggedInAdminForJson(req, res);
    if (!admin) return;

    const { assertion } = req.body || {};
    if (!assertion) return res.status(400).json({ success: false, error: "缺少验证结果" });

    const challengeKey = `webauthn:backup-restore:challenge:${admin.id}`;
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "认证超时，请重新验证" });

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    if (!creds.length) {
      return res.status(403).json({
        success: false,
        error: "需要先录入生物识别",
        code: "WEBAUTHN_NOT_ENROLLED",
      });
    }

    const credentialLookup = new Map(creds.map((credential) => [credential.credentialId, credential]));
    const credKey = getCredentialKeyFromAssertion(assertion);
    const credential = credKey ? credentialLookup.get(credKey) : null;
    if (!credential) return res.status(401).json({ success: false, error: "未识别的生物识别凭证" });

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: buildAuthenticatorFromCredential(credential),
      requireUserVerification: true,
    });

    const { verified, authenticationInfo } = verification;
    if (!verified || !authenticationInfo) return res.status(401).json({ success: false, error: "验证失败" });

    credential.counter = Number(authenticationInfo.newCounter || authenticationInfo.counter || 0);
    credential.lastUsedAt = new Date();
    await credential.save();

    await req.redisClient.del(challengeKey);
    await req.redisClient.set(getBackupRestoreReauthKey(admin.id), "1", { EX: 10 * 60 });

    try {
      await XhuntAdminAuditLog.create({
        adminId: admin.id,
        email: admin.email,
        action: "webauthn-backup-restore-reauth",
        route: "/admin/webauthn/backup-restore/verify",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
      });
    } catch (e) {}

    res.json({ success: true, expiresInSeconds: 10 * 60 });
  } catch (e) {
    console.error("[webauthn backup restore verify] error:", e);
    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser?.id || null,
        email: req.adminUser?.email || null,
        action: "webauthn-backup-restore-reauth",
        route: "/admin/webauthn/backup-restore/verify",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: false,
        message: e.message,
      });
    } catch (_) {}
    res.status(500).json({ success: false, error: "备份恢复二次验证失败" });
  }
});

// ========== 凭证管理 ==========
router.get("/webauthn/credentials", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const rows = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id }, order: [["updatedAt", "DESC"]] });
    res.json({ success: true, credentials: rows.map(r => ({ id: r.id, nickname: r.nickname, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt })) });
  } catch (e) {
    res.status(500).json({ success: false, error: "获取失败" });
  }
});

router.delete("/webauthn/credentials/:id", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: "参数无效" });
    const row = await XhuntAdminWebAuthnCredential.findOne({ where: { id, adminId: admin.id } });
    if (!row) return res.status(404).json({ success: false, error: "未找到" });
    await row.destroy();
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-delete", route: `/admin/webauthn/credentials/${id}`, method: "DELETE", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "删除失败" });
  }
});

// 发送管理员密码修改验证码（发送到当前登录管理员邮箱）
router.post("/password/send-code", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const email = admin.email;
    // 生成 6 位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `admin:pwdreset:${email}`;
    // 存入 Redis，10 分钟有效
    await req.redisClient.set(key, code, { EX: 600 });

    // 使用邮件服务发送验证码
    const emailService = require("../../services/emailService");
    
    await emailService.sendEmail(
      email,
      "XHunt 管理员修改密码验证码",
      `<p>您的验证码是 <b>${code}</b>，10 分钟内有效。</p>`,
      `您的验证码是 ${code}，10 分钟内有效。`
    );

    

    try { 
      await XhuntAdminAuditLog.create({ 
        adminId: admin.id, 
        email, 
        action: "password-send-code", 
        route: "/admin/password/send-code", 
        method: "POST", 
        ip: req.ip || "", 
        userAgent: req.headers["user-agent"] || "", 
        success: true 
      }); 
    } catch (e) {}
    
    return res.json({ success: true });
  } catch (e) {
    // 检查是否是认证失败错误
    const isAuthError = e.message && (
      e.message.includes('535') || 
      e.message.includes('Authentication unsuccessful') ||
      e.message.includes('basic authentication is disabled')
    );

    console.error(`[admin/password/send-code] ❌ 发送验证码失败:`, {
      email: req.adminUser?.email,
      error: e.message,
      stack: e.stack,
      nodemailerError: e.responseCode ? `SMTP错误码: ${e.responseCode}, 响应: ${e.response}` : undefined,
      command: e.command,
      isAuthError: isAuthError
    });

    try { 
      await XhuntAdminAuditLog.create({ 
        adminId: req.adminUser?.id, 
        email: req.adminUser?.email, 
        action: "password-send-code", 
        route: "/admin/password/send-code", 
        method: "POST", 
        ip: req.ip || "", 
        userAgent: req.headers["user-agent"] || "", 
        success: false, 
        message: e.message 
      }); 
    } catch (_) {}

    // 如果是认证错误，提供更详细的错误信息
    if (isAuthError) {
      
      return res.status(500).json({ 
        success: false, 
        error: "邮件发送失败：Office 365 基本认证已被禁用",
        message: "Office 365 已完全禁用基本认证（SMTP AUTH）。解决方案：1) 联系管理员在 Azure Portal 启用 SMTP AUTH 2) 使用其他邮件服务（如 SendGrid、Gmail）3) 配置 OAuth2 认证。详细步骤请查看服务器日志。"
      });
    }

    res.status(500).json({ success: false, error: "发送失败" });
  }
});

// 使用验证码重置当前登录管理员密码
router.post("/password/reset", adminAuth, express.json(), async (req, res) => {
  try {
    const admin = req.adminUser;
    const email = admin.email;
    const { code, newPassword } = req.body || {};
    if (!code || !newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: "参数无效（密码至少8位）" });
    }
    const key = `admin:pwdreset:${email}`;
    const cached = await req.redisClient.get(key);
    if (!cached || cached !== code) {
      return res.status(400).json({ success: false, error: "验证码错误或已过期" });
    }
    const adminRow = await XhuntAdminManager.findByPk(admin.id);
    if (!adminRow) return res.status(404).json({ success: false, error: "管理员不存在" });
    const hash = await bcrypt.hash(newPassword, 10);
    adminRow.passwordHash = hash;
    await adminRow.save();
    await req.redisClient.del(key);
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email, action: "password-reset", route: "/admin/password/reset", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser?.id, email: req.adminUser?.email, action: "password-reset", route: "/admin/password/reset", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "重置失败" });
  }
});

// 登录提交
router.post("/login", express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: "缺少参数" });

    const admin = await XhuntAdminManager.findOne({ where: { email } });
    if (!admin) {
      return res.status(401).json({ success: false, error: "邮箱或密码错误" });
    }
    if (!admin.isActive || !admin.canLogin) {
      return res.status(423).json({ success: false, error: "账号已被锁定，请联系管理员" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      try {
        const key = `admin:loginfail:${email}`;
        const count = await req.redisClient.incr(key);
        if (count === 1) {
          await req.redisClient.expire(key, 12 * 60 * 60);
        }
        if (count >= 6) {
          await admin.update({ canLogin: false });
          await req.redisClient.del(key);
          try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "account-lock", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: `failed attempts: ${count}` }); } catch (e) {}
          return res.status(423).json({ success: false, error: "账号已被锁定，请联系管理员" });
        }
      } catch (e) {}
      return res.status(401).json({ success: false, error: "邮箱或密码错误" });
    }

    // 判断是否存在 WebAuthn 凭证
    const credCount = await XhuntAdminWebAuthnCredential.count({ where: { adminId: admin.id } });

    try { const key = `admin:loginfail:${email}`; await req.redisClient.del(key); } catch (e) {}

    if (credCount > 0) {
      // 需要二次验证：签发一个临时 token（5 分钟有效），不下发会话
      const tempToken = jwt.sign({ aid: admin.id, email: admin.email, step: "pwd-ok" }, TEMP_JWT_SECRET, { expiresIn: 300 });
      try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "login-password-ok", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: `credCount=${credCount}` }); } catch (e) {}
      res.set('Cache-Control','no-store');
      res.type('application/json');
      return res.json({ success: true, needsWebAuthn: true, tempToken, credCount });
    }

    // 无凭证：直接登录
    await admin.update({ lastLoginAt: new Date() });
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "login", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: `credCount=${credCount}` }); } catch (e) {}
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });
    res.set('Cache-Control','no-store');
    res.type('application/json');
    res.json({ success: true, redirect: "/overview", credCount });
  } catch (e) {
    console.error("[admin login] error:", e);
    res.status(500).json({ success: false, error: "登录失败" });
  }
});

// Vercel Blob 浏览器直传：后端只签发短期上传凭证，不接收图片文件
router.post("/uploads/blob", async (req, res) => {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ success: false, error: "缺少 BLOB_READ_WRITE_TOKEN 配置" });
    }

    const body = req.body || {};
    const isGenerateTokenEvent = body.type === "blob.generate-client-token";
    let currentAdmin = null;

    const jsonResponse = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (isGenerateTokenEvent) {
          const requestedWith = String(req.headers["x-requested-with"] || "").toLowerCase();
          if (requestedWith !== "xmlhttprequest") {
            throw new Error("非法上传请求");
          }
        }

        currentAdmin = await getAdminFromRequest(req);
        if (!currentAdmin) {
          throw new Error("请先登录后再上传图片");
        }
        if (!adminCanUploadAssets(currentAdmin)) {
          throw new Error("当前账号没有图片上传权限");
        }

        const safePathname = assertValidBlobPath(pathname);
        const payload = parseClientPayload(clientPayload);
        const requestedMaxSizeMb = Number(payload.maxSizeMb || ADMIN_BLOB_MAX_SIZE_MB);
        const purposeMaxSizeMb = payload.purpose === "banner-image" ? 3 : ADMIN_BLOB_MAX_SIZE_MB;
        const maximumSizeInBytes = Math.round(
          Math.max(1, Math.min(requestedMaxSizeMb, purposeMaxSizeMb, ADMIN_BLOB_MAX_SIZE_MB)) * 1024 * 1024
        );
        try {
          await XhuntAdminAuditLog.create({
            adminId: currentAdmin.id,
            email: currentAdmin.email,
            action: "blob-upload-token",
            route: "/admin/uploads/blob",
            method: "POST",
            ip: req.ip || "",
            userAgent: req.headers["user-agent"] || "",
            success: true,
            message: JSON.stringify({ pathname: safePathname, multipart: !!multipart, purpose: payload.purpose || null }),
          });
        } catch (e) {}

        return {
          allowedContentTypes: ADMIN_BLOB_ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes,
          addRandomSuffix: true,
          cacheControlMaxAge: 60 * 60 * 24 * 30,
          tokenPayload: JSON.stringify({
            adminId: currentAdmin.id,
            email: currentAdmin.email,
            pathname: safePathname,
            purpose: payload.purpose || "admin-image",
          }),
        };
      },
    });

    res.set("Cache-Control", "no-store");
    return res.status(200).json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成上传凭证失败";
    const status = /登录/.test(message) ? 401 : /权限/.test(message) ? 403 : /BLOB_READ_WRITE_TOKEN/.test(message) ? 500 : 400;
    try {
      await XhuntAdminAuditLog.create({
        adminId: null,
        email: null,
        action: "blob-upload-token",
        route: "/admin/uploads/blob",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: false,
        message,
      });
    } catch (_e) {}
    return res.status(status).json({ success: false, error: message });
  }
});

// 登出
router.post("/logout", adminAuth, async (req, res) => {
  try {
    try { const u = req.adminUser; if (u) { await XhuntAdminAuditLog.create({ adminId: u.id, email: u.email, action: "logout", route: "/admin/logout", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } } catch (e) {}
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const secure = (process.env.ADMIN_COOKIE_SECURE || "false").toLowerCase() === "true";
    const domain = process.env.ADMIN_COOKIE_DOMAIN || undefined;
    res.cookie(cookieName, "", { httpOnly: true, sameSite: "lax", secure, domain, expires: new Date(0), path: "/" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// 管理员列表（用于配置是否接收日报）
router.get("/users", adminAuth, async (req, res) => {
  try {
    const rows = await XhuntAdminManager.findAll({ attributes: ["id", "email", "role", "receivesDailyReport", "isActive", "canLogin", "lastLoginAt", "permissions"], order: [["id", "ASC"]] });
    const creds = await XhuntAdminWebAuthnCredential.findAll({ attributes: ["adminId"] });
    const counts = {};
    for (const c of creds) { const aid = c.adminId; counts[aid] = (counts[aid] || 0) + 1; }
    res.json({ success: true, data: rows.map(r => ({ id: r.id, email: r.email, role: r.role, receivesDailyReport: r.receivesDailyReport, isActive: r.isActive, canLogin: r.canLogin, lastLoginAt: r.lastLoginAt, permissions: r.permissions, webauthnCount: counts[r.id] || 0 })) });
  } catch (e) {
    res.status(500).json({ success: false, error: "加载失败" });
  }
});

// 新增管理员（需要 admin:manage-permissions）
router.post("/users", adminAuth, requirePermission("admin:manage-permissions"), express.json(), async (req, res) => {
  try {
    const { email, password, role = "admin", permissions } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, error: "邮箱无效" });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ success: false, error: "密码至少8位" });
    }
    if (role !== "admin" && role !== "super") {
      return res.status(400).json({ success: false, error: "角色无效" });
    }

    // 权限数组可选
    let perms = [];
    if (Array.isArray(permissions)) {
      perms = permissions.filter((p) => typeof p === "string").map((p) => p.trim()).filter((p) => p.length > 0);
    }

    // 仅 super 可分配 管理员列表/操作记录 相关权限
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "admin:manage-permissions", "audit-logs:read", "deploy:rollback", "deploy:release"]);
    if (req.adminUser.role !== "super") {
      const containsRestricted = perms.some((p) => RESTRICTED.has(p));
      if (containsRestricted) {
        return res.status(403).json({ success: false, error: "仅 super 可配置管理员相关权限" });
      }
    }

    const exists = await XhuntAdminManager.findOne({ where: { email } });
    if (exists) {
      return res.status(409).json({ success: false, error: "邮箱已存在" });
    }

    const hash = await bcrypt.hash(password, 10);
    const row = await XhuntAdminManager.create({
      email,
      passwordHash: hash,
      role,
      isActive: true,
      canLogin: true,
      receivesDailyReport: true,
      permissions: perms,
    });

    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser.id, email: req.adminUser.email, action: "create-admin", route: "/admin/users", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: JSON.stringify({ id: row.id, email }) }); } catch (e) {}
    return res.json({ success: true, data: { id: row.id, email: row.email, role: row.role, permissions: row.permissions } });
  } catch (e) {
    return res.status(500).json({ success: false, error: "创建失败" });
  }
});

// 切换是否接收日报：super 可修改任意，admin 仅可修改自己
router.patch("/users/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { receivesDailyReport } = req.body || {};
    const target = await XhuntAdminManager.findByPk(id);
    if (!target) return res.status(404).json({ success: false, error: "未找到" });

    const role = req.adminUser.role;
    if (role !== "super" && req.adminUser.id !== target.id) {
      return res.status(403).json({ success: false, error: "权限不足" });
    }

    if (typeof receivesDailyReport === "boolean") target.receivesDailyReport = receivesDailyReport;
    await target.save();
    res.json({ success: true, data: { id: target.id, receivesDailyReport: target.receivesDailyReport } });
  } catch (e) {
    res.status(500).json({ success: false, error: "更新失败" });
  }
});

// 重置其他管理员登录密码（需要 admin:manage-permissions 权限）
router.post("/users/:id/password/reset-random", adminAuth, requirePermission("admin:manage-permissions"), async (req, res) => {
  try {
    const { id } = req.params;
    const target = await XhuntAdminManager.findByPk(id);
    if (!target) return res.status(404).json({ success: false, error: "未找到" });
    if (Number(req.adminUser.id) === Number(target.id)) {
      return res.status(400).json({ success: false, error: "不能重置自己的密码" });
    }

    const password = generateAdminLoginPassword();
    target.passwordHash = await bcrypt.hash(password, 10);
    target.canLogin = true;
    await target.save();

    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "reset-admin-password",
        route: `/admin/users/${id}/password/reset-random`,
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({ targetId: target.id, targetEmail: target.email }),
      });
    } catch (e) {}

    res.json({ success: true, data: { id: target.id, email: target.email, password } });
  } catch (e) {
    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser?.id,
        email: req.adminUser?.email,
        action: "reset-admin-password",
        route: `/admin/users/${req.params.id}/password/reset-random`,
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: false,
        message: e.message,
      });
    } catch (_) {}
    res.status(500).json({ success: false, error: "重置失败" });
  }
});

// 更新管理员权限清单（需要 admin:manage-permissions 权限）
router.patch("/users/:id/permissions", adminAuth, requirePermission("admin:manage-permissions"), express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, error: "permissions 必须是字符串数组" });
    }
    const sanitized = permissions
      .filter((p) => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // 仅 super 可分配 管理员列表/操作记录 相关权限
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "admin:manage-permissions", "audit-logs:read", "deploy:rollback", "deploy:release"]);
    if (req.adminUser.role !== "super") {
      const containsRestricted = sanitized.some((p) => RESTRICTED.has(p));
      if (containsRestricted) {
        return res.status(403).json({ success: false, error: "仅 super 可配置管理员相关权限" });
      }
    }
    const target = await XhuntAdminManager.findByPk(id);
    if (!target) return res.status(404).json({ success: false, error: "未找到" });

    target.permissions = sanitized;
    await target.save();
    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser.id, email: req.adminUser.email, action: "update-permissions", route: `/admin/users/${id}/permissions`, method: "PATCH", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: JSON.stringify(sanitized) }); } catch (e) {}

    res.json({ success: true, data: { id: target.id, permissions: target.permissions } });
  } catch (e) {
    res.status(500).json({ success: false, error: "更新失败" });
  }
});

// 生成一次性 Supabase 访问票据（后台已登录）
router.post("/supabase/link-token", adminAuth, requirePermission("supabase"), async (req, res) => {
  try {
    const admin = req.adminUser;
    // 需要已录入至少一个 WebAuthn 凭证
    const credCount = await XhuntAdminWebAuthnCredential.count({ where: { adminId: admin.id } });
    if (!credCount || credCount <= 0) {
      return res.status(403).json({ success: false, error: "需要先录入生物识别" });
    }
    const jti = randomUUID();
    const token = jwt.sign({ aid: admin.id, purpose: "supabase", jti }, LINK_SECRET, { expiresIn: 600 });
    const targetIP = process.env.SUPABASE_IP || "150.5.158.179";
    const url = `http://${targetIP}:8388/project/default?token=${encodeURIComponent(token)}`;
    return res.json({ success: true, token, url, ttl: 300 });
  } catch (e) {
    return res.status(500).json({ success: false, error: "生成票据失败" });
  }
});

// 校验一次性票据（用于 Nginx auth_request）
router.get("/supabase/verify-link", async (req, res) => {
  try {
    const token = req.headers["x-request-signature"];
    if (!token) {
      console.log("[supabase/verify-link] missing token");
      return res.status(401).json({ success: false });
    }
    let decoded;
    try {
      decoded = jwt.verify(String(token), LINK_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false });
    }
    if (decoded.purpose !== "supabase" || !decoded.jti) {
      return res.status(401).json({ success: false });
    }
    res.set("Cache-Control","no-store");
    return res.status(204).end();
  } catch (e) {
    console.log("[supabase/verify-link] error:", e?.message);
    return res.status(500).json({ success: false });
  }
});

// ========== 紧急部署 / 回滚（super only） ==========
router.get("/deploy/status", adminAuth, requireRole("super"), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await getDeployStatusData();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "读取部署状态失败" });
  }
});

router.get("/deploy/preview", adminAuth, requireRole("super"), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const target = String(req.query.target || "").trim();
    const targetType = String(req.query.targetType || "commit").trim();
    const verified = await assertGitTarget(target, targetType);
    const lostCommits = await getLostCommits(verified.target);
    return res.json({ success: true, data: { ...verified, lostCommits } });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message || "生成回滚预览失败" });
  }
});

router.get("/deploy/release/status", adminAuth, requireRole("super"), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await getReleaseStatusData();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "读取发布状态失败" });
  }
});

router.post("/deploy/release/fetch", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const fetchResult = await runDeployCommand("git", ["fetch", "origin", "--tags"], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const data = await getReleaseStatusData();
    await createDeployAudit(req, "deploy-release-fetch", true, {
      current: data.current?.hash || null,
      remote: data.remote?.hash || null,
      pendingCommitCount: data.pendingCommits.length,
    });
    return res.json({
      success: true,
      data: {
        ...data,
        outputs: [{ step: "fetch", stdout: fetchResult.stdout.slice(-4000), stderr: fetchResult.stderr.slice(-4000) }],
      },
    });
  } catch (e) {
    await createDeployAudit(req, "deploy-release-fetch", false, { error: e.message });
    return res.status(500).json({ success: false, error: e.message || "刷新远程版本失败" });
  }
});

router.post("/deploy/release/tag-message", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const releaseStatus = await getReleaseStatusData();
    const before = releaseStatus.current?.hash || (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    const after = releaseStatus.remote?.hash;
    if (!after) {
      return res.status(409).json({ success: false, error: "没有找到 origin/main，无法生成 Tag 描述" });
    }
    if (releaseStatus.pendingCommits.length === 0 && before === after) {
      return res.status(409).json({ success: false, error: "当前没有待发布提交，无需生成 Tag 描述" });
    }

    const tagMessage = await generateReleaseTagMessage(releaseStatus.pendingCommits, before, after);
    await createDeployAudit(req, "deploy-release-tag-message", true, {
      before,
      after,
      messageSource: tagMessage.source,
      commitCount: releaseStatus.pendingCommits.length,
    });
    return res.json({
      success: true,
      data: {
        suggestedTagName: buildReleaseTagName(after),
        message: tagMessage.message,
        messageSource: tagMessage.source,
        commitCount: releaseStatus.pendingCommits.length,
        before,
        after,
      },
    });
  } catch (e) {
    await createDeployAudit(req, "deploy-release-tag-message", false, { error: e.message });
    return res.status(500).json({ success: false, error: e.message || "生成 Tag 描述失败" });
  }
});

router.post("/deploy/release/tag", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { tagName, tagMessage, tagMessageSource } = req.body || {};
    const releaseStatus = await getReleaseStatusData();
    const before = releaseStatus.current?.hash || (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    const after = releaseStatus.remote?.hash;
    if (!after) {
      return res.status(409).json({ success: false, error: "没有找到 origin/main，无法创建发布 Tag" });
    }
    if (releaseStatus.pendingCommits.length === 0 && before === after) {
      return res.status(409).json({ success: false, error: "当前没有待发布提交，无需创建发布 Tag" });
    }

    const releaseTag = await createReleaseTag({
      commits: releaseStatus.pendingCommits,
      beforeHash: before,
      afterHash: after,
      tagNameOverride: tagName || buildReleaseTagName(after),
      tagMessageOverride: tagMessage,
      tagMessageSource,
    });

    await createDeployAudit(req, "deploy-release-tag", true, {
      before,
      after,
      tagName: releaseTag.tagName,
      tagMessageSource: releaseTag.messageSource,
      tagPushed: releaseTag.pushed,
      commitCount: releaseStatus.pendingCommits.length,
    });
    return res.json({
      success: true,
      data: {
        before,
        after,
        releaseTag,
        commitCount: releaseStatus.pendingCommits.length,
      },
    });
  } catch (e) {
    await createDeployAudit(req, "deploy-release-tag", false, { error: e.message, tagName: req.body?.tagName });
    return res.status(e.statusCode || 500).json({ success: false, error: e.message || "创建发布 Tag 失败" });
  }
});

router.post("/deploy/release", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { rebuildAdminWeb, restartAfterDeploy = true, releaseTagName, tagMessage, tagMessageSource } = req.body || {};

    const outputs = [];
    const fetchResult = await runDeployCommand("git", ["fetch", "origin", "--tags"], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    outputs.push({ step: "fetch", stdout: fetchResult.stdout.slice(-4000), stderr: fetchResult.stderr.slice(-4000) });

    const releaseStatus = await getReleaseStatusData();
    const before = releaseStatus.current?.hash || (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    if (!releaseStatus.remote?.hash) {
      return res.status(409).json({ success: false, error: "没有找到 origin/main，无法发布" });
    }
    if (releaseStatus.aheadCommits.length > 0) {
      return res.status(409).json({
        success: false,
        error: "当前线上存在 origin/main 没有的提交，发布会覆盖本地提交，请先确认或使用紧急回滚/终端处理",
        data: { aheadCommits: releaseStatus.aheadCommits },
      });
    }
    if (releaseStatus.pendingCommits.length === 0 && before === releaseStatus.remote.hash) {
      return res.status(409).json({ success: false, error: "当前已经是 origin/main 最新版本，无需发布" });
    }

    if (releaseStatus.dirty) {
      const stashMessage = `admin-release-${new Date().toISOString()}`;
      const stash = await runDeployCommand("git", ["stash", "push", "-u", "-m", stashMessage], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      outputs.push({ step: "stash", stdout: stash.stdout, stderr: stash.stderr });
    }

    const reset = await runDeployCommand("git", ["reset", "--hard", "origin/main"], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    outputs.push({ step: "reset", stdout: reset.stdout, stderr: reset.stderr });

    if (rebuildAdminWeb === true) {
      const build = await runDeployCommand("npm", ["run", "admin-web:build"], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      outputs.push({ step: "admin-web:build", stdout: build.stdout.slice(-4000), stderr: build.stderr.slice(-4000) });
    }

    const after = (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    const releaseTag = releaseTagName
      ? await getExistingReleaseTag(releaseTagName, after)
      : await createReleaseTag({
          commits: releaseStatus.pendingCommits,
          beforeHash: before,
          afterHash: after,
          tagMessageOverride: tagMessage,
          tagMessageSource,
        });

    if (releaseTagName) {
      outputs.push({
        step: "release-tag",
        stdout: `using existing tag=${releaseTag.tagName}`,
        stderr: "",
      });
    } else {
      outputs.push({
        step: "release-tag",
        stdout: `tag=${releaseTag.tagName}\nmessageSource=${releaseTag.messageSource}\npushed=${releaseTag.pushed}`,
        stderr: releaseTag.stderr || "",
      });
      if (releaseTag.pushOutput) {
        outputs.push({ step: "push-tag", stdout: releaseTag.pushOutput.stdout, stderr: releaseTag.pushOutput.stderr });
      }
    }

    await createDeployAudit(req, "deploy-release", true, {
      before,
      after,
      tagName: releaseTag.tagName,
      tagMessageSource: releaseTag.messageSource,
      tagPushed: releaseTag.pushed,
      commitCount: releaseStatus.pendingCommits.length,
      rebuildAdminWeb: rebuildAdminWeb === true,
      restartAfterDeploy: restartAfterDeploy !== false,
      restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
    });

    res.json({
      success: true,
      data: {
        before,
        after,
        releaseTag,
        commitCount: releaseStatus.pendingCommits.length,
        releasedCommits: releaseStatus.pendingCommits,
        outputs,
        restartScheduled: restartAfterDeploy !== false,
        restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
      },
    });
    if (restartAfterDeploy !== false) {
      schedulePm2Restart("release:origin/main");
    }
  } catch (e) {
    await createDeployAudit(req, "deploy-release", false, { error: e.message });
    return res.status(500).json({ success: false, error: e.message || "发布失败" });
  }
});

router.post("/deploy/rollback", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { target, targetType, confirmText, rebuildAdminWeb } = req.body || {};
    if (confirmText !== "ROLLBACK") {
      return res.status(400).json({ success: false, error: "请输入 ROLLBACK 确认回滚" });
    }

    const verified = await assertGitTarget(target, targetType);
    const before = (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    const dirty = (await runDeployCommand("git", ["status", "--porcelain"], { maxBuffer: 512 * 1024 })).stdout;
    const lostCommits = await getLostCommits(verified.target);
    const outputs = [];

    if (dirty) {
      const stashMessage = `admin-rollback-${new Date().toISOString()}`;
      const stash = await runDeployCommand("git", ["stash", "push", "-u", "-m", stashMessage], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      outputs.push({ step: "stash", stdout: stash.stdout, stderr: stash.stderr });
    }

    const reset = await runDeployCommand("git", ["reset", "--hard", verified.target], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    outputs.push({ step: "reset", stdout: reset.stdout, stderr: reset.stderr });

    if (rebuildAdminWeb === true) {
      const build = await runDeployCommand("npm", ["run", "admin-web:build"], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      outputs.push({ step: "admin-web:build", stdout: build.stdout.slice(-4000), stderr: build.stderr.slice(-4000) });
    }

    const after = (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    await createDeployAudit(req, "deploy-rollback", true, {
      before,
      after,
      target: verified.target,
      targetType,
      resolvedHash: verified.resolvedHash,
      lostCommitCount: lostCommits.length,
      rebuildAdminWeb: rebuildAdminWeb === true,
    });

    res.json({
      success: true,
      data: {
        before,
        after,
        target: verified.target,
        resolvedHash: verified.resolvedHash,
        lostCommits,
        outputs,
        restartScheduled: true,
        restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
      },
    });
    schedulePm2Restart(`rollback:${verified.target}`);
  } catch (e) {
    await createDeployAudit(req, "deploy-rollback", false, { error: e.message, target: req.body?.target });
    return res.status(e.statusCode || 500).json({ success: false, error: e.message || "回滚失败" });
  }
});

router.post("/deploy/recover", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { confirmText, rebuildAdminWeb } = req.body || {};
    if (confirmText !== "RECOVER") {
      return res.status(400).json({ success: false, error: "请输入 RECOVER 确认恢复到 origin/main" });
    }

    const before = (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    const dirty = (await runDeployCommand("git", ["status", "--porcelain"], { maxBuffer: 512 * 1024 })).stdout;
    const outputs = [];
    if (dirty) {
      const stashMessage = `admin-recover-${new Date().toISOString()}`;
      const stash = await runDeployCommand("git", ["stash", "push", "-u", "-m", stashMessage], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      outputs.push({ step: "stash", stdout: stash.stdout, stderr: stash.stderr });
    }

    const fetchResult = await runDeployCommand("git", ["fetch", "origin", "--tags"], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    outputs.push({ step: "fetch", stdout: fetchResult.stdout.slice(-4000), stderr: fetchResult.stderr.slice(-4000) });
    const reset = await runDeployCommand("git", ["reset", "--hard", "origin/main"], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    outputs.push({ step: "reset", stdout: reset.stdout, stderr: reset.stderr });

    if (rebuildAdminWeb === true) {
      const build = await runDeployCommand("npm", ["run", "admin-web:build"], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      outputs.push({ step: "admin-web:build", stdout: build.stdout.slice(-4000), stderr: build.stderr.slice(-4000) });
    }

    const after = (await runDeployCommand("git", ["rev-parse", "HEAD"])).stdout;
    await createDeployAudit(req, "deploy-recover", true, { before, after, rebuildAdminWeb: rebuildAdminWeb === true });

    res.json({
      success: true,
      data: {
        before,
        after,
        outputs,
        restartScheduled: true,
        restartTarget: process.env.ADMIN_DEPLOY_PM2_TARGET || "all",
      },
    });
    schedulePm2Restart("recover:origin/main");
  } catch (e) {
    await createDeployAudit(req, "deploy-recover", false, { error: e.message });
    return res.status(500).json({ success: false, error: e.message || "恢复失败" });
  }
});

// Logo 代理
router.get("/logo", async (req, res) => {
  try {
    const logoUrl = "https://oaewcvliegq6wyvp.public.blob.vercel-storage.com/xhunt_new.jpg";
    const response = await fetch(logoUrl);
    if (!response.ok) {
      return res.status(502).json({ success: false, error: "Failed to fetch logo" });
    }
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error("[logo proxy] error:", e?.message);
    res.status(500).json({ success: false, error: "Logo proxy failed" });
  }
});

// ========== Redis 管理路由 ==========
const redisRoutes = require("./redis");
router.use("/system/redis", redisRoutes);

module.exports = router;
