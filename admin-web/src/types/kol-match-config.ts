export type KolMatchAppEnv = "production" | "test";

export interface KolMatchLimitsConfig {
  aiDailyLimit: number;
  filterDailyLimit: number;
  aiResultLimit: number;
  aiRecallTopK: number;
  filterResultLimit: number;
  filterCandidateScanLimit: number;
}

export interface KolMatchStrategyLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface KolMatchEvaluatorLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  batchSize: number;
  maxTokensBase: number;
  maxTokensPerCandidate: number;
  maxTokensCap: number;
  temperature: number;
}

export interface KolMatchPromptConfig {
  strategy: {
    taskPrompt: string;
    systemPrompt: string;
    extraRules: string[];
  };
  candidateEvaluation: {
    taskPrompt: string;
    systemPrompt: string;
    authoritativeRules: string[];
    scoreCalibration: string[];
  };
}

export interface KolMatchEffectiveConfig {
  version: string;
  appEnv: KolMatchAppEnv;
  source?: string;
  configSource?: string;
  fallbackReason?: string;
  contentSha256?: string;
  limits: KolMatchLimitsConfig;
  strategyLlm: KolMatchStrategyLlmConfig;
  evaluatorLlm: KolMatchEvaluatorLlmConfig;
  prompts: KolMatchPromptConfig;
}

export interface KolMatchRuntimeConfigDocument {
  version: string;
  defaults: Partial<KolMatchEffectiveConfig> & Record<string, unknown>;
  envs: Record<KolMatchAppEnv, Partial<KolMatchEffectiveConfig> & Record<string, unknown>>;
}

export interface KolMatchPromptFallbacks {
  strategy: {
    taskPrompt: string;
    systemPrompt: string;
    builtInRules: string[];
    systemSafetyRules: string[];
    extraRules: string[];
  };
  candidateEvaluation: {
    taskPrompt: string;
    systemPrompt: string;
    authoritativeRules: string[];
    scoreCalibration: string[];
    systemSafetyRules: string[];
  };
}

export interface KolMatchConfigData {
  dataId: string;
  group: string;
  type: string;
  source: string;
  version: string;
  content: string;
  contentSha256: string;
  valid?: boolean;
  errors?: string[];
  defaults: KolMatchRuntimeConfigDocument["defaults"];
  envs: KolMatchRuntimeConfigDocument["envs"];
  effective: Record<KolMatchAppEnv, KolMatchEffectiveConfig>;
  runtime?: Record<KolMatchAppEnv, KolMatchEffectiveConfig>;
  promptFallbacks?: KolMatchPromptFallbacks;
}

export interface KolMatchConfigResponse {
  success: boolean;
  data: KolMatchConfigData;
}

export interface KolMatchValidateResponse {
  success: boolean;
  data: {
    valid: boolean;
    errors: string[];
    normalizedDocument: KolMatchRuntimeConfigDocument;
    effective: Record<KolMatchAppEnv, KolMatchEffectiveConfig>;
  };
  error?: string;
}

export interface KolMatchPublishResponse {
  success: boolean;
  data: {
    published: boolean;
    beforeSha256?: string | null;
    afterSha256: string;
    changed: boolean;
    productionChanged?: boolean;
    beforeReadError?: string;
    version: string;
    runtime: Record<KolMatchAppEnv, KolMatchEffectiveConfig>;
  };
}

export interface KolMatchHistoryItem {
  id: number;
  dataId: string;
  group: string;
  type: string;
  contentSha256: string;
  contentLength: number;
  action: string;
  reason: string;
  operatorEmail: string;
  createdAt: string;
}
