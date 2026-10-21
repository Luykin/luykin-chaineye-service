import { useState } from "react";
import { Avatar, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { ApiError } from "@/services/apiClient";
import {
  completeCampaign,
  getCampaign,
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
const TYPE_LABEL: Record<string, string> = { mindshare: "Mindshare", equal: "Equal" };
const LANG_LABEL: Record<string, string> = { all: "全部", zh: "中文 (zh)", cn: "中文 (cn)", en: "English" };
const FLAG_LABEL: Record<string, string> = { political: "政治", sexual: "色情", violence: "暴力", abusive: "辱骂" };
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const AMOUNT_PATTERN = /^\d{1,10}(?:\.\d{1,6})?$/;

const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "-");
const formatAmount = (value?: number | null) => (value === undefined || value === null ? "-" : String(value));
const shortAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "-";
const tweetLink = (tweetId?: string | null, ownerHandle?: string | null) => {
  if (!tweetId) return null;
  return ownerHandle
    ? `https://x.com/${ownerHandle}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
};
const errorMessage = (error: Error) => {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "message" in error.data) {
    const backendMessage = (error.data as { message?: string }).message;
    if (backendMessage) return String(backendMessage);
  }
  return error.message;
};

export function E2eCampaignsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const [detailAddress, setDetailAddress] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "records">("info");
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(10);

  const [editing, setEditing] = useState<E2eCampaign | null>(null);
  const [completing, setCompleting] = useState<E2eCampaign | null>(null);
  const [editForm] = Form.useForm();
  const [completeForm] = Form.useForm();

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
    onError: (error: Error) => messageApi.error(errorMessage(error)),
  });

  const complete = useMutation({
    mutationFn: ({ address, txHash }: { address: string; txHash: string }) => completeCampaign(address, txHash),
    onSuccess: (res, variables) => {
      messageApi.success("已标记结算完成");
      setCompleting(null);
      if (res.data) applyDetail(variables.address, res.data);
      else invalidateAll();
    },
    onError: (error: Error) => messageApi.error(errorMessage(error)),
  });

  const openDetail = (row: E2eCampaign) => {
    setDetailAddress(row.address);
    setDetailTab("info");
    setRecordPage(1);
  };

  const openEdit = (row: E2eCampaign) => {
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
    const payload: E2eCampaignUpdatePayload = {
      target: values.target as number,
      winners: values.winners as number,
      type: values.type as E2eCampaignUpdatePayload["type"],
      lang: values.lang as E2eCampaignUpdatePayload["lang"],
      retro: Boolean(values.retro),
    };
    // 后端 startTime/endTime 不接受空值，留空时不提交该字段
    if (values.startTime) payload.startTime = new Date(String(values.startTime)).toISOString();
    if (values.endTime) payload.endTime = new Date(String(values.endTime)).toISOString();
    if (editing.status === "pending") {
      if (values.rewards !== undefined && values.rewards !== null && values.rewards !== "") payload.rewards = String(values.rewards);
      if (values.fees !== undefined && values.fees !== null && values.fees !== "") payload.fees = String(values.fees);
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
      render: (_: unknown, row: E2eCampaign) => `${row.target ? `Top ${row.target}` : "-"} / ${row.winners ?? "-"}`,
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
      title: "操作", width: 190, fixed: "right" as const,
      render: (_: unknown, row: E2eCampaign) => (
        <Space size={8}>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openDetail(row)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.status === "review" && (
            <Button size="small" type="primary" ghost onClick={() => { setCompleting(row); completeForm.resetFields(); }}>
              标记结算完成
            </Button>
          )}
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

  return <PermissionGuard permission="e2e-campaigns"><PageSection title="E2E 活动管理" description="管理 E2E 链上活动：查看活动配置与报名排行、编辑活动参数、在待发奖阶段标记结算完成。"><>{contextHolder}
    {statusCounts && (
      <Space size={8} wrap style={{ marginBottom: 12 }}>
        {STATUS_OPTIONS.map((opt) => (
          <Tag key={opt.value} color={STATUS_TAG[opt.value]?.color} style={{ marginRight: 0 }}>
            {opt.label} {statusCounts[opt.value] ?? 0}
          </Tag>
        ))}
        <Tag style={{ marginRight: 0 }}>总计 {statusCounts.total ?? 0}</Tag>
      </Space>
    )}
    <Card title="活动列表" extra={<Space wrap>
      <Select allowClear placeholder="状态" style={{ width: 110 }} options={STATUS_OPTIONS} value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1); }} />
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
      {query.isLoading ? <div style={{ padding: 48, textAlign: "center" }}><Spin /></div> : <Table rowKey="address" size="small" columns={columns} dataSource={campaigns} scroll={{ x: 1180 }} pagination={{
        current: page,
        pageSize,
        total: pagination?.total || 0,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条`,
        onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
      }} />}
    </Card>

    <Drawer
      open={Boolean(detailAddress)}
      width={760}
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
        onChange={(key) => setDetailTab(key as "info" | "records")}
        items={[
          {
            key: "info",
            label: "活动信息",
            children: detailQuery.isLoading ? (
              <div style={{ padding: 48, textAlign: "center" }}><Spin /></div>
            ) : detailCampaign ? (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
                  <Descriptions.Item label="参与门槛（XHunt 排名）">{detailCampaign.target ? `Top ${detailCampaign.target}` : "-"}</Descriptions.Item>
                  <Descriptions.Item label="获奖人数">{detailCampaign.winners ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="参与人数">{detailCampaign.participantCount ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="开始时间">{formatTime(detailCampaign.startTime)}</Descriptions.Item>
                  <Descriptions.Item label="结束时间">{formatTime(detailCampaign.endTime)}</Descriptions.Item>
                  <Descriptions.Item label="结算交易 (completeTx)" span={2}>
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
        ]}
      />
    </Drawer>

    <Modal
      open={Boolean(editing)}
      title="编辑活动"
      width={640}
      onCancel={() => setEditing(null)}
      onOk={() => editForm.submit()}
      confirmLoading={update.isPending}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={editForm} layout="vertical" onFinish={submitEdit} size="middle">
        {editing && editing.status !== "pending" && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, fontSize: 12, color: "#d48806" }}>
            当前活动状态为「{STATUS_TAG[editing.status || ""]?.text || editing.status}」，奖池与服务费已锁定（仅待支付状态可修改），本次保存不会提交这两项。
          </div>
        )}
        <Space.Compact block>
          <Form.Item
            name="rewards"
            label="奖池金额"
            rules={editing?.status === "pending" ? [
              { required: true, message: "必填" },
              { pattern: AMOUNT_PATTERN, message: "最多 10 位整数、6 位小数" },
            ] : []}
            style={{ width: "50%", marginRight: 8 }}
          >
            <Input placeholder="如 1000" disabled={editing?.status !== "pending"} />
          </Form.Item>
          <Form.Item
            name="fees"
            label="服务费"
            rules={editing?.status === "pending" ? [
              { required: true, message: "必填" },
              { pattern: AMOUNT_PATTERN, message: "最多 10 位整数、6 位小数，可为 0" },
            ] : []}
            style={{ width: "50%" }}
          >
            <Input placeholder="如 50，可为 0" disabled={editing?.status !== "pending"} />
          </Form.Item>
        </Space.Compact>
        <Space.Compact block>
          <Form.Item name="target" label="参与门槛（XHunt 排名）" rules={[{ required: true, message: "必填" }]} style={{ width: "50%", marginRight: 8 }}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
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
        <Space.Compact block>
          <Form.Item name="startTime" label="开始时间（留空则不修改）" style={{ width: "50%", marginRight: 8 }}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="endTime"
            label="结束时间（留空则不修改）"
            style={{ width: "50%" }}
            dependencies={["startTime"]}
            rules={[
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
        </Space.Compact>
      </Form>
    </Modal>

    <Modal
      open={Boolean(completing)}
      title="标记结算完成"
      width={520}
      onCancel={() => setCompleting(null)}
      onOk={() => completeForm.submit()}
      confirmLoading={complete.isPending}
      okText="确认完成"
      cancelText="取消"
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        确认链上奖励已发放后，填写结算交易哈希将活动标记为已结束（complete）。仅待发奖（review）状态的活动可执行此操作。
      </Typography.Paragraph>
      <Form
        form={completeForm}
        layout="vertical"
        onFinish={(values) => completing && complete.mutate({ address: completing.address, txHash: String(values.txHash).trim() })}
      >
        <Form.Item
          name="txHash"
          label="结算交易哈希"
          rules={[
            { required: true, message: "请输入交易哈希" },
            { pattern: TX_HASH_PATTERN, message: "格式应为 0x 开头的 64 位十六进制字符" },
          ]}
        >
          <Input placeholder="0x..." allowClear />
        </Form.Item>
      </Form>
    </Modal>
  </></PageSection></PermissionGuard>;
}
