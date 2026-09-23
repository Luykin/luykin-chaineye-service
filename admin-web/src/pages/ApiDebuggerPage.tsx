import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  InputNumber,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  RocketOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  TwitterOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchDebuggerEndpoints, executeDebuggerRequest } from "@/services/api-debugger";
import { lookupTwitterIdHandler } from "@/services/twitter-id-handler";
import type { TwitterIdHandlerLookupData } from "@/types/twitter-id-handler";
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

interface TwitterProfileRecord {
  id?: string;
  name?: string;
  username?: string;
  description?: string;
  created_at?: string;
  followers_count?: number;
  following_count?: number;
  tweets_count?: number;
  listed_count?: number;
  is_blue_verified?: boolean;
  verified?: boolean;
  protected?: boolean;
  location?: string;
  url?: string;
  profile_image_url?: string;
  profile_banner_url?: string;
  [key: string]: unknown;
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

/**
 * 健壮提取关注列表中的 profiles 数组与 nextCursor
 */
function extractFollowingProfiles(responseData: unknown): {
  profiles: TwitterProfileRecord[];
  nextCursor: string | null;
} {
  if (!responseData || typeof responseData !== "object") {
    return { profiles: [], nextCursor: null };
  }
  const anyData = responseData as Record<string, unknown>;
  const inner = (anyData.data ||
    (anyData.result as Record<string, unknown>)?.data ||
    anyData.result ||
    anyData) as Record<string, unknown>;

  const rawProfiles = Array.isArray(inner?.profiles)
    ? inner.profiles
    : Array.isArray(inner?.users)
    ? inner.users
    : Array.isArray(anyData?.profiles)
    ? anyData.profiles
    : [];

  const profiles: TwitterProfileRecord[] = rawProfiles.filter(
    (item): item is TwitterProfileRecord => typeof item === "object" && item !== null
  );

  const rawNext = inner?.next ?? inner?.next_cursor ?? anyData?.next;
  const nextCursor =
    typeof rawNext === "string" && rawNext.trim().length > 0 ? rawNext.trim() : null;

  return { profiles, nextCursor };
}

/**
 * 下载文本文件到本地
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * 将 Profiles 导出为 CSV 表格 (带 UTF-8 BOM，防止 Excel 中文乱码，数字 ID 加制表符防科学计数法)
 */
function exportProfilesToCsv(profiles: TwitterProfileRecord[], targetName: string) {
  const headers = [
    "Twitter ID",
    "用户名 (Handle)",
    "显示昵称",
    "粉丝数",
    "关注数",
    "推文数",
    "是否蓝V认证",
    "是否锁推",
    "主页链接",
    "个人简介",
    "创建时间",
    "头像链接",
  ];

  const escapeCsv = (str: unknown) => {
    if (str === null || str === undefined) return '""';
    const clean = String(str).replace(/"/g, '""').replace(/\r?\n/g, " ");
    return `"${clean}"`;
  };

  const rows = profiles.map((p) => {
    const rawId = p.id || "";
    // Excel 防科学计数法：="\t12345"
    const safeId = rawId ? `="\t${rawId}"` : '""';
    const username = p.username || "";
    const xUrl = username ? `https://x.com/${username}` : "";

    return [
      safeId,
      escapeCsv(username),
      escapeCsv(p.name || ""),
      Number(p.followers_count || 0),
      Number(p.following_count || 0),
      Number(p.tweets_count || 0),
      p.is_blue_verified ? "是" : "否",
      p.protected ? "是" : "否",
      escapeCsv(xUrl),
      escapeCsv(p.description || ""),
      escapeCsv(p.created_at || ""),
      escapeCsv(p.profile_image_url || ""),
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const safeName = (targetName || "twitter").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}_following_${profiles.length}_${dayjs().format(
    "YYYYMMDD_HHmmss"
  )}.csv`;

  downloadFile(csvContent, filename, "text/csv;charset=utf-8;");
}

/**
 * 将 Profiles 导出为 JSON 文件
 */
function exportProfilesToJson(profiles: TwitterProfileRecord[], targetName: string) {
  const jsonContent = JSON.stringify(profiles, null, 2);
  const safeName = (targetName || "twitter").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}_following_${profiles.length}_${dayjs().format(
    "YYYYMMDD_HHmmss"
  )}.json`;

  downloadFile(jsonContent, filename, "application/json;charset=utf-8;");
}

export function ApiDebuggerPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [viewMode, setViewMode] = useState<"all" | "single">("all");
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("");
  const [endpointStates, setEndpointStates] = useState<Record<string, EndpointFormState>>({});

  // Twitter Handler 解析状态 (用于 social/following 及其他需要 user_id 的卡片)
  const [followingLookupHandler, setFollowingLookupHandler] = useState<string>("elonmusk");
  const [isLookingUpId, setIsLookingUpId] = useState<boolean>(false);
  const [lookupTargetProfile, setLookupTargetProfile] = useState<TwitterIdHandlerLookupData | null>(
    null
  );

  // 全量关注列表抓取与导出状态
  const [batchMaxLimit, setBatchMaxLimit] = useState<number>(500);
  const [batchFetching, setBatchFetching] = useState<boolean>(false);
  const [batchProfiles, setBatchProfiles] = useState<TwitterProfileRecord[]>([]);
  const [batchStats, setBatchStats] = useState<{ page: number; cursor: string }>({
    page: 0,
    cursor: "",
  });
  const [showPreviewTable, setShowPreviewTable] = useState<boolean>(false);
  const batchStopRequestedRef = useRef<boolean>(false);

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

  /**
   * 通过 Handler 解析 Twitter ID 并自动填充到 user_id 输入框中
   */
  const handleLookupTwitterId = async (inputHandler?: string) => {
    const raw = inputHandler || followingLookupHandler;
    const clean = String(raw || "")
      .trim()
      .replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "")
      .split(/[/?#]/)[0]
      .replace(/^@+/, "")
      .trim();

    if (!clean) {
      messageApi.warning("请输入有效的 Twitter 用户名 (Handler)");
      return;
    }

    setIsLookingUpId(true);
    try {
      const res = await lookupTwitterIdHandler({ handler: clean });
      if (res.success && res.data) {
        const found = res.data;
        setLookupTargetProfile(found);
        // 自动填入 social/following 接口参数中的 user_id
        updateParam("ghost_social_following", "user_id", found.twitterId);
        // 如果当前是其他需要 user_id 的接口，也同步填入
        updateParam("ghost_user_tweets", "user_id", found.twitterId);
        updateParam("ghost_profile_by_userid", "user_id", found.twitterId);
        updateParam("ghost_full_pipeline", "user_id", found.twitterId);
        updateParam("ghost_full_pipeline", "handle", found.handler);

        messageApi.success(`已成功解析 @${found.handler} 的 Twitter ID: ${found.twitterId}，已自动填入！`);
      } else {
        messageApi.error("未找到对应的 Twitter ID，请检查 Handler 是否正确");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messageApi.error(`查询 Twitter ID 失败: ${errMsg}`);
    } finally {
      setIsLookingUpId(false);
    }
  };

  /**
   * 启动全量连续抓取关注者
   */
  const handleStartBatchFollowingFetch = async () => {
    const state = endpointStates["ghost_social_following"];
    const userId = String(state?.params?.user_id || "").trim();

    if (!userId) {
      messageApi.warning("请先填入 Twitter 数字 ID (user_id)，或在上方通过 Handler 自动查询");
      return;
    }

    setBatchFetching(true);
    batchStopRequestedRef.current = false;
    setBatchProfiles([]);
    setBatchStats({ page: 0, cursor: "" });

    const collected: TwitterProfileRecord[] = [];
    let currentCursor = "";
    let page = 0;
    let hasMore = true;

    messageApi.loading({ content: "正在开始抓取关注列表...", key: "batch-msg", duration: 0 });

    try {
      while (hasMore && !batchStopRequestedRef.current) {
        page += 1;
        setBatchStats({ page, cursor: currentCursor });

        const resp = await executeDebuggerRequest({
          endpointId: "ghost_social_following",
          params: {
            user_id: userId,
            cursor: currentCursor,
          },
        });

        if (!resp.success || !resp.execution || resp.execution.isError) {
          const errDetail =
            resp.execution?.error?.message ||
            (resp.execution?.responseData as { message?: string })?.message ||
            resp.error ||
            "下游接口请求失败";
          messageApi.warning({
            content: `第 ${page} 页请求中断：${errDetail}。已保留当前已抓取的 ${collected.length} 条数据。`,
            key: "batch-msg",
            duration: 4,
          });
          break;
        }

        const { profiles: newProfiles, nextCursor } = extractFollowingProfiles(
          resp.execution.responseData
        );

        if (newProfiles.length === 0) {
          hasMore = false;
          break;
        }

        collected.push(...newProfiles);
        setBatchProfiles([...collected]);

        messageApi.loading({
          content: `正在抓取第 ${page} 页，已累计获取 ${collected.length} 位关注者...`,
          key: "batch-msg",
          duration: 0,
        });

        // 检查是否达到抓取上限
        if (batchMaxLimit > 0 && collected.length >= batchMaxLimit) {
          hasMore = false;
          break;
        }

        // 检查是否有下一页游标
        if (!nextCursor || nextCursor === currentCursor) {
          hasMore = false;
          break;
        }

        currentCursor = nextCursor;

        // 每页轻微延迟 350ms，防止触发频率限制
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      const finishMsg = batchStopRequestedRef.current
        ? `已手动停止抓取，累计成功获取 ${collected.length} 位关注者！`
        : `抓取完毕！共获取 ${collected.length} 位关注者 (耗时 ${page} 页)。`;

      messageApi.success({ content: finishMsg, key: "batch-msg", duration: 4 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messageApi.error({
        content: `批量抓取出现异常: ${errMsg}，已保留已获取数据。`,
        key: "batch-msg",
        duration: 4,
      });
    } finally {
      setBatchFetching(false);
    }
  };

  /**
   * 手动中止批量抓取
   */
  const handleStopBatchFollowingFetch = () => {
    batchStopRequestedRef.current = true;
    setBatchFetching(false);
    messageApi.info("已触发停止抓取，正在整理当前已拉取的数据...");
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

  /**
   * 渲染表格预览的列配置
   */
  const previewColumns = [
    {
      title: "博主",
      key: "user",
      render: (_: unknown, record: TwitterProfileRecord) => (
        <Space>
          <Avatar src={record.profile_image_url} icon={<TwitterOutlined />} />
          <div>
            <div style={{ fontWeight: 600 }}>{record.name || record.username}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              @{record.username}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: "Twitter ID",
      dataIndex: "id",
      key: "id",
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: "粉丝数",
      dataIndex: "followers_count",
      key: "followers_count",
      sorter: (a: TwitterProfileRecord, b: TwitterProfileRecord) =>
        (a.followers_count || 0) - (b.followers_count || 0),
      render: (count: number) => count?.toLocaleString() ?? 0,
    },
    {
      title: "关注数",
      dataIndex: "following_count",
      key: "following_count",
      render: (count: number) => count?.toLocaleString() ?? 0,
    },
    {
      title: "认证",
      key: "verified",
      render: (_: unknown, record: TwitterProfileRecord) => (
        <Space size={4}>
          {record.is_blue_verified && <Tag color="blue">蓝V</Tag>}
          {record.protected && <Tag color="gold">私密锁推</Tag>}
          {!record.is_blue_verified && !record.protected && <Tag>普通</Tag>}
        </Space>
      ),
    },
    {
      title: "简介",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (desc: string) => desc || "-",
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: TwitterProfileRecord) => (
        <Button
          type="link"
          size="small"
          icon={<LinkOutlined />}
          href={`https://x.com/${record.username}`}
          target="_blank"
        >
          主页
        </Button>
      ),
    },
  ];

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
    const isFollowingEndpoint = endpoint.id === "ghost_social_following";

    // 检查单次响应中是否提取到 profiles
    const singleResponseProfiles = isFollowingEndpoint
      ? extractFollowingProfiles(result?.responseData).profiles
      : [];

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

          {/* 如果是 social/following 接口，提供专属的 Twitter Handler 自动转 ID 工具栏 */}
          {isFollowingEndpoint && (
            <div className="api-debugger-lookup-box">
              <div className="api-debugger-lookup-header">
                <span>
                  <TwitterOutlined style={{ marginRight: 6 }} />
                  输入 Twitter 用户名 (Handler) 自动查 Twitter ID
                </span>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  调用 xhunt/stats#/twitter-id-handler 接口
                </Text>
              </div>

              <div className="api-debugger-lookup-inputs">
                <Input
                  prefix={<TwitterOutlined style={{ color: "#1890ff" }} />}
                  value={followingLookupHandler}
                  onChange={(e) => setFollowingLookupHandler(e.target.value)}
                  onPressEnter={() => handleLookupTwitterId()}
                  placeholder="输入博主 Handler，例如 elonmusk 或 @elonmusk"
                  style={{ flex: 1 }}
                  allowClear
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  loading={isLookingUpId}
                  onClick={() => handleLookupTwitterId()}
                >
                  查询并填入 ID
                </Button>
              </div>

              {lookupTargetProfile && (
                <div className="api-debugger-profile-preview">
                  <div className="api-debugger-profile-info">
                    <Avatar
                      src={lookupTargetProfile.avatar || undefined}
                      icon={<TwitterOutlined />}
                      size={36}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {lookupTargetProfile.displayName || lookupTargetProfile.handler}
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        @{lookupTargetProfile.handler}
                      </Text>
                    </div>
                  </div>
                  <Space>
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      Twitter ID: {lookupTargetProfile.twitterId}
                    </Tag>
                    <Button
                      type="link"
                      size="small"
                      icon={<LinkOutlined />}
                      href={lookupTargetProfile.twitterUrl}
                      target="_blank"
                    >
                      主页
                    </Button>
                  </Space>
                </div>
              )}
            </div>
          )}

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
                  {state.loading ? "正在发起请求..." : "发送请求 (单页测试)"}
                </Button>
              </div>

              {/* 如果是 social/following 接口，提供连续抓取与全量导出助手 */}
              {isFollowingEndpoint && (
                <div className="api-debugger-batch-box">
                  <div className="api-debugger-batch-header">
                    <span>
                      <DownloadOutlined style={{ marginRight: 6 }} />
                      全量关注者抓取与导出助手
                    </span>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      自动多页翻页拉取
                    </Text>
                  </div>

                  <div className="api-debugger-batch-controls">
                    <span style={{ fontSize: 12, color: "#374151" }}>最大抓取上限:</span>
                    <Select
                      size="small"
                      value={batchMaxLimit}
                      onChange={(val) => setBatchMaxLimit(val)}
                      style={{ width: 140 }}
                      options={[
                        { label: "100 人 (约 2 页)", value: 100 },
                        { label: "500 人 (约 10 页)", value: 500 },
                        { label: "1,000 人 (约 20 页)", value: 1000 },
                        { label: "2,000 人 (约 40 页)", value: 2000 },
                        { label: "全部 (上限 1 万人)", value: 10000 },
                      ]}
                    />

                    {!batchFetching ? (
                      <Button
                        type="primary"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={handleStartBatchFollowingFetch}
                      >
                        开始全量抓取
                      </Button>
                    ) : (
                      <Button
                        danger
                        size="small"
                        icon={<PauseCircleOutlined />}
                        onClick={handleStopBatchFollowingFetch}
                      >
                        停止抓取
                      </Button>
                    )}
                  </div>

                  {batchFetching && (
                    <div className="api-debugger-batch-progress">
                      <div className="api-debugger-batch-progress-text">
                        <span>正在抓取第 {batchStats.page} 页...</span>
                        <span>已累计获取 {batchProfiles.length} 位关注者</span>
                      </div>
                      <Progress
                        percent={
                          batchMaxLimit > 0
                            ? Math.min(100, Math.round((batchProfiles.length / batchMaxLimit) * 100))
                            : 50
                        }
                        status="active"
                        size="small"
                      />
                    </div>
                  )}

                  {batchProfiles.length > 0 && (
                    <div className="api-debugger-export-actions">
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>
                        已获取 {batchProfiles.length} 人:
                      </span>
                      <Button
                        size="small"
                        className="api-debugger-export-csv-btn"
                        icon={<FileExcelOutlined />}
                        onClick={() =>
                          exportProfilesToCsv(
                            batchProfiles,
                            lookupTargetProfile?.handler || String(params.user_id || "target")
                          )
                        }
                      >
                        导出为 CSV (Excel)
                      </Button>
                      <Button
                        size="small"
                        icon={<FileTextOutlined />}
                        onClick={() =>
                          exportProfilesToJson(
                            batchProfiles,
                            lookupTargetProfile?.handler || String(params.user_id || "target")
                          )
                        }
                      >
                        导出为 JSON
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setShowPreviewTable(!showPreviewTable)}
                      >
                        {showPreviewTable ? "收起表格预览" : "查看数据表格"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
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

              {/* 如果单次请求返回了关注列表，提供单页快速导出条 */}
              {isFollowingEndpoint && singleResponseProfiles.length > 0 && (
                <div className="api-debugger-inline-export">
                  <span>
                    <CheckCircleOutlined style={{ marginRight: 6 }} />
                    当前单页响应中包含 {singleResponseProfiles.length} 条关注者数据
                  </span>
                  <Space size={6}>
                    <Button
                      size="small"
                      type="primary"
                      className="api-debugger-export-csv-btn"
                      icon={<FileExcelOutlined />}
                      onClick={() =>
                        exportProfilesToCsv(
                          singleResponseProfiles,
                          lookupTargetProfile?.handler || String(params.user_id || "single_page")
                        )
                      }
                    >
                      导出当前页 CSV
                    </Button>
                    <Button
                      size="small"
                      icon={<FileTextOutlined />}
                      onClick={() =>
                        exportProfilesToJson(
                          singleResponseProfiles,
                          lookupTargetProfile?.handler || String(params.user_id || "single_page")
                        )
                      }
                    >
                      导出当前页 JSON
                    </Button>
                  </Space>
                </div>
              )}

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

          {/* 如果展示预览表格，且有批量抓取的数据 */}
          {isFollowingEndpoint && showPreviewTable && batchProfiles.length > 0 && (
            <Card
              size="small"
              title={`关注者数据预览 (共 ${batchProfiles.length} 条)`}
              extra={
                <Space>
                  <Button
                    size="small"
                    className="api-debugger-export-csv-btn"
                    icon={<FileExcelOutlined />}
                    onClick={() =>
                      exportProfilesToCsv(
                        batchProfiles,
                        lookupTargetProfile?.handler || String(params.user_id || "target")
                      )
                    }
                  >
                    导出 CSV
                  </Button>
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() =>
                      exportProfilesToJson(
                        batchProfiles,
                        lookupTargetProfile?.handler || String(params.user_id || "target")
                      )
                    }
                  >
                    导出 JSON
                  </Button>
                </Space>
              }
              style={{ marginTop: 12 }}
            >
              <Table
                dataSource={batchProfiles.map((p, idx) => ({ ...p, key: p.id || String(idx) }))}
                columns={previewColumns}
                pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 位关注者` }}
                size="small"
                scroll={{ x: 800 }}
              />
            </Card>
          )}
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
                现已集成 <Text code>Handler 自动转换 Twitter ID</Text> 及全量关注列表导出功能。
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
