import { Button, Empty, Space, Tag, Typography } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";

export function VersionStatsPage() {
  return (
    <PermissionGuard permission="version-stats">
      <PageSection
        title="版本统计"
        description="该页将作为 React 图表接入的试点页，验证 antd + 图表组件的组合方式。"
        extra={
          <Space>
            <Tag color="purple">Version</Tag>
            <Button type="primary">刷新</Button>
          </Space>
        }
      >
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text>该页面骨架已创建。</Typography.Text>
              <Typography.Text type="secondary">
                下一步将接入 /api/xhunt/stats/version-stats。
              </Typography.Text>
            </Space>
          }
        />
      </PageSection>
    </PermissionGuard>
  );
}
