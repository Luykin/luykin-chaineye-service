import { Alert, Button, Form, Image, Input, Typography, App, Space } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { buildApiUrl } from "@/services/apiClient";

const ADMIN_ENTRY_PATH = "/api/xhunt/stats";
const DEFAULT_NEXT_PATH = "/overview";

type LoginSecondFactor = {
  tempToken: string;
  maskedEmail?: string;
  emailOtpAvailable?: boolean;
};

function normalizeNextPath(value?: string | null) {
  if (!value || !value.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (value.startsWith("/admin-react/")) return value.replace("/admin-react", "") || DEFAULT_NEXT_PATH;
  if (value.startsWith("/api/xhunt/stats#")) return value.replace("/api/xhunt/stats#", "") || DEFAULT_NEXT_PATH;
  return value;
}

function getSafeNextPath() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
  return normalizeNextPath(params.get("next"));
}

export function LoginPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [otpForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [webauthnLoading, setWebauthnLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondFactorNotice, setSecondFactorNotice] = useState<string | null>(null);
  const [secondFactor, setSecondFactor] = useState<LoginSecondFactor | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const nextPath = useMemo(() => getSafeNextPath(), []);

  const finishLogin = (target?: string) => {
    const safeTarget = normalizeNextPath(target || nextPath || DEFAULT_NEXT_PATH);
    window.location.assign(`${ADMIN_ENTRY_PATH}#${safeTarget}`);
  };

  const authenticateWithWebAuthn = async (attempt: LoginSecondFactor) => {
    setWebauthnLoading(true);
    setError(null);
    setSecondFactorNotice(null);

    try {
      const browserApi = window.SimpleWebAuthnBrowser;
      const supports = browserApi
        ? await browserApi.browserSupportsWebAuthn()
        : typeof window.PublicKeyCredential !== "undefined";

      if (!supports || !browserApi) {
        throw new Error("当前设备不支持生物识别或通行密钥");
      }

      message.loading({ content: "等待设备验证...", key: "admin-login-passkey", duration: 0 });
      const optionsResponse = await fetch(
        buildApiUrl(`/admin/webauthn/authentication/options?tempToken=${encodeURIComponent(attempt.tempToken)}&_ts=${Date.now()}`),
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        }
      );
      const optionsData = await optionsResponse.json().catch(() => ({ success: false, error: "获取认证参数失败" }));
      if (!optionsResponse.ok || !optionsData.success) {
        throw new Error(optionsData.error || "获取认证参数失败");
      }

      const assertion = await browserApi.startAuthentication(optionsData.options);
      const verifyResponse = await fetch(buildApiUrl("/admin/webauthn/authentication/verify"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ tempToken: attempt.tempToken, assertion }),
      });
      const verifyData = await verifyResponse.json().catch(() => ({ success: false, error: "非 JSON 响应" }));
      if (!verifyResponse.ok || !verifyData.success) {
        throw new Error(verifyData.error || "二次验证失败");
      }
      message.destroy("admin-login-passkey");
      finishLogin(verifyData.redirect || nextPath);
    } catch (_) {
      message.destroy("admin-login-passkey");
      setSecondFactorNotice("设备验证未完成。你可以重试，或使用管理员邮箱验证码进入。");
    } finally {
      setWebauthnLoading(false);
      setLoading(false);
    }
  };

  const sendEmailOtp = async () => {
    if (!secondFactor) return;
    setSendingOtp(true);
    setError(null);
    try {
      const response = await fetch(buildApiUrl("/admin/login/email-otp/send"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ tempToken: secondFactor.tempToken }),
      });
      const data = await response.json().catch(() => ({ success: false, error: "验证码发送失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "验证码发送失败");
      }
      setOtpSent(true);
      setSecondFactorNotice(`验证码已发送至 ${data.maskedEmail || secondFactor.maskedEmail || "管理员邮箱"}`);
      message.success("邮箱验证码已发送");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "验证码发送失败");
    } finally {
      setSendingOtp(false);
    }
  };

  const verifyEmailOtp = async (values: { code: string }) => {
    if (!secondFactor) return;
    setVerifyingOtp(true);
    setError(null);
    try {
      const response = await fetch(buildApiUrl("/admin/login/email-otp/verify"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ tempToken: secondFactor.tempToken, code: values.code.trim() }),
      });
      const data = await response.json().catch(() => ({ success: false, error: "验证码验证失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "验证码验证失败");
      }
      finishLogin(data.redirect || nextPath);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "验证码验证失败");
    } finally {
      setVerifyingOtp(false);
    }
  };

  const returnToPassword = () => {
    setSecondFactor(null);
    setOtpSent(false);
    setError(null);
    setSecondFactorNotice(null);
    otpForm.resetFields();
  };

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    setSecondFactorNotice(null);
    setSecondFactor(null);
    setOtpSent(false);

    try {
      const loginResponse = await fetch(buildApiUrl("/admin/login"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          email: values.email.trim(),
          password: values.password,
        }),
      });

      const loginData = await loginResponse.json().catch(() => ({ success: false, error: "登录响应异常" }));
      if (!loginResponse.ok || !loginData.success) {
        throw new Error(loginData.error || `登录失败 (${loginResponse.status})`);
      }

      if (loginData.needsWebAuthn && loginData.tempToken) {
        const attempt = {
          tempToken: String(loginData.tempToken),
          maskedEmail: typeof loginData.maskedEmail === "string" ? loginData.maskedEmail : undefined,
          emailOtpAvailable: loginData.emailOtpAvailable !== false,
        };
        setSecondFactor(attempt);
        await authenticateWithWebAuthn(attempt);
        return;
      }

      finishLogin(loginData.redirect || nextPath);
    } catch (ex) {
      message.destroy("admin-login-passkey");
      setError(ex instanceof Error ? ex.message : "登录失败");
      setLoading(false);
    }
  };

  return (
    <main className="admin-login-react-page">
      <div className="admin-login-bg" aria-hidden="true">
        <span className="admin-login-orb admin-login-orb--blue" />
        <span className="admin-login-orb admin-login-orb--green" />
        <span className="admin-login-orb admin-login-orb--violet" />
        <span className="admin-login-grid" />
        <span className="admin-login-scanline admin-login-scanline--one" />
        <span className="admin-login-scanline admin-login-scanline--two" />
      </div>

      <section className="admin-login-shell">
        <div className="admin-login-brand-panel">
          <div className="admin-login-brand-mark">
            <Image src={buildApiUrl("/admin/logo")} alt="XHunt Logo" preview={false} width={54} height={54} />
          </div>
          <Typography.Title level={1} className="admin-login-brand-title">
            XHunt Admin
          </Typography.Title>
          {/* <Typography.Paragraph className="admin-login-brand-copy">
            新版管理后台。更清爽的操作台，更少干扰，更快进入数据与运营工作流。
          </Typography.Paragraph> */}
        </div>

        <div className="admin-login-card">
          <div className="admin-login-card-head">
            <Typography.Text className="admin-login-kicker">Admin Console</Typography.Text>
            <Typography.Title level={2} className="admin-login-title">
              登录
            </Typography.Title>
            <Typography.Text className="admin-login-subtitle">
              使用管理员邮箱和密码进入后台。
            </Typography.Text>
          </div>

          {error ? <Alert className="admin-login-error" type="error" showIcon message={error} /> : null}

          {secondFactor ? (
            <section className="admin-login-second-factor" aria-labelledby="admin-login-second-factor-title">
              <Typography.Title level={4} id="admin-login-second-factor-title" className="admin-login-second-factor-title">
                完成二次验证
              </Typography.Title>
              <Typography.Paragraph className="admin-login-second-factor-copy">
                优先使用已录入的生物识别设备。无法使用时，可向 {secondFactor.maskedEmail || "管理员邮箱"} 获取一次性验证码。
              </Typography.Paragraph>

              {secondFactorNotice ? <Alert type="info" showIcon message={secondFactorNotice} /> : null}

              <Space direction="vertical" size={10} className="admin-login-second-factor-actions">
                <Button size="large" block loading={webauthnLoading} onClick={() => void authenticateWithWebAuthn(secondFactor)}>
                  重试生物识别
                </Button>
                {secondFactor.emailOtpAvailable ? (
                  <Button type="primary" size="large" block loading={sendingOtp} onClick={() => void sendEmailOtp()}>
                    {otpSent ? "重新发送邮箱验证码" : "使用邮箱验证码"}
                  </Button>
                ) : null}
              </Space>

              {otpSent ? (
                <Form form={otpForm} layout="vertical" onFinish={(values) => void verifyEmailOtp(values)} requiredMark={false}>
                  <Form.Item
                    label="邮箱验证码"
                    name="code"
                    rules={[
                      { required: true, message: "请输入邮箱验证码" },
                      { pattern: /^\d{6}$/, message: "请输入 6 位数字验证码" },
                    ]}
                  >
                    <Input
                      size="large"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="输入 6 位验证码"
                      aria-label="邮箱验证码"
                    />
                  </Form.Item>
                  <Button type="primary" size="large" htmlType="submit" loading={verifyingOtp} block className="admin-login-submit">
                    验证并登录
                  </Button>
                </Form>
              ) : null}

              <Button type="link" block onClick={returnToPassword} disabled={webauthnLoading || sendingOtp || verifyingOtp}>
                返回并重新输入账号密码
              </Button>
            </section>
          ) : (
          <Form form={form} layout="vertical" onFinish={(values) => void handleSubmit(values)} requiredMark={false}>
            <Form.Item
              label="邮箱地址"
              name="email"
              rules={[
                { required: true, message: "请输入邮箱地址" },
                { type: "email", message: "请输入有效邮箱" },
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder="admin@example.com"
                autoComplete="username"
                autoFocus
              />
            </Form.Item>

            <Form.Item label="登录密码" name="password" rules={[{ required: true, message: "请输入登录密码" }]}>
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <Button type="primary" size="large" htmlType="submit" loading={loading} block className="admin-login-submit">
              登录
            </Button>
          </Form>
          )}
        </div>
      </section>
    </main>
  );
}
