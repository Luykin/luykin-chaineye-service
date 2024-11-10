import { ProLayout } from '@ant-design/pro-components';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useUserStore } from './stores/userStore';
import { routes } from './routes';

export default function App() {
  const { pathname } = useLocation();
  const { user } = useUserStore();

  return (
    <ProLayout
      title="Enterprise Admin"
      logo={null}
      location={{ pathname }}
      menu={{ type: 'group' }}
      menuItemRender={(item, dom) => (
        <Link to={item.path || '/'}>{dom}</Link>
      )}
      routes={routes}
    >
      <Outlet />
    </ProLayout>
  );
}
