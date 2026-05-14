import {
  AuditOutlined,
  BarChartOutlined,
  FireOutlined,
  HomeOutlined,
  LinkOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  AppstoreOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Dropdown,
  Form,
  Input,
  Layout,
  List,
  Menu,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useAuth } from "@/app/auth";
import { buildApiUrl } from "@/services/apiClient";

const { Header, Sider, Content } = Layout;
const ADMIN_HOME_PATH = "/admin-react/dau-details";

const navItems = [
  {
    key: "/admin-react/dau-details",
    icon: <FireOutlined />,
    label: "日活详情",
    permission: "dau-details",
  },
  {
    key: "/admin-react/online-users",
    icon: <TeamOutlined />,
    label: "在线用户",
    permission: "online-users",
  },
  {
    key: "/admin-react/generic-stats",
    icon: <AppstoreOutlined />,
    label: "通用统计",
    permission: "generic-stats",
  },
  {
    key: "/admin-react/admin-audit-logs",
    icon: <AuditOutlined />,
    label: "操作记录",
    permission: "audit-logs:read",
  },
  {
    key: "/admin-react/url-stats",
    icon: <LinkOutlined />,
    label: "接口统计",
    permission: "url-stats",
  },
  {
    key: "/admin-react/version-stats",
    icon: <BarChartOutlined />,
    label: "版本统计",
    permission: "version-stats",
  },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasPermission, refresh } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [webauthnModalOpen, setWebauthnModalOpen] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [addingCredential, setAddingCredential] = useState(false);
  const [credentialItems, setCredentialItems] = useState<
    Array<{ id: number; nickname?: string | null; lastUsedAt?: string | null; createdAt?: string | null }>
  >([]);
  const [passwordForm] = Form.useForm();
  const [webauthnForm] = Form.useForm();

  const items = useMemo(
    () =>
      navItems
        .filter((item) => hasPermission(item.permission))
        .map(({ key, icon, label }) => ({ key, icon, label })),
    [hasPermission]
  );

  const openLoginPage = () => {
    const loginUrl = new URL(buildApiUrl("/admin/login"), window.location.origin);
    loginUrl.searchParams.set("next", ADMIN_HOME_PATH);
    window.location.href = loginUrl.toString();
  };

  const handleLogout = async () => {
    await fetch(buildApiUrl("/admin/logout"), {
      method: "POST",
      credentials: "include",
    });
    openLoginPage();
  };

  const sendPasswordCode = async () => {
    try {
      setSendingCode(true);
      const response = await fetch(buildApiUrl("/admin/password/send-code"), {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({ success: false, error: "发送失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || "发送失败");
      }
      messageApi.success("验证码已发送到当前管理员邮箱");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "发送验证码失败");
    } finally {
      setSendingCode(false);
    }
  };

  const submitPasswordReset = async () => {
    try {
      const values = await passwordForm.validateFields();
      setResettingPassword(true);
      const response = await fetch(buildApiUrl("/admin/password/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: values.code,
          newPassword: values.newPassword,
        }),
      });
      const data = await response.json().catch(() => ({ success: false, error: "重置失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "重置失败");
      }
      messageApi.success("密码已修改，请重新登录");
      setPasswordModalOpen(false);
      passwordForm.resetFields();
      await handleLogout();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setResettingPassword(false);
    }
  };

  const loadCredentials = async () => {
    try {
      setLoadingCredentials(true);
      const response = await fetch(buildApiUrl("/admin/webauthn/credentials"), {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({ success: false, error: "加载失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "加载失败");
      }
      setCredentialItems(Array.isArray(data.credentials) ? data.credentials : []);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载生物识别设备失败");
      setCredentialItems([]);
    } finally {
      setLoadingCredentials(false);
    }
  };

  const openWebAuthnModal = async () => {
    setWebauthnModalOpen(true);
    await loadCredentials();
  };

  const addCredential = async () => {
    try {
      setAddingCredential(true);
      const nickname = (webauthnForm.getFieldValue("nickname") || "").trim();
      const browserApi = window.SimpleWebAuthnBrowser;
      const supports = browserApi
        ? await browserApi.browserSupportsWebAuthn()
        : typeof window.PublicKeyCredential !== "undefined";

      if (!supports || !browserApi) {
        throw new Error("当前环境不支持生物识别注册，请使用支持指纹/FaceID 的设备");
      }

      const optRes = await fetch(buildApiUrl("/admin/webauthn/registration/options"), {
        credentials: "include",
      });
      const optData = await optRes.json().catch(() => ({ success: false, error: "获取注册参数失败" }));
      if (!optRes.ok || !optData.success) {
        throw new Error(optData.error || "获取注册参数失败");
      }

      const attResp = await browserApi.startRegistration(optData.options);
      const verifyRes = await fetch(buildApiUrl("/admin/webauthn/registration/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attResp, nickname }),
      });
      const verifyData = await verifyRes.json().catch(() => ({ success: false, error: "注册失败" }));
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || "注册失败");
      }
      messageApi.success("已添加当前设备，可用于生物识别登录");
      webauthnForm.resetFields();
      await loadCredentials();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "注册生物识别失败");
    } finally {
      setAddingCredential(false);
    }
  };

  const deleteCredential = async (id: number) => {
    try {
      const response = await fetch(buildApiUrl(`/admin/webauthn/credentials/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({ success: false, error: "删除失败" }));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "删除失败");
      }
      messageApi.success("设备已删除");
      await loadCredentials();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除设备失败");
    }
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {contextHolder}
      <Sider
        width={248}
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        collapsedWidth={80}
        trigger={null}
        style={{ borderRight: "1px solid #e5e7eb" }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? "0 12px" : "0 20px",
            borderBottom: "1px solid #e5e7eb",
            fontWeight: 700,
            fontSize: 18,
            color: "#111827",
          }}
        >
          <Typography.Text
            strong
            ellipsis
            style={{ fontSize: 18, margin: 0, maxWidth: "100%" }}
          >
            {collapsed ? "XA" : "XHunt Admin"}
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: "none", paddingTop: 12 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            gap: 16,
          }}
        >
          <Space size={12} style={{ minWidth: 0, flex: 1 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            />
            <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
              <Typography.Title level={4} ellipsis style={{ margin: 0, maxWidth: "100%" }}>
                新版管理后台
              </Typography.Title>
              <Typography.Text type="secondary" ellipsis style={{ maxWidth: "100%" }}>
                React + Ant Design 迁移试点
              </Typography.Text>
            </Space>
          </Space>

          <Dropdown
            trigger={["hover", "click"]}
            menu={{
              items: [
                {
                  key: "email",
                  disabled: true,
                  label: (
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong>{user?.email || "管理员"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        当前账号
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  key: "role",
                  disabled: true,
                  label: (
                    <Space size={8}>
                      <Typography.Text type="secondary">角色</Typography.Text>
                      <Tag color={user?.role === "super" ? "gold" : "blue"}>
                        {user?.role === "super" ? "Super Admin" : "Admin"}
                      </Tag>
                    </Space>
                  ),
                },
                { type: "divider" },
                {
                  key: "home",
                  label: "返回首页",
                  icon: <HomeOutlined />,
                  onClick: () => navigate(ADMIN_HOME_PATH),
                },
                {
                  key: "refresh-session",
                  label: "刷新会话",
                  icon: <ReloadOutlined />,
                  onClick: async () => {
                    await refresh();
                  },
                },
                {
                  key: "change-password",
                  label: "修改密码",
                  icon: <LockOutlined />,
                  onClick: () => setPasswordModalOpen(true),
                },
                {
                  key: "webauthn",
                  label: "生物识别",
                  icon: <SafetyCertificateOutlined />,
                  onClick: () => {
                    void openWebAuthnModal();
                  },
                },
                { type: "divider" },
                {
                  key: "logout",
                  label: "退出登录",
                  icon: <LogoutOutlined />,
                  onClick: async () => {
                    await handleLogout();
                  },
                },
              ],
            }}
          >
            <Tooltip title={user?.email || "管理员"}>
              <Button type="text" style={{ maxWidth: 240 }}>
                <Space size={8}>
                  <Avatar size="small" icon={<UserOutlined />} />
                  <Typography.Text ellipsis style={{ maxWidth: 160, margin: 0 }}>
                    {user?.email || "管理员"}
                  </Typography.Text>
                </Space>
              </Button>
            </Tooltip>
          </Dropdown>
        </Header>

        <Content style={{ padding: 20, overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal
        title="修改密码"
        open={passwordModalOpen}
        onCancel={() => {
          setPasswordModalOpen(false);
          passwordForm.resetFields();
        }}
        onOk={() => {
          void submitPasswordReset();
        }}
        okText="提交"
        confirmLoading={resettingPassword}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            验证码会发送到当前管理员邮箱，修改成功后将重新登录。
          </Typography.Text>
          <Button onClick={() => void sendPasswordCode()} loading={sendingCode}>
            发送验证码
          </Button>
          <Form form={passwordForm} layout="vertical">
            <Form.Item
              label="验证码"
              name="code"
              rules={[{ required: true, message: "请输入验证码" }]}
            >
              <Input placeholder="请输入邮箱收到的验证码" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 8, message: "密码至少 8 位" },
              ]}
            >
              <Input.Password placeholder="请输入新密码" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("newPassword") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("两次输入的密码不一致"));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="请再次输入新密码" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="生物识别"
        open={webauthnModalOpen}
        onCancel={() => {
          setWebauthnModalOpen(false);
          webauthnForm.resetFields();
        }}
        footer={null}
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            为当前管理员添加或删除指纹 / Face ID 登录凭证。
          </Typography.Text>
          <Form form={webauthnForm} layout="vertical">
            <Form.Item label="设备备注" name="nickname">
              <Input placeholder="例如：MacBook Pro / iPhone" />
            </Form.Item>
            <Button type="primary" onClick={() => void addCredential()} loading={addingCredential}>
              添加当前设备
            </Button>
          </Form>
          <List
            bordered
            loading={loadingCredentials}
            locale={{ emptyText: "尚未添加任何生物识别设备" }}
            dataSource={credentialItems}
            style={{ maxHeight: 320, overflow: "auto", borderRadius: 8 }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="delete"
                    title="确认删除该设备？"
                    onConfirm={() => void deleteCredential(item.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button danger type="link">
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={item.nickname || `设备 #${item.id}`}
                  description={
                    item.lastUsedAt
                      ? `最近使用：${new Date(item.lastUsedAt).toLocaleString()}`
                      : item.createdAt
                        ? `创建时间：${new Date(item.createdAt).toLocaleString()}`
                        : "尚未使用"
                  }
                />
              </List.Item>
            )}
          />
        </Space>
      </Modal>
    </Layout>
  );
}
