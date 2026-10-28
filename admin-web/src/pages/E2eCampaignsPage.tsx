import { useState } from "react";
import { Alert, Avatar, Button, Card, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { DeleteOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { E2eDiagnosticsTab } from "@/components/e2e/E2eDiagnosticsTab";
import { E2eSettlementTab } from "@/components/e2e/E2eSettlementTab";
import { E2eScoringConfigCard } from "@/components/e2e/E2eScoringConfigCard";
import { E2ePublishAccessCard } from "@/components/e2e/E2ePublishAccessCard";
import { getApiErrorMessage } from "@/services/apiClient";
import {
  forceActivateCampaign,
  deleteCampaign,
  getCampaign,
  getCampaignPaymentStatus,
  listCampaignRecords,
  listCampaigns,
  updateCampaign,
  type E2eCampaign,
  type E2eCampaignDetail,
  type E2eCampaignRecord,
  type E2eCampaignStatus,
  type E2eCampaignUpdatePayload,
} from "@/services/e2e-campaigns";

const STATUS_OPTIONS: Array<{ value: E2eCampaignStatus; label: string }> = [
  { value: "pending", label: "待支付" },
  { value: "active", label: "进行中" },
  { value: "review", label: "待发奖" },
  { value: "complete", label: "已结束" },
];
const STATUS_TAG: Record<string, { text: string; color: string }> = {
  pending: { text: "待支付", color: "gold" },
  active: { text: "进行中", color: "green" },
  review: { text: "待发奖", color: "orange" },
  complete: { text: "已结束", color: "default" },
};
const TYPE_OPTIONS = [
  { value: "mindshare", label: "Mindshare（按积分占比分配）" },
  { value: "equal", label: "Equal（平均分配）" },
];
const LANG_OPTIONS = [
  { value: "all", label: "全部语言" },
  { value: "zh", label: "中文 (zh)" },
  { value: "cn", label: "中文 (cn)" },
  { value: "en", label: "English" },
];
const TARGET_OPTIONS = [
  { value: 50000, label: "Top 50K" },
  { value: 100000, label: "Top 100K" },
  { value: 200000, label: "Top 200K" },
  { value: -1, label: "Top 200K + 认证创作者" },
];
const TYPE_LABEL: Record<string, string> = { mindshare: "Mindshare", equal: "Equal" };
const LANG_LABEL: Record<string, string> = { all: "全部", zh: "中文 (zh)", cn: "中文 (cn)", en: "English" };
const FLAG_LABEL: Record<string, string> = { political: "政治", sexual: "色情", violence: "暴力", abusive: "辱骂" };

const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "-");
const formatAmount = (value?: number | null) => (value === undefined || value === null ? "-" : String(value));
const formatTarget = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return TARGET_OPTIONS.find((option) => option.value === value)?.label || `Top ${value.toLocaleString()}`;
};
const shortAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "-";
const tweetLink = (tweetId?: string | null, ownerHandle?: string | null) => {
  if (!tweetId) return null;
  return ownerHandle
    ? `https://x.com/${ownerHandle}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
};
export function E2eCampaignsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<E2eCampaignStatus | undefined>("active");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const [detailAddress, setDetailAddress] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "records" | "scoring" | "settlement" | "diagnostics">("info");
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(10);

  const [editing, setEditing] = useState<E2eCampaign | null>(null);
  const [activating, setActivating] = useState<E2eCampaign | null>(null);
  const [deleting, setDeleting] = useState<E2eCampaign | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [editForm] = Form.useForm();

  const query = useQuery({
    queryKey: ["e2e-campaigns", page, pageSize, statusFilter, keyword],
    queryFn: () => listCampaigns({ page, pageSize, status: statusFilter, keyword: keyword || undefined }),
  });
  const refresh = () => void query.refetch();
  const invalidateAll = () => void queryClient.invalidateQueries({ queryKey: ["e2e-campaigns"] });

  const detailQuery = useQuery({
    queryKey: ["e2e-campaigns", "detail", detailAddress],
    queryFn: () => (detailAddress ? getCampaign(detailAddress) : Promise.reject(new Error("No address"))),
    enabled: Boolean(detailAddress),
  });
  const recordsQuery = useQuery({
    queryKey: ["e2e-campaigns", "records", detailAddress, recordPage, recordPageSize],
    queryFn: () =>
      detailAddress
        ? listCampaignRecords(detailAddress, recordPage, recordPageSize)
        : Promise.reject(new Error("No address")),
    enabled: Boolean(detailAddress) && detailTab === "records",
  });
  const paymentStatusQuery = useQuery({
    queryKey: ["e2e-campaigns", "payment-status", detailAddress],
    queryFn: () => detailAddress
      ? getCampaignPaymentStatus(detailAddress)
      : Promise.reject(new Error("No address")),
    enabled: false,
    retry: false,
  });

  const applyDetail = (address: string, detail: E2eCampaignDetail) => {
    queryClient.setQueryData(["e2e-campaigns", "detail", address], { success: true, data: detail });
    invalidateAll();
  };

  const update = useMutation({
    mutationFn: ({ address, body }: { address: string; body: E2eCampaignUpdatePayload }) =>
      updateCampaign(address, body),
    onSuccess: (res, variables) => {
      messageApi.success("已保存");
      setEditing(null);
      if (res.data) applyDetail(variables.address, res.data);
      else invalidateAll();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });

  const forceActivate = useMutation({
    mutationFn: (address: string) => forceActivateCampaign(address),
    onSuccess: (res, address) => {
      messageApi.success("已跳过支付校验，活动已进入进行中");
      setActivating(null);
      if (res.data) applyDetail(address, res.data);
      else invalidateAll();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: ({ address, confirmation }: { address: string; confirmation: string }) =>
      deleteCampaign(address, confirmation),
    onSuccess: (_, variables) => {
      messageApi.success("E2E 任务已删除");
      if (detailAddress === variables.address) setDetailAddress(null);
      if (editing?.address === variables.address) setEditing(null);
      if (activating?.address === variables.address) setActivating(null);
      setDeleting(null);
      setDeleteConfirmation("");
      queryClient.removeQueries({ queryKey: ["e2e-campaigns", "detail", variables.address] });
      if (campaigns.length === 1 && page > 1) setPage((current) => Math.max(1, current - 1));
      invalidateAll();
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });

  const openDelete = (row: E2eCampaign) => {
    setDeleting(row);
    setDeleteConfirmation("");
  };

  const openDetail = (row: E2eCampaign) => {
    setDetailAddress(row.address);
    setDetailTab("info");
    setRecordPage(1);
  };

  const openEdit = (row: E2eCampaign) => {
    if (row.status !== "pending" && row.status !== "active") return;
    setEditing(row);
    editForm.setFieldsValue({
      rewards: row.rewards ?? undefined,
      fees: row.fees ?? undefined,
      target: row.target ?? undefined,
      winners: row.winners ?? undefined,
      type: row.type || "mindshare",
      lang: row.lang || "all",
      retro: Boolean(row.retro),
      startTime: toLocalInput(row.startTime),
      endTime: toLocalInput(row.endTime),
    });
  };

  const submitEdit = (values: Record<string, unknown>) => {
    if (!editing) return;
    const payload: E2eCampaignUpdatePayload = {};
    if (values.endTime) payload.endTime = new Date(String(values.endTime)).toISOString();
    if (editing.status === "pending") {
      payload.target = values.target as number;
      payload.winners = values.winners as number;
      payload.type = values.type as E2eCampaignUpdatePayload["type"];
      payload.lang = values.lang as E2eCampaignUpdatePayload["lang"];
      payload.retro = Boolean(values.retro);
    }
    update.mutate({ address: editing.address, body: payload });
  };

  const campaigns = query.data?.data.list || [];
  const pagination = query.data?.data.pagination;
  const statusCounts = query.data?.data.statusCounts;
  const detail = detailQuery.data?.data;
  const detailCampaign = detail?.campaign;
  const detailTweet = detail?.tweet;
  const detailStats = detail?.stats;
  const paymentStatus = paymentStatusQuery.data?.data;

  const columns = [
    {
      title: "活动推文", key: "tweet", width: 300,
      render: (_: unknown, row: E2eCampaign) => {
        const link = tweetLink(row.tweetId, row.ownerHandle);
        return (
          <Space align="start" size={8}>
            <Avatar src={row.ownerImageUrl || undefined} size={36}>
              {(row.ownerHandle || "?")[0]?.toUpperCase()}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <Space size={6}>
                <Typography.Text strong>@{row.ownerHandle || "-"}</Typography.Text>
                {link && (
                  <Tooltip title="在 X 上查看">
                    <Typography.Link href={link} target="_blank" rel="noreferrer">
                      <LinkOutlined />
                    </Typography.Link>
                  </Tooltip>
                )}
              </Space>
              <Typography.Text type="secondary" ellipsis={{ tooltip: row.summaryCn || row.text }} style={{ fontSize: 12, maxWidth: 200, display: "block" }}>
                {row.summaryCn || row.text || "-"}
              </Typography.Text>
            </div>
          </Space>
        );
      },
    },
    {
      title: "状态", dataIndex: "status", width: 90,
      render: (value: string) => {
        const tag = STATUS_TAG[value] || { text: value || "-", color: "default" };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      },
    },
    {
      title: "奖池 / 服务费 / 应付", key: "amounts", width: 150,
      render: (_: unknown, row: E2eCampaign) => (
        <>
          <Typography.Text>奖池 {formatAmount(row.rewards)}</Typography.Text>
          <br />
          <Typography.Text type="secondary">服务费 {formatAmount(row.fees)}</Typography.Text>
          <br />
          <Typography.Text strong>应付 {formatAmount(row.depositRewards)}</Typography.Text>
        </>
      ),
    },
    {
      title: "门槛 / 获奖人数", key: "rules", width: 110,
      render: (_: unknown, row: E2eCampaign) => `${formatTarget(row.target)} / ${row.winners ?? "-"}`,
    },
    {
      title: "时间", key: "time", width: 175,
      render: (_: unknown, row: E2eCampaign) => (
        <>
          {row.startTime ? new Date(row.startTime).toLocaleString() : "未设开始"}
          <br />
          {row.endTime ? `至 ${new Date(row.endTime).toLocaleString()}` : "未设结束"}
        </>
      ),
    },
    {
      title: "参与人数", dataIndex: "participantCount", width: 85,
      render: (value: number | undefined) => (
        <span style={{ fontWeight: (value || 0) > 0 ? 600 : 400, color: (value || 0) > 0 ? "#1677ff" : "#8c8c8c" }}>
          {value ?? 0}
        </span>
      ),
    },
    {
      title: "操作", width: 330, fixed: "right" as const,
      render: (_: unknown, row: E2eCampaign) => (
        <Space size={8}>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openDetail(row)}>
            详情
          </Button>
          {(row.status === "pending" || row.status === "active") && (
            <Button size="small" onClick={() => openEdit(row)}>
              {row.status === "active" ? "调整结束时间" : "编辑"}
            </Button>
          )}
          {row.status === "pending" && (
            <Button size="small" type="primary" ghost onClick={() => setActivating(row)}>
              确认已支付
            </Button>
          )}
          {row.status === "review" && (
            <Button size="small" type="primary" ghost onClick={() => { openDetail(row); setDetailTab("settlement"); }}>
              审核发奖
            </Button>
          )}
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            style={{ padding: 0 }}
            onClick={() => openDelete(row)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const recordColumns = [
    {
      title: "用户", key: "user", width: 210,
      render: (_: unknown, record: E2eCampaignRecord) => (
        <Space align="start" size={8}>
          <Avatar src={record.profileImageUrl || undefined} size={32}>
            {(record.name || record.username || "U")[0]?.toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>@{record.username || "-"}</div>
            {record.name && <div style={{ fontSize: 11, color: "#8c8c8c" }}>{record.name}</div>}
          </div>
        </Space>
      ),
    },
    {
      title: "粉丝排名", dataIndex: "fanRank", width: 85,
      render: (value: number | null) => (value ? `#${value}` : "-"),
    },
    {
      title: "钱包地址", dataIndex: "userAddress", width: 160,
      render: (value: string | null) =>
        value ? (
          <Typography.Text copyable={{ text: value }} code style={{ fontSize: 12 }}>
            {shortAddress(value)}
          </Typography.Text>
        ) : "-",
    },
    {
      title: "积分", dataIndex: "point", width: 90,
      render: (value: number | null, record: E2eCampaignRecord) =>
        record.explanation ? (
          <Tooltip title={record.explanation}>{formatAmount(value)}</Tooltip>
        ) : (
          formatAmount(value)
        ),
    },
    {
      title: "奖励", dataIndex: "rewards", width: 110,
      render: (value: number | null) => formatAmount(value),
    },
    {
      title: "报名 / 更新时间", key: "time", width: 175,
      render: (_: unknown, record: E2eCampaignRecord) => (
        <>
          {formatTime(record.createTime)}
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            更新 {formatTime(record.updateTime)}
          </Typography.Text>
        </>
      ),
    },
  ];

  const activeFlags = detailTweet
    ? Object.entries(detailTweet.flags || {}).filter(([, value]) => value).map(([key]) => key)
    : [];

  return <PermissionGuard permission="e2e-campaigns"><PageSection title="E2E 活动管理" description="查看抓取与评分依据，审核不可变获奖名单，并在管理员确认后触发 E2E V2 链上分发。"><>{contextHolder}
    <Space size={8} wrap style={{ marginBottom: 12 }} role="group" aria-label="活动状态筛选">
      <Button
        type={statusFilter === undefined ? "primary" : "default"}
        aria-pressed={statusFilter === undefined}
        onClick={() => { setStatusFilter(undefined); setPage(1); }}
      >
        全部 {statusCounts?.total ?? 0}
      </Button>
      {STATUS_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          type={statusFilter === opt.value ? "primary" : "default"}
          aria-pressed={statusFilter === opt.value}
          onClick={() => { setStatusFilter(opt.value); setPage(1); }}
        >
          {opt.label} {statusCounts?.[opt.value] ?? 0}
        </Button>
      ))}
    </Space>
    <Card title="活动列表" style={{ marginBottom: 12 }} extra={<Space wrap>
      <Input.Search
        allowClear
        placeholder="搜索地址 / 作者 / 推文内容"
        style={{ width: 220 }}
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        onSearch={(value) => { setKeyword(value.trim()); setPage(1); }}
      />
      <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
    </Space>}>
      {query.isLoading ? <div style={{ padding: 48, textAlign: "center" }}><Spin /></div> : <Table rowKey="address" size="small" columns={columns} dataSource={campaigns} scroll={{ x: 1260 }} pagination={{
        current: page,
        pageSize,
        total: pagination?.total || 0,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条`,
        onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
      }} />}
    </Card>
    <E2ePublishAccessCard />
    <Collapse
      style={{ marginTop: 12 }}
      items={[{
        key: "global-scoring-config",
        label: <Space wrap size={8}>
          <Typography.Text strong>全局默认评分参数</Typography.Text>
          <Typography.Text type="secondary">仅影响之后新建的活动</Typography.Text>
        </Space>,
        children: <E2eScoringConfigCard global />,
      }]}
    />

    <Drawer
      open={Boolean(detailAddress)}
      width={1180}
      title={
        <Space size={8}>
          <span>活动详情</span>
          <Typography.Text copyable={{ text: detailAddress || "" }} code style={{ fontSize: 12 }}>
            {shortAddress(detailAddress)}
          </Typography.Text>
        </Space>
      }
      onClose={() => setDetailAddress(null)}
      destroyOnClose
    >
      <Tabs
        activeKey={detailTab}
        onChange={(key) => setDetailTab(key as "info" | "records" | "scoring" | "settlement" | "diagnostics")}
        items={[
          {
            key: "info",
            label: "活动信息",
            children: detailQuery.isLoading ? (
              <div style={{ padding: 48, textAlign: "center" }}><Spin /></div>
            ) : detailCampaign ? (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card
                  size="small"
                  title="充值状态"
                  extra={<Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={paymentStatusQuery.isFetching}
                    onClick={() => void paymentStatusQuery.refetch()}
                  >
                    查询 E2E V2
                  </Button>}
                >
                  {paymentStatusQuery.isError ? (
                    <Alert
                      type="error"
                      showIcon
                      message="充值状态查询失败"
                      description={getApiErrorMessage(paymentStatusQuery.error)}
                    />
                  ) : paymentStatus ? (
                    <Descriptions size="small" column={4}>
                      <Descriptions.Item label="到账">
                        <Tag color={paymentStatus.paid ? "green" : "gold"}>{paymentStatus.paid ? "已支付" : "待支付"}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="资金状态">
                        <Tag color={paymentStatus.funded ? "green" : "default"}>{paymentStatus.funded ? "已入账" : "未入账"}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="订单金额">{paymentStatus.requiredAmount} USDC</Descriptions.Item>
                      <Descriptions.Item label="余额">{paymentStatus.balance ?? "-"}</Descriptions.Item>
                      <Descriptions.Item label="查询时间" span={2}>{formatTime(paymentStatus.checkedAt)}</Descriptions.Item>
                      <Descriptions.Item label="服务返回" span={2}>{paymentStatus.message || "-"}</Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Typography.Text type="secondary">点击“查询 E2E V2”获取支付订单的实时到账状态。</Typography.Text>
                  )}
                </Card>
                <Descriptions bordered size="small" column={2} title="活动配置">
                  <Descriptions.Item label="活动地址" span={2}>
                    <Typography.Text copyable code style={{ fontSize: 12 }}>{detailCampaign.address}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={STATUS_TAG[detailCampaign.status || ""]?.color}>{STATUS_TAG[detailCampaign.status || ""]?.text || detailCampaign.status || "-"}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="分配方式">{TYPE_LABEL[detailCampaign.type || ""] || detailCampaign.type || "-"}</Descriptions.Item>
                  <Descriptions.Item label="语言">{LANG_LABEL[detailCampaign.lang || ""] || detailCampaign.lang || "-"}</Descriptions.Item>
                  <Descriptions.Item label="追溯历史数据 (retro)">
                    {detailCampaign.retro ? <Tag color="blue">开启</Tag> : <Tag>关闭</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="奖池">{formatAmount(detailCampaign.rewards)}</Descriptions.Item>
                  <Descriptions.Item label="服务费">{formatAmount(detailCampaign.fees)}</Descriptions.Item>
                  <Descriptions.Item label="应付总额 (depositRewards)">{formatAmount(detailCampaign.depositRewards)}</Descriptions.Item>
                  <Descriptions.Item label="参与门槛（XHunt 排名）">{formatTarget(detailCampaign.target)}</Descriptions.Item>
                  <Descriptions.Item label="获奖人数">{detailCampaign.winners ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="参与人数">{detailCampaign.participantCount ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="开始时间">{formatTime(detailCampaign.startTime)}</Descriptions.Item>
                  <Descriptions.Item label="结束时间">{formatTime(detailCampaign.endTime)}</Descriptions.Item>
                  <Descriptions.Item label="发放名单提交交易 (completeTx)" span={2}>
                    {detailCampaign.completeTx ? (
                      <Typography.Text copyable code style={{ fontSize: 12 }}>{detailCampaign.completeTx}</Typography.Text>
                    ) : "-"}
                  </Descriptions.Item>
                </Descriptions>

                <Descriptions bordered size="small" column={2} title="推文信息">
                  <Descriptions.Item label="推文作者" span={2}>
                    <Space size={8}>
                      <Avatar src={(detailTweet?.ownerImageUrl || detailCampaign.ownerImageUrl) || undefined} size={24}>
                        {((detailTweet?.ownerHandle || detailCampaign.ownerHandle || "?")[0] || "?").toUpperCase()}
                      </Avatar>
                      <span>@{(detailTweet?.ownerHandle || detailCampaign.ownerHandle) || "-"}</span>
                      {tweetLink(detailCampaign.tweetId, detailTweet?.ownerHandle || detailCampaign.ownerHandle) && (
                        <Typography.Link href={tweetLink(detailCampaign.tweetId, detailTweet?.ownerHandle || detailCampaign.ownerHandle)!} target="_blank" rel="noreferrer">
                          X 外链 <LinkOutlined />
                        </Typography.Link>
                      )}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="推文 ID" span={2}>
                    {detailCampaign.tweetId ? <Typography.Text code style={{ fontSize: 12 }}>{detailCampaign.tweetId}</Typography.Text> : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="正文 (text)" span={2}>
                    <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ margin: 0 }}>
                      {detailTweet?.text || detailCampaign.text || "-"}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                  <Descriptions.Item label="中文摘要 (summaryCn)" span={2}>
                    <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ margin: 0 }}>
                      {detailTweet?.summaryCn || detailCampaign.summaryCn || "-"}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                  <Descriptions.Item label="英文摘要 (summaryEn)" span={2}>
                    <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ margin: 0 }}>
                      {detailTweet?.summaryEn || detailCampaign.summaryEn || "-"}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                  <Descriptions.Item label="AI 审核">
                    {detailTweet?.passed === null || detailTweet?.passed === undefined ? "-" : detailTweet.passed ? <Tag color="green">通过</Tag> : <Tag color="red">未通过</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="审核标记 (flags)">
                    {activeFlags.length > 0 ? (
                      <Space size={4} wrap>
                        {activeFlags.map((flag) => <Tag key={flag} color="red">{FLAG_LABEL[flag] || flag}</Tag>)}
                      </Space>
                    ) : <Tag color="green">无</Tag>}
                  </Descriptions.Item>
                  {detailTweet?.explanation && (
                    <Descriptions.Item label="审核说明" span={2}>
                      <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ margin: 0, fontSize: 12 }}>
                        {detailTweet.explanation}
                      </Typography.Paragraph>
                    </Descriptions.Item>
                  )}
                </Descriptions>

                {detailStats && (
                  <Descriptions bordered size="small" column={2} title="参与统计">
                    <Descriptions.Item label="参与人数">{detailStats.participantCount}</Descriptions.Item>
                    <Descriptions.Item label="总积分">{formatAmount(detailStats.totalPoints)}</Descriptions.Item>
                    <Descriptions.Item label="已分配奖励">{formatAmount(detailStats.allocatedRewards)}</Descriptions.Item>
                    <Descriptions.Item label="获奖记录数">{detailStats.winnerCount}</Descriptions.Item>
                  </Descriptions>
                )}
              </Space>
            ) : (
              <Typography.Text type="secondary">未找到活动详情</Typography.Text>
            ),
          },
          {
            key: "records",
            label: `报名排行 (${recordsQuery.data?.data.pagination.total ?? 0})`,
            children: (
              <Table
                rowKey="userId"
                size="small"
                loading={recordsQuery.isLoading}
                columns={recordColumns}
                dataSource={recordsQuery.data?.data.list || []}
                pagination={{
                  current: recordPage,
                  pageSize: recordPageSize,
                  total: recordsQuery.data?.data.pagination.total || 0,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                  onChange: (p, ps) => { setRecordPage(p); setRecordPageSize(ps); },
                }}
              />
            ),
          },
          {
            key: "scoring",
            label: "评分规则",
            children: detailAddress && detailCampaign ? <E2eScoringConfigCard address={detailAddress} status={detailCampaign.status} config={detailCampaign.scoreConfig} /> : null,
          },
          {
            key: "settlement",
            label: "结算审核",
            children: detailAddress ? <E2eSettlementTab address={detailAddress} campaignStatus={detailCampaign?.status} /> : null,
          },
          {
            key: "diagnostics",
            label: "抓取与算分",
            children: detailAddress ? <E2eDiagnosticsTab address={detailAddress} /> : null,
          },
        ]}
      />
    </Drawer>

    <Modal
      open={Boolean(editing)}
      title={editing?.status === "active" ? "调整活动结束时间" : "编辑活动"}
      width={640}
      onCancel={() => setEditing(null)}
      onOk={() => editForm.submit()}
      confirmLoading={update.isPending}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={editForm} layout="vertical" onFinish={submitEdit} size="middle">
        {editing?.status === "active" && (
          <>
            <Alert
              type="info"
              showIcon
              message="活动已开始，核心配置已锁定"
              description="为避免改变已报名用户的参与与奖励规则，当前仅允许延长或调整结束时间。"
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered size="small" column={2} title="已锁定配置" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="奖池">{formatAmount(editing.rewards)}</Descriptions.Item>
              <Descriptions.Item label="服务费">{formatAmount(editing.fees)}</Descriptions.Item>
              <Descriptions.Item label="参与门槛">{formatTarget(editing.target)}</Descriptions.Item>
              <Descriptions.Item label="获奖人数">{editing.winners ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="分配方式">{TYPE_LABEL[editing.type || ""] || editing.type || "-"}</Descriptions.Item>
              <Descriptions.Item label="语言">{LANG_LABEL[editing.lang || ""] || editing.lang || "-"}</Descriptions.Item>
              <Descriptions.Item label="追溯历史数据">{editing.retro ? "开启" : "关闭"}</Descriptions.Item>
              <Descriptions.Item label="开始时间">{formatTime(editing.startTime)}</Descriptions.Item>
            </Descriptions>
          </>
        )}
        {editing?.status === "pending" && (
          <>
            <Alert
              type="warning"
              showIcon
              message="支付订单已创建，金额与开始时间已锁定"
              description="奖池和服务费必须与外部支付订单一致；开始时间将在支付确认并激活时自动生成。活动开始后，其他参与规则也会锁定。"
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered size="small" column={2} title="已锁定配置" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="奖池">{formatAmount(editing.rewards)}</Descriptions.Item>
              <Descriptions.Item label="服务费">{formatAmount(editing.fees)}</Descriptions.Item>
              <Descriptions.Item label="应付总额">{formatAmount(editing.depositRewards)}</Descriptions.Item>
              <Descriptions.Item label="开始时间">支付确认后自动生成</Descriptions.Item>
            </Descriptions>
            <Space.Compact block>
              <Form.Item name="target" label="参与门槛（XHunt 排名）" rules={[{ required: true, message: "必选" }]} style={{ width: "50%", marginRight: 8 }}>
                <Select options={TARGET_OPTIONS} placeholder="请选择参与门槛" />
              </Form.Item>
              <Form.Item name="winners" label="获奖人数" rules={[{ required: true, message: "必填" }]} style={{ width: "50%" }}>
                <InputNumber min={1} max={200} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Space.Compact>
            <Space.Compact block>
              <Form.Item name="type" label="分配方式" rules={[{ required: true, message: "必选" }]} style={{ width: "50%", marginRight: 8 }}>
                <Select options={TYPE_OPTIONS} />
              </Form.Item>
              <Form.Item name="lang" label="语言范围" rules={[{ required: true, message: "必选" }]} style={{ width: "50%" }}>
                <Select options={LANG_OPTIONS} />
              </Form.Item>
            </Space.Compact>
            <Form.Item name="retro" label="追溯历史数据（retro）" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="endTime"
          label="结束时间"
          dependencies={["startTime"]}
          rules={[
            { required: true, message: "请选择结束时间" },
            ({ getFieldValue }) => ({
              validator: async (_, value) => {
                const start = getFieldValue("startTime") || toLocalInput(editing?.startTime);
                if (value && start && new Date(String(value)).getTime() <= new Date(String(start)).getTime()) {
                  throw new Error("结束时间必须晚于开始时间");
                }
              },
            }),
          ]}
        >
          <Input type="datetime-local" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      open={Boolean(activating)}
      title="确认已支付并开始活动"
      width={520}
      onCancel={() => setActivating(null)}
      onOk={() => activating && forceActivate.mutate(activating.address)}
      confirmLoading={forceActivate.isPending}
      okText="跳过校验并开始"
      okButtonProps={{ danger: true }}
      cancelText="取消"
      destroyOnClose
    >
      <Typography.Paragraph>
        此操作会跳过真实支付校验，直接将活动从「待支付」变为「进行中」，并从当前时间重新计算活动起止时间。
      </Typography.Paragraph>
      <Typography.Paragraph type="danger" strong>
        请仅在已人工确认收款或明确需要免支付投放时执行。
      </Typography.Paragraph>
      {activating && (
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="活动">@{activating.ownerHandle || "-"}</Descriptions.Item>
          <Descriptions.Item label="活动地址">
            <Typography.Text copyable code style={{ fontSize: 12 }}>{activating.address}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="应付总额">{formatAmount(activating.depositRewards)}</Descriptions.Item>
        </Descriptions>
      )}
    </Modal>

    <Modal
      open={Boolean(deleting)}
      title="永久删除 E2E 任务"
      width={600}
      onCancel={() => {
        if (remove.isPending) return;
        setDeleting(null);
        setDeleteConfirmation("");
      }}
      onOk={() => deleting && remove.mutate({
        address: deleting.address,
        confirmation: deleteConfirmation,
      })}
      confirmLoading={remove.isPending}
      okText="永久删除"
      okButtonProps={{
        danger: true,
        disabled: !deleting || deleteConfirmation !== deleting.address,
      }}
      cancelButtonProps={{ disabled: remove.isPending }}
      cancelText="取消"
      closable={!remove.isPending}
      maskClosable={false}
      destroyOnClose
    >
      <Alert
        type="error"
        showIcon
        message="此操作不可恢复"
        description="将永久删除该任务及其报名、互动、抓取、算分和结算数据。推文审核缓存会保留；E2E V2 外部支付订单、已支付资金和链上记录不会被删除或退款。"
        style={{ marginBottom: 16 }}
      />
      {deleting && (
        <>
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="推文作者">@{deleting.ownerHandle || "-"}</Descriptions.Item>
            <Descriptions.Item label="任务状态">
              <Tag color={STATUS_TAG[deleting.status || ""]?.color}>
                {STATUS_TAG[deleting.status || ""]?.text || deleting.status || "-"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="活动地址">
              <Typography.Text copyable code style={{ fontSize: 12 }}>{deleting.address}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            请输入完整活动地址以确认删除：
          </Typography.Paragraph>
          <Input
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={deleting.address}
            disabled={remove.isPending}
            status={deleteConfirmation && deleteConfirmation !== deleting.address ? "error" : undefined}
            autoComplete="off"
          />
        </>
      )}
    </Modal>

  </></PageSection></PermissionGuard>;
}
