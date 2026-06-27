#!/usr/bin/env node
/*
 * Keep local release tags bounded before pushing code.
 * - Only touches tags matching `${ADMIN_DEPLOY_TAG_PREFIX || "prod"}-*`.
 * - Keeps the newest ADMIN_DEPLOY_TAG_KEEP_LIMIT || 10 by tag creatordate.
 * - Does not delete remote tags; server-side release flow handles remote cleanup.
 */
const { execFileSync } = require("child_process");

const prefix = (process.env.ADMIN_DEPLOY_TAG_PREFIX || "prod").trim() || "prod";
const keepLimit = Math.max(1, parseInt(process.env.ADMIN_DEPLOY_TAG_KEEP_LIMIT || "10", 10));
const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const skipFetch = process.argv.includes("--no-fetch") || process.env.RELEASE_TAG_SYNC_NO_FETCH === "true";
const pattern = `${prefix}-*`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function warn(message) {
  process.stderr.write(`${message}\n`);
}

function ensureGitRepo() {
  try {
    run("git", ["rev-parse", "--is-inside-work-tree"]);
  } catch (_) {
    warn("[release-tags] 当前目录不是 Git 仓库，跳过 tag 同步。 ");
    process.exit(0);
  }
}

function fetchTags() {
  if (skipFetch) return;
  try {
    run("git", ["fetch", "origin", "--tags", "--prune"], { stdio: "ignore" });
  } catch (error) {
    // pre-push 本身即将访问远程；这里失败不直接阻断 push，避免偶发网络问题影响正常提交。
    warn(`[release-tags] git fetch origin --tags --prune 失败，继续清理本地已有 tag：${error.message || error}`);
  }
}

function listLocalReleaseTags() {
  const output = run("git", [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)%09%(creatordate:iso8601)",
    `refs/tags/${pattern}`,
  ]);
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => {
      const [name, createdAt] = line.split("\t");
      return { name, createdAt };
    })
    .filter((tag) => tag.name && tag.name.startsWith(`${prefix}-`));
}

function deleteLocalTag(tagName) {
  if (dryRun) return;
  run("git", ["tag", "-d", tagName]);
}

function main() {
  ensureGitRepo();
  fetchTags();

  const tags = listLocalReleaseTags();
  const toDelete = tags.slice(keepLimit);

  if (!toDelete.length) {
    log(`[release-tags] 本地 ${pattern} tag 数量 ${tags.length}，未超过 ${keepLimit}，无需清理。`);
    return;
  }

  log(`[release-tags] 本地 ${pattern} tag 数量 ${tags.length}，保留最近 ${keepLimit} 个，清理 ${toDelete.length} 个旧 tag。`);
  toDelete.forEach((tag) => {
    log(`[release-tags] ${dryRun ? "dry-run " : ""}delete local tag: ${tag.name}`);
    deleteLocalTag(tag.name);
  });
}

main();
