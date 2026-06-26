export interface PerfMetricPoint {
  timestamp: number;
  request_count: number;
  total_duration?: number;
  avg_duration_ms: number;
  [key: string]: string | number | undefined;
}

export interface PerfKpiSummary {
  totalRequests?: number;
  requestCount?: number;
  totalCount?: number;
  total?: number;
  count?: number;
  avgDurationMs?: number;
  avg_duration_ms?: number;
  avgMs?: number;
  avg?: number;
  p95DurationMs?: number;
  p95_duration_ms?: number;
  p95Ms?: number;
  p95?: number;
}

export interface PerfKpiResponse {
  current?: PerfKpiSummary;
  cur?: PerfKpiSummary;
  data?: PerfKpiSummary;
  [key: string]: unknown;
}

export interface PerfTracePoint {
  ts: number;
  durationMs: number;
  status: number;
  hasDetail?: boolean;
  requestId?: string;
  path?: string;
  userId?: string;
  ip?: string;
  source?: string;
  webClientKey?: string;
  webSignResult?: string;
  webSignFailReason?: string;
  pageUrl?: string;
}

export interface PerfTraceDetail {
  [key: string]: unknown;
}

export interface PerfQueueStatusResponse {
  success: boolean;
  queueLength: number;
}

export interface PerfErrorTracePoint {
  ts: number;
  durationMs: number;
  status: number;
  requestId?: string;
  path?: string;
  userId?: string;
}
