import { useEffect } from "react";
import { Alert, Button, Card, Col, Collapse, Descriptions, Divider, Form, InputNumber, Popover, Row, Space, Tag, Typography, message } from "antd";
import { InfoCircleOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/services/apiClient";
import {
  getCampaignSettlement,
  updateCampaignScoringConfig,
  type E2eScoringConfig,
} from "@/services/e2e-campaigns";

const defaults: E2eScoringConfig = {
  timeDecayFloor: 0.7,
  replyBase: 10,
  quoteBase: 15,
  lengthCharsPerPoint: 12,
  lengthBonusCap: 25,
  likeMultiplier: 1.5,
  replyMultiplier: 2,
  retweetReceivedMultiplier: 2,
  viewsPerPoint: 200,
  viewBonusCap: 10,
  engagementBonusCap: 30,
  maxReplies: 3,
  maxQuotes: 3,
  rankThreshold1: 1000,
  rankThreshold2: 5000,
  rankThreshold3: 20000,
  rankThreshold4: 50000,
  rankThreshold5: 100000,
  rankWeightTop1000: 2.5,
  rankWeightTop5000: 2,
  rankWeightTop20000: 1.6,
  rankWeightTop50000: 1.35,
  rankWeightTop100000: 1.15,
  rankWeightDefault: 1,
};

type FieldDefinition = {
  name: keyof E2eScoringConfig;
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
  precision?: number;
};

const contentFields: FieldDefinition[] = [
  { name: "replyBase", label: "评论基础分", help: "每条有效评论的起始分", min: 0, max: 100, step: 1, precision: 2 },
  { name: "quoteBase", label: "引用基础分", help: "每条有效引用的起始分", min: 0, max: 100, step: 1, precision: 2 },
  { name: "lengthCharsPerPoint", label: "每加 1 分所需字符", help: "正文长度每达到该字符数增加 1 分", min: 1, max: 1000, step: 1, precision: 0 },
  { name: "lengthBonusCap", label: "长度奖励上限", help: "单条互动的长度奖励封顶", min: 0, max: 200, step: 1, precision: 2 },
  { name: "maxReplies", label: "最多计分评论数", help: "每位用户按时间顺序最多计入的评论", min: 0, max: 20, step: 1, precision: 0 },
  { name: "maxQuotes", label: "最多计分引用数", help: "每位用户按时间顺序最多计入的引用", min: 0, max: 20, step: 1, precision: 0 },
];
const engagementFields: FieldDefinition[] = [
  { name: "likeMultiplier", label: "获赞系数", help: "评论或引用每收到 1 个赞增加的分数", min: 0, max: 20, step: 0.1, precision: 2 },
  { name: "replyMultiplier", label: "收到回复系数", help: "评论或引用每收到 1 条回复增加的分数", min: 0, max: 20, step: 0.1, precision: 2 },
  { name: "retweetReceivedMultiplier", label: "被转推系数", help: "互动内容被转推时的质量分；不是普通转推原推文", min: 0, max: 20, step: 0.1, precision: 2 },
  { name: "viewsPerPoint", label: "每 1 分所需浏览量", help: "浏览量除以该值换算浏览奖励", min: 1, max: 100000, step: 10, precision: 0 },
  { name: "viewBonusCap", label: "浏览奖励上限", help: "单条互动的浏览奖励封顶", min: 0, max: 200, step: 1, precision: 2 },
  { name: "engagementBonusCap", label: "互动质量分上限", help: "点赞、回复、被转推和浏览奖励的合计封顶", min: 0, max: 500, step: 1, precision: 2 },
];
const rankFields: FieldDefinition[] = [
  { name: "rankThreshold1", label: "第 1 档排名上限", help: "默认 Top 1,000", min: 1, max: 1000000000, step: 100, precision: 0 },
  { name: "rankWeightTop1000", label: "第 1 档权重", help: "默认 ×2.5", min: 0, max: 10, step: 0.05, precision: 2 },
  { name: "rankThreshold2", label: "第 2 档排名上限", help: "默认 Top 5,000", min: 1, max: 1000000000, step: 100, precision: 0 },
  { name: "rankWeightTop5000", label: "第 2 档权重", help: "默认 ×2.0", min: 0, max: 10, step: 0.05, precision: 2 },
  { name: "rankThreshold3", label: "第 3 档排名上限", help: "默认 Top 20,000", min: 1, max: 1000000000, step: 100, precision: 0 },
  { name: "rankWeightTop20000", label: "第 3 档权重", help: "默认 ×1.6", min: 0, max: 10, step: 0.05, precision: 2 },
  { name: "rankThreshold4", label: "第 4 档排名上限", help: "默认 Top 50,000", min: 1, max: 1000000000, step: 100, precision: 0 },
  { name: "rankWeightTop50000", label: "第 4 档权重", help: "默认 ×1.35", min: 0, max: 10, step: 0.05, precision: 2 },
  { name: "rankThreshold5", label: "第 5 档排名上限", help: "默认 Top 100,000", min: 1, max: 1000000000, step: 100, precision: 0 },
  { name: "rankWeightTop100000", label: "第 5 档权重", help: "默认 ×1.15", min: 0, max: 10, step: 0.05, precision: 2 },
  { name: "rankWeightDefault", label: "其他 / 无排名权重", help: "排名超过第 5 档上限或无有效排名", min: 0, max: 10, step: 0.05, precision: 2 },
];

function errorMessage(error: Error) {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "message" in error.data) {
    return String((error.data as { message?: string }).message || error.message);
  }
  return error.message;
}

