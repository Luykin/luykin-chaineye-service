import {
  Alert,
  Avatar,
  Card,
  Col,
  Collapse,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  getCampaignDiagnostics,
  type E2eCampaignRecord,
  type E2eInteractionSubmissionDiagnostic,
  type E2eScoreBreakdown,
} from "@/services/e2e-campaigns";

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "-";
const typeLabel: Record<string, string> = { reply: "评论", quote: "引用" };
const formatScoreNumber = (value: number | null | undefined, maximumFractionDigits = 6) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(maximumFractionDigits))) : "0";
};
const policyNumber = (breakdown: E2eScoreBreakdown, key: string) =>
  formatScoreNumber(Number(breakdown.policy[key]));

function ScoreExplanation({ breakdown, fallback }: { breakdown: E2eScoreBreakdown | null; fallback?: string | null }) {
  if (!breakdown) return <Typography.Text type="secondary">{fallback || "暂无算分明细"}</Typography.Text>;
  const counted = breakdown.interactions.filter((item) => item.counted);
  const excluded = breakdown.interactions.filter((item) => !item.counted);
  const typeIndexes: Record<string, number> = {};
  return (
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      <Typography.Text strong>
        最终积分 {formatScoreNumber(breakdown.point, 2)} = 互动原始分 {formatScoreNumber(breakdown.rawScore, 2)} × 排名权重 {formatScoreNumber(breakdown.rankMultiplier)}
      </Typography.Text>
      {counted.map((item) => {
        typeIndexes[item.type] = (typeIndexes[item.type] || 0) + 1;
        const viewBonusFormula = Number(breakdown.policy.viewSqrtDivisor) > 0
          ? `√${item.metrics.views}÷${policyNumber(breakdown, "viewSqrtDivisor")}`
          : `${item.metrics.views}÷${policyNumber(breakdown, "viewsPerPoint")}`;
        return (
          <div key={item.id}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {typeLabel[item.type] || item.type}{typeIndexes[item.type]}：
              （基础 {formatScoreNumber(item.base)} + 长度 {formatScoreNumber(item.lengthBonus)} + 互动 {formatScoreNumber(item.engagementBonus)}）
              × 实际时间权重 {formatScoreNumber(item.timeWeight)} = {formatScoreNumber(item.score, 2)}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              长度：{item.charLength} 字，每 {policyNumber(breakdown, "lengthCharsPerPoint")} 字 +1，上限 {policyNumber(breakdown, "lengthBonusCap")}；
              互动：赞 {item.metrics.likes}×{policyNumber(breakdown, "likeMultiplier")}、
              回复 {item.metrics.replies}×{policyNumber(breakdown, "replyMultiplier")}、
              被转发 {item.metrics.retweets}×{policyNumber(breakdown, "retweetReceivedMultiplier")}、
              浏览 min({viewBonusFormula}，{policyNumber(breakdown, "viewBonusCap")}），
              互动总上限 {policyNumber(breakdown, "engagementBonusCap")}
            </Typography.Text>
          </div>
        );
      })}
      {excluded.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          另有 {excluded.length} 条互动未计分：{excluded.map((item) => item.reason || "不符合计分条件").join("；")}
        </Typography.Text>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        时间权重按发布时间线性衰减，最低为 {formatScoreNumber(Number(breakdown.policy.timeDecayFloor))}
      </Typography.Text>
    </Space>
  );
}

export function E2eDiagnosticsTab({ address }: { address: string }) {
  const query = useQuery({
    queryKey: ["e2e-campaigns", "diagnostics", address],
    queryFn: () => getCampaignDiagnostics(address),
  });
  if (query.isLoading) return <div style={{ padding: 48, textAlign: "center" }}><Spin /></div>;
  if (!query.data?.data) return <Empty description="暂无诊断数据" />;
  const data = query.data.data;

  const submissionColumns = [
    {
      title: "提交用户",
      key: "user",
      width: 180,
      render: (_: unknown, row: E2eInteractionSubmissionDiagnostic) => (
        <Space>
          <Avatar size={28} src={row.profileImageUrl || undefined}>{(row.username || "U")[0]?.toUpperCase()}</Avatar>
          <span>@{row.username || row.userId}</span>
        </Space>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 80,
      render: (value: string) => <Tag color={value === "quote" ? "purple" : "blue"}>{typeLabel[value] || value}</Tag>,
    },
    {
      title: "验证",
      dataIndex: "status",
      width: 90,
      render: (value: string) => <Tag color={value === "verified" ? "green" : "orange"}>{value === "verified" ? "已验证" : value}</Tag>,
    },
    {
      title: "互动内容",
      dataIndex: "text",
      width: 280,
      ellipsis: true,
      render: (value: string, row: E2eInteractionSubmissionDiagnostic) => (
        <Space direction="vertical" size={0}>
          <Typography.Link href={row.tweetUrl} target="_blank" rel="noreferrer">{value || row.tweetId}</Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.tweetId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "提交 / 验证时间",
      key: "verification",
      width: 190,
      render: (_: unknown, row: E2eInteractionSubmissionDiagnostic) => (
        <>{formatTime(row.submittedAt)}<br/><Typography.Text type="secondary" style={{ fontSize: 12 }}>验证：{formatTime(row.verifiedAt)}</Typography.Text></>
      ),
    },
    { title: "互动时间", dataIndex: "interactionCreatedAt", width: 175, render: formatTime },
    {
      title: "赞 / 回 / 转 / 引 / 浏览",
      key: "metrics",
      width: 175,
      render: (_: unknown, row: E2eInteractionSubmissionDiagnostic) => `${row.metrics.likes} / ${row.metrics.replies} / ${row.metrics.retweets} / ${row.metrics.quotes} / ${row.metrics.views}`,
    },
    {
      title: "指标刷新",
      key: "refresh",
      width: 210,
      render: (_: unknown, row: E2eInteractionSubmissionDiagnostic) => (
        <Space direction="vertical" size={0}>
          <span>{formatTime(row.lastRefreshedAt)}</span>
          {row.lastError
            ? <Typography.Text type="danger" ellipsis={{ tooltip: row.lastError }} style={{ maxWidth: 190 }}>{row.lastError}</Typography.Text>
            : <Typography.Text type="success">正常</Typography.Text>}
        </Space>
      ),
    },
    {
      title: "当前算分",
      key: "score",
      width: 150,
      render: (_: unknown, row: E2eInteractionSubmissionDiagnostic) => row.counted
        ? <Tag color="green">计入 {Number(row.score || 0).toFixed(2)} 分</Tag>
        : <ReasonTag reason={row.reason} />,
    },
  ];
  const scoreColumns = [
    { title: "用户", key: "user", width: 180, render: (_: unknown, row: E2eCampaignRecord) => <Space><Avatar size={28} src={row.profileImageUrl || undefined}>{(row.username || "U")[0]?.toUpperCase()}</Avatar><span>@{row.username || row.userId}</span></Space> },
    { title: "XHunt 排名", dataIndex: "fanRank", width: 100, render: (value: number | null) => value ? `#${value}` : "-" },
    { title: "原始互动分", key: "raw", width: 105, render: (_: unknown, row: E2eCampaignRecord) => row.scoreBreakdown?.rawScore ?? 0 },
    { title: "排名权重", key: "weight", width: 90, render: (_: unknown, row: E2eCampaignRecord) => `×${row.scoreBreakdown?.rankMultiplier ?? 1}` },
    { title: "最终积分", dataIndex: "point", width: 90 },
    {
      title: "算分明细",
      key: "explanation",
      width: 640,
      render: (_: unknown, row: E2eCampaignRecord) => (
        <ScoreExplanation breakdown={row.scoreBreakdown} fallback={row.explanation} />
      ),
    },
  ];

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <Alert
      type="info"
      showIcon
      message="当前验证与算分流程"
      description="只处理用户主动提交且后端验证通过的评论或引用。系统按已知 Tweet ID 定时刷新指标，不再扫描原推文的回复或引用列表；刷新失败时保留上一次快照并展示错误。"
    />
    <Card size="small" title="提交与刷新概览">
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}><Statistic title="全部提交" value={data.submissionStats.total} /></Col>
        <Col xs={12} md={8} xl={4}><Statistic title="已验证" value={data.submissionStats.verified} /></Col>
        <Col xs={12} md={8} xl={4}><Statistic title="评论" value={data.submissionStats.replies} /></Col>
        <Col xs={12} md={8} xl={4}><Statistic title="引用" value={data.submissionStats.quotes} /></Col>
        <Col xs={12} md={8} xl={4}><Statistic title="刷新异常" value={data.submissionStats.refreshFailed} valueStyle={data.submissionStats.refreshFailed ? { color: "#cf1322" } : undefined} /></Col>
        <Col xs={24} md={16} xl={4}><Statistic title="最近刷新" value={formatTime(data.submissionStats.latestRefreshedAt)} /></Col>
      </Row>
      <Typography.Text type="secondary">最旧指标快照：{formatTime(data.submissionStats.oldestRefreshedAt)}</Typography.Text>
    </Card>
    <Card size="small" title={`用户提交与验证明细 (${data.submissions.length})`}>
      <Table rowKey="id" size="small" columns={submissionColumns} dataSource={data.submissions} scroll={{ x: 1660 }} pagination={{ pageSize: 20, showSizeChanger: true }} />
    </Card>
    <Card size="small" title={`用户算分 (${data.scores.length})`}>
      <Table rowKey="userId" size="small" columns={scoreColumns} dataSource={data.scores} scroll={{ x: 1240 }} pagination={{ pageSize: 20 }} expandable={{ expandedRowRender: (row) => <Collapse ghost items={[{ key: "details", label: "原始算分数据", children: <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(row.scoreBreakdown, null, 2)}</pre> }]} /> }} />
    </Card>
    <Card size="small" title={`最近算分变更记录 (${data.scoreLogs.length})`}>
      <Table
        rowKey={(row) => `${row.userId}:${row.calculatedAt}`}
        size="small"
        dataSource={data.scoreLogs}
        scroll={{ x: 1220 }}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "计算时间", dataIndex: "calculatedAt", width: 180, render: formatTime },
          { title: "用户", dataIndex: "username", width: 160, render: (value: string, row) => `@${value || row.userId}` },
          { title: "积分", dataIndex: "point", width: 90 },
          {
            title: "算分明细",
            key: "explanation",
            width: 760,
            render: (_: unknown, row) => (
              <ScoreExplanation breakdown={row.scoreBreakdown} fallback={row.explanation} />
            ),
          },
        ]}
      />
    </Card>
  </Space>;
}

function ReasonTag({ reason }: { reason: string | null }) {
  return <Tag color="default">不计分{reason ? `：${reason}` : ""}</Tag>;
}
