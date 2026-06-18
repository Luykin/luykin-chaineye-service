import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
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

const LOG_SEARCH_SCOPE_OPTIONS = [
  { label: "全部服务", value: "all" },
  { label: "API · luykin-chaineye-api", value: "api" },
  { label: "爬虫 · luykin-chaineye-crawler", value: "crawler" },
  { label: "Bot · luykin-chaineye-bot", value: "bot" },
  { label: "Jobs · luykin-chaineye-jobs", value: "jobs" },
  { label: "币安广场爬虫", value: "binance-square-crawler" },
  { label: "其他日志", value: "other" },
];
const LOG_CONTEXT_MODE_OPTIONS = [
  { label: "前后", value: "around" },
  { label: "仅后", value: "after" },
  { label: "仅前", value: "before" },
];

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
  const [logScope, setLogScope] = useState("all");
  const [submittedLogScope, setSubmittedLogScope] = useState("all");
  const [contextMode, setContextMode] = useState("after");
  const [submittedContextMode, setSubmittedContextMode] = useState("after");
  const [contextLines, setContextLines] = useState(5);
  const [submittedContextLines, setSubmittedContextLines] = useState(5);
  const [resultLimit, setResultLimit] = useState(1);
  const [submittedResultLimit, setSubmittedResultLimit] = useState(1);
  const [searchNonce, setSearchNonce] = useState(0);
  const [errorLogScope, setErrorLogScope] = useState("all");
  const [submittedErrorLogScope, setSubmittedErrorLogScope] = useState("all");
  const [errorLogLines, setErrorLogLines] = useState(1000);
  const [submittedErrorLogLines, setSubmittedErrorLogLines] = useState(1000);
  const [errorLogNonce, setErrorLogNonce] = useState(0);

  const submitSearch = () => {
    const keyword = queryText.trim();
    if (!keyword) return;
    setSubmittedQuery(keyword);
    setSubmittedLogScope(logScope);
    setSubmittedContextMode(contextMode);
    setSubmittedContextLines(contextLines);
    setSubmittedResultLimit(resultLimit);
    setSearchNonce((value) => value + 1);
  };

  const submitErrorLogs = () => {
    setSubmittedErrorLogScope(errorLogScope);
    setSubmittedErrorLogLines(errorLogLines);
    setErrorLogNonce((value) => value + 1);
  };

  const searchQuery = useQuery({
    queryKey: [
      "log-search",
      submittedQuery,
      submittedLogScope,
      submittedContextMode,
      submittedContextLines,
      submittedResultLimit,
      searchNonce,
    ],
    queryFn: () =>
      fetchLogSearch({
        query: submittedQuery,
        scope: submittedLogScope,
        contextMode: submittedContextMode,
        contextLines: submittedContextLines,
        limit: submittedResultLimit,
      }),
    enabled: Boolean(submittedQuery.trim()),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const errorLogsQuery = useQuery({
    queryKey: ["error-logs", submittedErrorLogScope, submittedErrorLogLines, errorLogNonce],
    queryFn: () => fetchErrorLogs({ scope: submittedErrorLogScope, lines: submittedErrorLogLines }),
    enabled: canReadErrorLogs,
    refetchOnWindowFocus: false,
  });

  const results = searchQuery.data?.data.results || [];
  const selectedScopeLabel =
    LOG_SEARCH_SCOPE_OPTIONS.find((item) => item.value === submittedLogScope)?.label || "全部服务";
  const selectedErrorLogScopeLabel =
    LOG_SEARCH_SCOPE_OPTIONS.find((item) => item.value === submittedErrorLogScope)?.label || "全部服务";
  const submittedContextSummary =
    submittedContextMode === "after"
      ? `命中行后 ${submittedContextLines} 行`
      : submittedContextMode === "before"
        ? `命中行前 ${submittedContextLines} 行`
        : `命中行前后各 ${submittedContextLines} 行`;

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
                      <Select
                        value={logScope}
                        onChange={setLogScope}
                        style={{ width: 220 }}
                        options={LOG_SEARCH_SCOPE_OPTIONS}
                      />
                      <Input
                        value={queryText}
                        onChange={(event) => setQueryText(event.target.value)}
                        placeholder="输入搜索关键词..."
                        style={{ minWidth: 260, flex: 1 }}
                        onPressEnter={submitSearch}
                      />
                      <Select
                        value={contextMode}
                        onChange={setContextMode}
                        style={{ width: 96 }}
                        options={LOG_CONTEXT_MODE_OPTIONS}
                      />
                      <InputNumber
                        value={contextLines}
                        onChange={(value) => setContextLines(Math.max(0, Math.floor(Number(value) || 0)))}
                        min={0}
                        precision={0}
                        addonAfter="行"
                        style={{ width: 130 }}
                      />
                      <Select
                        value={resultLimit}
                        onChange={setResultLimit}
                        style={{ width: 120 }}
                        options={[1, 5, 10, 50, 100, 200].map((value) => ({
                          label: `${value} 条`,
                          value,
                        }))}
                      />
                      <Button
                        type="primary"
                        onClick={submitSearch}
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
                          title={`${selectedScopeLabel}：共 ${searchQuery.data.data.totalMatches} 个匹配，搜索了 ${searchQuery.data.data.searchedFiles} 个文件`}
                        >
                          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                            当前展示模式：{submittedContextSummary}
                          </Typography.Text>
                          <Space wrap className="log-search-file-tags">
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
                              value={errorLogScope}
                              onChange={setErrorLogScope}
                              style={{ width: 220 }}
                              options={LOG_SEARCH_SCOPE_OPTIONS}
                            />
                            <Select
                              value={errorLogLines}
                              onChange={setErrorLogLines}
                              style={{ width: 140 }}
                              options={[1000, 5000, 10000].map((value) => ({
                                label: `${value} 行`,
                                value,
                              }))}
                            />
                            <Button onClick={submitErrorLogs} loading={errorLogsQuery.isFetching}>
                              刷新日志
                            </Button>
                          </Space>
                        </Card>

                        {errorLogsQuery.isError ? (
                          <Alert type="error" showIcon message="加载错误日志失败" />
                        ) : null}

                        {errorLogsQuery.data?.data.logs?.length ? (
                          <Card
                            title={`${selectedErrorLogScopeLabel}：共 ${errorLogsQuery.data.data.totalLines} 行，来自 ${errorLogsQuery.data.data.files.length} 个文件`}
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
