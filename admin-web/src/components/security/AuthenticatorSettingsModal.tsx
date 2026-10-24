import { useEffect, useState } from "react";
import { CheckCircleOutlined, KeyOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Modal, Space, Spin, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  beginAdminAuthenticatorSetup,
  fetchAdminAuthenticatorStatus,
  verifyAdminAuthenticatorSetup,
  type AdminAuthenticatorSetup,
} from "@/services/admin-authenticator";
import { TotpSetupDetails } from "./TotpSetupDetails";

interface AuthenticatorSettingsModalProps {
  adminId?: number;
  open: boolean;
  onClose: () => void;
}

export function AuthenticatorSettingsModal({ adminId, open, onClose }: AuthenticatorSettingsModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [setup, setSetup] = useState<AdminAuthenticatorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const statusQuery = useQuery({
    queryKey: ["admin-authenticator-status", adminId],
    queryFn: fetchAdminAuthenticatorStatus,
    enabled: open && !!adminId,
    gcTime: 0,
    retry: false,
    staleTime: 0,
  });
  const status = statusQuery.data?.data;
  const replacing = !!status?.enrolled;

  useEffect(() => {
    if (open) return;
    setSetup(null);
    setCode("");
    setError(null);
    setSubmitting(false);
  }, [open]);

  async function beginSetup() {
    try {
      setSubmitting(true);
      setError(null);
      const response = await beginAdminAuthenticatorSetup();
      setSetup(response.data);
      setCode("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成 Authenticator 绑定信息失败");
      await statusQuery.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSetup() {
    if (!/^\d{6}$/.test(code)) {
      setError("请输入 6 位 Authenticator 验证码");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const response = await verifyAdminAuthenticatorSetup(code);
      setSetup(null);
      setCode("");
      await statusQuery.refetch();
      messageApi.success(response.data.replaced ? "Authenticator 已更换" : "Authenticator 已绑定");
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : replacing
          ? "更换 Authenticator 失败"
          : "绑定 Authenticator 失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title="Authenticator"
        open={open}
        onCancel={onClose}
        footer={null}
        width={720}
        destroyOnHidden
      >
        {statusQuery.isLoading ? (
          <div style={{ minHeight: 180, display: "grid", placeItems: "center" }}>
            <Spin tip="正在检查绑定状态..." />
          </div>
        ) : statusQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法加载 Authenticator 状态"
            description={statusQuery.error instanceof Error ? statusQuery.error.message : "请稍后重试"}
            action={<Button onClick={() => void statusQuery.refetch()}>重新检查</Button>}
          />
        ) : status?.enrolled && !setup ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined aria-hidden="true" />}
              message="Authenticator 已绑定"
              description="该账号已经启用 Authenticator，可用于需要二次验证的高敏感管理页面。"
            />
            {status.enabledAt ? (
              <Typography.Text type="secondary">
                绑定时间：{new Date(status.enabledAt).toLocaleString()}
              </Typography.Text>
            ) : null}
            <Button
              size="large"
              icon={<KeyOutlined aria-hidden="true" />}
              loading={submitting}
              onClick={() => void beginSetup()}
            >
              更换 Authenticator
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type={replacing ? "warning" : "info"}
              showIcon
              message={replacing ? "正在更换 Authenticator" : "当前账号尚未绑定 Authenticator"}
              description={replacing
                ? "请扫描新的二维码并输入一次新 Authenticator 显示的验证码。确认成功前，原 Authenticator 仍然有效。"
                : "绑定后可进入要求 Authenticator 二次验证的管理页面。"}
            />
            {!setup ? (
              <Button
                size="large"
                type="primary"
                icon={<KeyOutlined aria-hidden="true" />}
                loading={submitting}
                onClick={() => void beginSetup()}
              >
                生成二维码并开始绑定
              </Button>
            ) : (
              <Card size="small" title={replacing ? "扫描新二维码并确认更换" : "扫描二维码并确认绑定"}>
                <Space direction="vertical" size={20} style={{ width: "100%" }}>
                  <TotpSetupDetails setup={setup} />
                  <Form layout="vertical" onFinish={() => void submitSetup()} style={{ maxWidth: 380 }}>
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
                        {replacing ? "确认更换" : "确认绑定"}
                      </Button>
                      <Button size="large" loading={submitting} onClick={() => void beginSetup()}>
                        重新生成二维码
                      </Button>
                    </Space>
                  </Form>
                </Space>
              </Card>
            )}
            {error && !setup ? <Alert type="error" showIcon message={error} /> : null}
          </Space>
        )}
      </Modal>
    </>
  );
}
