import { DashboardOutlined, RobotOutlined, ApiOutlined, TeamOutlined, SettingOutlined } from '@ant-design/icons';

export const routes = [
  {
    path: '/dashboard',
    name: '仪表盘',
    icon: <DashboardOutlined />,
  },
  {
    path: '/data-services',
    name: '数据服务',
    icon: <ApiOutlined />,
    routes: [
      {
        path: '/data-services/crawlers',
        name: '数据采集',
        icon: <RobotOutlined />,
        routes: [
          {
            path: '/data-services/crawlers/fundraising',
            name: 'Fundraising 数据',
          },
          {
            path: '/data-services/crawlers/monitor',
            name: '采集监控',
          }
        ]
      },
      {
        path: '/data-services/api',
        name: 'API 管理',
      }
    ]
  },
  {
    path: '/system',
    name: '系统管理',
    icon: <SettingOutlined />,
    routes: [
      {
        path: '/system/users',
        name: '用户管理',
        icon: <TeamOutlined />,
      },
      {
        path: '/system/settings',
        name: '系统设置',
      }
    ]
  }
];

export const defaultRoute = {
  routes: routes
};