import { upload } from "@vercel/blob/client";

export const ADMIN_IMAGE_UPLOAD_PERMISSION = "assets:upload";
export const ADMIN_IMAGE_UPLOAD_PREFIX = import.meta.env.VITE_ADMIN_BLOB_PREFIX || "admin-images";
export const ADMIN_IMAGE_MAX_SIZE_MB = Number(import.meta.env.VITE_ADMIN_BLOB_MAX_SIZE_MB || 10);
export const ADMIN_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export interface AdminImageUploadResult {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType?: string;
  contentDisposition?: string;
}

interface UploadAdminImageOptions {
  purpose?: string;
  directory?: string;
  maxSizeMb?: number;
  onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void;
}

function getFileExtension(file: File) {
  const nameExtension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (nameExtension) return nameExtension === "jpeg" ? "jpg" : nameExtension;
  const typeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return typeMap[file.type] || "png";
}

function sanitizeFileName(file: File) {
  const rawName = file.name.replace(/\.[^.]+$/, "") || "image";
  const safeName = rawName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
  return `${safeName}.${getFileExtension(file)}`;
}

function sanitizePathSegment(value: string) {
  return value
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/\.\./g, "") || ADMIN_IMAGE_UPLOAD_PREFIX;
}

export function validateAdminImageFile(file: File, maxSizeMb = ADMIN_IMAGE_MAX_SIZE_MB) {
  const allowedTypes = ADMIN_IMAGE_ACCEPT.split(",");
  if (!allowedTypes.includes(file.type)) {
    throw new Error("仅支持 jpg、png、webp、gif 图片");
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`图片不能超过 ${maxSizeMb}MB`);
  }
}

export async function uploadAdminImage(file: File, options: UploadAdminImageOptions = {}) {
  validateAdminImageFile(file, options.maxSizeMb);

  const directory = sanitizePathSegment(options.directory || ADMIN_IMAGE_UPLOAD_PREFIX);
  const pathname = `${directory}/${sanitizeFileName(file)}`;

  return upload(pathname, file, {
    access: "public",
    contentType: file.type,
    handleUploadUrl: "/admin/uploads/blob",
    multipart: file.size > 4.5 * 1024 * 1024,
    clientPayload: JSON.stringify({
      purpose: options.purpose || "admin-image",
      originalName: file.name,
      size: file.size,
      contentType: file.type,
      maxSizeMb: options.maxSizeMb || ADMIN_IMAGE_MAX_SIZE_MB,
    }),
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
    onUploadProgress: options.onProgress,
  }) as Promise<AdminImageUploadResult>;
}
