const { getKolMatchConfigSummary } = require("./config");
const {
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_AI_RECALL_TOP_K,
  DEFAULT_AI_RESULT_LIMIT,
  DEFAULT_FILTER_CANDIDATE_SCAN_LIMIT,
  DEFAULT_FILTER_DAILY_LIMIT,
  DEFAULT_FILTER_RESULT_LIMIT,
} = require("./constants");
const {
  clampInteger,
  getEnvBoolean,
  getEnvPositiveInteger,
} = require("./utils");
const { getEnvRouteMeta } = require("../../utils/env-handler-dispatch");
const { MAX_LIMIT: KOL_MARKETING_SEARCH_MAX_LIMIT } = require("../kol-marketing/search-service");

function getResolvedKolMatchConfig(reqOrConfig) {
  if (reqOrConfig?.kolMatchConfig) return reqOrConfig.kolMatchConfig;
  if (reqOrConfig?.limits || reqOrConfig?.strategyLlm || reqOrConfig?.evaluatorLlm) return reqOrConfig;
  return null;
}

function getKolMatchRuntimeMeta(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  const meta = getKolMatchConfigSummary(config || {});
  if (reqOrConfig?.echohuntRouteVariant) {
    return {
      ...meta,
      ...getEnvRouteMeta(reqOrConfig, { metaKeyPrefix: "echohunt" }),
    };
  }
  return meta;
}

function getAiDailyLimit(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.limits?.aiDailyLimit || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_AI_DAILY_LIMIT", DEFAULT_AI_DAILY_LIMIT);
}

function getFilterDailyLimit(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.limits?.filterDailyLimit || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_FILTER_DAILY_LIMIT", DEFAULT_FILTER_DAILY_LIMIT);
}

function getAiResultLimit(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.limits?.aiResultLimit || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_AI_RESULT_LIMIT", DEFAULT_AI_RESULT_LIMIT);
}

function getAiRecallTopK(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  if (config?.limits?.aiRecallTopK) return config.limits.aiRecallTopK;
  const configured = getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_RECALL_TOP_K", DEFAULT_AI_RECALL_TOP_K);
  return Math.min(KOL_MARKETING_SEARCH_MAX_LIMIT || DEFAULT_AI_RECALL_TOP_K, Math.max(getAiResultLimit(reqOrConfig), configured));
}

function isStrategyLlmEnabled(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  if (config?.strategyLlm) return config.strategyLlm.enabled !== false;
  return getEnvBoolean("ECHOHUNT_KOL_MATCH_STRATEGY_LLM_ENABLED", true);
}

function getStrategyLlmModel(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.strategyLlm?.model || process.env.ECHOHUNT_KOL_MATCH_STRATEGY_LLM_MODEL || process.env.KOL_MARKETING_FILTER_LLM_MODEL || process.env.LLM_MODEL || "";
}

function getStrategyLlmTimeoutMs(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.strategyLlm?.timeoutMs || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_STRATEGY_LLM_TIMEOUT_MS", 10000);
}

function getStrategyLlmMaxTokens(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.strategyLlm?.maxTokens || 1200;
}

function getStrategyLlmTemperature(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return Number.isFinite(Number(config?.strategyLlm?.temperature)) ? Number(config.strategyLlm.temperature) : 0;
}

function isEvaluatorLlmEnabled(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  if (config?.evaluatorLlm) return config.evaluatorLlm.enabled !== false;
  return getEnvBoolean("ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED", true);
}

function getEvaluatorLlmModel(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.evaluatorLlm?.model || process.env.ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_MODEL || process.env.LLM_MODEL || "";
}

function getEvaluatorLlmTimeoutMs(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.evaluatorLlm?.timeoutMs || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_TIMEOUT_MS", 45000);
}

function getEvaluatorLlmBatchSize(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.evaluatorLlm?.batchSize || clampInteger(process.env.ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_BATCH_SIZE || 10, 10, 1, 20);
}

function getEvaluatorLlmMaxTokens(reqOrConfig, batchLength) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  const base = config?.evaluatorLlm?.maxTokensBase || 900;
  const perCandidate = config?.evaluatorLlm?.maxTokensPerCandidate || 300;
  const cap = config?.evaluatorLlm?.maxTokensCap || 5000;
  return Math.min(cap, base + Math.max(0, batchLength || 0) * perCandidate);
}

function getEvaluatorLlmTemperature(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return Number.isFinite(Number(config?.evaluatorLlm?.temperature)) ? Number(config.evaluatorLlm.temperature) : 0;
}

function getFilterResultLimit(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.limits?.filterResultLimit || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_FILTER_RESULT_LIMIT", DEFAULT_FILTER_RESULT_LIMIT);
}

function getFilterCandidateScanLimit(reqOrConfig) {
  const config = getResolvedKolMatchConfig(reqOrConfig);
  return config?.limits?.filterCandidateScanLimit || getEnvPositiveInteger("ECHOHUNT_KOL_MATCH_FILTER_CANDIDATE_SCAN_LIMIT", DEFAULT_FILTER_CANDIDATE_SCAN_LIMIT);
}

module.exports = {
  getAiDailyLimit,
  getAiRecallTopK,
  getAiResultLimit,
  getEvaluatorLlmBatchSize,
  getEvaluatorLlmMaxTokens,
  getEvaluatorLlmModel,
  getEvaluatorLlmTemperature,
  getEvaluatorLlmTimeoutMs,
  getFilterCandidateScanLimit,
  getFilterDailyLimit,
  getFilterResultLimit,
  getKolMatchRuntimeMeta,
  getResolvedKolMatchConfig,
  getStrategyLlmMaxTokens,
  getStrategyLlmModel,
  getStrategyLlmTemperature,
  getStrategyLlmTimeoutMs,
  isEvaluatorLlmEnabled,
  isStrategyLlmEnabled,
};
