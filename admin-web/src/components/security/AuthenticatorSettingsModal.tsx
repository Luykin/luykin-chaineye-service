import { useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Steps,
  Typography,
  message,
  theme,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  beginAdminAuthenticatorSetup,
  fetchAdminAuthenticatorStatus,
  verifyAdminAuthenticatorSetup,
  verifyCurrentAdminAuthenticator,
  type AdminAuthenticatorSetup,
} from "@/services/admin-authenticator";
import { TotpSetupDetails } from "./TotpSetupDetails";

interface AuthenticatorSettingsModalProps {
  adminId?: number;
  open: boolean;
  onClose: () => void;
}

type AuthenticatorFlow = "idle" | "verify-current" | "setup-new";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AuthenticatorSettingsModal({ adminId, open, onClose }: AuthenticatorSettingsModalProps) {
  const { token } = theme.useToken();
  const [messageApi, contextHolder] = message.useMessage();
  const [flow, setFlow] = useState<AuthenticatorFlow>("idle");
  const [setup, setSetup] = useState<AdminAuthenticatorSetup | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [verifyingCurrent, setVerifyingCurrent] = useState(false);
  const [generatingSetup, setGeneratingSetup] = useState(false);
  const [verifyingSetup, setVerifyingSetup] = useState(false);
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
  const busy = verifyingCurrent || generatingSetup || verifyingSetup;

  function resetFlow() {
    setFlow("idle");
    setSetup(null);
    setCurrentCode("");
    setNewCode("");
    setCurrentError(null);
    setSetupError(null);
    setVerifyingCurrent(false);
    setGeneratingSetup(false);
    setVerifyingSetup(false);
  }

  useEffect(() => {
    if (!open) resetFlow();
  }, [open]);

  async function generateSetup() {
    try {
      setGeneratingSetup(true);
      setSetupError(null);
      const response = await beginAdminAuthenticatorSetup();
      setSetup(response.data);
      setNewCode("");
    } catch (requestError) {
      setSetup(null);
      setSetupError(getErrorMessage(requestError, "生成 Authenticator 绑定信息失败"));
    } finally {
      setGeneratingSetup(false);
    }
  }

  function startReplacement() {
    setFlow("verify-current");
    setCurrentCode("");
    setCurrentError(null);
  }

  async function startInitialSetup() {
    setFlow("setup-new");
    await generateSetup();
  }

  async function submitCurrentAuthenticator() {
    if (!/^\d{6}$/.test(currentCode)) {
      setCurrentError("请输入当前 Authenticator 显示的 6 位验证码");
      return;
    }
    try {
      setVerifyingCurrent(true);
      setCurrentError(null);
      await verifyCurrentAdminAuthenticator(currentCode);
      setCurrentCode("");
      setFlow("setup-new");
      messageApi.success("当前 Authenticator 已验证");
      await generateSetup();
    } catch (requestError) {
      setCurrentError(getErrorMessage(requestError, "当前 Authenticator 验证失败"));
    } finally {
      setVerifyingCurrent(false);
    }
  }

  async function submitSetup() {
    if (!/^\d{6}$/.test(newCode)) {
      setSetupError(`请输入${replacing ? "新 " : ""}Authenticator 显示的 6 位验证码`);
      return;
    }
    try {
      setVerifyingSetup(true);
      setSetupError(null);
      const response = await verifyAdminAuthenticatorSetup(newCode);
      resetFlow();
      await statusQuery.refetch();
      messageApi.success(response.data.replaced ? "Authenticator 已安全更换" : "Authenticator 已绑定");
    } catch (requestError) {
      setSetupError(getErrorMessage(
        requestError,
        replacing ? "新 Authenticator 验证失败" : "Authenticator 绑定失败",
      ));
    } finally {
      setVerifyingSetup(false);
    }
  }

  const iconPanelStyle = {
    width: 48,
    height: 48,
    flex: "0 0 48px",
    display: "grid",
    placeItems: "center",
    borderRadius: token.borderRadiusLG,
    color: token.colorPrimary,
    background: token.colorPrimaryBg,
    fontSize: 22,
  } as const;

  return (
    <>
      {contextHolder}
      <Modal
        title={(
          <Space size={10}>
            <SafetyCertificateOutlined style={{ color: token.colorPrimary }} aria-hidden="true" />
            <span>Authenticator 安全设置</span>
          </Space>
        )}
        open={open}
        onCancel={onClose}
        footer={null}
        width={760}
        destroyOnHidden
        maskClosable={!busy}
        keyboard={!busy}
      >
        {statusQuery.isLoading ? (
          <div style={{ minHeight: 240, display: "grid", placeItems: "center" }}>
            <Spin tip="正在检查绑定状态..." />
          </div>
        ) : statusQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法加载 Authenticator 状态"
            description={getErrorMessage(statusQuery.error, "请稍后重试")}
            action={<Button onClick={() => void statusQuery.refetch()}>重新检查</Button>}
          />
        ) : replacing && flow === "idle" ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Card styles={{ body: { padding: 24 } }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                <div style={{ ...iconPanelStyle, color: token.colorSuccess, background: token.colorSuccessBg }}>
                  <CheckCircleOutlined aria-hidden="true" />
                </div>
                <Space direction="vertical" size={4} style={{ flex: 1 }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    Authenticator 已启用
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    高敏感管理操作已受到动态验证码保护。
                  </Typography.Text>
                  {status.enabledAt ? (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      绑定时间：{new Date(status.enabledAt).toLocaleString()}
                    </Typography.Text>
                  ) : null}
                </Space>
              </div>
            </Card>

            <Card styles={{ body: { padding: 24 } }}>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={iconPanelStyle}>
                    <SwapOutlined aria-hidden="true" />
                  </div>
                  <Space direction="vertical" size={4} style={{ flex: 1 }}>
                    <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
                      更换 Authenticator
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      需要先验证当前 Authenticator，再扫描并验证新的二维码。全部完成前，当前 Authenticator 不会失效。
                    </Typography.Text>
                  </Space>
                </div>
                <Button
                  size="large"
                  type="primary"
                  icon={<SwapOutlined aria-hidden="true" />}
                  onClick={startReplacement}
                >
                  开始更换
                </Button>
              </Space>
            </Card>
          </Space>
        ) : replacing && flow === "verify-current" ? (
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Steps
              current={0}
              responsive={false}
              items={[
                { title: "验证当前 Authenticator" },
                { title: "绑定新 Authenticator" },
              ]}
            />
            <Alert
              type="info"
              showIcon
              message="先确认是你本人"
              description="输入当前 Authenticator 中的验证码。此操作只进行身份确认，不会修改或停用当前绑定。"
            />
            <Card styles={{ body: { padding: 24 } }}>
              <Form layout="vertical" onFinish={() => void submitCurrentAuthenticator()} style={{ maxWidth: 420 }}>
                <Form.Item
                  label="当前 Authenticator 验证码"
                  required
                  validateStatus={currentError ? "error" : undefined}
                  help={currentError}
                >
                  <Input
                    value={currentCode}
                    onChange={(event) => {
                      setCurrentCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setCurrentError(null);
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="当前 Authenticator 六位验证码"
                    placeholder="输入 6 位验证码"
                    maxLength={6}
                    size="large"
                    autoFocus
                  />
                </Form.Item>
                <Space wrap>
                  <Button size="large" type="primary" htmlType="submit" loading={verifyingCurrent}>
                    验证并继续
                  </Button>
                  <Button size="large" disabled={busy} onClick={resetFlow}>
                    取消
                  </Button>
                </Space>
              </Form>
            </Card>
          </Space>
        ) : flow === "setup-new" ? (
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            {replacing ? (
              <Steps
                current={1}
                responsive={false}
                items={[
                  { title: "验证当前 Authenticator" },
                  { title: "绑定新 Authenticator" },
                ]}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                message="绑定 Authenticator"
                description="绑定后，高敏感管理操作将需要额外输入动态验证码。"
              />
            )}

            {generatingSetup ? (
              <Card styles={{ body: { minHeight: 220, display: "grid", placeItems: "center" } }}>
                <Spin tip="正在生成安全绑定信息..." />
              </Card>
            ) : !setup ? (
              <Alert
                type="error"
                showIcon
                message="无法生成绑定信息"
                description={setupError || "请稍后重试"}
                action={(
                  <Button loading={generatingSetup} onClick={() => void generateSetup()}>
                    重新生成
                  </Button>
                )}
              />
            ) : (
              <Card
                title={replacing ? "扫描新二维码" : "添加 Authenticator 账户"}
                styles={{ body: { padding: 24 } }}
              >
                <Space direction="vertical" size={24} style={{ width: "100%" }}>
                  <TotpSetupDetails setup={setup} />
                  <Alert
                    type={replacing ? "warning" : "info"}
                    showIcon
                    message={replacing ? "旧 Authenticator 目前仍然有效" : "最后一步：确认验证码"}
                    description={replacing
                      ? "只有下方的新验证码验证成功后，系统才会停用旧 Authenticator 并完成更换。"
                      : "输入新添加账户中显示的验证码，以确认绑定正确。"}
                  />
                  <Form layout="vertical" onFinish={() => void submitSetup()} style={{ maxWidth: 420 }}>
                    <Form.Item
                      label={replacing ? "新 Authenticator 验证码" : "Authenticator 验证码"}
                      required
                      validateStatus={setupError ? "error" : undefined}
                      help={setupError}
                    >
                      <Input
                        value={newCode}
                        onChange={(event) => {
                          setNewCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                          setSetupError(null);
                        }}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        aria-label={replacing ? "新 Authenticator 六位验证码" : "Authenticator 六位验证码"}
                        placeholder="输入 6 位验证码"
                        maxLength={6}
                        size="large"
                        autoFocus
                      />
                    </Form.Item>
                    <Space wrap>
                      <Button size="large" type="primary" htmlType="submit" loading={verifyingSetup}>
                        {replacing ? "确认并完成更换" : "确认绑定"}
                      </Button>
                      <Button size="large" disabled={busy} onClick={() => void generateSetup()}>
                        重新生成二维码
                      </Button>
                      <Button size="large" disabled={busy} onClick={resetFlow}>
                        {replacing ? "取消更换" : "取消"}
                      </Button>
                    </Space>
                  </Form>
                </Space>
              </Card>
            )}

            {replacing && flow === "setup-new" ? (
              <Button type="link" disabled={busy} style={{ alignSelf: "flex-start", paddingInline: 0 }} onClick={startReplacement}>
                返回重新验证当前 Authenticator
              </Button>
            ) : null}
          </Space>
        ) : (
          <Card styles={{ body: { padding: 24 } }}>
            <Space direction="vertical" size={20} style={{ width: "100%" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                <div style={iconPanelStyle}>
                  <KeyOutlined aria-hidden="true" />
                </div>
                <Space direction="vertical" size={4} style={{ flex: 1 }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    尚未绑定 Authenticator
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    绑定后，可使用动态验证码保护高敏感管理页面和操作。
                  </Typography.Text>
                </Space>
              </div>
              <Button
                size="large"
                type="primary"
                icon={<KeyOutlined aria-hidden="true" />}
                loading={generatingSetup}
                onClick={() => void startInitialSetup()}
              >
                开始绑定
              </Button>
            </Space>
          </Card>
        )}
      </Modal>
    </>
  );
}
