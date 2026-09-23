export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface DebuggerEndpointField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  description?: string;
  options?: string[];
}

export interface DebuggerEndpoint {
  id: string;
  name: string;
  module: string;
  method: HttpMethod;
  path: string;
  defaultBaseUrl: string;
  description: string;
  presetHeaders: Record<string, string>;
  fixedParams: Record<string, unknown>;
  fields: DebuggerEndpointField[];
  sampleParams: Record<string, unknown>;
}

export interface DebuggerConfigInfo {
  baseUrl: string;
  apiKeyMasked: string;
  crawlerQuotaUrl: string;
}

export interface DebuggerEndpointsResponse {
  success: boolean;
  data: {
    endpoints: DebuggerEndpoint[];
    configInfo: DebuggerConfigInfo;
  };
}

export interface DebuggerExecutionResult {
  status: number;
  statusText: string;
  durationMs: number;
  targetUrl: string;
  method: HttpMethod;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseHeaders: Record<string, unknown>;
  responseData: unknown;
  isError: boolean;
  error: {
    message: string;
    code?: string;
    type?: string;
    suggestion?: string;
  } | null;
}

export interface DebuggerExecuteRequestPayload {
  endpointId: string;
  params?: Record<string, unknown>;
  customPayload?: Record<string, unknown>;
  baseUrlOverride?: string;
  customHeaders?: Record<string, string>;
  [key: string]: unknown;
}

export interface DebuggerExecuteResponse {
  success: boolean;
  endpointId: string;
  execution: DebuggerExecutionResult;
  error?: string;
}
