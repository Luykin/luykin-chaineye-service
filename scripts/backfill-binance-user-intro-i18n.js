#!/usr/bin/env node
/**
 * 一次性脚本：将 BinanceSquareUsers.aiOneLineIntro 旧文本回填到 aiOneLineIntroI18n(JSONB)
 *
 * 用法：
 *   NODE_ENV=production node scripts/backfill-binance-user-intro-i18n.js
 *   NODE_ENV=production node scripts/backfill-binance-user-intro-i18n.js --dry-run
 *   NODE_ENV=production node scripts/backfill-binance-user-intro-i18n.js --force
 *
 * 默认只回填 aiOneLineIntroI18n 为空的记录。
 * --force 会覆盖已有但格式不完整的 aiOneLineIntroI18n，不覆盖已有合法 { zh, en }。
 */

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { Op } = require("sequelize");
const { pgInstance } = require("../src/models/postgres-start");
const initBinanceSquareModels = require("../src/binance-square/models");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");
const BATCH_SIZE = Number(process.env.BS_INTRO_BACKFILL_BATCH_SIZE || 200);

function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  const raw = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value || "");
  }
}

function sanitizeIntroLine(line) {
  let text = String(line || "")
    .replace(/^[-*\d.、\s]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:中文|Chinese|ZH|CN|英文|English|EN)[:：]\s*/i, "")
    .replace(/^介绍[:：]\s*/i, "")
    .replace(/^一句话介绍[:：]\s*/i, "")
    .replace(/^根据资料显示[，,：:]?\s*/g, "")
    .trim();

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

function pickObjectText(value, keys, depth) {
  for (const key of keys) {
    if (value && value[key] != null) {
      const text = extractRawText(value[key], depth + 1).trim();
      if (text) return text;
    }
  }
  return "";
}

function extractRawText(value, depth = 0) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (depth > 4) return safeJsonStringify(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractRawText(item, depth + 1))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value === "object") {
    const zh = pickObjectText(value, ["zh", "cn", "chinese", "chineseIntro", "zhIntro", "cnIntro", "中文", "中文介绍"], depth);
    const en = pickObjectText(value, ["en", "english", "englishIntro", "enIntro", "英文", "英文介绍"], depth);
    if (zh || en) {
      return [zh ? `中文：${zh}` : "", en ? `English: ${en}` : ""].filter(Boolean).join("\n");
    }

    for (const key of ["intro", "oneLineIntro", "one_line_intro", "aiOneLineIntro", "summary", "description", "text", "output_text", "content", "message"]) {
      if (value[key] != null) {
        const text = extractRawText(value[key], depth + 1);
        if (text) return text;
      }
    }

    return Object.values(value)
      .map((item) => extractRawText(item, depth + 1))
      .find((text) => text && text.trim().length >= 8) || "";
  }

  return String(value || "");
}

function parseBilingualText(value) {
  const parsedJson = safeJsonParse(value);
  const raw = extractRawText(parsedJson || value)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!raw || /^\[object Object\]$/i.test(raw)) return null;

  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  let zh = "";
  let en = "";
  const rest = [];

  for (const line of lines) {
    const zhMatch = line.match(/^(?:中文|Chinese|ZH|CN)[:：]\s*(.+)$/i);
    const enMatch = line.match(/^(?:英文|English|EN)[:：]\s*(.+)$/i);
    if (zhMatch) zh = sanitizeIntroLine(zhMatch[1]);
    else if (enMatch) en = sanitizeIntroLine(enMatch[1]);
    else rest.push(sanitizeIntroLine(line));
  }

  if (!en) {
    const inlineEnglish = raw.match(/(?:^|\s)(?:English|英文|EN)[:：]\s*(.+)$/i);
    if (inlineEnglish) {
      en = sanitizeIntroLine(inlineEnglish[1]);
      zh = sanitizeIntroLine(zh || raw.slice(0, inlineEnglish.index).replace(/^(?:中文|Chinese|ZH|CN)[:：]\s*/i, ""));
    }
  }

  if (!zh) zh = rest.find((line) => /[\u3400-\u9fff]/.test(line)) || "";
  if (!en) en = rest.find((line) => /[a-zA-Z]/.test(line) && line !== zh) || "";

  zh = sanitizeIntroLine(zh);
  en = sanitizeIntroLine(en);

  if (!zh || !en) return null;
  if (!/[\u3400-\u9fff]/.test(zh) || !/[a-zA-Z]/.test(en)) return null;
  if (zh.length < 6 || en.length < 8) return null;

  return { zh, en };
}