function FieldGrid({ fields }: { fields: FieldDefinition[] }) {
  return <Row gutter={[16, 0]}>{fields.map((field) => <Col xs={24} md={12} xl={8} key={field.name}>
    <Form.Item
      name={field.name}
      label={field.label}
      extra={field.help}
      rules={[{ required: true, message: `请输入${field.label}` }]}
    >
      <InputNumber min={field.min} max={field.max} step={field.step} precision={field.precision} style={{ width: "100%" }} />
    </Form.Item>
  </Col>)}</Row>;
}

function ScoringAlgorithmHelp({ config }: { config: E2eScoringConfig }) {
  const rankRows = [
    [1, config.rankThreshold1, config.rankWeightTop1000],
    [config.rankThreshold1 + 1, config.rankThreshold2, config.rankWeightTop5000],
    [config.rankThreshold2 + 1, config.rankThreshold3, config.rankWeightTop20000],
    [config.rankThreshold3 + 1, config.rankThreshold4, config.rankWeightTop50000],
    [config.rankThreshold4 + 1, config.rankThreshold5, config.rankWeightTop100000],
  ];
  return <div style={{ width: "min(620px, calc(100vw - 56px))", maxHeight: "72vh", overflowY: "auto", paddingRight: 4 }}>
    <Typography.Paragraph style={{ marginBottom: 8 }}>
      系统分别计算用户的有效评论和引用，再叠加 XHunt 排名权重。时间权重保留 6 位小数，单条互动得分和最终积分保留 2 位小数。
    </Typography.Paragraph>
    <Typography.Title level={5}>1. 有效互动筛选</Typography.Title>
    <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
      <li>只计算已经报名用户发布的评论和引用；普通转推原推文会被抓取展示，但固定计 0 分。</li>
      <li>互动必须符合活动语言要求，且活动结束后的互动不计分。</li>
      <li>关闭 retro 时，只计算用户报名之后的互动；开启 retro 时允许计算报名之前已经存在的互动。</li>
      <li>每位用户按互动时间从早到晚，最多计入 {config.maxReplies} 条评论和 {config.maxQuotes} 条引用。</li>
    </ul>

    <Typography.Title level={5}>2. 单条评论或引用</Typography.Title>
    <Typography.Paragraph code style={{ display: "block", whiteSpace: "normal" }}>
      单条得分 =（基础分 + 长度奖励 + 互动质量分）× 时间权重
    </Typography.Paragraph>
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="基础分">评论 {config.replyBase} 分；引用 {config.quoteBase} 分</Descriptions.Item>
      <Descriptions.Item label="长度奖励">
        min（{config.lengthBonusCap}，floor（字符数 ÷ {config.lengthCharsPerPoint}））
      </Descriptions.Item>
      <Descriptions.Item label="互动质量分">
        min（{config.engagementBonusCap}，获赞数 × {config.likeMultiplier} + 收到回复数 × {config.replyMultiplier} + 被转推数 × {config.retweetReceivedMultiplier} + 浏览奖励）
      </Descriptions.Item>
      <Descriptions.Item label="浏览奖励">
        min（{config.viewBonusCap}，浏览量 ÷ {config.viewsPerPoint}）
      </Descriptions.Item>
    </Descriptions>
    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 12 }}>
      “获赞、收到回复、被转推”均指这条评论或引用自身收到的互动，不是用户对原推文执行的动作。
    </Typography.Paragraph>

    <Typography.Title level={5}>3. 时间衰减</Typography.Title>
    <Typography.Paragraph>
      活动开始时权重为 1.0，随后按互动发生时间线性衰减，活动结束时为 {config.timeDecayFloor}。
      活动开始前的 retro 互动按 1.0 计算。
    </Typography.Paragraph>
    <Typography.Paragraph code style={{ display: "block", whiteSpace: "normal" }}>
      时间权重 = 1 -（互动时间 - 开始时间）÷（结束时间 - 开始时间）×（1 - {config.timeDecayFloor}）
    </Typography.Paragraph>

    <Typography.Title level={5}>4. 用户总分与排名权重</Typography.Title>
    <Typography.Paragraph code style={{ display: "block", whiteSpace: "normal" }}>
      最终积分 = 所有计入互动的单条得分之和 × XHunt 排名权重
    </Typography.Paragraph>
    <Descriptions bordered size="small" column={1}>
      {rankRows.map(([from, to, weight], index) => <Descriptions.Item key={index} label={`排名 ${from.toLocaleString()} - ${to.toLocaleString()}`}>× {weight}</Descriptions.Item>)}
      <Descriptions.Item label={`排名超过 ${config.rankThreshold5.toLocaleString()} 或无有效排名`}>× {config.rankWeightDefault}</Descriptions.Item>
    </Descriptions>

    <Divider style={{ margin: "16px 0 12px" }} />
    <Typography.Title level={5}>可配置参数</Typography.Title>
    <Typography.Paragraph style={{ marginBottom: 0 }}>
      管理员可以调整：时间衰减下限、评论/引用基础分、长度换算与封顶、每人计分条数、获赞/回复/被转推/浏览系数、互动质量封顶，以及 XHunt 排名档位和权重。
      普通转推原推文 0 分、活动结束后互动不计分、最终保留 2 位小数属于固定规则，不能配置。
    </Typography.Paragraph>
  </div>;
}

