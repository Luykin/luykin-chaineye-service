const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TARGETS = [
  "nginx/nginx.conf",
  "nginx/kb.cryptohunt.ai.conf",
  "scripts/storage-guard-wizard.sh",
];

test("conditional Nginx access logs specify a format before if=", () => {
  for (const relativePath of TARGETS) {
    const contents = fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      contents,
      /access_log\s+\/var\/log\/nginx\/\S+\s+if=/,
      `${relativePath} has an if= parameter where Nginx expects a log format`
    );
  }
});
