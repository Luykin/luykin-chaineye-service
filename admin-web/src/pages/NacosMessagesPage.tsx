import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { JsonEditorCard } from "@/components/ui/JsonEditorCard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";

type MessageLang = "zh" | "en";

interface MessageItem {
  title?: string;
  type?: string;
  content?: string;
  created?: number | string;
  [key: string]: unknown;
}

const DATA_IDS: Record<MessageLang, string> = {
  zh: "xhunt_message",
  en: "xhunt_message_en",
};

function parseMessageContent(content?: string) {
  if (!content) return "";
  return content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function NacosMessagesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [lang, setLang] = useState<MessageLang>("zh");
  const [editorValue, setEditorValue] = useState("");

  const query = useQuery({
    queryKey: ["nacos-messages", lang],
    queryFn: () => fetchNacosConfig({ dataId: DATA_IDS[lang] }),
  });

  const publishMutation = useMutation({
    mutationFn: (content: string) =>
      publishNacosConfig({
        dataId: DATA_IDS[lang],
        content,
        source: "nacos-messages",
      }),
    onSuccess: () => {
      messageApi.success("公告配置已发布");
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "公告配置发布失败");
    },
  });

  const items = useMemo<MessageItem[]>(() => {
    if (!query.data?.data.content) return [];
    try {
      const parsed = JSON.parse(query.data.data.content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [query.data]);

  const isJsonValid = useMemo(() => {
    try {
      JSON.parse(editorValue || "[]");
      return true;
    } catch {
      return false;
    }
  }, [editorValue]);

  useState(() => {
    return undefined;
  });

  if (editorValue === "" && query.data?.data.content) {
    setTimeout(() => setEditorValue(query.data?.data.content || "[]"), 0);
  }

  return (
    <PermissionGuard permission="nacos-messages">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="公告配置"
          description="编辑 Nacos 公告配置：xhunt_message / xhunt_message_en。"
          extra={
            <Space wrap>
              <Button type={lang === "zh" ? "primary" : "default"} onClick={() => { setLang("zh"); setEditorValue(""); }}>
                中文
              </Button>
              <Button type={lang === "en" ? "primary" : "default"} onClick={() => { setLang("en"); setEditorValue(""); }}>
                English
              </Button>
              <Button onClick={() => { setEditorValue(query.data?.data.content || "[]"); }}>重新加载</Button>
              <Button
                type="primary"
                loading={publishMutation.isPending}
                disabled={!isJsonValid}
                onClick={() => publishMutation.mutate(editorValue)}
              >
                发布
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small">
              <Space wrap>
                <Tag color="blue">dataId: {DATA_IDS[lang]}</Tag>
                <Tag>group: DEFAULT_GROUP</Tag>
                <Tag color={isJsonValid ? "success" : "error"}>
                  {isJsonValid ? "JSON 有效" : "JSON 无效"}
                </Tag>
                <Tag>条数：{items.length}</Tag>
              </Space>
            </Card>

            <Card title="公告列表预览">
              {items.length ? (
                <List
                  dataSource={items}
                  renderItem={(item, index) => (
                    <List.Item key={`${item.created || index}`}>
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <Typography.Text strong>{item.title || `公告 ${index + 1}`}</Typography.Text>
                            <Tag>{item.type || "all"}</Tag>
                          </Space>
                        }
                        description={
                          <Typography.Text type="secondary">
                            {parseMessageContent(item.content) || "无内容"}
                          </Typography.Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告数据" />
              )}
            </Card>

            <JsonEditorCard
              title="JSON 配置编辑器"
              description="直接编辑完整公告数组。发布时会覆盖当前语言的全部公告。"
              value={editorValue}
              onChange={setEditorValue}
              extra={
                <Popconfirm
                  title="确认格式化当前 JSON？"
                  onConfirm={() => {
                    try {
                      setEditorValue(JSON.stringify(JSON.parse(editorValue || "[]"), null, 2));
                    } catch {
                      messageApi.warning("当前 JSON 无法格式化，请先修复语法错误");
                    }
                  }}
                >
                  <Button size="small">格式化</Button>
                </Popconfirm>
              }
            />

            {query.isError ? (
              <Alert type="error" showIcon message="加载公告配置失败" />
            ) : null}
          </Space>
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
