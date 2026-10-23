import { useEffect, useState, type ReactNode } from "react";
import { KeyOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Spin, Typography, message, theme } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth";
import {
  beginSensitivePageTotpSetup,
  fetchSensitivePageTotpStatus,
  verifySensitivePageTotp,
  verifySensitivePageTotpSetup,
  type SensitivePageTotpScope,
  type SensitivePageTotpSetup,
} from "@/services/sensitive-page-security";
import { TotpSetupDetails } from "./TotpSetupDetails";

interface SensitivePageTotpGateProps {
  children: ReactNode;
  description: string;
  scope: SensitivePageTotpScope;
  title: string;
}

export function SensitivePageTotpGate({ children, description, scope, title }: SensitivePageTotpGateProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const { token } = theme.useToken();
  const { user } = useAuth();
  const [setup, setSetup] = useState<SensitivePageTotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [locallyExpired, setLocallyExpired] = useState(false);
  const statusQuery = useQuery({
    queryKey: ["sensitive-page-totp", scope, user?.id],
    queryFn: () => fetchSensitivePageTotpStatus(scope),
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
  const status = statusQuery.data?.data;
  const statusExpiresAt = status?.verified
    ? statusQuery.dataUpdatedAt + status.ttlSeconds * 1000
    : 0;
  const accessVerified = !!status?.verified && !locallyExpired && statusExpiresAt > Date.now();

  useEffect(() => {
    if (!status?.verified) return;
    setLocallyExpired(false);
    const remainingMs = statusQuery.dataUpdatedAt + status.ttlSeconds * 1000 - Date.now();
    if (remainingMs <= 0) {
      setLocallyExpired(true);
      void statusQuery.refetch();
      return;
    }
    const timer = window.setTimeout(() => {
      setLocallyExpired(true);
      void statusQuery.refetch();
    }, remainingMs + 100);
    return () => window.clearTimeout(timer);
  }, [status?.ttlSeconds, status?.verified, statusQuery.dataUpdatedAt, statusQuery.refetch]);

  async function beginSetup() {
    try {
      setSubmitting(true);
      setError(null);
      const response = await beginSensitivePageTotpSetup(scope);
      setSetup(response.data);
      setCode("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成 Authenticator 绑定信息失败");
      await statusQuery.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(code)) {
      setError("请输入 6 位 Authenticator 验证码");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      if (status?.enrolled) {
        await verifySensitivePageTotp(scope, code);
      } else {
        await verifySensitivePageTotpSetup(scope, code);
      }
      setCode("");
      setSetup(null);
      await statusQuery.refetch();
      messageApi.success("Authenticator 验证通过");
    } catch (requestError) {
      const text = requestError instanceof Error ? requestError.message : "Authenticator 验证失败";
      setError(text);
      messageApi.error(text);
      await statusQuery.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  if (accessVerified) {
    return (
      <>
        {contextHolder}
        {children}
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <Card style={{ maxWidth: 680, margin: "32px auto" }}>
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Space align="start" size={16}>
            <SafetyCertificateOutlined aria-hidden="true" style={{ color: token.colorPrimary, fontSize: 28, marginTop: 4 }} />
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>{title}</Typography.Title>
              <Typography.Text type="secondary">{description}</Typography.Text>
            </div>
          </Space>

          {statusQuery.isLoading ? (
            <div style={{ minHeight: 120, display: "grid", placeItems: "center" }}>
              <Spin tip="正在检查 Authenticator 状态..." />
            </div>
          ) : statusQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="无法检查 Authenticator 状态"
              description={statusQuery.error instanceof Error ? statusQuery.error.message : "请稍后重试"}
              action={<Button onClick={() => void statusQuery.refetch()}>重新检查</Button>}
            />
          ) : (
            <>
              <Alert
                type="warning"
                showIcon
                message={status?.enrolled ? "需要 Authenticator 验证" : "需要先绑定 Authenticator"}
                description={status?.enrolled
                  ? "请输入 Authenticator 应用当前显示的 6 位验证码。"
                  : "当前账号尚未绑定 Authenticator，完成绑定后才能进入此页面。"}
              />

              {!status?.enrolled && !setup ? (
                <Button
                  size="large"
                  type="primary"
                  icon={<KeyOutlined />}
                  loading={submitting}
                  onClick={() => void beginSetup()}
                >
                  生成 Authenticator 绑定信息
                </Button>
              ) : null}

              {!status?.enrolled && setup ? (
                <Card size="small" title="添加 Authenticator 账户">
                  <TotpSetupDetails setup={setup} />
                </Card>
              ) : null}

              {error && !(status?.enrolled || setup) ? <Alert type="error" showIcon message={error} /> : null}

              {(status?.enrolled || setup) ? (
                <Form layout="vertical" onFinish={() => void submitCode()} style={{ maxWidth: 380 }}>
                  <Form.Item
                    label="Authenticator 验证码"
                    required
                    validateStatus={error ? "error" : undefined}
                    help={error}
                  >
                    <Input
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setError(null);
                      }}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={6}
                      size="large"
                      autoFocus
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button size="large" type="primary" htmlType="submit" loading={submitting}>
                      {status?.enrolled ? "验证并进入" : "确认绑定并进入"}
                    </Button>
                    {!status?.enrolled ? (
                      <Button size="large" loading={submitting} onClick={() => void beginSetup()}>
                        重新生成密钥
                      </Button>
                    ) : null}
                  </Space>
                </Form>
              ) : null}
            </>
          )}
        </Space>
      </Card>
    </>
  );
}
