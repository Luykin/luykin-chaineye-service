import { Button, Empty, Space, Tag, Typography } from "antd";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";

export function AuditLogsPage() {
  return (
    <PermissionGuard permission="audit-logs:read">
      <PageSection
        title="操作记录"
        description="先建立筛选页与表格页骨架，后续逐步接入管理员审计日志查询。"
        extra={
          <Space>
            <Tag color="gold">Audit</Tag>
            <Button type="primary">查询</Button>
          </Space>
        }
      >
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text>该页面骨架已创建。</Typography.Text>
              <Typography.Text type="secondary">
                下一步将接入 /api/xhunt/stats/admin-audit/logs。
              </Typography.Text>
            </Space>
          }
        />
      </PageSection>
    </PermissionGuard>
  );
}
