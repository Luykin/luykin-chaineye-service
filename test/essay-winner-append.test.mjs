import test from "node:test";
import assert from "node:assert/strict";
import { appendEssayWinners } from "../admin-web/src/components/campaigns/essayWinnerImportUtils.ts";

function winner(overrides) {
  return {
    name: "",
    handler: "same_author",
    avatar: "",
    reward: "100",
    award: "",
    post: "",
    url: "",
    ...overrides,
  };
}

test("appends a different winning work from the same X account", () => {
  const existing = [winner({
    post: "征文作品",
    url: "https://x.com/same_author/status/essay",
  })];
  const imported = [winner({
    post: "视频作品",
    url: "https://x.com/same_author/status/video",
  })];

  const result = appendEssayWinners(existing, imported);

  assert.equal(result.winners.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test("still skips the same work when it is imported again", () => {
  const existing = [winner({
    post: "征文作品",
    url: "https://x.com/same_author/status/essay",
  })];
  const imported = [winner({
    post: "重复导入的征文作品",
    url: "https://x.com/same_author/status/essay?source=sheet",
  })];

  const result = appendEssayWinners(existing, imported);

  assert.equal(result.winners.length, 1);
  assert.equal(result.duplicateCount, 1);
});
