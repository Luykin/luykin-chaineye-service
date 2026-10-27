const assert = require("node:assert/strict");
const { test } = require("node:test");
const { evaluateRankEligibility } = require("../src/xhunt/services/rankEligibilityService");

function rankResult(domain, kolRank, creatorStatus = null) {
  const isCreatorAuthed = creatorStatus === 2;
  return {
    domain,
    kolRank,
    isCreator: isCreatorAuthed,
    isCreatorAuthed,
    creatorAuth: {
      status: creatorStatus,
      recordTime: creatorStatus == null ? null : "2026-10-20T00:00:00.000Z",
      twitterId: "123",
      isCreatorAuthed,
    },
  };
}

test("includes rank 200000 in a Top 200K requirement", async () => {
  const result = await evaluateRankEligibility({
    twitterId: "123",
    threshold: 200000,
    includeCreator: true,
    domains: ["web3"],
    fetchRank: async (domain) => rankResult(domain, 200000),
  });

  assert.equal(result.status, "ELIGIBLE");
  assert.equal(result.reason, "ELIGIBLE_BY_RANK");
  assert.equal(result.matchedBy, "RANK");
});

test("accepts an approved creator when rank does not meet the threshold", async () => {
  const result = await evaluateRankEligibility({
    twitterId: "123",
    threshold: 200000,
    includeCreator: true,
    domains: ["web3", "ai"],
    fetchRank: async (domain) => rankResult(domain, 300000, domain === "ai" ? 2 : null),
  });

  assert.equal(result.status, "ELIGIBLE");
  assert.equal(result.reason, "ELIGIBLE_BY_CREATOR");
  assert.equal(result.matchedDomain, "ai");
});

test("returns unknown when no domain meets the requirement and one domain fails", async () => {
  const result = await evaluateRankEligibility({
    twitterId: "123",
    threshold: 200000,
    includeCreator: true,
    domains: ["web3", "ai"],
    fetchRank: async (domain) => {
      if (domain === "ai") throw new Error("AI rank unavailable");
      return rankResult(domain, 300000);
    },
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "RANK_DATA_UNAVAILABLE");
});

test("offers creator verification only when creator alternatives are enabled", async () => {
  const fetchRank = async (domain) => rankResult(domain, 200001);
  const withCreator = await evaluateRankEligibility({
    twitterId: "123",
    threshold: 200000,
    includeCreator: true,
    domains: ["web3"],
    fetchRank,
  });
  const rankOnly = await evaluateRankEligibility({
    twitterId: "123",
    threshold: 200000,
    includeCreator: false,
    domains: ["web3"],
    fetchRank,
  });

  assert.equal(withCreator.reason, "CREATOR_VERIFICATION_AVAILABLE");
  assert.equal(rankOnly.reason, "RANK_REQUIREMENT_NOT_MET");
});

test("does not query ranking services for logged-out users", async () => {
  let calls = 0;
  const result = await evaluateRankEligibility({
    twitterId: null,
    threshold: 200000,
    includeCreator: true,
    domains: ["web3", "ai"],
    fetchRank: async () => {
      calls += 1;
      return rankResult("web3", 1);
    },
  });

  assert.equal(result.status, "AUTH_REQUIRED");
  assert.equal(calls, 0);
});
