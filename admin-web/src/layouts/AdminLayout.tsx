import {
  AppstoreOutlined,
  BarChartOutlined,
  CaretRightOutlined,
  CodeOutlined,
  ExportOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  MonitorOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import {
  Button,
  Dropdown,
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
  Typography,
  message,
} from "antd";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useAuth } from "@/app/auth";
import { buildApiUrl } from "@/services/apiClient";
import { adminMainNavItems, adminShortcutNavItems, type AdminNavItem } from "@/config/admin-navigation";

const { Header, Content } = Layout;
const ADMIN_HOME_PATH = "/admin-react/overview";
const ADMIN_LOGIN_PATH = "/admin-react/login";
const ADMIN_TITLE = "数据统计面板";
const { useBreakpoint } = Grid;

type SidebarGroupKey = NonNullable<AdminNavItem["sidebarGroup"]>;

const navGroupDefinitions: Array<{ key: SidebarGroupKey; label: string; icon: ReactNode }> = [
  { key: "data", label: "数据查看", icon: <BarChartOutlined /> },
  { key: "operation", label: "运营配置", icon: <AppstoreOutlined /> },
  { key: "monitor", label: "状态监控", icon: <MonitorOutlined /> },
  { key: "dev", label: "调试工具", icon: <CodeOutlined /> },
  { key: "system", label: "系统管理", icon: <TeamOutlined /> },
];

function getNavGroupKey(item: AdminNavItem): SidebarGroupKey {
  return item.sidebarGroup || (item.section === "system" ? "system" : "data");
}

