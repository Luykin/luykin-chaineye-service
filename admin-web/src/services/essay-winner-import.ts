import { apiRequest } from "./apiClient";

export type EssayWinnerDraft = {
  name: string;
  handler: string;
  avatar: string;
  reward: string;
  award: string;
  post: string;
  url: string;
};

export type EssayWinnerImportIssue = {
  level: "error" | "warning";
  message: string;
};

export type EssayWinnerImportRow = {
  id: string;
  sourceRow: number;
  winner: EssayWinnerDraft;
  issues: EssayWinnerImportIssue[];
  profileLookup: "pending" | "not-needed" | "completed" | "failed";
};

export type EssayWinnerImportPreview = {
  source: {
    type: "google-sheet" | "file";
    spreadsheetId?: string;
    gid?: string;
    fileName?: string;
  };
  sheetName: string;
  sheetNames: string[];
  columns: Array<{ index: number; source: string; field: keyof EssayWinnerDraft | null }>;
  rows: EssayWinnerImportRow[];
  truncated: boolean;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    profilesCompleted: number;
    profilesFailed: number;
  };
};

type PreviewResponse = { success: true; data: EssayWinnerImportPreview };

export function previewGoogleSheetEssayWinners(googleSheetUrl: string) {
  return apiRequest<PreviewResponse>("/api/xhunt/stats/essay-contest-winners/import-preview", {
    method: "POST",
    body: { sourceType: "google-sheet", googleSheetUrl },
  });
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export async function previewEssayWinnerFile(file: File) {
  const base64 = await readFileAsBase64(file);
  return apiRequest<PreviewResponse>("/api/xhunt/stats/essay-contest-winners/import-preview", {
    method: "POST",
    body: {
      sourceType: "file",
      file: { name: file.name, base64 },
    },
  });
}
