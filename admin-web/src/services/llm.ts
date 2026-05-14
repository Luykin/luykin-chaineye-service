import { apiRequest } from "./apiClient";

export interface LlmModelOption {
  value: string;
  label: string;
  description?: string;
  supportsJson?: boolean;
}

export interface LlmTestRequest {
  prompt: string;
  model: string;
  temperature: number;
  outputFormat: "text" | "json";
  jsonSchema?: unknown;
  systemPrompt?: string;
}

export interface LlmTestResponse {
  success: boolean;
  data: unknown;
  error?: { message?: string; type?: string } | string | null;
  meta?: {
    model?: string;
    temperature?: number;
    outputFormat?: string;
    duration?: string;
    timestamp?: string;
    requestId?: string | null;
  };
}

export function fetchLlmModels() {
  return apiRequest<{ success: boolean; data: LlmModelOption[] }>("/api/admin/llm-test/models");
}

export function runLlmTest(payload: LlmTestRequest) {
  return apiRequest<LlmTestResponse>("/api/admin/llm-test", {
    method: "POST",
    headers: { "x-request-id": `llm-${Date.now()}-${Math.random().toString(16).slice(2)}` },
    body: { ...payload },
  });
}
