import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Result, Space, Spin, Tag, Typography, message } from "antd";
import { ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { buildApiUrl } from "@/services/apiClient";

interface SupabaseLinkResponse {
  success?: boolean;
  url?: string;
  ttl?: number;
  error?: string;
}

export function SupabaseStudioPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [iframeUrl, setIframeUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ttl, setTtl] = useState<number | null>(null);

  const loadStudioUrl = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(buildApiUrl("/admin/supabase/link-token"), {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const data = (await response.json().catch(() => ({ success: false, error: "生成访问票据失败" }))) as SupabaseLinkResponse;

      if (response.status === 403 && data?.error === "需要先录入生物识别") {
        throw new Error("请先在「生物识别」中录入指纹 / Face ID / 通行密钥，再使用 Supabase Studio。");
      }

      if (!response.ok || !data?.success || !data?.url) {
        throw new Error(data?.error || "生成访问票据失败");
      }

      setIframeUrl(data.url);
      setTtl(typeof data.ttl === "number" ? data.ttl : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIframeUrl("");
      messageApi.error(`Supabase Studio 打开失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadStudioUrl();
  }, [loadStudioUrl]);

  return (
    <div className="supabase-studio-page">
      {contextHolder}
      <Card
        className="supabase-studio-shell"
        title={
          <Space size={10} wrap>
            <SafetyCertificateOutlined />
            <span>Supabase Studio</span>
            <Tag color="green">受保护代理</Tag>
            {ttl ? <Tag color="blue">票据 {Math.floor(ttl / 60)} 分钟</Tag> : null}
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void loadStudioUrl()} loading={loading}>
            重新加载
          </Button>
        }
      >
        <Alert
          className="supabase-studio-notice"
          type="warning"
          showIcon
          message="高危数据入口"
          description="Studio 不再通过 IP:8388 暴露；这里通过管理后台登录态生成短时票据，再由 Nginx 受保护代理到本机 Studio。操作数据库前请确认环境与 SQL 影响范围。"
        />

        {loading ? (
          <div className="supabase-studio-state">
            <Spin size="large" tip="正在生成受保护访问票据..." />
          </div>
        ) : error ? (
          <Result
            status="403"
            title="无法打开 Supabase Studio"
            subTitle={error}
            extra={<Button type="primary" onClick={() => void loadStudioUrl()}>重试</Button>}
          />
        ) : iframeUrl ? (
          <div className="supabase-studio-frame-wrap">
            <iframe
              key={iframeUrl}
              className="supabase-studio-frame"
              src={iframeUrl}
              title="Supabase Studio"
              referrerPolicy="same-origin"
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
            />
          </div>
        ) : (
          <Result status="warning" title="暂未生成 Studio 地址" />
        )}

        <Typography.Paragraph className="supabase-studio-footnote" type="secondary">
          如果页面长时间停留后提示无权限或接口失败，点击「重新加载」刷新短时访问票据。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
