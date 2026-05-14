import {
  AuditOutlined,
  BarChartOutlined,
  FireOutlined,
  LinkOutlined,
  LogoutOutlined,
  TeamOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "@/app/auth";

const { Header, Sider, Content } = Layout;

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
  const { user, hasPermission } = useAuth();

  const items = useMemo(
    () =>
      navItems
        .filter((item) => hasPermission(item.permission))
        .map(({ key, icon, label }) => ({ key, icon, label })),
    [hasPermission]
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={248} theme="light" style={{ borderRight: "1px solid #e5e7eb" }}>
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: "1px solid #e5e7eb",
            fontWeight: 700,
            fontSize: 18,
            color: "#111827",
          }}
        >
          XHunt Admin
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
          }}
        >
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              新版管理后台
            </Typography.Title>
            <Typography.Text type="secondary">
              React + Ant Design 迁移试点
            </Typography.Text>
          </Space>

          <Dropdown
            menu={{
              items: [
                {
                  key: "legacy",
                  label: "返回旧版后台",
                  onClick: () => {
                    window.location.href = "/api/xhunt/stats";
                  },
                },
                {
                  key: "logout",
                  label: "退出登录",
                  icon: <LogoutOutlined />,
                  onClick: async () => {
                    await fetch("/admin/logout", { method: "POST", credentials: "include" });
                    window.location.href = "/admin/login";
                  },
                },
              ],
            }}
          >
            <Button type="text">
              {user?.email || "管理员"}
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ padding: 20 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
