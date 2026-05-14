import { Button, Empty, Space, Tag, Typography } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";

export function UrlStatsPage() {
  return (
    <PermissionGuard permission="url-stats">
      <PageSection
        title="接口统计"
        description="计划使用 antd 的筛选、统计卡片与表格组件替代现有 EJS + 原生图表布局。"
        extra={
          <Space>
            <Tag color="cyan">URL Stats</Tag>
            <Button type="primary">刷新</Button>
          </Space>
        }
      >
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text>该页面骨架已创建。</Typography.Text>
              <Typography.Text type="secondary">
                下一步将接入 /api/xhunt/stats/url-stats。
              </Typography.Text>
            </Space>
          }
        />
      </PageSection>
    </PermissionGuard>
  );
}
