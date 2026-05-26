#!/usr/bin/env node

/**
 * Build a Tampermonkey console snippet for re-crawling suspected polluted
 * RootData outbound investment relationships.
 *
 * Usage:
 *   node scripts/rootdata-build-invested-cleanup-recrawl.js
 *   node scripts/rootdata-build-invested-cleanup-recrawl.js data/audits/file.csv --tag=2026-05-25 --batch-size=10
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_CSV = "data/audits/rootdata-invested-cleanup-candidates-2026-05-25.csv";
const DEFAULT_TAG = "2026-05-25";
// 2026-05-25 00:00:00 Asia/Shanghai
const DEFAULT_CLEANUP_WINDOW_START = "2026-05-24T16:00:00.000Z";

function parseArgs(argv) {
  const args = {
    csv: DEFAULT_CSV,
    tag: DEFAULT_TAG,
    batchSize: 10,
    maxSub: 0,
    cleanupWindowStart: DEFAULT_CLEANUP_WINDOW_START,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--tag=")) args.tag = arg.slice("--tag=".length);
    else if (arg.startsWith("--batch-size=")) args.batchSize = Number(arg.slice("--batch-size=".length)) || args.batchSize;
    else if (arg.startsWith("--max-sub=")) args.maxSub = Number(arg.slice("--max-sub=".length)) || args.maxSub;
    else if (arg.startsWith("--cleanup-window-start=")) args.cleanupWindowStart = arg.slice("--cleanup-window-start=".length);
    else if (!arg.startsWith("--")) args.csv = arg;
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift() || [];
  return rows
    .filter((item) => item.some(Boolean))
    .map((item) => Object.fromEntries(header.map((key, index) => [key, item[index] || ""])));
}

function canonicalRootDataDetailUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    const detailMatch = url.pathname.match(/^\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
    const memberMatch = url.pathname.match(/^\/member\/([^/?#]+)/);
    if (!detailMatch?.[1] && !memberMatch?.[1]) return url.toString();

    url.protocol = "https:";
    url.hostname = "www.rootdata.com";
    if (memberMatch?.[1]) {
      url.pathname = `/member/${memberMatch[1]}`;
    } else {
      const type = /\/(?:investors|Investors)\//.test(url.pathname) ? "Investors" : "Projects";
      url.pathname = `/${type}/detail/${detailMatch[1]}`;
    }

    const k = url.searchParams.get("k");
    url.search = "";
    if (k) url.searchParams.set("k", k);
    url.hash = "";
    return url.toString();
  } catch (_) {
    return rawUrl;
  }
}

function buildItems(rows) {
  const map = new Map();

  for (const row of rows) {
    const projectLink = canonicalRootDataDetailUrl(row.investor_link || "");
    const projectName = String(row.investor_name || "").trim();
    if (!projectName || !/rootdata\.com\/(?:projects|Projects|investors|Investors)\/detail\//.test(projectLink)) {
      continue;
    }

    if (!map.has(projectLink)) {
      map.set(projectLink, {
        projectName,
        projectLink,
        candidateRelationIds: [],
      });
    }

    map.get(projectLink).candidateRelationIds.push(Number(row.id || 0) || row.id);
  }

  return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
}

function main() {
  const args = parseArgs(process.argv);
  const csvPath = path.resolve(process.cwd(), args.csv);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const itemsWithIds = buildItems(rows);
  const items = itemsWithIds.map(({ projectName, projectLink }) => ({ projectName, projectLink }));

  const outputDir = path.resolve(process.cwd(), "data/audits");
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, `rootdata-invested-cleanup-recrawl-items-${args.tag}.json`);
  const snippetPath = path.join(outputDir, `rootdata-invested-cleanup-recrawl-console-${args.tag}.js`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(itemsWithIds, null, 2)}\n`);

  const snippet = `// Paste this into RootData page console after Tampermonkey v0.6.7+ is active.
// It will delete only recent blank outbound investment relationships for each page,
// then rebuild them from the corrected explicit Investment/Portfolio parser.
const rootdataInvestedCleanupItems = ${JSON.stringify(items, null, 2)};

await RootDataFundraisingCollector.recrawlDetails(rootdataInvestedCleanupItems, {
  batchSize: ${JSON.stringify(args.batchSize)},
  maxSub: ${JSON.stringify(args.maxSub)},
  forceRefreshInvestedRelationships: true,
  cleanupWindowStart: ${JSON.stringify(args.cleanupWindowStart)},
  slot: ${JSON.stringify(`manual-cleanup-invested-${args.tag}`)},
});
`;

  fs.writeFileSync(snippetPath, snippet);

  console.log("[rootdata-cleanup] recrawl plan generated");
  console.log(`  source csv rows: ${rows.length}`);
  console.log(`  unique recrawl pages: ${items.length}`);
  console.log(`  cleanup window start: ${args.cleanupWindowStart}`);
  console.log(`  items json: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`  console snippet: ${path.relative(process.cwd(), snippetPath)}`);
}

main();
