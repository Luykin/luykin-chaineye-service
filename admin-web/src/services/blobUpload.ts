import { upload } from "@vercel/blob/client";

export const ADMIN_IMAGE_UPLOAD_PERMISSION = "assets:upload";
export const ADMIN_IMAGE_UPLOAD_PREFIX = import.meta.env.VITE_ADMIN_BLOB_PREFIX || "admin-images";
export const ADMIN_IMAGE_MAX_SIZE_MB = Number(import.meta.env.VITE_ADMIN_BLOB_MAX_SIZE_MB || 10);
export const ADMIN_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const ADMIN_IMAGE_COMPRESS_MAX_DIMENSION = 1920;
const ADMIN_IMAGE_SOURCE_MAX_SIZE_MB = 30;

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
  onPrepared?: (result: PreparedAdminImageFile) => void;
}

export interface PreparedAdminImageFile {
  file: File;
  originalFile: File;
  compressed: boolean;
  originalSize: number;
  preparedSize: number;
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

function validateAdminImageType(file: File) {
  const allowedTypes = ADMIN_IMAGE_ACCEPT.split(",");
  if (!allowedTypes.includes(file.type)) {
    throw new Error("仅支持 jpg、png、webp、gif 图片");
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("图片压缩失败，请换一张图片重试"));
        else resolve(blob);
      },
      type,
      quality
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败，请确认文件未损坏"));
    };
    image.src = url;
  });
}

function replaceFileExtension(name: string, extension: string) {
  const baseName = name.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.${extension}`;
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

async function compressImageFile(file: File, maxSizeMb: number) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  if (typeof document === "undefined") return file;

  const image = await loadImage(file);
  const targetBytes = maxSizeMb * 1024 * 1024;
  const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  let scale = Math.min(1, ADMIN_IMAGE_COMPRESS_MAX_DIMENSION / Math.max(1, longestSide));
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
  let bestBlob: Blob | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器不支持图片压缩，请换浏览器或先手动压缩");
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= targetBytes) break;
    }

    if (bestBlob && bestBlob.size <= targetBytes) break;
    scale *= 0.82;
  }

  if (!bestBlob) return file;
  if (bestBlob.size >= file.size && file.size <= targetBytes) return file;

  return new File([bestBlob], replaceFileExtension(file.name, "webp"), {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

export async function prepareAdminImageFile(file: File, maxSizeMb = ADMIN_IMAGE_MAX_SIZE_MB): Promise<PreparedAdminImageFile> {
  validateAdminImageType(file);

  if (file.size > ADMIN_IMAGE_SOURCE_MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`原图过大（${formatFileSize(file.size)}），请先压缩到 ${ADMIN_IMAGE_SOURCE_MAX_SIZE_MB}MB 以内再上传`);
  }

  const preparedFile = await compressImageFile(file, maxSizeMb);
  validateAdminImageFile(preparedFile, maxSizeMb);

  if (preparedFile.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`图片压缩后仍超过 ${maxSizeMb}MB，请运营先压缩后再上传`);
  }

  return {
    file: preparedFile,
    originalFile: file,
    compressed: preparedFile !== file,
    originalSize: file.size,
    preparedSize: preparedFile.size,
  };
}

export async function uploadAdminImage(file: File, options: UploadAdminImageOptions = {}) {
  const prepared = await prepareAdminImageFile(file, options.maxSizeMb);
  options.onPrepared?.(prepared);

  const directory = sanitizePathSegment(options.directory || ADMIN_IMAGE_UPLOAD_PREFIX);
  const pathname = `${directory}/${sanitizeFileName(prepared.file)}`;

  return upload(pathname, prepared.file, {
    access: "public",
    contentType: prepared.file.type,
    handleUploadUrl: "/admin/uploads/blob",
    multipart: prepared.file.size > 4.5 * 1024 * 1024,
    clientPayload: JSON.stringify({
      purpose: options.purpose || "admin-image",
      originalName: file.name,
      size: file.size,
      preparedName: prepared.file.name,
      preparedSize: prepared.file.size,
      contentType: prepared.file.type,
      compressed: prepared.compressed,
      maxSizeMb: options.maxSizeMb || ADMIN_IMAGE_MAX_SIZE_MB,
    }),
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
    onUploadProgress: options.onProgress,
  }) as Promise<AdminImageUploadResult>;
}
