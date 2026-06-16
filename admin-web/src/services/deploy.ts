import { apiRequest } from "./apiClient";

export interface DeployCommit {
  hash: string;
  shortHash: string;
  author: string;
  relativeTime: string;
  message: string;
}

export interface DeployTag {
  name: string;
  hash: string;
  shortHash: string;
  relativeTime: string;
  message: string;
}

export interface DeployStatusData {
  projectRoot: string;
  current: DeployCommit | null;
  branch: string;
  dirty: boolean;
  dirtyFiles: string[];
  recentCommits: DeployCommit[];
  tags: DeployTag[];
  originMain: string;
  restartTarget: string;
}

export interface DeployPreviewData {
  target: string;
  resolvedHash: string;
  lostCommits: DeployCommit[];
}

export interface DeployActionData {
  before: string;
  after: string;
  target?: string;
  resolvedHash?: string;
  lostCommits?: DeployCommit[];
  restartScheduled: boolean;
  restartTarget: string;
  outputs: Array<{ step: string; stdout?: string; stderr?: string }>;
}

export function fetchDeployStatus() {
  return apiRequest<{ success: boolean; data: DeployStatusData }>("/admin/deploy/status");
}

export function fetchDeployPreview(target: string, targetType: "commit" | "tag") {
  const params = new URLSearchParams({ target, targetType });
  return apiRequest<{ success: boolean; data: DeployPreviewData }>(`/admin/deploy/preview?${params.toString()}`);
}

export function rollbackDeploy(payload: {
  target: string;
  targetType: "commit" | "tag";
  confirmText: string;
  rebuildAdminWeb: boolean;
}) {
  return apiRequest<{ success: boolean; data: DeployActionData }>("/admin/deploy/rollback", {
    method: "POST",
    body: payload,
  });
}

export function recoverDeploy(payload: { confirmText: string; rebuildAdminWeb: boolean }) {
  return apiRequest<{ success: boolean; data: DeployActionData }>("/admin/deploy/recover", {
    method: "POST",
    body: payload,
  });
}
