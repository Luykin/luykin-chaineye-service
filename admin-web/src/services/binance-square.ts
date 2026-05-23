import { apiRequest } from "./apiClient";
import type {
  BinanceSquareActionResult,
  BinanceSquareApiResponse,
  BinanceSquareConfigItem,
  BinanceSquareCrawlLogItem,
  BinanceSquareCrawlStatus,
  BinanceSquarePaginated,
  BinanceSquarePostItem,
  BinanceSquareProgress,
  BinanceSquareSeedItem,
  BinanceSquareStats,
  BinanceSquareTargetRankItem,
  BinanceSquareTargetProgress,
  BinanceSquareUserIntroProgress,
  BinanceSquareFollowingUser,
} from "@/types/binance-square";

const BASE = "/api/admin/binance-square";

export async function fetchBinanceSquareStats() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareStats>>(`${BASE}/stats`);
}

export async function fetchBinanceSquareStatus() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareCrawlStatus>>(`${BASE}/crawl/status`);
}

export async function fetchBinanceSquareProgress() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareProgress>>(`${BASE}/crawl/progress`);
}

export async function fetchBinanceSquareTargetProgress() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareTargetProgress>>(`${BASE}/target/progress`);
}

export async function fetchBinanceSquareSeeds() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareSeedItem[]>>(`${BASE}/seed/list`);
}

export async function addBinanceSquareSeed(params: {
  username: string;
  displayName?: string;
}) {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareSeedItem>>(`${BASE}/seed/add`, {
    method: "POST",
    body: params,
  });
}

export async function removeBinanceSquareSeed(username: string) {
  return apiRequest<BinanceSquareApiResponse<{ username: string; removed: boolean }>>(
    `${BASE}/seed/remove`,
    {
      method: "POST",
      body: { username },
    }
  );
}

export async function syncAllBinanceSquareFollowings() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/following/sync`, {
    method: "POST",
  });
}

export async function syncBinanceSquareSeedFollowing(username: string) {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(
    `${BASE}/following/sync/${encodeURIComponent(username)}`,
    { method: "POST" }
  );
}

export async function fetchBinanceSquareFollowingList(params: {
  username: string;
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page || 1));
  query.set("pageSize", String(params.pageSize || 20));
  if (params.includeInactive) query.set("includeInactive", "true");
  return apiRequest<BinanceSquareApiResponse<BinanceSquarePaginated<BinanceSquareFollowingUser>>>(
    `${BASE}/following/list/${encodeURIComponent(params.username)}?${query.toString()}`
  );
}

export type BinanceSquareRankSet = "top50" | "top100" | "top300" | "top1000";

export async function calculateBinanceSquareTargets(rankSet: BinanceSquareRankSet = "top50") {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/target/calculate/${rankSet}`, {
    method: "POST",
  });
}

export async function fetchBinanceSquareTargets(rankSet: BinanceSquareRankSet = "top1000") {
  const query = new URLSearchParams();
  query.set("rankSet", rankSet);
  return apiRequest<BinanceSquareApiResponse<BinanceSquareTargetRankItem[]>>(`${BASE}/target/list?${query.toString()}`);
}

export async function generateBinanceSquareUserIntros(params: {
  rankSet?: BinanceSquareRankSet;
  limit?: number;
  postLimit?: number;
  force?: boolean;
} = {}) {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/users/generate-intros`, {
    method: "POST",
    body: {
      rankSet: params.rankSet || "top1000",
      limit: params.limit || 100,
      postLimit: params.postLimit || 50,
      force: Boolean(params.force),
    },
  });
}

export async function fetchBinanceSquareUserIntroProgress() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareUserIntroProgress>>(`${BASE}/users/generate-intros/progress`);
}

export async function crawlBinanceSquarePosts(params: {
  mode?: "incremental" | "full";
  daysBack?: number;
  concurrency?: number;
  filterTypes?: string[];
} = {}) {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/crawl/posts`, {
    method: "POST",
    body: {
      mode: params.mode || "full",
      daysBack: params.daysBack || 7,
      concurrency: params.concurrency || 5,
      filterTypes: params.filterTypes || ["ALL", "REPLY"],
    },
  });
}

export async function startBinanceSquareScheduler() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/crawl/start`, {
    method: "POST",
  });
}

export async function pauseBinanceSquareScheduler() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(`${BASE}/crawl/pause`, {
    method: "POST",
  });
}

export async function forceStopBinanceSquareCrawl() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(
    `${BASE}/crawl/force-stop`,
    { method: "POST" }
  );
}

export async function purgeBinanceSquareSnapshots() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(
    `${BASE}/maintenance/purge-snapshots`,
    { method: "POST" }
  );
}

export async function recalculateBinanceSquarePostScores(params: {
  daysBack?: number;
  targetOnly?: boolean;
} = {}) {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareActionResult>>(
    `${BASE}/posts/recalculate-scores`,
    {
      method: "POST",
      body: {
        daysBack: params.daysBack || 7,
        targetOnly: params.targetOnly !== false,
      },
    }
  );
}

export async function fetchBinanceSquarePosts(params: {
  page?: number;
  pageSize?: number;
  username?: string;
  postType?: string;
  orderBy?: string;
  minScore?: string | number;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page || 1));
  query.set("pageSize", String(params.pageSize || 20));
  if (params.username) query.set("username", params.username);
  if (params.postType) query.set("postType", params.postType);
  if (params.orderBy) query.set("orderBy", params.orderBy);
  if (params.minScore !== undefined && params.minScore !== "") query.set("minScore", String(params.minScore));
  return apiRequest<BinanceSquareApiResponse<BinanceSquarePaginated<BinanceSquarePostItem>>>(
    `${BASE}/posts?${query.toString()}`
  );
}

export async function fetchBinanceSquareLogs(params?: {
  page?: number;
  pageSize?: number;
  taskType?: string;
  status?: string;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params?.page || 1));
  query.set("pageSize", String(params?.pageSize || 20));
  if (params?.taskType) query.set("taskType", params.taskType);
  if (params?.status) query.set("status", params.status);
  return apiRequest<BinanceSquareApiResponse<BinanceSquarePaginated<BinanceSquareCrawlLogItem>>>(
    `${BASE}/crawl/logs?${query.toString()}`
  );
}

export async function fetchBinanceSquareConfig() {
  return apiRequest<BinanceSquareApiResponse<BinanceSquareConfigItem[]>>(`${BASE}/config`);
}

export async function updateBinanceSquareConfig(params: {
  configKey: string;
  configValue: string;
}) {
  return apiRequest<BinanceSquareApiResponse<{ configKey: string; configValue: string; updated: boolean }>>(
    `${BASE}/config`,
    {
      method: "POST",
      body: params,
    }
  );
}
