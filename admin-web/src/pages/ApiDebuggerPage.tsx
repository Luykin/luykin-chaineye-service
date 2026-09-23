import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  CopyOutlined,
  FundViewOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchDebuggerEndpoints, executeDebuggerRequest } from "@/services/api-debugger";
import type {
  DebuggerEndpoint,
  DebuggerExecutionResult,
} from "@/types/api-debugger";

const { Paragraph, Text, Title } = Typography;

interface EndpointFormState {
  params: Record<string, unknown>;
  result: DebuggerExecutionResult | null;
  loading: boolean;
  activeTab: "body" | "request" | "headers";
}

function formatJson(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  return JSON.stringify(val, null, 2);
}

export function ApiDebuggerPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [viewMode, setViewMode] = useState<"all" | "single">("all");
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("");
  const [endpointStates, setEndpointStates] = useState<Record<string, EndpointFormState>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["debugger-endpoints"],
    queryFn: fetchDebuggerEndpoints,
  });

  const endpoints = data?.data?.endpoints || [];
  const configInfo = data?.data?.configInfo;

  // 初始化各个接口的表单参数
  useEffect(() => {
    if (endpoints.length > 0) {
      setEndpointStates((prev) => {
        const next: Record<string, EndpointFormState> = { ...prev };
        endpoints.forEach((ep) => {
          if (!next[ep.id]) {
            const initialParams: Record<string, unknown> = {};
            ep.fields.forEach((field) => {
              initialParams[field.key] = field.defaultValue ?? "";
            });
            next[ep.id] = {
              params: initialParams,
              result: null,
              loading: false,
              activeTab: "body",
            };
          }
        });
        return next;
      });

      if (!selectedEndpointId) {
        setSelectedEndpointId(endpoints[0].id);
      }
    }
  }, [endpoints, selectedEndpointId]);

  const updateParam = (endpointId: string, key: string, value: unknown) => {
    setEndpointStates((prev) => {
      const current = prev[endpointId] || {
        params: {},
        result: null,
        loading: false,
        activeTab: "body",
      };
      return {
        ...prev,
        [endpointId]: {
          ...current,
          params: {
            ...current.params,
            [key]: value,
          },
        },
      };
    });
  };

  const fillSample = (endpoint: DebuggerEndpoint) => {
    setEndpointStates((prev) => {
      const current = prev[endpoint.id] || {
        params: {},
        result: null,
        loading: false,
        activeTab: "body",
      };
      return {
        ...prev,
        [endpoint.id]: {
          ...current,
          params: {
            ...current.params,
            ...endpoint.sampleParams,
          },
        },
      };
    });
    messageApi.success(`已为 [${endpoint.name}] 填入测试样例`);
  };

  const resetEndpoint = (endpoint: DebuggerEndpoint) => {
    const initialParams: Record<string, unknown> = {};
    endpoint.fields.forEach((field) => {
      initialParams[field.key] = field.defaultValue ?? "";
    });
    setEndpointStates((prev) => ({
      ...prev,
      [endpoint.id]: {
        params: initialParams,
        result: null,
        loading: false,
        activeTab: "body",
      },
    }));
    messageApi.info(`已重置 [${endpoint.name}]`);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      messageApi.success(`${label}已复制到剪贴板`);
    } catch {
      messageApi.error("复制失败，请手动选择复制");
    }
  };

  const handleExecute = async (endpoint: DebuggerEndpoint) => {
    const state = endpointStates[endpoint.id];
    const currentParams = state?.params || {};

    // 简单校验必填字段
    for (const field of endpoint.fields) {
      if (field.required) {
        const val = currentParams[field.key];
        if (val === undefined || val === null || String(val).trim() === "") {
          messageApi.warning(`请填写必填项：${field.label}`);
          return;
        }
      }
    }

    setEndpointStates((prev) => ({
      ...prev,
      [endpoint.id]: {
        ...prev[endpoint.id],
        loading: true,
      },
    }));

    try {
      const response = await executeDebuggerRequest({
        endpointId: endpoint.id,
        params: currentParams,
      });

      if (response.success && response.execution) {
        setEndpointStates((prev) => ({
          ...prev,
          [endpoint.id]: {
            ...prev[endpoint.id],
            loading: false,
            result: response.execution,
          },
        }));

        if (response.execution.isError) {
          messageApi.warning(`请求已完成，下游返回错误状态码: ${response.execution.status}`);
        } else {
          messageApi.success(`请求成功！耗时 ${response.execution.durationMs}ms`);
        }
      } else {
        throw new Error(response.error || "请求执行未返回结果");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messageApi.error(`执行失败: ${errMsg}`);
      setEndpointStates((prev) => ({
        ...prev,
        [endpoint.id]: {
          ...prev[endpoint.id],
          loading: false,
          result: {
            status: 0,
            statusText: "Error",
            durationMs: 0,
            targetUrl: endpoint.path,
            method: endpoint.method,
            requestHeaders: {},
            requestBody: currentParams,
            responseHeaders: {},
            responseData: { error: errMsg },
            isError: true,
            error: { message: errMsg },
          },
        },
      }));
    }
  };

  const renderCard = (endpoint: DebuggerEndpoint) => {
    const state = endpointStates[endpoint.id] || {
      params: {},
      result: null,
      loading: false,
      activeTab: "body",
    };
    const params = state.params;
    const result = state.result;
    const isPost = endpoint.method === "POST";

    return (
      <div
        key={endpoint.id}
        id={`endpoint-card-${endpoint.id}`}
        className="api-debugger-endpoint-card"
      >
        {/* 卡片头部 */}
        <div className="api-debugger-card-header">
          <div className="api-debugger-header-left">
            <span
              className={`api-debugger-method-tag ${
                isPost ? "api-debugger-method-post" : "api-debugger-method-get"
              }`}
            >
              {endpoint.method}
            </span>
            <span className="api-debugger-endpoint-title">{endpoint.name}</span>
            <span className="api-debugger-endpoint-url">{endpoint.path}</span>
          </div>
          <Space>
            <Button
              size="small"
              icon={<RocketOutlined />}
              onClick={() => fillSample(endpoint)}
            >
              填入测试样例
            </Button>
            <Button
              size="small"
              icon={<RedoOutlined />}
              onClick={() => resetEndpoint(endpoint)}
            >
              重置
            </Button>
          </Space>
        </div>

        {/* 卡片主体 */}
        <div className="api-debugger-card-body">
          <p className="api-debugger-desc">{endpoint.description}</p>

          {/* 预设写死参数提示框 */}
          <div className="api-debugger-preset-box">
            <div className="api-debugger-preset-header">
              <span>系统已沿用写死参数（管理后台请求时自动注入，无需手动填入）:</span>
              <Tag color="cyan">代码原样沿用</Tag>
            </div>
            <div className="api-debugger-preset-tags">
              {Object.entries(endpoint.presetHeaders).map(([key, val]) => (
                <Tag key={key} color="blue">
                  Header: {key} = {val}
                </Tag>
              ))}
              {Object.entries(endpoint.fixedParams).map(([key, val]) => (
                <Tag key={key} color="purple">
                  Fixed Param: {key} = {String(val)}
                </Tag>
              ))}
            </div>
          </div>

          {/* 左右调试工作台 */}
          <div className="api-debugger-workbench">
            {/* 左侧：变动参数填写表单 */}
            <div className="api-debugger-params-panel">
              <div className="api-debugger-panel-title">
                <span>动态变动参数 (管理员填写)</span>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  由管理后台后端统一发起请求
                </Text>
              </div>

              {endpoint.fields.map((field) => {
                const val = params[field.key] ?? "";
                return (
                  <div key={field.key} className="api-debugger-form-item">
                    <label className="api-debugger-label">
                      {field.label}
                      {field.required && (
                        <span className="api-debugger-label-required">*</span>
                      )}
                    </label>

                    {field.options ? (
                      <Select
                        style={{ width: "100%" }}
                        value={String(val)}
                        onChange={(selected) =>
                          updateParam(endpoint.id, field.key, selected)
                        }
                        options={field.options.map((opt) => ({
                          label: opt,
                          value: opt,
                        }))}
                      />
                    ) : field.type === "number" ? (
                      <InputNumber
                        style={{ width: "100%" }}
                        value={typeof val === "number" ? val : Number(val) || 0}
                        onChange={(n) => updateParam(endpoint.id, field.key, n)}
                        placeholder={field.placeholder}
                      />
                    ) : field.type === "boolean" ? (
                      <Switch
                        checked={Boolean(val)}
                        onChange={(checked) =>
                          updateParam(endpoint.id, field.key, checked)
                        }
                      />
                    ) : (
                      <Input
                        value={String(val)}
                        onChange={(e) =>
                          updateParam(endpoint.id, field.key, e.target.value)
                        }
                        placeholder={field.placeholder}
                        allowClear
                      />
                    )}

                    {field.description && (
                      <span className="api-debugger-field-hint">
                        {field.description}
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="api-debugger-actions">
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={state.loading}
                  onClick={() => handleExecute(endpoint)}
                  style={{ flex: 1 }}
                >
                  {state.loading ? "正在由管理后台发起请求..." : "发送请求"}
                </Button>
              </div>
            </div>

            {/* 右侧：Postman 风格响应结果面板 */}
            <div className="api-debugger-response-panel">
              <div className="api-debugger-response-header">
                <Space size={12}>
                  {result ? (
                    <span className="api-debugger-status-badge">
                      {result.status >= 200 && result.status < 300 ? (
                        <Badge status="success" />
                      ) : (
                        <Badge status="error" />
                      )}
                      <span
                        style={{
                          color:
                            result.status >= 200 && result.status < 300
                              ? "#52c41a"
                              : "#ff4d4f",
                        }}
                      >
                        Status: {result.status} {result.statusText}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                      Status: 未请求
                    </span>
                  )}

                  {result && (
                    <span className="api-debugger-duration">
                      <ClockCircleOutlined />
                      {result.durationMs} ms
                    </span>
                  )}
                </Space>

                <Space size={8}>
                  {result && (
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined style={{ color: "#d9d9d9" }} />}
                      onClick={() =>
                        copyText(
                          formatJson(result.responseData),
                          "响应结果 JSON "
                        )
                      }
                      style={{ color: "#d9d9d9" }}
                    >
                      复制结果
                    </Button>
                  )}
                </Space>
              </div>

              {/* 响应标签页切换 */}
              {result && (
                <div style={{ padding: "0 16px", background: "#252525" }}>
                  <Tabs
                    size="small"
                    activeKey={state.activeTab}
                    onChange={(tab) =>
                      setEndpointStates((prev) => ({
                        ...prev,
                        [endpoint.id]: {
                          ...prev[endpoint.id],
                          activeTab: tab as "body" | "request" | "headers",
                        },
                      }))
                    }
                    items={[
                      { key: "body", label: "Response Body" },
                      { key: "request", label: "Actual Request Details" },
                      { key: "headers", label: "Response Headers" },
                    ]}
                  />
                </div>
              )}

              {/* 响应内容 */}
              <div className="api-debugger-response-body">
                {state.loading ? (
                  <div className="api-debugger-loading-response">
                    <Spin size="large" />
                    <span>管理后台正在连通服务并执行请求...</span>
                  </div>
                ) : !result ? (
                  <div className="api-debugger-empty-response">
                    <CodeOutlined style={{ fontSize: 28, color: "#4a5568" }} />
                    <span>输入参数后点击左侧“发送请求”，响应结果将展示在此处</span>
                  </div>
                ) : state.activeTab === "body" ? (
                  <pre className="api-debugger-pre">
                    {formatJson(result.responseData) || "(Empty Response)"}
                  </pre>
                ) : state.activeTab === "request" ? (
                  <pre className="api-debugger-pre">
                    {formatJson({
                      targetUrl: result.targetUrl,
                      method: result.method,
                      headers: result.requestHeaders,
                      body: result.requestBody,
                    })}
                  </pre>
                ) : (
                  <pre className="api-debugger-pre">
                    {formatJson(result.responseHeaders) || "(No Response Headers)"}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const displayedEndpoints =
    viewMode === "all"
      ? endpoints
      : endpoints.filter((item) => item.id === selectedEndpointId);

  return (
    <PermissionGuard permission="api-debugger">
      {contextHolder}
      <PageSection
        title="接口调试台"
        description="调试工具 · 用于直接在管理后台测试后端服务及下游依赖接口。代码写死参数（如 API Key、Crawler Pool）自动沿用注入，管理员仅需输入变动参数。"
      >
        <div className="api-debugger-page">
          {/* 顶部 Hero 卡片 */}
          <div className="api-debugger-hero">
            <div className="api-debugger-hero-content">
              <span className="api-debugger-eyebrow">DEVELOPER TOOLS / API DEBUGGER</span>
              <Title level={3} className="api-debugger-hero-title">
                后端接口调试台 (Ghost Following 专区)
              </Title>
              <Paragraph className="api-debugger-hero-desc">
                本页面用于快速测试推特抓取分析下游接口（如 <Text code>kol_tweets</Text>、
                <Text code>user_tweets</Text>、<Text code>profile_by_userid</Text>、
                <Text code>social/following</Text> 及配额查询）。请求由管理后台后端以真实内网身份发起，
                自动沿用配置中的 <Text code>apiKey</Text> 与请求头，管理员仅需填写变动参数即可秒级查看完整返回体。
              </Paragraph>
            </div>
            <div className="api-debugger-hero-tags">
              <Tag color="blue" icon={<ThunderboltOutlined />}>
                管理后台代理发起
              </Tag>
              <Tag color="green" icon={<CheckCircleOutlined />}>
                API Key 自动注入
              </Tag>
              {configInfo && (
                <Tag color="geekblue">BaseURL: {configInfo.baseUrl}</Tag>
              )}
            </div>
          </div>

          {/* 状态与加载 */}
          {isLoading && (
            <Card style={{ textAlign: "center", padding: "40px 0" }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: "#8c8c8c" }}>
                正在加载接口配置与元数据...
              </div>
            </Card>
          )}

          {isError && (
            <Alert
              type="error"
              showIcon
              message="加载接口配置失败"
              description={error instanceof Error ? error.message : "无法获取端点列表"}
              action={
                <Button size="small" type="primary" onClick={() => refetch()}>
                  重试
                </Button>
              }
            />
          )}

          {/* 工具栏：模式切换与快捷跳转 */}
          {!isLoading && endpoints.length > 0 && (
            <div className="api-debugger-toolbar">
              <div className="api-debugger-nav-links">
                <span className="api-debugger-nav-label">快速跳转:</span>
                {endpoints.map((ep) => (
                  <Button
                    key={ep.id}
                    size="small"
                    type={
                      viewMode === "single" && selectedEndpointId === ep.id
                        ? "primary"
                        : "default"
                    }
                    onClick={() => {
                      if (viewMode === "single") {
                        setSelectedEndpointId(ep.id);
                      } else {
                        const el = document.getElementById(
                          `endpoint-card-${ep.id}`
                        );
                        if (el) {
                          el.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }
                      }
                    }}
                  >
                    <Tag
                      color={ep.method === "POST" ? "green" : "blue"}
                      style={{ marginRight: 4 }}
                    >
                      {ep.method}
                    </Tag>
                    {ep.name.split("(")[0].trim()}
                  </Button>
                ))}
              </div>

              <Space>
                <span style={{ fontSize: 13, color: "#64748b" }}>展示模式:</span>
                <Radio.Group
                  size="small"
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="all">平铺所有接口</Radio.Button>
                  <Radio.Button value="single">单接口聚焦</Radio.Button>
                </Radio.Group>
              </Space>
            </div>
          )}

          {/* 接口卡片列表 */}
          <div className="api-debugger-cards">
            {displayedEndpoints.map((ep) => renderCard(ep))}
          </div>
        </div>
      </PageSection>
    </PermissionGuard>
  );
}
