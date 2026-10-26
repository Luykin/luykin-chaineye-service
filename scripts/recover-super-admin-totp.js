#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomBytes } = require("crypto");

const TOTP_SCOPES = Object.freeze([
  "account-settings",
  "account-settings-replace",
  "admin-users",
  "db-admin",
  "server-command",
  "log-search",
  "nacos-admin",
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildKnownTemporaryAuthKeys(adminId) {
  const keys = TOTP_SCOPES.flatMap((scope) => [
    `admin:${scope}:totp:verified:${adminId}`,
    `admin:${scope}:totp:setup:${adminId}`,
    `admin:${scope}:totp:failures:${adminId}`,
  ]);
  keys.push(
    `admin:admin-users:webauthn:verified:${adminId}`,
    `admin:admin-users:webauthn:challenge:${adminId}`,
  );
  return keys;
}

function parseArgs(argv) {
  let selectedMode = null;
  const options = {
    mode: "check",
    envFile: "",
    email: "",
    operator: "",
    reason: "",
    confirmEmail: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      if (selectedMode && selectedMode !== "check") throw new Error("--check 与 --apply 不能同时使用");
      selectedMode = "check";
      options.mode = "check";
      continue;
    }
    if (argument === "--apply") {
      if (selectedMode && selectedMode !== "apply") throw new Error("--check 与 --apply 不能同时使用");
      selectedMode = "apply";
      options.mode = "apply";
      continue;
    }

    const valueFlags = {
      "--env-file": "envFile",
      "--email": "email",
      "--operator": "operator",
      "--reason": "reason",
      "--confirm-email": "confirmEmail",
    };
    const key = valueFlags[argument];
    if (!key) throw new Error(`未知参数: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} 缺少值`);
    options[key] = value;
    index += 1;
  }

  options.email = normalizeEmail(options.email);
  options.confirmEmail = normalizeEmail(options.confirmEmail);
  options.envFile = String(options.envFile || "").trim();
  options.operator = String(options.operator || "").trim();
  options.reason = String(options.reason || "").trim();

  if (!options.envFile) throw new Error("必须通过 --env-file 指定环境文件");
  if (!/^\S+@\S+\.\S+$/.test(options.email)) throw new Error("--email 必须是有效邮箱");
  if (options.mode === "apply") {
    if (!options.operator) throw new Error("执行恢复时必须通过 --operator 记录操作人");
    if (options.reason.length < 8) throw new Error("执行恢复时 --reason 不能少于 8 个字符");
    if (options.confirmEmail !== options.email) {
      throw new Error("--confirm-email 必须与目标邮箱完全匹配");
    }
  }

  return options;
}

function describeTotpState(admin) {
  const fieldsPresent = {
    secret: !!admin.totpSecretEncrypted,
    enabledAt: !!admin.totpEnabledAt,
    lastUsedStep: admin.totpLastUsedStep != null,
  };
  return {
    enrolled: fieldsPresent.secret && fieldsPresent.enabledAt,
    hasAnyData: Object.values(fieldsPresent).some(Boolean),
    fieldsPresent,
  };
}

function validateTarget(admins, email) {
  if (admins.length === 0) throw new Error(`未找到管理员账号: ${email}`);
  if (admins.length > 1) throw new Error(`存在多个大小写不同但邮箱相同的账号，拒绝继续: ${email}`);
  const admin = admins[0];
  if (admin.role !== "super") throw new Error(`目标账号不是超级管理员，拒绝继续: ${admin.email}`);
  return admin;
}

function printTarget(admin, state, mode) {
  console.log("");
  console.log(`模式: ${mode === "apply" ? "执行恢复" : "只读预检"}`);
  console.log(`管理员 ID: ${admin.id}`);
  console.log(`邮箱: ${admin.email}`);
  console.log(`角色: ${admin.role}`);
  console.log(`账号状态: isActive=${admin.isActive}, canLogin=${admin.canLogin}`);
  console.log(`Authenticator 已绑定: ${state.enrolled ? "是" : "否"}`);
  console.log(`Authenticator 启用时间: ${admin.totpEnabledAt || "无"}`);
  if (!state.enrolled && state.hasAnyData) {
    console.log("警告: TOTP 字段状态不完整，执行恢复会一并清理残留字段。");
  }
}

async function findTargetAdmin(XhuntAdminManager, email, transaction) {
  const { col, fn, where } = require("sequelize");
  const options = {
    where: where(fn("LOWER", col("email")), email),
    limit: 2,
    transaction,
  };
  if (transaction) options.lock = transaction.LOCK.UPDATE;
  const admins = await XhuntAdminManager.findAll(options);
  return validateTarget(admins, email);
}

async function clearTemporaryAuthState(redisClient, adminId, scanKeys) {
  const discoveredKeys = await scanKeys(redisClient, `admin:*:totp:*:${adminId}`, {
    count: 100,
    maxKeys: 500,
  });
  const keys = [...new Set([...buildKnownTemporaryAuthKeys(adminId), ...discoveredKeys])];
  const sessionVersion = randomBytes(32).toString("hex");
  const multi = redisClient.multi();
  multi.set(`admin:session-version:${adminId}`, sessionVersion);
  if (keys.length > 0) multi.del(keys);
  await multi.exec();
  return keys;
}

async function run(options) {
  const envPath = path.resolve(process.cwd(), options.envFile);
  if (!fs.existsSync(envPath) || !fs.statSync(envPath).isFile()) {
    throw new Error(`环境文件不存在: ${envPath}`);
  }

  require("dotenv").config({ path: envPath, override: true });
  const {
    pgInstance,
    XhuntAdminAuditLog,
    XhuntAdminManager,
  } = require("../src/models/postgres-start");

  let redisClient = null;
  try {
    await pgInstance.authenticate();
    const previewAdmin = await findTargetAdmin(XhuntAdminManager, options.email);
    const previewState = describeTotpState(previewAdmin);
    printTarget(previewAdmin, previewState, options.mode);

    if (options.mode === "check") {
      console.log("");
      console.log(previewState.hasAnyData
        ? "预检通过：可以执行受控重置。"
        : "预检完成：该账号已没有 TOTP 数据；执行模式仍可用于清理临时授权并使会话失效。");
      return;
    }

    const { getRedisClient, scanKeys } = require("../src/lib/redisClient");
    redisClient = await getRedisClient();

    // 先使现有会话失效并清理临时授权。若后续数据库事务失败，账号只会被登出，
    // 原 Authenticator 仍保持有效，可排除故障后安全重试。
    const clearedKeys = await clearTemporaryAuthState(redisClient, previewAdmin.id, scanKeys);

    let resetPerformed = false;
    await pgInstance.transaction(async (transaction) => {
      const admin = await findTargetAdmin(XhuntAdminManager, options.email, transaction);
      const previousState = describeTotpState(admin);
      resetPerformed = previousState.hasAnyData;

      if (resetPerformed) {
        admin.totpSecretEncrypted = null;
        admin.totpEnabledAt = null;
        admin.totpLastUsedStep = null;
        await admin.save({ transaction });
      }

      const auditPayload = {
        operator: options.operator,
        reason: options.reason,
        host: os.hostname(),
        targetAdminId: admin.id,
        resetPerformed,
        previousTotpState: previousState.fieldsPresent,
        invalidatedSession: true,
        clearedTemporaryAuthKeyCount: clearedKeys.length,
      };
      await XhuntAdminAuditLog.create({
        adminId: admin.id,
        email: admin.email,
        action: resetPerformed
          ? "super-admin-totp-emergency-reset"
          : "super-admin-totp-emergency-cleanup",
        route: "scripts/recover-super-admin-totp.js",
        method: "CLI",
        ip: "",
        userAgent: `operator:${options.operator}`.slice(0, 512),
        payload: JSON.stringify(auditPayload),
        success: true,
        message: `Authenticator recovery: ${options.reason}`.slice(0, 512),
      }, { transaction });
    });

    // 再清一次，覆盖数据库事务执行期间可能完成的在途请求。
    const finalClearedKeys = await clearTemporaryAuthState(redisClient, previewAdmin.id, scanKeys);
    console.log("");
    console.log(resetPerformed ? "恢复完成：TOTP 已重置。" : "清理完成：TOTP 原本已重置。");
    console.log(`已清理临时授权 key: ${new Set([...clearedKeys, ...finalClearedKeys]).size} 个`);
    console.log("该管理员的所有旧管理会话均已失效，请重新登录并立即绑定新 Authenticator。");
  } finally {
    if (redisClient?.isOpen) await redisClient.quit().catch(() => {});
    await pgInstance.close().catch(() => {});
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    await run(options);
  } catch (error) {
    console.error(`恢复失败: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  TOTP_SCOPES,
  buildKnownTemporaryAuthKeys,
  describeTotpState,
  normalizeEmail,
  parseArgs,
  validateTarget,
};
