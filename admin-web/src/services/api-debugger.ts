import { apiRequest } from "./apiClient";
import type {
  DebuggerEndpointsResponse,
  DebuggerExecuteRequestPayload,
  DebuggerExecuteResponse,
} from "@/types/api-debugger";

/**
 * 获取可调试端点及预设配置元数据
 */
export async function fetchDebuggerEndpoints(): Promise<DebuggerEndpointsResponse> {
  return apiRequest<DebuggerEndpointsResponse>("/api/admin/api-debugger/endpoints");
}

/**
 * 由管理后台服务器执行接口调试请求
 */
export async function executeDebuggerRequest(
  payload: DebuggerExecuteRequestPayload
): Promise<DebuggerExecuteResponse> {
  return apiRequest<DebuggerExecuteResponse>("/api/admin/api-debugger/execute", {
    method: "POST",
    body: payload,
  });
}