function normalizeExistingI18n(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const zh = sanitizeIntroLine(value.zh || value.cn || value.chinese || "");
    const en = sanitizeIntroLine(value.en || value.english || "");
    if (zh && en) return { zh, en };
  }
  return parseBilingualText(value);
}

async function ensureColumnExists() {
  const [rows] = await pgInstance.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'BinanceSquareUsers'
      AND column_name = 'aiOneLineIntroI18n'
    LIMIT 1
  `);
  if (!rows.length) {
    throw new Error("缺少 BinanceSquareUsers.aiOneLineIntroI18n 字段，请先执行 yarn db:migrate:pg");
  }
}

async function main() {
  const db = initBinanceSquareModels(pgInstance);

  await pgInstance.authenticate();
  await ensureColumnExists();

  console.log("[backfill-binance-user-intro-i18n] 开始");
  console.log(`  NODE_ENV=${process.env.NODE_ENV || "undefined"}`);
  console.log(`  dryRun=${DRY_RUN}`);
  console.log(`  force=${FORCE}`);
  console.log(`  batchSize=${BATCH_SIZE}`);

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let skippedValid = 0;
  let skippedEmpty = 0;
  let skippedInvalid = 0;

  while (true) {
    const rows = await db.BinanceSquareUser.findAll({
      where: {
        id: { [Op.gt]: lastId },
        aiOneLineIntro: { [Op.ne]: null },
      },
      attributes: ["id", "username", "aiOneLineIntro", "aiOneLineIntroI18n"],
      order: [["id", "ASC"]],
      limit: BATCH_SIZE,
      raw: true,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;
      scanned++;

      const existing = normalizeExistingI18n(row.aiOneLineIntroI18n);
      if (existing) {
        skippedValid++;
        continue;
      }

      if (row.aiOneLineIntroI18n && !FORCE) {
        skippedInvalid++;
        continue;
      }

      const introI18n = parseBilingualText(row.aiOneLineIntro);
      if (!row.aiOneLineIntro || !String(row.aiOneLineIntro).trim()) {
        skippedEmpty++;
        continue;
      }

      if (!introI18n) {
        skippedInvalid++;
        continue;
      }

      if (!DRY_RUN) {
        await db.BinanceSquareUser.update(
          { aiOneLineIntroI18n: introI18n },
          { where: { id: row.id } }
        );
      }

      updated++;
      if (updated <= 10 || updated % 100 === 0) {
        console.log(`  [${DRY_RUN ? "可回填" : "已回填"}] #${row.id} ${row.username}: ${introI18n.zh} / ${introI18n.en}`);
      }
    }
  }

  console.log("\n[backfill-binance-user-intro-i18n] 完成");
  console.log(`  扫描: ${scanned}`);
  console.log(`  ${DRY_RUN ? "可回填" : "已回填"}: ${updated}`);
  console.log(`  跳过-已有合法JSON: ${skippedValid}`);
  console.log(`  跳过-旧字段为空: ${skippedEmpty}`);
  console.log(`  跳过-无法解析/已有异常JSON未force: ${skippedInvalid}`);

  await pgInstance.close();
}

main().catch(async (err) => {
  console.error("[backfill-binance-user-intro-i18n] 失败:", err);
  try {
    await pgInstance.close();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
