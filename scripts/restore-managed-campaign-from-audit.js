#!/usr/bin/env node

require("dotenv").config({
  path: process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro",
});

function parseArgs(argv) {
  const result = {
    auditId: null,
    campaignKey: "",
    operatorEmail: "",
    apply: false,
    confirm: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--audit-id") result.auditId = Number(argv[++index]);
    else if (value === "--campaign-key") result.campaignKey = String(argv[++index] || "").trim();
    else if (value === "--operator-email") result.operatorEmail = String(argv[++index] || "").trim();
    else if (value === "--confirm") result.confirm = String(argv[++index] || "").trim();
    else if (value === "--apply") result.apply = true;
    else if (value === "--help" || value === "-h") result.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

function printHelp() {
  console.log(`
从管理后台完整配置审计中恢复一条被软删除的活动。

默认仅预览：
  npm run campaign:restore-from-audit -- --audit-id 5676 --campaign-key yzilabs

确认写入：
  npm run campaign:restore-from-audit -- --audit-id 5676 --campaign-key yzilabs \\
    --operator-email you@example.com --apply --confirm RESTORE:yzilabs:5676
`);
}

function parseAuditCampaigns(audit) {
  if (audit.action !== "website-campaign-save-managed-config" || audit.success !== true) {
    throw new Error("指定记录不是成功的活动完整配置发布审计");
  }
  let payload;
  try {
    payload = JSON.parse(audit.payload || "{}");
  } catch (_) {
    throw new Error("审计 payload 不是有效 JSON");
  }
  if (!Array.isArray(payload?.config?.campaigns)) {
    throw new Error("审计 payload 不包含完整 campaigns 配置");
  }
  return payload.config.campaigns;
}

function getActiveCampaignPayloads(records) {
  return records
    .filter((record) => !record.isDeleted)
    .map((record) => {
      const payload = record.nacosPayload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`当前活动 ${record.nacosCampaignId} 缺少完整 nacosPayload，停止恢复以避免覆盖`);
      }
      const id = String(payload.id || "").trim();
      const campaignKey = String(payload.campaignKey || "").trim();
      if (!id || !campaignKey) {
        throw new Error(`当前活动 ${record.nacosCampaignId} 的身份字段不完整，停止恢复以避免覆盖`);
      }
      return JSON.parse(JSON.stringify(payload));
    });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!Number.isInteger(args.auditId) || args.auditId <= 0 || !args.campaignKey) {
    printHelp();
    throw new Error("必须提供有效的 --audit-id 和 --campaign-key");
  }

  const {
    XHuntWebsiteCampaign,
    XhuntAdminAuditLog,
    XhuntAdminManager,
    pgInstance,
  } = require("../src/models/postgres-start");
  const { saveManagedCampaignsConfig, getManagedCampaignsAdminSnapshot } = require("../src/xhunt/services/websiteCampaignService");

  try {
    const audit = await XhuntAdminAuditLog.findByPk(args.auditId);
    if (!audit) throw new Error(`找不到审计记录：${args.auditId}`);
    const matches = parseAuditCampaigns(audit).filter(
      (campaign) => String(campaign?.campaignKey || "").trim() === args.campaignKey
    );
    if (matches.length !== 1) {
      throw new Error(`审计 ${args.auditId} 中 campaignKey=${args.campaignKey} 的记录数量为 ${matches.length}，要求恰好一条`);
    }

    const recovered = JSON.parse(JSON.stringify(matches[0]));
    const recoveredId = String(recovered.id || "").trim();
    const records = await XHuntWebsiteCampaign.findAll();
    const target = records.find((record) => String(record.nacosCampaignId) === recoveredId);
    if (!target) throw new Error(`数据库中不存在待恢复记录：${recoveredId}`);
    if (!target.isDeleted) throw new Error(`活动 ${recoveredId} 当前不是软删除状态，拒绝覆盖`);

    const activeCampaigns = getActiveCampaignPayloads(records);
    if (activeCampaigns.some((campaign) => campaign.id === recoveredId || campaign.campaignKey === args.campaignKey)) {
      throw new Error("当前活动配置中已经存在相同 ID 或 campaignKey，拒绝恢复");
    }

    const snapshot = await getManagedCampaignsAdminSnapshot();
    console.log(JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      audit: {
        id: audit.id,
        createdAt: audit.createdAt,
        originalOperator: audit.email,
      },
      restore: {
        id: recoveredId,
        campaignKey: recovered.campaignKey,
        displayName: recovered.displayName,
        startAt: recovered.enrollmentWindow?.startAt,
        endAt: recovered.enrollmentWindow?.endAt,
      },
      activeCampaignCount: activeCampaigns.length,
      websiteStatePreserved: {
        webStatus: target.webStatus,
        slug: target.slug,
        websiteExtra: true,
      },
    }, null, 2));

    if (!args.apply) {
      console.log("\n仅预览，数据库未修改。确认无误后再使用 --apply 和精确确认词。");
      return;
    }

    const expectedConfirm = `RESTORE:${args.campaignKey}:${args.auditId}`;
    if (args.confirm !== expectedConfirm) {
      throw new Error(`确认词不正确，应为：${expectedConfirm}`);
    }
    if (!args.operatorEmail) throw new Error("写入时必须提供 --operator-email");
    const operator = await XhuntAdminManager.findOne({ where: { email: args.operatorEmail, isActive: true } });
    if (!operator) throw new Error(`找不到有效管理员：${args.operatorEmail}`);

    const result = await saveManagedCampaignsConfig(
      { version: 3, campaigns: [...activeCampaigns, recovered] },
      snapshot.revision
    );
    await XhuntAdminAuditLog.create({
      adminId: operator.id,
      email: operator.email,
      action: "website-campaign-restore-audit",
      route: "scripts/restore-managed-campaign-from-audit.js",
      method: "CLI",
      ip: "local",
      userAgent: "node",
      payload: JSON.stringify({ sourceAuditId: args.auditId, campaignKey: args.campaignKey, recoveredId }),
      success: true,
      message: JSON.stringify(result.summary),
    });

    try {
      const { getRedisClient } = require("../src/lib/redisClient");
      const { invalidateCampaignConfigCache } = require("../src/xhunt/utils/campaign-config-cache");
      const { invalidateWebsiteCampaignPublicCache } = require("../src/xhunt/utils/website-campaign-public-cache");
      const redisClient = await getRedisClient();
      await Promise.all([
        invalidateCampaignConfigCache(redisClient),
        invalidateWebsiteCampaignPublicCache(redisClient),
      ]);
      await redisClient.quit();
    } catch (error) {
      console.warn(`活动已恢复，但缓存失效失败：${error.message || error}`);
    }

    console.log(`\n恢复完成：${recoveredId}`);
  } finally {
    await pgInstance.close();
  }
}

main().catch((error) => {
  console.error(`恢复失败：${error.message || error}`);
  process.exitCode = 1;
});

