import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  List,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchErrorLogs, fetchLogSearch } from "@/services/stats";
import type { LogSearchResultItem } from "@/types/stats";
import { useAuth } from "@/app/auth";

function highlightText(text: string, keyword: string) {
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <mark key={`${part}-${index}`} style={{ background: "#fff3bf", padding: 0 }}>
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
}

export function LogSearchPage() {
  const { hasPermission } = useAuth();
  const canReadErrorLogs = hasPermission("error-logs:read");

  const [queryText, setQueryText] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [contextLines, setContextLines] = useState(3);
  const [resultLimit, setResultLimit] = useState(5);
  const [errorLogLines, setErrorLogLines] = useState(1000);

  const searchQuery = useQuery({
    queryKey: ["log-search", submittedQuery, contextLines, resultLimit],
    queryFn: () =>
      fetchLogSearch({
        query: submittedQuery,
        contextLines,
        limit: resultLimit,
      }),
    enabled: Boolean(submittedQuery.trim()),
    retry: false,
  });

  const errorLogsQuery = useQuery({
    queryKey: ["error-logs", errorLogLines],
    queryFn: () => fetchErrorLogs({ lines: errorLogLines }),
    enabled: canReadErrorLogs,
  });

  const results = searchQuery.data?.data.results || [];

  return (
    <PermissionGuard permission="log-search:read">
      <PageSection
        title="日志搜索"
        description="搜索 PM2 日志，也可以在有权限时查看最新 API 错误日志。"
      >
        <Tabs
          items={[
            {
              key: "search",
              label: "日志搜索",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Card styles={{ body: { padding: 16 } }}>
                    <Space wrap style={{ width: "100%" }}>
                      <Input
                        value={queryText}
                        onChange={(event) => setQueryText(event.target.value)}
                        placeholder="输入搜索关键词..."
                        style={{ minWidth: 260, flex: 1 }}
                        onPressEnter={() => {
                          if (queryText.trim()) setSubmittedQuery(queryText.trim());
                        }}
                      />
                      <Select
                        value={contextLines}
                        onChange={setContextLines}
                        style={{ width: 120 }}
                        options={[1, 3, 5, 10, 20].map((value) => ({
                          label: `${value} 行上下文`,
                          value,
                        }))}
                      />
                      <Select
                        value={resultLimit}
                        onChange={setResultLimit}
                        style={{ width: 120 }}
                        options={[5, 10, 50, 100, 200].map((value) => ({
                          label: `${value} 条`,
                          value,
                        }))}
                      />
                      <Button
                        type="primary"
                        onClick={() => {
                          if (queryText.trim()) setSubmittedQuery(queryText.trim());
                        }}
                        loading={searchQuery.isFetching}
                      >
                        搜索
                      </Button>
                    </Space>
                  </Card>

                  {submittedQuery ? (
                    <>
                      {searchQuery.isError ? (
                        <Alert type="error" showIcon message="日志搜索失败" />
                      ) : null}

                      {searchQuery.data ? (
                        <Card
                          size="small"
                          styles={{ body: { padding: 16 } }}
                          title={`共 ${searchQuery.data.data.totalMatches} 个匹配，搜索了 ${searchQuery.data.data.searchedFiles} 个文件`}
                        >
                          <Space wrap>
                            {searchQuery.data.data.fileSizes.map((file) => (
                              <Tag key={file.name}>
                                {file.name} · {file.size.toFixed(2)} MB
                              </Tag>
                            ))}
                          </Space>
                        </Card>
                      ) : null}

                      {results.length ? (
                        <List
                          grid={{ gutter: 16, column: 1 }}
                          dataSource={results}
                          renderItem={(item: LogSearchResultItem) => (
                            <List.Item>
                              <Card
                                size="small"
                                title={
                                  <Space wrap>
                                    <Typography.Text strong>{item.file}</Typography.Text>
                                    <Tag>行 {item.lineNumber}</Tag>
                                  </Space>
                                }
                              >
                                <div
                                  style={{
                                    background: "#fafafa",
                                    border: "1px solid #f0f0f0",
                                    borderRadius: 8,
                                    padding: 12,
                                    fontFamily: "SFMono-Regular, Consolas, monospace",
                                    fontSize: 12,
                                    lineHeight: 1.6,
                                    overflowX: "auto",
                                  }}
                                >
                                  {item.context.map((line) => (
                                    <div
                                      key={`${item.file}-${line.lineNumber}`}
                                      style={{
                                        background: line.isMatch ? "#fffbe6" : "transparent",
                                        borderLeft: line.isMatch ? "3px solid #faad14" : "3px solid transparent",
                                        paddingLeft: 8,
                                      }}
                                    >
                                      <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                                        {line.lineNumber}
                                      </Typography.Text>
                                      {highlightText(line.content, submittedQuery)}
                                    </div>
                                  ))}
                                </div>
                              </Card>
                            </List.Item>
                          )}
                        />
                      ) : searchQuery.isFetched && !searchQuery.isFetching ? (
                        <Empty description="未找到匹配日志" />
                      ) : null}
                    </>
                  ) : (
                    <Empty description="输入关键词开始搜索日志" />
                  )}
                </Space>
              ),
            },
            ...(canReadErrorLogs
              ? [
                  {
                    key: "error-logs",
                    label: "错误日志",
                    children: (
                      <Space direction="vertical" size={16} style={{ width: "100%" }}>
                        <Card styles={{ body: { padding: 16 } }}>
                          <Space wrap>
                            <Select
                              value={errorLogLines}
                              onChange={setErrorLogLines}
                              style={{ width: 140 }}
                              options={[1000, 5000, 10000].map((value) => ({
                                label: `${value} 行`,
                                value,
                              }))}
                            />
                            <Button onClick={() => errorLogsQuery.refetch()} loading={errorLogsQuery.isFetching}>
                              刷新日志
                            </Button>
                          </Space>
                        </Card>

                        {errorLogsQuery.isError ? (
                          <Alert type="error" showIcon message="加载错误日志失败" />
                        ) : null}

                        {errorLogsQuery.data?.data.logs?.length ? (
                          <Card
                            title={`共 ${errorLogsQuery.data.data.totalLines} 行，来自 ${errorLogsQuery.data.data.files.length} 个文件`}
                            extra={
                              <Space wrap>
                                {errorLogsQuery.data.data.files.map((file) => (
                                  <Tag key={file.name}>{file.name}</Tag>
                                ))}
                              </Space>
                            }
                          >
                            <div
                              style={{
                                maxHeight: 520,
                                overflow: "auto",
                                background: "#fafafa",
                                border: "1px solid #e8e8e8",
                                borderRadius: 8,
                                padding: 12,
                                fontFamily: "SFMono-Regular, Consolas, monospace",
                                fontSize: 12,
                                lineHeight: 1.6,
                              }}
                            >
                              {errorLogsQuery.data.data.logs.map((line, index) => (
                                <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
                              ))}
                            </div>
                          </Card>
                        ) : errorLogsQuery.isFetched && !errorLogsQuery.isFetching ? (
                          <Empty description="暂无错误日志" />
                        ) : null}
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </PageSection>
    </PermissionGuard>
  );
}
