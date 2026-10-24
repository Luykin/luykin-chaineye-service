import { Alert, Avatar, Card, Collapse, Empty, Space, Spin, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { getCampaignDiagnostics, type E2eCampaignRecord, type E2eCrawlRun, type E2eInteractionScore } from "@/services/e2e-campaigns";

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "-";
const runColor: Record<string, string> = { success: "green", partial: "orange", failed: "red", running: "blue" };
const typeLabel: Record<string, string> = { reply: "评论", quote: "引用", retweet: "普通转推" };

export function E2eDiagnosticsTab({ address }: { address: string }) {
  const query = useQuery({ queryKey: ["e2e-campaigns", "diagnostics", address], queryFn: () => getCampaignDiagnostics(address) });
  if (query.isLoading) return <div style={{ padding: 48, textAlign: "center" }}><Spin /></div>;
  if (!query.data?.data) return <Empty description="暂无诊断数据" />;
  const data = query.data.data;
  const runColumns = [
    { title: "开始 / 完成", key: "time", width: 185, render: (_: unknown, row: E2eCrawlRun) => <>{formatTime(row.startedAt)}<br/><Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatTime(row.finishedAt)}</Typography.Text></> },
    { title: "状态", dataIndex: "status", width: 90, render: (value: string) => <Tag color={runColor[value] || "default"}>{value}</Tag> },
    { title: "评论", dataIndex: "replyCount", width: 70 },
    { title: "引用", dataIndex: "quoteCount", width: 70 },
    { title: "本轮转推抓取", dataIndex: "retweeterCount", width: 105 },
    { title: "异常", dataIndex: "error", ellipsis: true, render: (value: string | null) => value ? <Typography.Text type="danger">{value}</Typography.Text> : "-" },
  ];
  const interactionColumns = [
    { title: "用户", key: "user", width: 170, render: (_: unknown, row: E2eInteractionScore) => <Space><Avatar size={28} src={row.profileImageUrl || undefined}>{(row.username || "U")[0]?.toUpperCase()}</Avatar><span>@{row.username || row.userId}</span></Space> },
    { title: "类型", dataIndex: "type", width: 90, render: (value: string) => <Tag color={value === "quote" ? "purple" : value === "reply" ? "blue" : "default"}>{typeLabel[value] || value}</Tag> },
    { title: "互动内容", dataIndex: "text", width: 260, ellipsis: true, render: (value: string, row: E2eInteractionScore) => value || row.reason || "-" },
    { title: "互动时间", dataIndex: "createTime", width: 165, render: formatTime },
    { title: "赞 / 回 / 转 / 浏览", key: "metrics", width: 145, render: (_: unknown, row: E2eInteractionScore) => `${row.metrics.likes} / ${row.metrics.replies} / ${row.metrics.retweets} / ${row.metrics.views}` },
    { title: "基础+质量", key: "pre", width: 105, render: (_: unknown, row: E2eInteractionScore) => row.scoreBeforeDecay.toFixed(2) },
    { title: "时间权重", dataIndex: "timeWeight", width: 90, render: (value: number) => value.toFixed(4) },
    { title: "计入分", dataIndex: "score", width: 80, render: (value: number, row: E2eInteractionScore) => row.counted ? <Typography.Text strong>{value.toFixed(2)}</Typography.Text> : <TooltipReason reason={row.reason} /> },
  ];
  const scoreColumns = [
    { title: "用户", key: "user", width: 180, render: (_: unknown, row: E2eCampaignRecord) => <Space><Avatar size={28} src={row.profileImageUrl || undefined}>{(row.username || "U")[0]?.toUpperCase()}</Avatar><span>@{row.username || row.userId}</span></Space> },
    { title: "XHunt 排名", dataIndex: "fanRank", width: 100, render: (value: number | null) => value ? `#${value}` : "-" },
    { title: "原始互动分", key: "raw", width: 105, render: (_: unknown, row: E2eCampaignRecord) => row.scoreBreakdown?.rawScore ?? 0 },
    { title: "排名权重", key: "weight", width: 90, render: (_: unknown, row: E2eCampaignRecord) => `×${row.scoreBreakdown?.rankMultiplier ?? 1}` },
    { title: "最终积分", dataIndex: "point", width: 90 },
    { title: "说明", dataIndex: "explanation", ellipsis: true },
  ];

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <Alert type="info" showIcon message="当前评分口径" description="评论和引用参与评分；普通转推固定计 0 分，已停止调用 tweet_retweeters 抓取接口以节省配额，历史或只读库已有的转推数据仅供核对。互动越晚时间权重越低；评论/引用收到的点赞仍按当前配置计入质量分。" />
    <Card size="small" title="最近抓取过程">
      <Table rowKey="id" size="small" columns={runColumns} dataSource={data.crawlRuns} scroll={{ x: 760 }} pagination={{ pageSize: 5 }} expandable={{ expandedRowRender: (row) => <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{JSON.stringify(row.endpointDetails, null, 2)}</pre> }} />
    </Card>
    <Card size="small" title={`抓到的互动 (${data.interactions.length})`}>
      <Table rowKey={(row) => `${row.userId}:${row.type}:${row.id}`} size="small" columns={interactionColumns} dataSource={data.interactions} scroll={{ x: 1220 }} pagination={{ pageSize: 20, showSizeChanger: true }} />
    </Card>
    <Card size="small" title={`用户算分 (${data.scores.length})`}>
      <Table rowKey="userId" size="small" columns={scoreColumns} dataSource={data.scores} scroll={{ x: 850 }} pagination={{ pageSize: 20 }} expandable={{ expandedRowRender: (row) => <Collapse ghost items={[{ key: "details", label: "完整算分明细", children: <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(row.scoreBreakdown, null, 2)}</pre> }]} /> }} />
    </Card>
    <Card size="small" title={`最近算分变更记录 (${data.scoreLogs.length})`}>
      <Table
        rowKey={(row) => `${row.userId}:${row.calculatedAt}`}
        size="small"
        dataSource={data.scoreLogs}
        scroll={{ x: 720 }}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "计算时间", dataIndex: "calculatedAt", width: 180, render: formatTime },
          { title: "用户", dataIndex: "username", width: 160, render: (value: string, row) => `@${value || row.userId}` },
          { title: "积分", dataIndex: "point", width: 90 },
          { title: "说明", dataIndex: "explanation", ellipsis: true },
        ]}
      />
    </Card>
  </Space>;
}

function TooltipReason({ reason }: { reason: string | null }) {
  return <Tag color="default">不计分{reason ? `：${reason}` : ""}</Tag>;
}