function getPermissionLabel(item: AdminNavItem) {
  return (
    <span className="admin-top-nav-no-permission-item">
      <span className="admin-top-nav-no-permission-title">{item.label}</span>
      <span className="admin-top-nav-no-permission-badge">无权限</span>
    </span>
  );
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasPermission, refresh } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
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

  const visibleMainNavItems = useMemo(() => {
    const visibleItems = adminMainNavItems.filter((item) => !item.superOnly || user?.role === "super");
    return [
      ...visibleItems.filter((item) => item.section !== "system"),
      ...visibleItems.filter((item) => item.section === "system"),
    ];
  }, [user?.role]);

  const permittedNavItems = useMemo(
    () => visibleMainNavItems.filter((item) => hasPermission(item.permission)),
    [hasPermission, visibleMainNavItems]
  );

  const noPermissionNavItems = useMemo(
    () => visibleMainNavItems.filter((item) => !hasPermission(item.permission)),
    [hasPermission, visibleMainNavItems]
  );

  const navigationMenuItems = useMemo<MenuProps["items"]>(() => {
    const groupedItems = navGroupDefinitions
      .map((group) => {
        const items = permittedNavItems.filter((item) => getNavGroupKey(item) === group.key);
        if (!items.length) return null;
        return {
          key: `group-${group.key}`,
          icon: group.icon,
          label: group.label,
          popupClassName: "admin-top-nav-popup",
          children: items.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          })),
        };
      })
      .filter(Boolean) as NonNullable<MenuProps["items"]>;

    const shortcutGroup = adminShortcutNavItems.length
      ? [
          {
            key: "group-shortcut",
            icon: <ExportOutlined />,
            label: "快捷入口",
            popupClassName: "admin-top-nav-popup",
            children: adminShortcutNavItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label:
                item.action === "supabase" ? (
                  <span className="admin-top-nav-external-link" role="button">
                    <span>{item.label}</span>
                    <ExportOutlined />
                  </span>
                ) : (
                  <a href={item.href} target="_blank" rel="noreferrer" className="admin-top-nav-external-link">
                    <span>{item.label}</span>
                    <ExportOutlined />
                  </a>
                ),
            })),
          },
        ]
      : [];

    const noPermissionGroup = noPermissionNavItems.length
      ? [
          {
            key: "group-no-permission",
            icon: <LockOutlined />,
            label: "无权限",
            popupClassName: "admin-top-nav-popup admin-top-nav-popup--no-permission",
            children: noPermissionNavItems.map((item) => ({
              key: `no-permission:${item.key}`,
              icon: item.icon,
              label: getPermissionLabel(item),
            })),
          },
        ]
      : [];

    return [...groupedItems, ...shortcutGroup, ...noPermissionGroup];
  }, [noPermissionNavItems, permittedNavItems]);

  const handleNavigationClick: MenuProps["onClick"] = ({ key }) => {
    const itemKey = String(key);
    if (itemKey.startsWith("no-permission:")) {
      messageApi.warning("当前账号暂无此功能权限");
      return;
    }
    if (itemKey === "shortcut-supabase") {
      void openSupabase();
      return;
    }
    if (itemKey.startsWith("/admin-react/")) {
      navigate(itemKey);
    }
  };

  const openLoginPage = () => {
    const loginUrl = new URL(ADMIN_LOGIN_PATH, window.location.origin);
    loginUrl.searchParams.set("next", ADMIN_HOME_PATH);
    window.location.href = loginUrl.toString();
  };

  const openSupabase = async () => {
    try {
      const response = await fetch(buildApiUrl("/admin/supabase/link-token"), {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const data = await response.json().catch(() => ({ success: false, error: "生成票据失败" }));

      if (response.status === 403 && data?.error === "需要先录入生物识别") {
        messageApi.warning('请先在「生物识别」中录入指纹 / Face ID，再使用 Supabase 入口。');
        return;
      }

      if (!response.ok || !data?.success || !data?.url) {
        throw new Error(data?.error || "生成票据失败");
      }

      window.open(data.url, "_blank", "noopener");
    } catch (error) {
      messageApi.error(`打开失败：${error instanceof Error ? error.message : String(error)}`);
    }
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
    <Layout className="admin-shell admin-shell--top-nav">
      {contextHolder}
      <Header className="admin-top-header">
        <div className="admin-top-header-brand" onClick={() => navigate(ADMIN_HOME_PATH)} role="button" tabIndex={0}>
          <Image
            src={buildApiUrl("/admin/logo")}
            alt="XHunt Logo"
            preview={false}
            width={30}
            height={30}
            className="admin-top-header-logo"
          />
          <div className="admin-top-header-title-wrap">
            <Typography.Text className="admin-top-header-brand-title">XHunt</Typography.Text>
            <Typography.Text className="admin-top-header-brand-subtitle">管理后台</Typography.Text>
          </div>
        </div>

        {isMobile ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            menu={{ items: navigationMenuItems, onClick: handleNavigationClick, selectedKeys: [location.pathname] }}
          >
            <Button icon={<MenuOutlined />} className="admin-top-nav-mobile-button">
              导航
            </Button>
          </Dropdown>
        ) : (
          <Menu
            mode="horizontal"
            className="admin-top-nav-menu"
            selectedKeys={[location.pathname]}
            items={navigationMenuItems}
            onClick={handleNavigationClick}
          />
        )}

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
                  </Space>
                ),
              },
              {
                key: "role",
                disabled: true,
                label: (
                  <Space size={8}>
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
          <Button type="text" className="admin-top-user-button">
            <Space size={8} wrap={false}>
              <UserOutlined className="admin-top-user-icon" />
              {!isMobile ? (
                <Typography.Text ellipsis className="admin-top-user-email">
                  {user?.email || "管理员"}
                </Typography.Text>
              ) : null}
              <CaretRightOutlined className="admin-top-user-caret" />
            </Space>
          </Button>
        </Dropdown>
      </Header>

      <div className="admin-page-title-bar">
        <Typography.Title level={4} ellipsis className="admin-page-title">
          {ADMIN_TITLE}
        </Typography.Title>
      </div>

      <Content className="admin-top-content">
        <Outlet />
      </Content>

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
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">验证码会发送到当前管理员邮箱，修改成功后将重新登录。</Typography.Text>
          <Button onClick={() => void sendPasswordCode()} loading={sendingCode}>
            发送验证码
          </Button>
          <Form form={passwordForm} layout="vertical">
            <Form.Item label="验证码" name="code" rules={[{ required: true, message: "请输入验证码" }]}>
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
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">为当前管理员添加或删除指纹 / Face ID 登录凭证。</Typography.Text>
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
