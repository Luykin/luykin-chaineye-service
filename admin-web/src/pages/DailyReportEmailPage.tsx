import { Alert, Button, Card, Input, Space, Typography, message } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { sendDailyReport } from "@/services/daily-report";
import { useState } from "react";

export function DailyReportEmailPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [recipientsText, setRecipientsText] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const recipients = recipientsText
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      return sendDailyReport(recipients);
    },
    onSuccess: () => messageApi.success("日报发送任务已完成"),
    onError: (error: Error) => messageApi.error(error.message || "日报发送失败"),
  });

  return (
    <PermissionGuard permission="daily-report:send">
      {contextHolder}
      <PageSection title="日报发送" description="手动触发 XHunt 每日数据报告邮件。留空则发送给后台配置的日报接收人。">
        <Card size="small" styles={{ body: { padding: 16 } }}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="发送说明"
              description="该操作会立即调用后端日报服务。可在下方临时指定收件人，多个邮箱用逗号、分号或换行分隔。"
            />
            <div className="admin-compact-field">
              <Typography.Text strong>临时收件人</Typography.Text>
              <Input.TextArea
                rows={5}
                value={recipientsText}
                onChange={(event) => setRecipientsText(event.target.value)}
                placeholder="例如：a@example.com, b@example.com\n留空则使用管理员日报订阅配置"
              />
            </div>
            <Button type="primary" icon={<SendOutlined />} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              立即发送日报
            </Button>
          </Space>
        </Card>
      </PageSection>
    </PermissionGuard>
  );
}
