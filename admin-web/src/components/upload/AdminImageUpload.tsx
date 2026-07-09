import { useState } from "react";
import { App, Button, Image, Space, Typography, Upload } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  ADMIN_IMAGE_ACCEPT,
  ADMIN_IMAGE_MAX_SIZE_MB,
  ADMIN_PROGRESSIVE_IMAGE_ACCEPT,
  type AdminImageUploadResult,
  uploadAdminImage,
} from "@/services/blobUpload";

interface AdminImageUploadProps {
  value?: string;
  purpose?: string;
  directory?: string;
  disabled?: boolean;
  maxSizeMb?: number;
  progressiveJpeg?: boolean;
  buttonText?: string;
  onChange?: (url: string, blob?: AdminImageUploadResult) => void;
}

export function AdminImageUpload({
  value,
  purpose = "admin-image",
  directory,
  disabled,
  maxSizeMb = ADMIN_IMAGE_MAX_SIZE_MB,
  progressiveJpeg = false,
  buttonText = "上传图片",
  onChange,
}: AdminImageUploadProps) {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadHint, setUploadHint] = useState("");

  const customRequest: UploadProps["customRequest"] = async (options) => {
    const file = options.file as File;
    try {
      setUploading(true);
      setProgress(0);
      setUploadHint(progressiveJpeg ? "正在转成渐进式 JPEG…" : "正在压缩图片…");
      const blob = await uploadAdminImage(file, {
        purpose,
        directory,
        maxSizeMb,
        progressiveJpeg,
        onPrepared: (result) => {
          if (result.progressiveJpeg) {
            const before = (result.originalSize / 1024 / 1024).toFixed(2);
            const after = (result.preparedSize / 1024 / 1024).toFixed(2);
            setUploadHint(`已转成渐进式 JPEG：${before}MB → ${after}MB`);
          } else if (result.compressed) {
            const before = (result.originalSize / 1024 / 1024).toFixed(2);
            const after = (result.preparedSize / 1024 / 1024).toFixed(2);
            setUploadHint(`已自动压缩：${before}MB → ${after}MB`);
          } else {
            setUploadHint("图片无需压缩，开始上传…");
          }
        },
        onProgress: (event) => {
          setProgress(event.percentage);
          options.onProgress?.({ percent: event.percentage });
        },
      });
      onChange?.(blob.url, blob);
      options.onSuccess?.(blob);
      message.success("图片上传成功");
    } catch (error) {
      const err = error instanceof Error ? error : new Error("图片上传失败");
      options.onError?.(err);
      message.error(err.message);
    } finally {
      setUploading(false);
      setProgress(null);
      setUploadHint("");
    }
  };

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {value ? (
        <Image
          src={value}
          alt="已上传图片"
          width={180}
          style={{ maxHeight: 120, objectFit: "cover", borderRadius: 10 }}
        />
      ) : null}
      <Space wrap>
        <Upload accept={progressiveJpeg ? ADMIN_PROGRESSIVE_IMAGE_ACCEPT : ADMIN_IMAGE_ACCEPT} maxCount={1} showUploadList={false} customRequest={customRequest} disabled={disabled || uploading}>
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {value ? "更换图片" : buttonText}
          </Button>
        </Upload>
        {value ? (
          <Button icon={<DeleteOutlined />} disabled={disabled || uploading} onClick={() => onChange?.("")}>移除</Button>
        ) : null}
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {progressiveJpeg ? "支持 jpg/png/webp，上传前自动转成渐进式 JPEG" : "支持 jpg/png/webp/gif，上传前自动压缩"}，最大 {maxSizeMb}MB{progress !== null ? `，上传中 ${Math.round(progress)}%` : ""}
        {uploadHint ? `，${uploadHint}` : ""}
      </Typography.Text>
    </Space>
  );
}
