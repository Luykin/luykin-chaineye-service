import { apiRequest } from "./apiClient";
import type {
  PerfErrorTracePoint,
  PerfKpiResponse,
  PerfMetricPoint,
  PerfQueueStatusResponse,
  PerfTraceDetail,
  PerfTracePoint,
} from "@/types/perf";

const BASE = "/api/stats/perf";

export async function fetchPerfQueueStatus() {
  return apiRequest<PerfQueueStatusResponse>(`${BASE}/queue-status`);
}

export async function fetchPerfKpis(params: {
  startTime: number;
  endTime: number;
}) {
  const query = new URLSearchParams({
    startTime: String(params.startTime),
    endTime: String(params.endTime),
  });
  return apiRequest<PerfKpiResponse>(`${BASE}/kpis?${query.toString()}`);
}

export async function fetchPerfMetrics(params: {
  startTime: number;
  endTime: number;
  intervalSecs: number;
}) {
  const query = new URLSearchParams({
    startTime: String(params.startTime),
    endTime: String(params.endTime),
    intervalSecs: String(params.intervalSecs),
  });
  return apiRequest<PerfMetricPoint[]>(`${BASE}/metrics?${query.toString()}`);
}

export async function fetchPerfTraces(params: {
  startTime: number;
  endTime: number;
  limit?: number;
}) {
  const query = new URLSearchParams({
    startTime: String(params.startTime),
    endTime: String(params.endTime),
    limit: String(params.limit || 15000),
  });
  return apiRequest<PerfTracePoint[]>(`${BASE}/traces?${query.toString()}`);
}

export async function fetchPerfTraceDetail(requestId: string) {
  return apiRequest<PerfTraceDetail>(`${BASE}/trace/${encodeURIComponent(requestId)}`);
}

export async function fetchPerfErrorTraces(params?: { maxScan?: number }) {
  const query = new URLSearchParams({
    maxScan: String(params?.maxScan || 100000),
  });
  return apiRequest<PerfErrorTracePoint[]>(`${BASE}/errors?${query.toString()}`);
}
