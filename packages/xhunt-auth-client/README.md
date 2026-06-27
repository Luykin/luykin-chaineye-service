# @xhunt/auth-client

React 登录包，封装 XHunt Auth Center 的登录 UI、接口调用、`localStorage` Token 管理和用户状态管理。

## 1. 当前定位

- 只考虑 React。
- Token 固定存 `localStorage`。
- 包含默认登录弹窗，也可以只使用 SDK / hooks 自己做 UI。
- 当前包放在项目内 `packages/xhunt-auth-client`，后续建议拆到单独 GitHub 私有仓库根目录。

## 2. 私有 GitHub 安装方式

可以不上传公共 npm，只放 GitHub 私有仓库。

### 推荐方式：单独私有仓库

把本目录内容放到一个单独仓库，例如：

```text
github.com/your-org/xhunt-auth-client
```

业务项目通过 SSH 安装：

```json
{
  "dependencies": {
    "@xhunt/auth-client": "git+ssh://git@github.com/your-org/xhunt-auth-client.git#v0.1.0"
  }
}
```

也可以使用分支：

```json
{
  "dependencies": {
    "@xhunt/auth-client": "git+ssh://git@github.com/your-org/xhunt-auth-client.git#main"
  }
}
```

> 不建议把 GitHub token 写进 `package.json`。本地开发机和 CI 用 SSH key / deploy key 更安全。

### 注意 monorepo 子目录问题

如果包仍然放在当前大仓库的 `packages/xhunt-auth-client` 子目录，普通 npm/yarn 从 GitHub 安装时不一定能直接安装子目录包。为了让其他项目稳定安装，最好后续拆成独立私有仓库，并让这个包位于仓库根目录。

## 3. 接入示例

```tsx
import {
  XHuntAuthProvider,
  XHuntLoginButton,
  XHuntLoginModal,
  useXHuntAuth,
} from "@xhunt/auth-client";
import "@xhunt/auth-client/dist/style.css";

function App() {
  return (
    <XHuntAuthProvider
      config={{
        apiBaseUrl: "https://api.cryptohunt.ai",
        authBasePath: "/api/xhunt/auth-center",
        clientKey: "xhunt-web",
        storage: "localStorage",
      }}
    >
      <Header />
      <XHuntLoginModal />
    </XHuntAuthProvider>
  );
}

function Header() {
  const auth = useXHuntAuth();

  if (!auth.isAuthenticated) {
    return <XHuntLoginButton />;
  }

  return (
    <div>
      <span>{auth.user?.username}</span>
      <button onClick={() => auth.logout()}>Logout</button>
    </div>
  );
}
```

## 4. OAuth 回调页

Google / Twitter 登录回调页可以使用：

```tsx
import { XHuntAuthCallbackPage } from "@xhunt/auth-client";

export default function AuthCallback() {
  return (
    <XHuntAuthCallbackPage
      provider="google"
      onSuccess={() => {
        window.location.href = "/";
      }}
    />
  );
}
```

Twitter：

```tsx
<XHuntAuthCallbackPage provider="twitter" />
```

绑定模式：

```tsx
<XHuntAuthCallbackPage provider="google" bindMode />
```

## 5. Token localStorage 约定

默认 key：

```text
xhunt_auth_token
```

结构：

```json
{
  "accessToken": "xxx",
  "refreshToken": "yyy",
  "expiresAt": 1710003600000,
  "tokenType": "Bearer",
  "userSnapshot": {
    "id": "uuid",
    "username": "alice"
  }
}
```

业务侧不要直接读写这个 key，统一通过 hooks / client 操作。

## 6. 常用 API

```ts
const auth = useXHuntAuth();

await auth.loginWithPassword({ accountName, password }); // accountName 支持普通账户名或邮箱
await auth.registerWithPassword({ accountName, password });
await auth.loginWithGoogle();
await auth.loginWithTwitter();
await auth.loginWithWallet();
await auth.refresh();
await auth.reloadUser();
await auth.logout();
await auth.logout({ allDevices: true });
```

底层 SDK：

```ts
import { XHuntAuthClient } from "@xhunt/auth-client";

const client = new XHuntAuthClient({
  apiBaseUrl: "https://api.cryptohunt.ai",
  clientKey: "xhunt-web",
});

const token = await client.getAccessToken();
const res = await client.authorizedFetch("/api/your-service");
```

## 7. 构建

```bash
npm install
npm run build
```

当前项目里不要自动运行构建，交给项目负责人控制。

## 8. 主题配置

默认主题是接近 XHunt 官网的黑底青绿色科技风：

```tsx
<XHuntAuthProvider
  config={{
    apiBaseUrl: "https://api.cryptohunt.ai",
    clientKey: "xhunt-web",
    ui: {
      theme: "xhunt",
      mode: "dark",
    },
  }}
>
  <App />
</XHuntAuthProvider>
```

内置 3 套主题：

```ts
theme: "xhunt" | "aqua" | "mono"
```

支持明暗模式：

```ts
mode: "dark" | "light" | "auto"
```

也可以自定义颜色：

```tsx
<XHuntAuthProvider
  config={{
    apiBaseUrl: "https://api.cryptohunt.ai",
    clientKey: "xhunt-web",
    ui: {
      theme: "xhunt",
      mode: "dark",
      tokens: {
        accent: "#12e3cf",
        accent2: "#19b7d3",
        background: "#000706",
        panel: "#06110f",
        text: "#edf7f4",
        muted: "#8c9898",
        border: "rgba(124, 154, 168, 0.28)",
        danger: "#ff6b63",
      },
    },
  }}
>
  <App />
</XHuntAuthProvider>
```

## 9. 多语言配置

默认语言是英文，不传 `locale` 时会展示英文。内置支持：

```ts
locale: "en" | "zh-CN" | "zh-TW"
```

业务侧可以在 Provider 里统一指定：

```tsx
<XHuntAuthProvider
  config={{
    apiBaseUrl: "https://api.cryptohunt.ai",
    clientKey: "xhunt-web",
    ui: {
      locale: "zh-CN",
    },
  }}
>
  <App />
</XHuntAuthProvider>
```

也可以只给某个弹窗指定：

```tsx
<XHuntLoginModal locale="zh-TW" />
```

如果业务侧有其他语言，可以通过 `texts` 覆盖文案和错误提示：

```tsx
<XHuntAuthProvider
  config={{
    apiBaseUrl: "https://api.cryptohunt.ai",
    clientKey: "xhunt-web",
    ui: {
      locale: "ja",
      texts: {
        title: "XHunt にログイン",
        continueButton: "続行",
        errors: {
          INVALID_ACCOUNT_OR_PASSWORD: "アカウントまたはパスワードが正しくありません。",
        },
      },
    },
  }}
>
  <App />
</XHuntAuthProvider>
```

