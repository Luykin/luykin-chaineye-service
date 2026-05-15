import { useState } from "react";
import { App, Button, Image, Space, Typography, Upload } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  ADMIN_IMAGE_ACCEPT,
  ADMIN_IMAGE_MAX_SIZE_MB,
  type AdminImageUploadResult,
  uploadAdminImage,
  validateAdminImageFile,
} from "@/services/blobUpload";

interface AdminImageUploadProps {
  value?: string;
  purpose?: string;
  directory?: string;
  disabled?: boolean;
  maxSizeMb?: number;
  buttonText?: string;
  onChange?: (url: string, blob?: AdminImageUploadResult) => void;
}

export function AdminImageUpload({
  value,
  purpose = "admin-image",
  directory,
  disabled,
  maxSizeMb = ADMIN_IMAGE_MAX_SIZE_MB,
  buttonText = "上传图片",
  onChange,
}: AdminImageUploadProps) {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const customRequest: UploadProps["customRequest"] = async (options) => {
    const file = options.file as File;
    try {
      validateAdminImageFile(file, maxSizeMb);
      setUploading(true);
      setProgress(0);
      const blob = await uploadAdminImage(file, {
        purpose,
        directory,
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
        <Upload accept={ADMIN_IMAGE_ACCEPT} maxCount={1} showUploadList={false} customRequest={customRequest} disabled={disabled || uploading}>
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {value ? "更换图片" : buttonText}
          </Button>
        </Upload>
        {value ? (
          <Button icon={<DeleteOutlined />} disabled={disabled || uploading} onClick={() => onChange?.("")}>移除</Button>
        ) : null}
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        支持 jpg/png/webp/gif，最大 {maxSizeMb}MB{progress !== null ? `，上传中 ${Math.round(progress)}%` : ""}
      </Typography.Text>
    </Space>
  );
}
