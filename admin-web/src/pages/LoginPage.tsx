import { Alert, Button, Form, Image, Input, Typography, App } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { buildApiUrl } from "@/services/apiClient";

const DEFAULT_NEXT_PATH = "/admin-react/overview";

function getSafeNextPath() {
  const params = new URLSearchParams(window.location.search);
  const nextRaw = params.get("next");
  return nextRaw && nextRaw.startsWith("/") ? nextRaw : DEFAULT_NEXT_PATH;
}

export function LoginPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextPath = useMemo(() => getSafeNextPath(), []);

  const finishLogin = (target?: string) => {
    window.location.assign(target || nextPath || DEFAULT_NEXT_PATH);
  };

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);

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
        const browserApi = window.SimpleWebAuthnBrowser;
        const supports = browserApi
          ? await browserApi.browserSupportsWebAuthn()
          : typeof window.PublicKeyCredential !== "undefined";

        if (!supports || !browserApi) {
          throw new Error("该账号需要二次验证，请使用支持通行密钥的设备");
        }

        message.loading({ content: "等待设备验证...", key: "admin-login-passkey", duration: 0 });
        const optionsResponse = await fetch(
          buildApiUrl(`/admin/webauthn/authentication/options?tempToken=${encodeURIComponent(loginData.tempToken)}&_ts=${Date.now()}`),
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

        let assertion: unknown;
        try {
          assertion = await browserApi.startAuthentication(optionsData.options);
        } catch (we) {
          const reason = we instanceof Error && we.message ? `：${we.message}` : "";
          throw new Error(`验证已取消${reason}`);
        }

        const verifyResponse = await fetch(buildApiUrl("/admin/webauthn/authentication/verify"), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ tempToken: loginData.tempToken, assertion }),
        });
        const verifyData = await verifyResponse.json().catch(() => ({ success: false, error: "非 JSON 响应" }));
        if (!verifyResponse.ok || !verifyData.success) {
          throw new Error(verifyData.error || "二次验证失败");
        }
        message.destroy("admin-login-passkey");
        finishLogin(verifyData.redirect || nextPath);
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
        </div>
      </section>
    </main>
  );
}
