import { useMemo, useState } from "react";
import { Button, Card, Descriptions, Input, Space, Tag, Typography, message } from "antd";
import {
  XHuntAuthProvider,
  XHuntLoginButton,
  XHuntLoginModal,
  useXHuntAuth,
  type XHuntAuthProviderName,
} from "@xhunt/auth-client";
import { getApiBaseUrl } from "@/services/apiClient";
import "@/styles/pages/auth-center-test.css";

const { Paragraph, Text, Title } = Typography;
const AUTH_STORAGE_KEY = "xhunt_auth_token";

function getAuthCenterApiBaseUrl() {
  const envBase = import.meta.env.VITE_AUTH_CENTER_API_BASE_URL || getApiBaseUrl();
  if (envBase) return envBase;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8090";
}

function readStorageSnapshot() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTH_STORAGE_KEY) || "";
}

function inferProviderFromUrl(): "google" | "twitter" {
  if (typeof window === "undefined") return "google";
  const url = new URL(window.location.href);
  const provider = url.searchParams.get("provider") || url.searchParams.get("auth_provider");
  return provider === "twitter" ? "twitter" : "google";
}

function AuthCenterWorkbench() {
  const auth = useXHuntAuth();
  const [messageApi, contextHolder] = message.useMessage();
  const [callbackProvider, setCallbackProvider] = useState<"google" | "twitter">(inferProviderFromUrl());
  const [bindProvider, setBindProvider] = useState<"google" | "twitter">("google");
  const [storageSnapshot, setStorageSnapshot] = useState(readStorageSnapshot());
  const [passwordAccount, setPasswordAccount] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [lastResult, setLastResult] = useState<string>("");

  const hasOAuthParams = useMemo(() => {
    if (typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    return Boolean(url.searchParams.get("code") && url.searchParams.get("state"));
  }, []);

  function syncSnapshot() {
    setStorageSnapshot(readStorageSnapshot());
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      const result = await fn();
      const text = JSON.stringify(result, null, 2);
      setLastResult(text);
      syncSnapshot();
      messageApi.success(`${label} 成功`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setLastResult(text);
      syncSnapshot();
      messageApi.error(`${label} 失败：${text}`);
    }
  }

  const providers = auth.user?.providers || [];

  return (
    <div className="auth-center-test-page">
      {contextHolder}
      <section className="auth-center-hero">
        <div>
          <Text className="auth-center-kicker">XHunt Auth Center</Text>
          <Title level={2}>统一登录包联调台</Title>
          <Paragraph>
            这个页面直接从 <Text code>@xhunt/auth-client</Text> 引入 React Provider、登录弹窗和 SDK，
            用来验证后端认证中心接口、OAuth 回调、钱包签名和 localStorage Token 恢复。
          </Paragraph>
        </div>
        <Space wrap>
          <XHuntLoginButton loggedOutLabel="打开登录弹窗" />
          <Button onClick={auth.openLoginModal}>手动打开</Button>
          <Button danger onClick={() => run("logout", () => auth.logout())}>退出</Button>
        </Space>
      </section>

      <div className="auth-center-grid">
        <Card title="当前登录态" className="auth-center-card">
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="isAuthenticated">{String(auth.isAuthenticated)}</Descriptions.Item>
            <Descriptions.Item label="isLoading">{String(auth.isLoading)}</Descriptions.Item>
            <Descriptions.Item label="userId">{auth.user?.id || "-"}</Descriptions.Item>
            <Descriptions.Item label="username">{auth.user?.username || "-"}</Descriptions.Item>
            <Descriptions.Item label="xhuntUserId">{auth.user?.xhuntUserId || "-"}</Descriptions.Item>
            <Descriptions.Item label="providers">
              {providers.length ? providers.map((item) => <Tag key={item}>{item}</Tag>) : "-"}
            </Descriptions.Item>
          </Descriptions>
          <Space wrap className="auth-center-actions">
            <Button onClick={() => run("reloadUser", () => auth.reloadUser())}>调用 /me</Button>
            <Button onClick={() => run("refresh", () => auth.refresh())}>刷新 Token</Button>
            <Button onClick={() => run("logoutAll", () => auth.logout({ allDevices: true }))}>全设备退出</Button>
          </Space>
        </Card>

        <Card title="OAuth 回调测试" className="auth-center-card">
          <Paragraph>
            当前 URL {hasOAuthParams ? "已检测到" : "未检测到"} <Text code>code/state</Text>。
            如果 Google/Twitter 回调到本页面，可点击下面按钮完成 callback。
          </Paragraph>
          <Space wrap>
            <Button type={callbackProvider === "google" ? "primary" : "default"} onClick={() => setCallbackProvider("google")}>
              Google
            </Button>
            <Button type={callbackProvider === "twitter" ? "primary" : "default"} onClick={() => setCallbackProvider("twitter")}>
              Twitter
            </Button>
            <Button onClick={() => run(`handle ${callbackProvider} callback`, () => auth.handleOAuthCallback(callbackProvider))}>
              处理登录回调
            </Button>
          </Space>
        </Card>

        <Card title="绑定登录方式" className="auth-center-card">
          <Space direction="vertical" className="auth-center-full">
            <Input
              placeholder="账户名，只能设置一次"
              value={passwordAccount}
              onChange={(event) => setPasswordAccount(event.target.value)}
            />
            <Input.Password
              placeholder="密码"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
            />
            <Space wrap>
              <Button
                onClick={() =>
                  run("绑定账户密码", async () => {
                    const user = await auth.client.bindPassword({ accountName: passwordAccount, password: passwordValue });
                    await auth.reloadUser();
                    return user;
                  })
                }
              >
                绑定账户密码
              </Button>
              <Button onClick={() => run("绑定钱包", async () => {
                const user = await auth.client.bindWallet();
                await auth.reloadUser();
                return user;
              })}>
                绑定 EVM
              </Button>
            </Space>
            <Space wrap>
              <Button type={bindProvider === "google" ? "primary" : "default"} onClick={() => setBindProvider("google")}>
                Google
              </Button>
              <Button type={bindProvider === "twitter" ? "primary" : "default"} onClick={() => setBindProvider("twitter")}>
                Twitter
              </Button>
              <Button onClick={() => run(`开始绑定 ${bindProvider}`, () => auth.client.startIdentityBind(bindProvider))}>
                跳转绑定
              </Button>
              <Button onClick={() => run(`处理绑定 ${bindProvider} 回调`, async () => {
                const user = await auth.client.handleIdentityBindCallback(bindProvider);
                await auth.reloadUser();
                return user;
              })}>
                处理绑定回调
              </Button>
            </Space>
          </Space>
        </Card>

        <Card title="localStorage Token" className="auth-center-card">
          <Space wrap className="auth-center-actions">
            <Button onClick={syncSnapshot}>刷新快照</Button>
            <Button danger onClick={() => {
              window.localStorage.removeItem(AUTH_STORAGE_KEY);
              syncSnapshot();
              messageApi.success("已清理 localStorage token");
            }}>
              清理 localStorage
            </Button>
          </Space>
          <pre className="auth-center-pre">{storageSnapshot || "localStorage 里暂无 xhunt_auth_token"}</pre>
        </Card>
      </div>

      <Card title="最后一次调用结果" className="auth-center-card auth-center-result">
        <pre className="auth-center-pre">{lastResult || "暂无调用结果"}</pre>
      </Card>

      <XHuntLoginModal
        title="认证中心联调"
        subtitle="验证登录、Token 与身份绑定。"
        enabledProviders={["password", "google", "twitter", "evm"] as XHuntAuthProviderName[]}
      />
    </div>
  );
}

export function AuthCenterTestPage() {
  const apiBaseUrl = getAuthCenterApiBaseUrl();

  return (
    <XHuntAuthProvider
      config={{
        apiBaseUrl,
        authBasePath: "/api/xhunt/auth-center",
        clientKey: "xhunt-admin-web-test",
        storage: "localStorage",
        autoLoadUser: true,
        ui: {
          locale: "zh-CN",
        },
        onError(error) {
          // eslint-disable-next-line no-console
          console.warn("[AuthCenterTest]", error);
        },
      }}
    >
      <AuthCenterWorkbench />
    </XHuntAuthProvider>
  );
}
