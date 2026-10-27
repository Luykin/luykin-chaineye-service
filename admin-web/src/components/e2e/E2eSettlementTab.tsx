import { useState } from "react";
import { Alert, Avatar, Button, Card, Col, Descriptions, Empty, Input, Modal, Popconfirm, Row, Space, Spin, Statistic, Steps, Table, Tag, Typography, message } from "antd";
import { CheckCircleOutlined, ReloadOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/services/apiClient";
import {
  approveCampaignSettlement,
  distributeCampaignSettlement,
  getCampaignSettlement,
  recalculateCampaignSettlement,
  refreshCampaignSettlement,
  setSettlementItemExclusion,
  type E2eSettlementItem,
} from "@/services/e2e-campaigns";

const statusMeta: Record<string, { text: string; color: string }> = {
  draft: { text: "待审核", color: "orange" },
  approved: { text: "名单已确认", color: "blue" },
  submitting: { text: "提交中", color: "processing" },
  submitted: { text: "链上确认中", color: "processing" },
  confirmed: { text: "已实际发放", color: "green" },
  completed_no_payout: { text: "无需发奖，已完成", color: "green" },
  failed: { text: "交易失败", color: "red" },
};

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "-";
const shortAddress = (value?: string | null) => value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "-";
const addHours = (value: string | null, hours: number) => {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp + hours * 60 * 60 * 1000).toISOString() : null;
};

