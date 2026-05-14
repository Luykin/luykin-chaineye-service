import {
  CaretLeftOutlined,
  CaretRightOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import {
  Button,
  Collapse,
  Divider,
  Dropdown,
  Drawer,
  Form,
  Grid,
  Image,
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
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/auth";
import { buildApiUrl } from "@/services/apiClient";
import { adminMainNavItems, adminShortcutNavItems } from "@/config/admin-navigation";

const { Header, Sider, Content } = Layout;
const ADMIN_HOME_PATH = "/admin-react/dau-details";
const ADMIN_TITLE = "数据统计面板";
const { useBreakpoint } = Grid;
const NO_PERMISSION_COLLAPSED_STORAGE_KEY = "admin_sidebar_no_permission_collapsed";

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasPermission, refresh } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [webauthnModalOpen, setWebauthnModalOpen] = useState(false);
  const [noPermissionCollapsed, setNoPermissionCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(NO_PERMISSION_COLLAPSED_STORAGE_KEY) !== "false";
  });
  const [sendingCode, setSendingCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [addingCredential, setAddingCredential] = useState(false);
  const [credentialItems, setCredentialItems] = useState<
    Array<{ id: number; nickname?: string | null; lastUsedAt?: string | null; createdAt?: string | null }>
  >([]);
  const [passwordForm] = Form.useForm();
  const [webauthnForm] = Form.useForm();

  const visibleMainNavItems = useMemo(
    () => adminMainNavItems.filter((item) => !item.superOnly || user?.role === "super"),
    [user?.role]
  );

  const permittedNavItems = useMemo(
    () => visibleMainNavItems.filter((item) => hasPermission(item.permission)),
    [hasPermission, visibleMainNavItems]
  );

  const noPermissionNavItems = useMemo(
    () => visibleMainNavItems.filter((item) => !hasPermission(item.permission)),
    [hasPermission, visibleMainNavItems]
  );

  const permittedMenuItems = useMemo(
    () =>
      permittedNavItems.map(({ key, icon, label }) => ({
        key,
        icon,
        label,
      })),
    [permittedNavItems]
  );

  const noPermissionMenuItems = useMemo(
    () =>
      noPermissionNavItems.map(({ key, icon, label }) => ({
        key,
        icon,
        label: (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              minWidth: 0,
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                lineHeight: 1.2,
                color: "#ef4444",
                background: "#fee2e2",
                borderRadius: 4,
                padding: "1px 6px",
                fontWeight: 500,
                flex: "0 0 auto",
              }}
            >
              无权限
            </span>
          </div>
        ),
      })),
    [noPermissionNavItems]
  );

  const shortcutItems = useMemo(
    () =>
      adminShortcutNavItems.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: (
          <a
            href={item.href}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              color: "inherit",
            }}
          >
            <span>{item.label}</span>
            <ExportOutlined className="admin-sidebar-external-icon" />
          </a>
        ),
      })),
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      NO_PERMISSION_COLLAPSED_STORAGE_KEY,
      noPermissionCollapsed ? "true" : "false"
    );
  }, [noPermissionCollapsed]);

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

  const sidebarContent = (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          minHeight: 73,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: collapsed ? "20px 12px" : "20px",
          borderBottom: "1px solid #f1f5f9",
          color: "#1e293b",
          gap: 8,
        }}
      >
        <Space size={collapsed ? 0 : 12} style={{ minWidth: 0, flex: 1 }}>
          {!collapsed ? (
            <Image
              src={buildApiUrl("/admin/logo")}
              alt="XHunt Logo"
              preview={false}
              width={32}
              height={32}
              style={{
                borderRadius: 8,
                flex: "0 0 auto",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
            />
          ) : null}
          {!collapsed ? (
            <Space
              direction="vertical"
              size={0}
              align="start"
              style={{ minWidth: 0, alignItems: "flex-start" }}
            >
              <Typography.Text
                strong
                ellipsis
                style={{
                  fontSize: 21,
                  lineHeight: 1.1,
                  letterSpacing: "-0.02em",
                  margin: 0,
                  color: "#1e293b",
                }}
              >
                XHunt
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  marginTop: 2,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                管理后台
              </Typography.Text>
            </Space>
          ) : null}
        </Space>
        <Button
          type="text"
          size="small"
          icon={collapsed ? <CaretRightOutlined /> : <CaretLeftOutlined />}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          disabled={isMobile}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#ffffff",
            color: "#94a3b8",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            flex: "0 0 auto",
          }}
        />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: 12,
        }}
      >
        <Menu
          mode="inline"
          rootClassName="admin-sidebar-menu admin-sidebar-menu--main"
          inlineCollapsed={!isMobile && collapsed}
          selectedKeys={[location.pathname]}
          items={permittedMenuItems}
          onClick={({ key }) => {
            navigate(key);
            if (isMobile) setMobileMenuOpen(false);
          }}
          style={{ borderInlineEnd: "none", paddingTop: 8 }}
        />

        {noPermissionMenuItems.length > 0 ? (
          <>
            <Divider style={{ margin: "8px 16px" }} />
            <div style={{ padding: collapsed ? "0 8px 12px" : "0 12px 12px" }}>
              {collapsed ? (
                <Tooltip
                  placement="right"
                  title={`无权限功能 ${noPermissionMenuItems.length} 项，展开侧边栏查看`}
                >
                  <Button
                    type="text"
                    onClick={() => setCollapsed(false)}
                    aria-label="展开查看无权限功能"
                    style={{
                      width: "100%",
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 10,
                      color: "#94a3b8",
                      background: "#f8fafc",
                      border: "1px dashed #e2e8f0",
                    }}
                  >
                    <LockOutlined style={{ fontSize: 16 }} />
                  </Button>
                </Tooltip>
              ) : (
                <Collapse
                  ghost
                  size="small"
                  activeKey={noPermissionCollapsed ? [] : ["no-permission"]}
                  onChange={(keys) => {
                    const expanded = Array.isArray(keys)
                      ? keys.includes("no-permission")
                      : keys === "no-permission";
                    setNoPermissionCollapsed(!expanded);
                  }}
                  items={[
                    {
                      key: "no-permission",
                      label: (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: "#64748b",
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                        >
                          <span>无权限功能</span>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>
                            ({noPermissionMenuItems.length})
                          </span>
                        </div>
                      ),
                      children: (
                        <Menu
                          mode="inline"
                          selectable={false}
                          items={noPermissionMenuItems}
                          onClick={() => {
                            messageApi.warning("当前账号暂无此功能权限");
                          }}
                          rootClassName="admin-sidebar-menu admin-no-permission-menu"
                          style={{
                            borderInlineEnd: "none",
                            background: "transparent",
                          }}
                        />
                      ),
                      styles: {
                        header: {
                          padding: "6px 8px",
                          borderRadius: 10,
                          color: "#64748b",
                        },
                        body: {
                          padding: 0,
                        },
                      },
                    },
                  ]}
                />
              )}
            </div>
          </>
        ) : null}

        <Divider style={{ margin: "8px 16px" }} />
        <Menu
          mode="inline"
          rootClassName="admin-sidebar-menu admin-sidebar-menu--shortcut"
          inlineCollapsed={!isMobile && collapsed}
          selectable={false}
          items={shortcutItems}
          style={{ borderInlineEnd: "none" }}
        />
      </div>
    </div>
  );

  const desktopSidebarContent = (
    <div
      style={{
        position: "sticky",
        top: 0,
        height: "100vh",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      {sidebarContent}
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {contextHolder}
      {!isMobile ? (
        <Sider
          width={240}
          theme="light"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          collapsedWidth={80}
          trigger={null}
          style={{
            minHeight: "100vh",
            alignSelf: "stretch",
            background: "#fff",
            borderRight: "1px solid #e2e8f0",
            boxShadow: collapsed
              ? "4px 0 20px rgba(0,0,0,0.06)"
              : "4px 0 24px rgba(0,0,0,0.08)",
            overflow: "visible",
          }}
        >
          {desktopSidebarContent}
        </Sider>
      ) : (
        <Drawer
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          closable={false}
          bodyStyle={{ padding: 0 }}
          width={240}
        >
          {sidebarContent}
        </Drawer>
      )}

      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            gap: 16,
            height: "auto",
            lineHeight: 1,
          }}
        >
          <Space size={12} style={{ minWidth: 0, flex: 1, alignItems: "center" }}>
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
                aria-label="打开侧边栏"
              />
            ) : null}
            <Typography.Title
              level={4}
              ellipsis
              style={{
                margin: 0,
                maxWidth: "100%",
                fontSize: 18,
                fontWeight: 600,
                color: "#1e293b",
                letterSpacing: "-0.01em",
              }}
            >
              {ADMIN_TITLE}
            </Typography.Title>
            {!isMobile ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 20,
                  flex: "0 0 auto",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: "#22c55e",
                    borderRadius: "50%",
                  }}
                />
                <Typography.Text
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#16a34a",
                    margin: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  实时监控中
                </Typography.Text>
              </div>
            ) : null}
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
              <Button
                type="text"
                style={{
                  maxWidth: isMobile ? 180 : 240,
                  height: 38,
                  padding: "6px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <Space size={10}>
                  <UserOutlined style={{ color: "#64748b", fontSize: 16 }} />
                  <Typography.Text
                    ellipsis
                    style={{
                      maxWidth: 150,
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#334155",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {user?.email || "管理员"}
                  </Typography.Text>
                  <CaretRightOutlined
                    style={{
                      color: "#94a3b8",
                      fontSize: 13,
                      transform: "rotate(90deg)",
                    }}
                  />
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