export function E2eScoringConfigCard({ address, status, config }: { address: string; status?: string | null; config?: E2eScoringConfig }) {
  const [form] = Form.useForm<E2eScoringConfig>();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const settlementQuery = useQuery({
    queryKey: ["e2e-campaigns", "settlement", address],
    queryFn: () => getCampaignSettlement(address),
  });
  useEffect(() => {
    form.setFieldsValue(config || defaults);
  }, [config, form]);
  const settlement = settlementQuery.data?.data;
  const effectiveConfig = config || defaults;
  const locked = status === "complete" || (status === "review" && Boolean(settlement) && settlement?.status !== "draft");
  const controlsDisabled = locked || settlementQuery.isLoading;
  const save = useMutation({
    mutationFn: (values: E2eScoringConfig) => updateCampaignScoringConfig(address, values),
    onSuccess: (response) => {
      messageApi.success(status === "review"
        ? "评分参数已保存，并生成了新的结算版本"
        : status === "active" ? "评分参数已保存，积分已重新计算" : "评分参数已保存");
      queryClient.setQueryData(["e2e-campaigns", "detail", address], { success: true, data: response.data.detail });
      queryClient.setQueryData(["e2e-campaigns", "settlement", address], { success: true, data: response.data.settlement });
      void queryClient.invalidateQueries({ queryKey: ["e2e-campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["e2e-campaigns", "diagnostics", address] });
    },
    onError: (error: Error) => messageApi.error(errorMessage(error)),
  });

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    {contextHolder}
    <Alert
      type="info"
      showIcon
      message="评分规则按活动独立保存"
      description={status === "review"
        ? "保存后会立即重新计算积分并生成新的不可变结算版本；名单一旦确认，参数即锁定。"
        : "保存后会立即按新参数重新计算当前积分。普通转推原推文始终不计分，不能通过配置开启。"}
    />
    {locked && <Alert type="warning" showIcon message="评分规则已锁定" description="活动已完成或获奖名单已经管理员确认，不能再改变结算依据。" />}
    <Card
      title={<Space>
        <span>评分参数</span>
        <Popover
          title="E2E 综合评分算法"
          content={<ScoringAlgorithmHelp config={effectiveConfig} />}
          trigger={["hover", "click", "focus"]}
          placement="bottomLeft"
        >
          <Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label="查看 E2E 评分算法说明" aria-haspopup="dialog" />
        </Popover>
        <Tag color="blue">时间衰减下限默认 0.7</Tag>
      </Space>}
      extra={<Space>
        <Button icon={<UndoOutlined />} disabled={controlsDisabled || save.isPending} onClick={() => form.setFieldsValue(defaults)}>恢复默认值</Button>
        <Button type="primary" icon={<SaveOutlined />} disabled={controlsDisabled} loading={save.isPending} onClick={() => form.submit()}>{status === "pending" ? "保存评分参数" : "保存并重新计算"}</Button>
      </Space>}
    >
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)} disabled={controlsDisabled}>
        <Form.Item
          name="timeDecayFloor"
          label="活动结束时的最低时间权重"
          extra="活动开始时权重为 1.0，之后线性衰减，到活动结束时达到该值。建议保持 0.5-1.0。"
          rules={[{ required: true, message: "请输入最低时间权重" }]}
        >
          <InputNumber min={0} max={1} step={0.05} precision={2} style={{ width: "100%", maxWidth: 320 }} />
        </Form.Item>
        <Typography.Text type="secondary">最终积分 = Σ（基础分 + 长度奖励 + 互动质量分）× 时间权重 × XHunt 排名权重</Typography.Text>
        <Collapse
          style={{ marginTop: 16 }}
          defaultActiveKey={["content", "engagement"]}
          items={[
            { key: "content", label: "内容基础分与计分数量", children: <FieldGrid fields={contentFields} /> },
            { key: "engagement", label: "互动质量系数", children: <FieldGrid fields={engagementFields} /> },
            { key: "rank", label: "XHunt 排名权重", children: <FieldGrid fields={rankFields} /> },
          ]}
        />
      </Form>
    </Card>
  </Space>;
}
