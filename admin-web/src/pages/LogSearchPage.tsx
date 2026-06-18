import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  List,
  Select,
  Space,
  Tabs,
  Tag,
  Table,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchErrorLogs, fetchLogRequestHandlers, fetchLogRequests, fetchLogSearch } from "@/services/stats";
import type { LogRequestResultItem, LogSearchResultItem } from "@/types/stats";
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

  const [activeTab, setActiveTab] = useState("search");
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
  const [requestHandler, setRequestHandler] = useState("");
  const [submittedRequestHandler, setSubmittedRequestHandler] = useState("");
  const [requestLogScope, setRequestLogScope] = useState("api");
  const [submittedRequestLogScope, setSubmittedRequestLogScope] = useState("api");
  const [requestTimeRange, setRequestTimeRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, "minute"),
    dayjs(),
  ]);
  const [submittedRequestTimeRange, setSubmittedRequestTimeRange] = useState<[Dayjs, Dayjs]>(requestTimeRange);
  const [requestLimit, setRequestLimit] = useState(200);
  const [submittedRequestLimit, setSubmittedRequestLimit] = useState(200);
  const [requestNonce, setRequestNonce] = useState(0);

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

  const submitRequestSearch = () => {
    const handler = requestHandler.trim().replace(/^@+/, "");
    if (!handler) return;
    setSubmittedRequestHandler(handler);
    setSubmittedRequestLogScope(requestLogScope);
    setSubmittedRequestTimeRange(requestTimeRange);
    setSubmittedRequestLimit(requestLimit);
    setRequestNonce((value) => value + 1);
  };

  const searchByRequestId = (requestId: string) => {
    setActiveTab("search");
    setQueryText(requestId);
    setLogScope("api");
    setContextMode("after");
    setContextLines(5);
    setResultLimit(1);
    setSubmittedQuery(requestId);
    setSubmittedLogScope("api");
    setSubmittedContextMode("after");
    setSubmittedContextLines(5);
    setSubmittedResultLimit(1);
    setSearchNonce((value) => value + 1);
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

  const requestHandlersQuery = useQuery({
    queryKey: ["log-request-handlers"],
    queryFn: fetchLogRequestHandlers,
    refetchOnWindowFocus: false,
  });

  const requestSearchQuery = useQuery({
    queryKey: [
      "log-requests",
      submittedRequestHandler,
      submittedRequestLogScope,
      submittedRequestTimeRange[0]?.valueOf(),
      submittedRequestTimeRange[1]?.valueOf(),
      submittedRequestLimit,
      requestNonce,
    ],
    queryFn: () =>
      fetchLogRequests({
        handler: submittedRequestHandler,
        scope: submittedRequestLogScope,
        startTime: submittedRequestTimeRange[0].toISOString(),
        endTime: submittedRequestTimeRange[1].toISOString(),
        limit: submittedRequestLimit,
      }),
    enabled: Boolean(submittedRequestHandler.trim()),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const results = searchQuery.data?.data.results || [];
  const requestResults = requestSearchQuery.data?.data.results || [];
  const requestHandlerOptions = (requestHandlersQuery.data?.data.internalTest || []).map((username) => ({
    value: username,
    label: username,
  }));
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
          activeKey={activeTab}
          onChange={setActiveTab}
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
            {
              key: "request-search",
              label: "按用户请求",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Card styles={{ body: { padding: 16 } }}>
                    <Space wrap style={{ width: "100%" }}>
                      <Select
                        value={requestLogScope}
                        onChange={setRequestLogScope}
                        style={{ width: 220 }}
                        options={LOG_SEARCH_SCOPE_OPTIONS}
                      />
                      <AutoComplete
                        value={requestHandler}
                        onChange={setRequestHandler}
                        options={requestHandlerOptions}
                        placeholder="选择内测用户或输入 handler"
                        style={{ minWidth: 260 }}
                        filterOption={(inputValue, option) =>
                          String(option?.value || "").toLowerCase().includes(inputValue.toLowerCase())
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") submitRequestSearch();
                        }}
                        allowClear
                      />
                      <DatePicker.RangePicker
                        showTime
                        allowClear={false}
                        value={requestTimeRange}
                        onChange={(values) => {
                          if (values?.[0] && values?.[1]) {
                            setRequestTimeRange([values[0], values[1]]);
                          }
                        }}
                        style={{ minWidth: 380 }}
                      />
                      <Select
                        value={requestLimit}
                        onChange={setRequestLimit}
                        style={{ width: 120 }}
                        options={[50, 100, 200, 500, 1000].map((value) => ({
                          label: `${value} 条`,
                          value,
                        }))}
                      />
                      <Button
                        type="primary"
                        onClick={submitRequestSearch}
                        loading={requestSearchQuery.isFetching}
                      >
                        查询请求
                      </Button>
                    </Space>
                  </Card>

                  {requestSearchQuery.isError ? (
                    <Alert
                      type="error"
                      showIcon
                      message="请求日志查询失败"
                      description="请确认时间范围不超过 24 小时，并且 PM2 日志有时间前缀。"
                    />
                  ) : null}

                  {requestSearchQuery.data ? (
                    <Card
                      size="small"
                      title={`${submittedRequestHandler}：找到 ${requestSearchQuery.data.data.totalMatches} 条请求，搜索了 ${requestSearchQuery.data.data.searchedFiles} 个文件`}
                    >
                      <Typography.Text type="secondary">
                        点击 requestId 会切换到“日志搜索”，并按默认条件（仅后 / 5行 / 1条）查询该 requestId。
                      </Typography.Text>
                    </Card>
                  ) : null}

                  {requestResults.length ? (
                    <Table<LogRequestResultItem>
                      rowKey={(record) => `${record.file}-${record.lineNumber}-${record.requestId}`}
                      size="small"
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      dataSource={requestResults}
                      columns={[
                        {
                          title: "时间",
                          dataIndex: "time",
                          width: 190,
                          render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm:ss"),
                        },
                        {
                          title: "请求 URL",
                          dataIndex: "url",
                          render: (_value: string, record) => (
                            <Typography.Text code>
                              {record.method} {record.url}
                            </Typography.Text>
                          ),
                        },
                        {
                          title: "状态码",
                          dataIndex: "status",
                          width: 100,
                          render: (value: number | null | undefined) => {
                            if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
                            const color = value >= 500 ? "error" : value >= 400 ? "warning" : "success";
                            return <Tag color={color}>{value}</Tag>;
                          },
                        },
                        {
                          title: "报错",
                          dataIndex: "error",
                          width: 260,
                          render: (value: string | undefined) => value ? (
                            <Typography.Text type="danger" ellipsis style={{ maxWidth: 240 }} title={value}>
                              {value}
                            </Typography.Text>
                          ) : <Typography.Text type="secondary">-</Typography.Text>,
                        },
                        {
                          title: "requestId",
                          dataIndex: "requestId",
                          width: 300,
                          render: (value: string) => (
                            <Button type="link" size="small" onClick={() => searchByRequestId(value)}>
                              {value}
                            </Button>
                          ),
                        },
                        {
                          title: "日志文件",
                          dataIndex: "file",
                          width: 220,
                          render: (value: string, record) => <Tag>{value}: {record.lineNumber}</Tag>,
                        },
                      ]}
                    />
                  ) : requestSearchQuery.isFetched && !requestSearchQuery.isFetching ? (
                    <Empty description="未找到该 handler 在时间范围内的请求" />
                  ) : null}
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
