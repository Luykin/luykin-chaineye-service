import { useState, type ReactNode } from "react";
import { Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Spin, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import { InfoCircleOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  createHotVoteTopic,
  fetchHotVoteInternalTesters,
  fetchHotVoteTopics,
  updateHotVoteTopic,
  type HotVoteTopic,
} from "@/services/hot-vote";

const STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "ended", label: "已结束" },
  { value: "archived", label: "已归档" },
];
const STATUS_TAG: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  published: { text: "已发布", color: "green" },
  ended: { text: "已结束", color: "orange" },
  archived: { text: "已归档", color: "default" },
};
const TOPIC_TYPE_OPTIONS = [
  { value: "person_pk", label: "人物 PK" },
  { value: "general_topic", label: "普通议题" },
];
const DOMAIN_OPTIONS = [
  { value: "web3", label: "Web3" },
  { value: "ai", label: "AI" },
];
const LANGUAGE_OPTIONS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function InfoLabel({ label, info }: { label: ReactNode; info: string }) {
  return <Space size={5}>{label}<Tooltip title={info}><InfoCircleOutlined style={{ color: "#8c8c8c" }} /></Tooltip></Space>;
}

export function HotVotePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [testingFilter, setTestingFilter] = useState<string>();
  const [editing, setEditing] = useState<HotVoteTopic | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form] = Form.useForm();

  const query = useQuery({
    queryKey: ["hot-vote-topics", page, pageSize, statusFilter, testingFilter],
    queryFn: () => fetchHotVoteTopics({ page, pageSize, status: statusFilter, testingPhase: testingFilter }),
  });
  const testersQuery = useQuery({
    queryKey: ["hot-vote-internal-testers"],
    queryFn: fetchHotVoteInternalTesters,
    enabled: editorOpen,
  });
  const refresh = () => void query.refetch();

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => editing ? updateHotVoteTopic(editing.id, values) : createHotVoteTopic(values),
    onSuccess: () => { messageApi.success("已保存"); setEditorOpen(false); setEditing(null); refresh(); },
    onError: (error: Error) => messageApi.error(error.message),
  });

  const openEdit = (item?: HotVoteTopic) => {
    setEditing(item || null);
    setEditorOpen(true);
    form.setFieldsValue(item
      ? {
          ...item,
          titleEn: item.titleI18n?.en || "",
          summaryEn: item.summaryI18n?.en || "",
          options: (item.options || []).map((opt) => ({ ...opt, nameEn: opt.nameI18n?.en || "" })),
          titleHtml: item.titleHtml || "",
          startTime: toLocalInput(item.startTime),
          endTime: toLocalInput(item.endTime),
        }
      : {
          topicType: "person_pk",
          status: "draft",
          sortWeight: 0,
          maxRevotes: 2,
          testingPhase: false,
          displayDomains: ["web3"],
          displayLanguages: ["zh"],
          testList: [],
          options: [{ id: "opt_1" }, { id: "opt_2" }],
        });
  };

  const submit = (values: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { ...values };
    if (!payload.titleHtml) delete payload.titleHtml;
    payload.startTime = values.startTime ? new Date(String(values.startTime)).toISOString() : null;
    payload.endTime = values.endTime ? new Date(String(values.endTime)).toISOString() : null;
    save.mutate(payload);
  };

  const testerOptions = (testersQuery.data?.data || []).map((user) => ({ value: user.username, label: `@${user.username}` }));
  const topics = query.data?.data.list || [];
  const pagination = query.data?.data.pagination;

  const columns = [
    {
      title: "议题", key: "title", width: 260,
      render: (_: unknown, row: HotVoteTopic) => <>
        <Typography.Text strong>{row.title}</Typography.Text>
        {row.titleI18n?.en && <><br /><Typography.Text type="secondary" ellipsis={{ tooltip: row.titleI18n.en }}>{row.titleI18n.en}</Typography.Text></>}
        <br />
        <Typography.Text type="secondary" ellipsis={{ tooltip: row.summary }}>{row.summary}</Typography.Text>
      </>,
    },
    {
      title: "形式", dataIndex: "topicType", width: 90,
      render: (value: string) => <Tag color={value === "person_pk" ? "blue" : "purple"}>{value === "person_pk" ? "人物 PK" : "普通议题"}</Tag>,
    },
    {
      title: "状态", dataIndex: "status", width: 86,
      render: (value: string) => { const tag = STATUS_TAG[value] || { text: value, color: "default" }; return <Tag color={tag.color}>{tag.text}</Tag>; },
    },
    {
      title: "测试", dataIndex: "testingPhase", width: 76,
      render: (value: boolean, row: HotVoteTopic) => value ? <Tooltip title={(row.testList || []).map((item) => `@${item}`).join("、") || "未配置测试名单"}><Tag color="gold">内测中</Tag></Tooltip> : <Tag>正式</Tag>,
    },
    {
      title: "选项", dataIndex: "options", width: 200,
      render: (options: HotVoteTopic["options"]) => <Space size={4} wrap>{(options || []).map((opt) => <Tag key={opt.id} color={opt.isGua ? "default" : "cyan"}>{opt.name || opt.id}</Tag>)}</Space>,
    },
    {
      title: "可见范围", key: "display", width: 130,
      render: (_: unknown, row: HotVoteTopic) => <>
        <Typography.Text>{(row.displayDomains || []).map((d) => d === "web3" ? "Web3" : d === "ai" ? "AI" : d).join(" / ") || "-"}</Typography.Text>
        <br />
        <Typography.Text type="secondary">{(row.displayLanguages || []).map((l) => l === "zh" ? "中文" : l === "en" ? "EN" : l).join(" / ") || "-"}</Typography.Text>
      </>,
    },
    { title: "权重", dataIndex: "sortWeight", width: 64 },
    { title: "改票次数", dataIndex: "maxRevotes", width: 84 },
    {
      title: "时间", key: "time", width: 190,
      render: (_: unknown, row: HotVoteTopic) => <>
        {row.startTime ? new Date(row.startTime).toLocaleString() : "未设开始"}
        <br />
        {row.endTime ? `至 ${new Date(row.endTime).toLocaleString()}` : "未设结束"}
      </>,
    },
    {
      title: "创建时间", dataIndex: "createdAt", width: 165,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "操作", width: 80, fixed: "right" as const,
      render: (_: unknown, row: HotVoteTopic) => <Button size="small" onClick={() => openEdit(row)}>编辑</Button>,
    },
  ];

  return <PermissionGuard permission="nacos_config"><PageSection title="热点投票" description="创建和维护 XHunt 热点投票议题：配置选项、可见领域与语言、内测名单和上下线状态。"><>{contextHolder}<Card title="议题列表" extra={<Space wrap>
    <Select allowClear placeholder="状态" style={{ width: 110 }} options={STATUS_OPTIONS} value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1); }} />
    <Select allowClear placeholder="测试阶段" style={{ width: 110 }} value={testingFilter} onChange={(value) => { setTestingFilter(value); setPage(1); }} options={[{ value: "true", label: "内测中" }, { value: "false", label: "正式" }]} />
    <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>新建议题</Button>
  </Space>}>
    {query.isLoading ? <div style={{ padding: 48, textAlign: "center" }}><Spin /></div> : <Table rowKey="id" size="small" columns={columns} dataSource={topics} scroll={{ x: 1450 }} pagination={{
      current: page,
      pageSize,
      total: pagination?.total || 0,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`,
      onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
    }} />}
  </Card>
  <Modal open={editorOpen} title={editing ? "编辑议题" : "新建议题"} width={880} onCancel={() => { setEditorOpen(false); setEditing(null); }} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnClose>
    <Form form={form} layout="vertical" onFinish={submit}><Row gutter={20}>
      <Col span={24}><Form.Item name="title" label={<InfoLabel label="议题标题（中文）" info="用户看到的中文标题，限 100 字。" />} rules={[{ required: true, message: "请输入议题标题" }, { max: 100 }]}><Input placeholder="例如：CZ 与 SBF 谁对行业影响更大？" maxLength={100} showCount /></Form.Item></Col>
      <Col span={24}><Form.Item name="titleEn" label={<InfoLabel label="议题标题（English）" info="英文界面用户看到的标题，限 100 字；留空则英文界面也展示中文标题。" />} rules={[{ max: 100 }]}><Input placeholder="e.g. Who has shaped the industry more: CZ or SBF?" maxLength={100} showCount /></Form.Item></Col>
      <Col span={24}><Form.Item name="titleHtml" label={<InfoLabel label="富文本标题（可选）" info="支持白名单 HTML 标签的富文本标题，限 1000 字符；留空则使用纯文本标题。" />} rules={[{ max: 1000 }]}><Input.TextArea rows={2} placeholder="留空则使用纯文本标题" /></Form.Item></Col>
      <Col span={24}><Form.Item name="summary" label={<InfoLabel label="核心冲突介绍（中文）" info="一句话说明议题的核心冲突，限 100 字。" />} rules={[{ required: true, message: "请输入核心冲突介绍" }, { max: 100 }]}><Input.TextArea rows={2} maxLength={100} showCount placeholder="一句话介绍这个议题的争议点" /></Form.Item></Col>
      <Col span={24}><Form.Item name="summaryEn" label={<InfoLabel label="核心冲突介绍（English）" info="英文界面用户看到的简介，限 100 字；留空则英文界面也展示中文简介。" />} rules={[{ max: 100 }]}><Input.TextArea rows={2} maxLength={100} showCount placeholder="One-line summary of the debate for English UI" /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="topicType" label={<InfoLabel label="议题形式" info="人物 PK 强调候选人对抗；普通议题为一般观点投票。" />} rules={[{ required: true }]}><Select options={TOPIC_TYPE_OPTIONS} /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="status" label={<InfoLabel label="状态" info="仅「已发布」的议题对用户可见；结束后用户不能再投票。" />} rules={[{ required: true }]}><Select options={STATUS_OPTIONS} /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="sortWeight" label={<InfoLabel label="排序权重" info="数值大者优先展示。" />}><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
      <Col span={24}>
        <Form.Item label={<InfoLabel label="投票选项" info="2 ~ 6 个选项；ID 仅支持字母、数字、下划线和中划线。名称支持中英文分别配置，英文名留空时英文界面展示中文名。若未包含「吃瓜」选项，系统会自动追加。已有投票的议题不能删除产生过票数的选项。" />} required>
          <Form.List name="options" rules={[{
            validator: async (_, value) => {
              if (!Array.isArray(value) || value.length < 2) throw new Error("至少需要 2 个选项");
              if (value.length > 6) throw new Error("最多 6 个选项");
            },
          }]}>
            {(fields, { add, remove }, { errors }) => <>
              {fields.map((field) => <Card key={field.key} size="small" style={{ marginBottom: 10 }} extra={fields.length > 2 && <Button size="small" type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>移除</Button>}>
                <Row gutter={12}>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "id"]} label="选项 ID" rules={[{ required: true, message: "必填" }, { pattern: /^[a-zA-Z0-9_-]{1,32}$/, message: "仅字母/数字/_/-，1-32 字符" }]}><Input placeholder="opt_1" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "name"]} label="名称（中文）" rules={[{ required: true, message: "必填" }, { max: 30 }]}><Input placeholder="选项名称" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "nameEn"]} label="名称（English，可选）" rules={[{ max: 60 }]}><Input placeholder="留空则英文界面展示中文名" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "twitterHandle"]} label="X Handle（可选）"><Input placeholder="不带 @" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "avatar"]} label="头像 URL（可选）"><Input placeholder="https://…" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "color"]} label="颜色（可选）"><Input placeholder="#f0b90b" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name={[field.name, "isGua"]} label="吃瓜选项" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>
              </Card>)}
              <Form.ErrorList errors={errors} />
              {fields.length < 6 && <Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ id: `opt_${fields.length + 1}` })}>添加选项</Button>}
            </>}
          </Form.List>
        </Form.Item>
      </Col>
      <Col xs={24} md={12}><Form.Item name="displayDomains" label={<InfoLabel label="展示领域" info="议题在哪些领域站点可见。" />} rules={[{ required: true, message: "至少选择一项" }]}><Checkbox.Group options={DOMAIN_OPTIONS} /></Form.Item></Col>
      <Col xs={24} md={12}><Form.Item name="displayLanguages" label={<InfoLabel label="展示语言" info="议题在哪些语言版本可见。" />} rules={[{ required: true, message: "至少选择一项" }]}><Checkbox.Group options={LANGUAGE_OPTIONS} /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="maxRevotes" label={<InfoLabel label="允许改票次数" info="用户投票后允许修改选择的最大次数，0 表示不允许改票。" />}><InputNumber style={{ width: "100%" }} min={0} max={10} /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="startTime" label={<InfoLabel label="开始时间" info="到达后开始展示/可投票；留空表示不限制。" />}><Input type="datetime-local" /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="endTime" label={<InfoLabel label="结束时间" info="到达后停止投票；留空表示不限制。" />}><Input type="datetime-local" /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name="testingPhase" label={<InfoLabel label="内测阶段" info="开启后议题仅对内测名单中的用户可见。" />} valuePropName="checked"><Switch /></Form.Item></Col>
      <Col xs={24} md={16}><Form.Item noStyle shouldUpdate={(prev, next) => prev.testingPhase !== next.testingPhase}>
        {({ getFieldValue }) => <Form.Item name="testList" label={<InfoLabel label="内测名单" info="测试阶段可见本议题的 Twitter handle 名单；可从预设内测人员中选择，也可手动输入后回车。" />}><Select mode="tags" showSearch optionFilterProp="label" options={testerOptions} placeholder={getFieldValue("testingPhase") ? "选择或输入 Twitter handle（不带 @）" : "未开启内测时可暂不配置"} loading={testersQuery.isFetching} tokenSeparators={[",", "，", "\n", " "]} /></Form.Item>}
      </Form.Item></Col>
    </Row></Form>
  </Modal></></PageSection></PermissionGuard>;
}
