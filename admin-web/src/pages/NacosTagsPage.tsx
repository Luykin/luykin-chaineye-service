import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
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

type TagLang = "zh" | "en";
type TagConfig = Record<string, string[]>;

const DATA_IDS: Record<TagLang, string> = {
  zh: "xhunt_built_in_tag",
  en: "xhunt_built_in_tag_en",
};

function parseConfig(content?: string): TagConfig {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function NacosTagsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [lang, setLang] = useState<TagLang>("zh");
  const [search, setSearch] = useState("");
  const [editorValue, setEditorValue] = useState("");

  const query = useQuery({
    queryKey: ["nacos-tags", lang],
    queryFn: () => fetchNacosConfig({ dataId: DATA_IDS[lang] }),
  });

  useEffect(() => {
    setEditorValue(query.data?.data.content || "{}");
  }, [query.data?.data.content]);

  const config = useMemo(() => parseConfig(editorValue), [editorValue]);

  const filteredEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return Object.entries(config)
      .filter(([handle]) => !keyword || handle.toLowerCase().includes(keyword))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [config, search]);

  const isJsonValid = useMemo(() => {
    try {
      const parsed = JSON.parse(editorValue || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, [editorValue]);

  const publishMutation = useMutation({
    mutationFn: (content: string) =>
      publishNacosConfig({
        dataId: DATA_IDS[lang],
        content,
        source: "nacos-tags",
      }),
    onSuccess: () => {
      messageApi.success("标签配置已发布");
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "标签配置发布失败");
    },
  });

  return (
    <PermissionGuard permission="nacos-tags">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="标签配置"
          description="编辑 Nacos 内置标签配置：xhunt_built_in_tag / xhunt_built_in_tag_en。"
          extra={
            <Space wrap>
              <Button type={lang === "zh" ? "primary" : "default"} onClick={() => setLang("zh")}>
                中文
              </Button>
              <Button type={lang === "en" ? "primary" : "default"} onClick={() => setLang("en")}>
                English
              </Button>
              <Button onClick={() => setEditorValue(query.data?.data.content || "{}")}>重新加载</Button>
              <Button
                type="primary"
                disabled={!isJsonValid}
                loading={publishMutation.isPending}
                onClick={() => publishMutation.mutate(editorValue)}
              >
                发布
              </Button>
            </Space>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={9}>
              <Card
                title="Handle 列表"
                extra={<Tag color="blue">{filteredEntries.length}</Tag>}
              >
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input
                    placeholder="搜索 handle..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div style={{ maxHeight: 520, overflow: "auto" }}>
                    {filteredEntries.length ? (
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {filteredEntries.map(([handle, tags]) => (
                          <Card key={handle} size="small">
                            <Space direction="vertical" size={8} style={{ width: "100%" }}>
                              <Typography.Text strong>@{handle}</Typography.Text>
                              <Space wrap>
                                {tags.length ? tags.map((tag) => <Tag key={`${handle}-${tag}`}>{tag}</Tag>) : <Tag>无标签</Tag>}
                              </Space>
                            </Space>
                          </Card>
                        ))}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配 Handle" />
                    )}
                  </div>
                </Space>
              </Card>
            </Col>

            <Col xs={24} xl={15}>
              <JsonEditorCard
                title="JSON 配置编辑器"
                description="配置格式：{ handle: [tag1, tag2] }。直接编辑并发布整个对象。"
                value={editorValue}
                onChange={setEditorValue}
                height={520}
                extra={
                  <Space>
                    <Tag color={isJsonValid ? "success" : "error"}>
                      {isJsonValid ? "JSON 有效" : "JSON 无效"}
                    </Tag>
                    <Popconfirm
                      title="确认格式化当前 JSON？"
                      onConfirm={() => {
                        try {
                          setEditorValue(JSON.stringify(JSON.parse(editorValue || "{}"), null, 2));
                        } catch {
                          messageApi.warning("当前 JSON 无法格式化，请先修复语法错误");
                        }
                      }}
                    >
                      <Button size="small">格式化</Button>
                    </Popconfirm>
                  </Space>
                }
              />
            </Col>
          </Row>

          {query.isError ? <Alert style={{ marginTop: 16 }} type="error" showIcon message="加载标签配置失败" /> : null}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
