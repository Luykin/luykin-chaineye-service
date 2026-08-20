const AI_EVALUATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "semanticScore", "dimensions", "reason", "evidence", "matchedTerms"],
        properties: {
          candidateId: { type: "string" },
          semanticScore: { type: "number", minimum: 0, maximum: 100 },
          dimensions: {
            type: "object",
            additionalProperties: false,
            required: ["expertise", "content", "audience", "campaign"],
            properties: {
              expertise: { type: "number", minimum: 0, maximum: 100 },
              content: { type: "number", minimum: 0, maximum: 100 },
              audience: { type: "number", minimum: 0, maximum: 100 },
              campaign: { type: "number", minimum: 0, maximum: 100 },
            },
          },
          reason: { type: "string" },
          evidence: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["evidenceRef", "statement"],
              properties: {
                evidenceRef: { type: "string" },
                statement: { type: "string" },
              },
            },
          },
          matchedTerms: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
    },
  },
};

const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectUnderstanding",
    "semanticQuery",
    "filters",
    "strategyChips",
    "publicReasoning",
    "confidence",
  ],
  properties: {
    projectUnderstanding: {
      type: "object",
      additionalProperties: false,
      required: ["projectType", "marketingGoal", "targetAudience", "idealKolProfile"],
      properties: {
        projectType: { type: "string" },
        marketingGoal: { type: "string" },
        targetAudience: { type: "string" },
        idealKolProfile: { type: "string" },
      },
    },
    semanticQuery: { type: "string" },
    filters: {
      type: "object",
      additionalProperties: false,
      required: [
        "language",
        "domains",
        "keywords",
        "cooperationTypes",
        "marketingGoals",
        "projectStages",
        "willingnessLevels",
        "identityTier",
        "minFollowers",
        "maxFollowers",
        "activityDays",
      ],
      properties: {
        language: { type: "string", enum: ["", "CN", "GLOBAL"] },
        domains: { type: "array", items: { type: "string", enum: ["AI", "Web3"] }, maxItems: 2 },
        keywords: { type: "array", items: { type: "string" }, maxItems: 8 },
        cooperationTypes: { type: "array", items: { type: "string" }, maxItems: 6 },
        marketingGoals: { type: "array", items: { type: "string" }, maxItems: 6 },
        projectStages: { type: "array", items: { type: "string" }, maxItems: 6 },
        willingnessLevels: {
          type: "array",
          items: { type: "string", enum: ["low", "medium", "high", "unknown"] },
          maxItems: 4,
        },
        identityTier: { type: "string" },
        minFollowers: { type: ["number", "null"] },
        maxFollowers: { type: ["number", "null"] },
        activityDays: { type: ["number", "null"] },
      },
    },
    strategyChips: { type: "array", items: { type: "string" }, maxItems: 10 },
    publicReasoning: { type: "array", items: { type: "string" }, maxItems: 8 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

module.exports = {
  AI_EVALUATOR_SCHEMA,
  STRATEGY_SCHEMA,
};
