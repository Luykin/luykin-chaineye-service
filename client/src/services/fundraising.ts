import { request } from '@/utils/request';

export interface FundraisingData {
  projectName: string;
  amount: string;
  date: string;
  investors: string;
  stage: string;
  category: string;
}

export async function fetchFundraisingData(params: {
  current?: number;
  pageSize?: number;
}) {
  return request('/api/fundraising', {
    params: {
      page: params.current,
      limit: params.pageSize,
    },
  });
}

export async function startFullCrawl() {
  return request('/api/fundraising/crawl/full', {
    method: 'POST',
  });
}

export async function startQuickUpdate() {
  return request('/api/fundraising/crawl/quick', {
    method: 'POST',
  });
}

export async function getCrawlerStatus() {
  return request('/api/fundraising/status');
}