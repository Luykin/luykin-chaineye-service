import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Button, Card, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchFundraisingData, startFullCrawl, startQuickUpdate } from '@/services/fundraising';
import { CrawlerStatus } from './CrawlerStatus';

export default function FundraisingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['fundraising'],
    queryFn: fetchFundraisingData
  });

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'projectName',
    },
    {
      title: '金额',
      dataIndex: 'amount',
    },
    {
      title: '日期',
      dataIndex: 'date',
      valueType: 'date',
    },
    {
      title: '投资者',
      dataIndex: 'investors',
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      render: (stage: string) => <Tag>{stage}</Tag>,
    },
    {
      title: '类别',
      dataIndex: 'category',
      render: (category: string) => <Tag color="blue">{category}</Tag>,
    }
  ];

  return (
    <PageContainer
      header={{
        title: 'Fundraising 数据管理',
      }}
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Card>
          <CrawlerStatus />
          <Space className="mt-4">
            <Button type="primary" onClick={() => startFullCrawl()}>
              开始全量采集
            </Button>
            <Button onClick={() => startQuickUpdate()}>
              快速更新
            </Button>
          </Space>
        </Card>

        <ProTable
          columns={columns}
          dataSource={data?.data}
          loading={isLoading}
          rowKey="id"
          pagination={{
            total: data?.total,
            pageSize: 10,
          }}
          search={false}
          dateFormatter="string"
          toolBarRender={false}
        />
      </Space>
    </PageContainer>
  );
}