export function E2eSettlementTab({ address, campaignStatus }: { address: string; campaignStatus?: string | null }) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [exclusionItem, setExclusionItem] = useState<E2eSettlementItem | null>(null);
  const [reason, setReason] = useState("");
  const queryKey = ["e2e-campaigns", "settlement", address];
  const query = useQuery({ queryKey, queryFn: () => getCampaignSettlement(address) });
  const settlement = query.data?.data;
  const refreshQueries = (data?: unknown) => {
    if (data) queryClient.setQueryData(queryKey, { success: true, data });
    void queryClient.invalidateQueries({ queryKey: ["e2e-campaigns"] });
  };
  const mutationOptions = (successText: string) => ({
    onSuccess: (response: { data: unknown }) => { messageApi.success(successText); refreshQueries(response.data); },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const recalculate = useMutation({ mutationFn: () => recalculateCampaignSettlement(address), ...mutationOptions("已生成新的结算版本") });
  const approve = useMutation({
    mutationFn: () => approveCampaignSettlement(address),
    onSuccess: (response) => {
      const noPayout = response.data.status === "completed_no_payout";
      messageApi.success(noPayout ? "当前没有可发奖用户，活动已直接完成" : "获奖名单已确认并锁定");
      refreshQueries(response.data);
    },
    onError: (error: Error) => messageApi.error(getApiErrorMessage(error)),
  });
  const distribute = useMutation({ mutationFn: () => distributeCampaignSettlement(address), ...mutationOptions("分发请求已提交") });
  const refresh = useMutation({ mutationFn: () => refreshCampaignSettlement(address), ...mutationOptions("交易状态已刷新") });
  const exclusion = useMutation({
    mutationFn: ({ item, nextExcluded, exclusionReason }: { item: E2eSettlementItem; nextExcluded: boolean; exclusionReason?: string }) =>
      setSettlementItemExclusion(address, item.id, nextExcluded, exclusionReason),
    ...mutationOptions("已生成新的审核版本"),
    onSuccess: (response) => {
      messageApi.success("已生成新的审核版本");
      setExclusionItem(null);
      setReason("");
      refreshQueries(response.data);
    },
  });

  if (query.isLoading) return <div style={{ padding: 48, textAlign: "center" }}><Spin /></div>;
  if (!settlement) return <Empty description="尚未生成结算草稿"><Button type="primary" disabled={campaignStatus !== "review"} loading={recalculate.isPending} onClick={() => recalculate.mutate()}>生成结算草稿</Button></Empty>;

  const walletCounts = new Map<string, number>();
  const winnerRecipients = new Map<string, { users: string[]; amount: number }>();
  settlement.items.filter((item) => item.isWinner && !item.excluded && item.payoutAddress).forEach((item) => {
    const key = item.payoutAddress!.toLowerCase();
    walletCounts.set(key, (walletCounts.get(key) || 0) + 1);
    const current = winnerRecipients.get(key) || { users: [], amount: 0 };
    current.users.push(`@${item.username || item.userId}`);
    current.amount += Number(item.rewardAmount || 0);
    winnerRecipients.set(key, current);
  });
  const locked = settlement.status !== "draft";
  const noPayout = settlement.status === "completed_no_payout";
  const hasWinners = settlement.items.some((item) => item.isWinner && !item.excluded && Number(item.rewardAmount || 0) > 0);
  const execution = settlement.distributionExecution;
  const payoutExecuted = execution?.phase === "executed";
  const chainVerifiedCompleted = payoutExecuted || settlement.completionSource === "chain_executed";
  const timeoutCompleted = settlement.status === "confirmed" && settlement.completionSource === "timeout_72h" && !chainVerifiedCompleted;
  const legacyCompleted = settlement.status === "confirmed" && !timeoutCompleted && !chainVerifiedCompleted;
  const payoutCompleted = timeoutCompleted || chainVerifiedCompleted || legacyCompleted;
  const distributionPollingEndsAt = addHours(settlement.submittedAt, 72);
  const payoutWaiting = execution?.phase === "waiting";
  const payoutExecutable = execution?.phase === "executable";
  const step = settlement.status === "draft"
    ? 0
    : settlement.status === "approved"
      ? 1
      : noPayout || payoutCompleted
        ? 3
        : 2;
  const meta = noPayout
    ? statusMeta.completed_no_payout
    : timeoutCompleted
      ? { text: "超过 3 天，自动完成", color: "orange" }
      : chainVerifiedCompleted
      ? { text: "已实际发放", color: "green" }
      : legacyCompleted
        ? { text: "已完成，待核验", color: "blue" }
      : payoutExecutable
        ? { text: "已到执行时间", color: "orange" }
        : payoutWaiting
          ? { text: "等待实际发放", color: "processing" }
          : statusMeta[settlement.status] || { text: settlement.status, color: "default" };
  const recipientSource = execution?.recipients?.length
    ? execution.recipients
    : settlement.distributionRecipients;
  const distributionRows = recipientSource.map((recipient) => {
    const winner = winnerRecipients.get(recipient.address.toLowerCase());
    return {
      key: recipient.address.toLowerCase(),
      address: recipient.address,
      amount: recipient.amount,
      type: winner ? "reward" : "fee",
      users: winner?.users || [],
    };
  });
  const columns = [
    {
      title: "排名 / 用户", key: "user", width: 210,
      render: (_: unknown, row: E2eSettlementItem) => <Space><Avatar src={row.profileImageUrl || undefined}>{(row.username || "U")[0]?.toUpperCase()}</Avatar><div><Typography.Text strong>{row.rank ? `#${row.rank} ` : ""}@{row.username || "-"}</Typography.Text><br/><Typography.Text type="secondary" style={{ fontSize: 12 }}>积分 {row.point}</Typography.Text></div></Space>,
    },
    {
      title: "收款地址", dataIndex: "payoutAddress", width: 190,
      render: (value: string | null) => value ? <Space size={4}><Typography.Text copyable={{ text: value }} code>{shortAddress(value)}</Typography.Text>{(walletCounts.get(value.toLowerCase()) || 0) > 1 && <Tag color="purple">合并发放 ×{walletCounts.get(value.toLowerCase())}</Tag>}</Space> : <Tag color="red">未填写</Tag>,
    },
    { title: "奖励 USDC", dataIndex: "rewardAmount", width: 120, render: (value: string, row: E2eSettlementItem) => row.isWinner ? <Typography.Text strong>{value}</Typography.Text> : "-" },
    { title: "状态", key: "state", width: 110, render: (_: unknown, row: E2eSettlementItem) => row.excluded ? <Tag color="red">已排除</Tag> : row.isWinner ? <Tag color="green">获奖</Tag> : <Tag>未入选</Tag> },
    { title: "排除原因", dataIndex: "exclusionReason", width: 180, ellipsis: true },
    {
      title: "审核", key: "action", width: 100, fixed: "right" as const,
      render: (_: unknown, row: E2eSettlementItem) => row.excluded
        ? <Popconfirm title="恢复后会重新排名并生成新版本，确认恢复？" onConfirm={() => exclusion.mutate({ item: row, nextExcluded: false })}><Button size="small" disabled={locked}>恢复</Button></Popconfirm>
        : <Button size="small" danger icon={<StopOutlined />} disabled={locked} onClick={() => { setExclusionItem(row); setReason(""); }}>排除</Button>,
    },
  ];

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    {contextHolder}
    {settlement.lastError && <Alert type="error" showIcon message="最近一次分发失败" description={settlement.lastError} />}
    {settlement.status === "draft" && !hasWinners && <Alert type="info" showIcon message="当前没有可发奖用户" description="管理员确认后，活动将直接标记为完成，不会调用链上分发接口。" />}
    {payoutWaiting && !payoutCompleted && <Alert type="info" showIcon message="发放名单已上链，正在等待执行窗口" description={<>当前交易只提交了待发放名单，USDC 尚未转出。最早可执行实际分发时间：<Typography.Text strong>{formatTime(execution?.earliestExecuteAt)}</Typography.Text></>} />}
    {payoutExecutable && !payoutCompleted && <Alert type="warning" showIcon message="已到最早执行时间，等待实际分发" description="发放名单已经过合约等待期，但链上尚未执行实际 USDC 转账。" />}
    {chainVerifiedCompleted && <Alert type="success" showIcon message="实际分发已执行" description="系统已取得链上合约执行发放名单的记录。" />}
    {timeoutCompleted && <Alert type="warning" showIcon message="超过 72 小时，系统已自动完成" description="系统在三天检查窗口内未确认链上实际分发，现已停止自动检查。此状态不代表 USDC 转账已经过链上验证，可通过“刷新交易状态”再次人工核验。" />}
    {legacyCompleted && <Alert type="info" showIcon message="历史完成记录待核验" description="该记录没有保存完成来源，不能仅凭当前状态确认 USDC 已实际转出。" />}
    {new Date(settlement.payoutDueAt).getTime() < Date.now() && !noPayout && !payoutCompleted && <Alert type="warning" showIcon message="已超过计划发奖截止时间" description={`截止时间：${formatTime(settlement.payoutDueAt)}`} />}
    <Card size="small" title={<Space><span>结算版本 R{settlement.revision}</span><Tag color={meta.color}>{meta.text}</Tag></Space>} extra={<Space wrap>
      <Popconfirm title="将按当前抓取数据重新算分并创建不可变的新版本，确认继续？" onConfirm={() => recalculate.mutate()}><Button icon={<ReloadOutlined />} loading={recalculate.isPending} disabled={locked}>重新计算</Button></Popconfirm>
      <Popconfirm title={hasWinners ? "确认后名单与金额将锁定，不能再排除或重新计算。确认名单无误？" : "当前没有可发奖用户。确认后活动将直接完成，且不会触发链上分发。确认继续？"} onConfirm={() => approve.mutate()}><Button type="primary" icon={<CheckCircleOutlined />} loading={approve.isPending} disabled={locked}>{hasWinners ? "确认获奖名单" : "确认无需发奖并完成"}</Button></Popconfirm>
      <Popconfirm title="将调用 E2E V2 /distribution 提交链上发奖，确认继续？" onConfirm={() => distribute.mutate()}><Button type="primary" danger icon={<SendOutlined />} loading={distribute.isPending} disabled={settlement.status !== "approved"}>触发分发</Button></Popconfirm>
      <Button loading={refresh.isPending} disabled={!['submitting','submitted','failed','confirmed'].includes(settlement.status)} onClick={() => refresh.mutate()}>刷新交易状态</Button>
    </Space>}>
      <Steps size="small" current={step} status={settlement.status === "failed" ? "error" : noPayout || payoutCompleted ? "finish" : "process"} items={[{ title: "结算草稿" }, { title: "管理员确认" }, { title: noPayout ? "无需分发" : "提交发放名单" }, { title: noPayout ? "活动完成" : timeoutCompleted ? "超时自动完成" : "实际发放完成" }]} />
    </Card>
    <Row gutter={[12, 12]}>
      <Col xs={12} md={6}><Card size="small"><Statistic title="奖池 USDC" value={settlement.rewardPool} /></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Statistic title="服务费 USDC" value={settlement.feeAmount} /></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Statistic title="支付订单总额" value={settlement.depositAmount} /></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Statistic title="获奖 / 排除" value={`${settlement.winnerCount} / ${settlement.excludedCount}`} /></Card></Col>
    </Row>
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="草稿生成">{formatTime(settlement.generatedAt)}</Descriptions.Item>
      <Descriptions.Item label="发奖截止">{formatTime(settlement.payoutDueAt)}</Descriptions.Item>
      <Descriptions.Item label="审核人">{settlement.approvedByEmail || "-"}</Descriptions.Item>
      <Descriptions.Item label="确认时间">{formatTime(settlement.approvedAt)}</Descriptions.Item>
      <Descriptions.Item label="唯一收款地址">{settlement.status === "draft" ? "确认名单时生成" : settlement.uniqueRecipientCount}</Descriptions.Item>
      <Descriptions.Item label="名单提交状态"><Tag color={settlement.distributionStatus === "failed" ? "red" : settlement.distributionStatus === "confirmed" ? "blue" : "processing"}>{settlement.distributionStatus === "not_required" ? "无需分发" : settlement.distributionStatus === "confirmed" ? "提交交易已确认" : settlement.distributionStatus}</Tag></Descriptions.Item>
      <Descriptions.Item label="实际分发状态"><Tag color={timeoutCompleted ? "orange" : chainVerifiedCompleted ? "green" : legacyCompleted ? "blue" : payoutExecutable ? "orange" : payoutWaiting ? "processing" : "default"}>{timeoutCompleted ? "超时完成，未验证" : chainVerifiedCompleted ? "已执行（链上已验证）" : legacyCompleted ? "已完成，待核验" : payoutExecutable ? "可执行，等待链上调用" : payoutWaiting ? "等待执行窗口" : noPayout ? "无需分发" : "待确认"}</Tag></Descriptions.Item>
      <Descriptions.Item label="最早可执行实际分发">{formatTime(execution?.earliestExecuteAt)}</Descriptions.Item>
      <Descriptions.Item label="合约等待期">{execution?.waitTimeSeconds ? `${execution.waitTimeSeconds / 3600} 小时` : "-"}</Descriptions.Item>
      <Descriptions.Item label="自动检查频率">每小时一次，最多 72 小时</Descriptions.Item>
      <Descriptions.Item label="自动检查截止">{formatTime(distributionPollingEndsAt)}</Descriptions.Item>
      <Descriptions.Item label="名单提交交易哈希" span={2}>{settlement.txHash ? <Typography.Text copyable code>{settlement.txHash}</Typography.Text> : "-"}</Descriptions.Item>
    </Descriptions>
    {distributionRows.length > 0 && <Card size="small" title={chainVerifiedCompleted ? "发放名单" : timeoutCompleted || legacyCompleted ? "计划发放名单（未验证）" : "待发放名单"} extra={<Space><Tag color={execution?.recipients?.length ? "blue" : "default"}>{execution?.recipients?.length ? "链上名单" : "已确认名单"}</Tag><Typography.Text type="secondary">共 {distributionRows.length} 个地址 / {settlement.depositAmount} USDC</Typography.Text></Space>}>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={distributionRows}
        columns={[
          { title: "类型", dataIndex: "type", width: 120, render: (value: string) => value === "fee" ? <Tag color="gold">服务费</Tag> : <Tag color="green">获奖奖励</Tag> },
          { title: "用户", dataIndex: "users", render: (users: string[], row) => row.type === "fee" ? <Typography.Text type="secondary">平台服务费</Typography.Text> : users.join("、") || "-" },
          { title: "收款地址", dataIndex: "address", width: 360, render: (value: string) => <Typography.Text copyable={{ text: value }} code>{value}</Typography.Text> },
          { title: "计划发放 USDC", dataIndex: "amount", width: 160, align: "right" as const, render: (value: string) => <Typography.Text strong>{Number(value).toFixed(6)}</Typography.Text> },
          { title: "状态", key: "status", width: 150, render: () => <Tag color={timeoutCompleted ? "orange" : chainVerifiedCompleted ? "green" : legacyCompleted ? "blue" : payoutExecutable ? "orange" : "processing"}>{timeoutCompleted ? "超时完成，未验证" : chainVerifiedCompleted ? "已执行" : legacyCompleted ? "已完成，待核验" : payoutExecutable ? "等待执行" : "待发放"}</Tag> },
        ]}
        scroll={{ x: 980 }}
      />
    </Card>}
    <Table rowKey="id" size="small" columns={columns} dataSource={settlement.items} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报名或可发奖用户" /> }} scroll={{ x: 1020 }} pagination={{ pageSize: 20, showSizeChanger: true }} expandable={{ expandedRowRender: (row) => <Typography.Paragraph style={{ margin: 0, fontSize: 12 }}>原始分 {row.scoreBreakdown?.rawScore ?? 0} × 排名权重 {row.scoreBreakdown?.rankMultiplier ?? 1} = {row.point}；抓取评论 {row.scoreBreakdown?.captured.replies ?? 0}、引用 {row.scoreBreakdown?.captured.quotes ?? 0}、普通转推 {row.scoreBreakdown?.captured.ordinaryRetweet ? "有（不计分）" : "无"}</Typography.Paragraph> }} />
    <Modal open={Boolean(exclusionItem)} title={`排除异常用户 @${exclusionItem?.username || "-"}`} okText="排除并生成新版本" okButtonProps={{ danger: true, disabled: !reason.trim() }} confirmLoading={exclusion.isPending} onCancel={() => setExclusionItem(null)} onOk={() => exclusionItem && exclusion.mutate({ item: exclusionItem, nextExcluded: true, exclusionReason: reason.trim() })}>
      <Alert type="warning" showIcon message="此操作不会修改当前版本" description="系统会复制当前快照、记录审核人与原因，并生成新的结算版本后重新排名和分配尾差。" style={{ marginBottom: 12 }} />
      <Input.TextArea rows={4} maxLength={500} showCount value={reason} onChange={(event) => setReason(event.target.value)} placeholder="必填：异常依据，例如机器人行为、批量同源账号等" />
    </Modal>
  </Space>;
}
