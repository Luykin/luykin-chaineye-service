import { Card, Descriptions, Badge } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getCrawlerStatus } from '@/services/fundraising';
import dayjs from 'dayjs';

export function CrawlerStatus() {
  const { data: status, isLoading } = useQuery({
    queryKey: ['crawler-status'],
    queryFn: getCrawlerStatus,
    refetchInterval: 5000
  });

  const getStatusBadge = (status: string) => {
    const statusMap = {
      idle: 'default',
      running: 'processing',
      completed: 'success',
      failed: 'error'
    };
    return statusMap[status] || 'default';
  };

  if (isLoading) {
    return <Card loading />;
  }

  return (
    <Descriptions title="爬虫状态" bordered>
      <Descriptions.Item label="全量爬取状态">
        <Badge status={getStatusBadge(status?.fullCrawl?.status)} text={status?.fullCrawl?.status} />
      </Descriptions.Item>
      <Descriptions.Item label="最后爬取页码">
        {status?.fullCrawl?.lastPage || '-'}
      </Descriptions.Item>
      <Descriptions.Item label="最后更新时间">
        {status?.fullCrawl?.lastUpdate ? 
          dayjs(status.fullCrawl.lastUpdate).format('YYYY-MM-DD HH:mm:ss') : 
          '-'}
      </Descriptions.Item>
      <Descriptions.Item label="快速更新状态">
        <Badge status={getStatusBadge(status?.quickUpdate?.status)} text={status?.quickUpdate?.status} />
      </Descriptions.Item>
      <Descriptions.Item label="快速更新时间">
        {status?.quickUpdate?.lastUpdate ? 
          dayjs(status.quickUpdate.lastUpdate).format('YYYY-MM-DD HH:mm:ss') : 
          '-'}
      </Descriptions.Item>
    </Descriptions>
  );
}