import { Button, Empty, Space, Tag, Typography } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";

export function GenericStatsPage() {
  return (
    <PermissionGuard permission="generic-stats">
      <PageSection
        title="通用统计"
        description="第一阶段先迁移页面壳子，后续会逐步把筛选、聚合、事件列表从 EJS 迁到 React + antd。"
        extra={
          <Space>
            <Tag color="blue">Phase 1</Tag>
            <Button type="primary">刷新</Button>
          </Space>
        }
      >
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text>该页面骨架已创建。</Typography.Text>
              <Typography.Text type="secondary">
                下一步将接入 /api/xhunt/stats/generic-stats/* 接口。
              </Typography.Text>
            </Space>
          }
        />
      </PageSection>
    </PermissionGuard>
  );
}
