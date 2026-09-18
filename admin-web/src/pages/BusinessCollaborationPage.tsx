import { useState, type ReactNode } from "react";
import { AutoComplete, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { InfoCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  createCollaborationActivity,
  deleteCollaborationActivity,
  fetchCollaborationActivities,
  fetchCollaborationInternalTestUsers,
  grantCollaborationAccess,
  lookupCollaborationProjectAccount,
  updateCollaborationAccess,
  updateCollaborationActivity,
  type CollaborationActivity,
  type CollaborationProjectAccount,
} from "@/services/business-collaboration";

const statuses = ["draft", "open", "paused", "archived"];
const PROJECT_ACCOUNT_OPTIONS = [
  { value: "xhunt_ai", label: "XHunt AI · @xhunt_ai" }, { value: "Mantle_Official", label: "Mantle · @Mantle_Official" },
  { value: "yzilabs", label: "YZi Labs · @yzilabs" }, { value: "Bybit_Official", label: "Bybit · @Bybit_Official" },
  { value: "0xMantle", label: "Mantle Network · @0xMantle" }, { value: "BNBCHAIN", label: "BNB Chain · @BNBCHAIN" },
  { value: "Binance", label: "Binance · @Binance" }, { value: "BinanceWallet", label: "Binance Wallet · @BinanceWallet" },
  { value: "okx", label: "OKX · @okx" }, { value: "base", label: "Base · @base" }, { value: "arbitrum", label: "Arbitrum · @arbitrum" },
  { value: "Optimism", label: "Optimism · @Optimism" }, { value: "solana", label: "Solana · @solana" },
  { value: "0xPolygon", label: "Polygon · @0xPolygon" }, { value: "ethereum", label: "Ethereum · @ethereum" },
  { value: "CoinMarketCap", label: "CoinMarketCap · @CoinMarketCap" }, { value: "coingecko", label: "CoinGecko · @coingecko" },
];
const CONTENT_FORMAT_OPTIONS = ["X 帖子", "X 长推（Thread）", "图文帖", "短视频", "视频评测", "Space 直播", "产品体验", "教程 / 攻略", "转发引用"].map((value) => ({ value, label: value }));
const LANGUAGE_OPTIONS = ["中文", "English", "日本語", "한국어", "Español", "Русский"].map((value) => ({ value, label: value }));
const REQUIRED_POINT_OPTIONS = ["准确说明产品核心功能", "附上指定活动链接", "添加指定话题或标签", "标注官方 X 账号", "披露赞助 / 商务合作关系", "不得承诺收益或使用误导性表述", "发布后至少保留 7 天"].map((value) => ({ value, label: value }));

const toLocalInput = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const normalizeHandle = (value: unknown) => String(value || "").trim().replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "").split(/[/?#]/)[0].replace(/^@+/, "");
const toTagValues = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
function InfoLabel({ label, info }: { label: ReactNode; info: string }) {
  return <Space size={5}>{label}<Tooltip title={info}><InfoCircleOutlined style={{ color: "#8c8c8c" }} /></Tooltip></Space>;
}

function cleanInvitationTemplate(template: Record<string, unknown> = {}) {
  const clean: Record<string, unknown> = { ...template };
  ["title", "message", "brief", "minimumOfferAmount"].forEach((key) => {
    const value = template[key];
    if (typeof value === "string" && value.trim()) clean[key] = value.trim();
    else if (key === "minimumOfferAmount" && typeof value === "number" && Number.isFinite(value)) clean[key] = String(value);
    else delete clean[key];
  });
  ["contentFormat", "language"].forEach((key) => {
    const values = toTagValues(template[key]);
    if (values.length) clean[key] = values;
    else delete clean[key];
  });
  if (Array.isArray(template.requiredPoints)) clean.requiredPoints = template.requiredPoints.map((value) => String(value).trim()).filter(Boolean);
  else delete clean.requiredPoints;
  ["contentCount", "confirmationDeadlineHours"].forEach((key) => {
    if (template[key] !== undefined && template[key] !== null && template[key] !== "") clean[key] = template[key];
    else delete clean[key];
  });
  return clean;
}

export function BusinessCollaborationPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [editing, setEditing] = useState<CollaborationActivity | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [accessActivity, setAccessActivity] = useState<CollaborationActivity | null>(null);
  const [projectAccount, setProjectAccount] = useState<CollaborationProjectAccount | null>(null);
  const [form] = Form.useForm();
  const [accessForm] = Form.useForm();
  const query = useQuery({ queryKey: ["business-collaboration-activities"], queryFn: fetchCollaborationActivities });
  const internalTestUsersQuery = useQuery({ queryKey: ["business-collaboration-internal-test-users"], queryFn: fetchCollaborationInternalTestUsers, enabled: editorOpen || !!accessActivity });
  const refresh = () => void query.refetch();
  const save = useMutation({ mutationFn: (values: Record<string, unknown>) => editing ? updateCollaborationActivity(editing.id, values) : createCollaborationActivity(values), onSuccess: () => { messageApi.success("已保存"); setEditorOpen(false); setEditing(null); setProjectAccount(null); refresh(); }, onError: (error: Error) => messageApi.error(error.message) });
  const lookupProject = useMutation({
    mutationFn: (handle: string) => lookupCollaborationProjectAccount(normalizeHandle(handle)),
    onSuccess: ({ data }) => {
      setProjectAccount(data);
      const existingName = form.getFieldValue("name");
      form.setFieldsValue({ projectTwitterId: data.twitterId, projectTwitterHandle: data.handle, projectDisplayName: data.displayName || data.handle, ...(existingName ? {} : { name: data.displayName || data.handle }) });
      messageApi.success(`已带出 @${data.handle} 的账号资料`);
    },
    onError: (error: Error) => messageApi.error(error.message || "未找到该项目 X 账号"),
  });
  const remove = useMutation({ mutationFn: deleteCollaborationActivity, onSuccess: () => { messageApi.success("已删除"); refresh(); }, onError: (error: Error) => messageApi.error(error.message) });
  const grant = useMutation({ mutationFn: (values: { authCenterUserId: string; role: "project_manager" | "agency_manager"; reason?: string }) => grantCollaborationAccess(accessActivity!.id, values), onSuccess: () => { messageApi.success("授权已保存"); accessForm.resetFields(); refresh(); }, onError: (error: Error) => messageApi.error(error.message) });
  const changeAccess = useMutation({ mutationFn: ({ activityId, accessId, status }: { activityId: string; accessId: string; status: "active" | "paused" | "revoked" }) => updateCollaborationAccess(activityId, accessId, { status }), onSuccess: refresh, onError: (error: Error) => messageApi.error(error.message) });
  const openEdit = (item?: CollaborationActivity) => {
    setEditing(item || null); setEditorOpen(true);
    setProjectAccount(item ? { twitterId: item.projectTwitterId, handle: item.projectTwitterHandle || "", displayName: item.projectDisplayName } : null);
    form.setFieldsValue(item ? { ...item, startAt: toLocalInput(item.startAt), endAt: toLocalInput(item.endAt), authCenterUserIds: [], invitationTemplate: { ...item.invitationTemplate, contentFormat: toTagValues(item.invitationTemplate?.contentFormat), language: toTagValues(item.invitationTemplate?.language) } } : { currency: "USDT", status: "draft", reviewerMode: "project", authCenterUserIds: [], invitationTemplate: { contentFormat: ["X 帖子"], language: ["中文", "English"], minimumOfferAmount: "100.00", confirmationDeadlineHours: 72 } });
  };
  const submit = (values: Record<string, unknown>) => {
    const startAt = new Date(String(values.startAt)); const endAt = new Date(String(values.endAt));
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return messageApi.error("请填写有效的活动时间");
    save.mutate({ ...values, startAt: startAt.toISOString(), endAt: endAt.toISOString(), invitationTemplate: cleanInvitationTemplate(values.invitationTemplate as Record<string, unknown>) });
  };
  const internalTestUserOptions = (internalTestUsersQuery.data?.data || []).map((user) => ({ value: user.authCenterUserId || `unlinked:${user.username}`, label: user.authCenterUserId ? user.username : `${user.username}（尚未登录 EchoHunt）`, disabled: !user.authCenterUserId }));
  const columns = [
    { title: "活动 / 项目 X", key: "name", render: (_: unknown, row: CollaborationActivity) => <><Typography.Text strong>{row.name}</Typography.Text><br /><Typography.Text type="secondary">{row.projectDisplayName || "-"} · @{row.projectTwitterHandle || "-"} · {row.projectTwitterId}</Typography.Text></> },
    { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "open" ? "green" : value === "archived" ? "default" : "orange"}>{value}</Tag> },
    { title: "资金池", render: (_: unknown, row: CollaborationActivity) => <>{row.fundingPoolAmount} {row.currency}<br /><Typography.Text type="secondary">可用 {row.availableAmount}</Typography.Text></> },
    { title: "时间", render: (_: unknown, row: CollaborationActivity) => <>{new Date(row.startAt).toLocaleString()}<br />至 {new Date(row.endAt).toLocaleString()}</> },
    { title: "授权", render: (_: unknown, row: CollaborationActivity) => <Tag>{row.accesses?.filter((access) => access.status === "active").length || 0} 人</Tag> },
    { title: "操作", render: (_: unknown, row: CollaborationActivity) => <Space><Button size="small" onClick={() => openEdit(row)}>编辑</Button><Button size="small" onClick={() => { setAccessActivity(row); accessForm.resetFields(); }}>授权</Button><Popconfirm title="仅 draft 且无金额承诺的活动可删除，确认继续？" onConfirm={() => remove.mutate(row.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
  ];
  return <PermissionGuard permission="business_collaboration_manage"><PageSection title="定向合作活动" description="选择项目 X 账号后自动带出资料，并为项目方人员分配可见和代发邀约权限。"><>{contextHolder}<Card extra={<Space><Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>新建活动</Button></Space>}><Table rowKey="id" loading={query.isLoading} columns={columns} dataSource={query.data?.data || []} pagination={false} /></Card><Modal open={editorOpen} title={editing ? "编辑定向合作活动" : "新建定向合作活动"} width={920} onCancel={() => { setEditorOpen(false); setEditing(null); setProjectAccount(null); }} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnClose><Form form={form} layout="vertical" onFinish={submit}><Row gutter={20}>
    <Col span={24}><Form.Item name="name" label={<InfoLabel label="活动名称" info="项目方和 KOL 在 EchoHunt 中看到的活动名称。" />} rules={[{ required: true }]}><Input placeholder="例如：Binance Wallet KOL 推广活动" /></Form.Item></Col>
    <Col span={24}><Form.Item name="description" label={<InfoLabel label="活动说明" info="用于说明合作目标、适合邀请的 KOL 和活动背景。" />}><Input.TextArea rows={2} placeholder="说明合作目标、适合邀请的 KOL 等信息" /></Form.Item></Col>
    <Col span={24}><Form.Item label={<InfoLabel label="项目 X 账号" info="输入 Handle 或从常用合作方中选择；系统会自动查询并保存对应的 X ID。" />} required extra="输入 @handle 或 x.com 链接后查询；下拉提供常用合作方账号。"><Form.Item name="projectTwitterHandle" noStyle rules={[{ required: true, message: "请输入或选择项目 X Handle" }]}><AutoComplete options={PROJECT_ACCOUNT_OPTIONS} onSelect={(value) => lookupProject.mutate(value)} onChange={() => { form.setFieldValue("projectTwitterId", undefined); setProjectAccount(null); }}><Input.Search placeholder="输入 @handle 或 x.com 链接" enterButton="查询" loading={lookupProject.isPending} onSearch={(value) => lookupProject.mutate(value)} /></AutoComplete></Form.Item></Form.Item><Form.Item name="projectTwitterId" hidden rules={[{ required: true, message: "请先查询并确认项目 X 账号" }]}><Input /></Form.Item></Col>
    <Col span={24}>{projectAccount && <Card size="small" style={{ marginBottom: 16 }}><Typography.Text strong>{projectAccount.displayName || projectAccount.handle}</Typography.Text><Typography.Text type="secondary"> · @{projectAccount.handle} · X ID {projectAccount.twitterId}{projectAccount.followers ? ` · ${projectAccount.followers.toLocaleString()} followers` : ""}</Typography.Text></Card>}<Form.Item name="projectDisplayName" hidden><Input /></Form.Item></Col>
    <Col xs={24} md={7}><Form.Item name="fundingPoolAmount" label={<InfoLabel label="资金池" info="本活动可用于支付 KOL 合作的总预算。" />} rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} min={0.01} precision={2} stringMode /></Form.Item></Col><Col xs={24} md={7}><Form.Item name="currency" label={<InfoLabel label="币种" info="资金池和每次邀约金额使用的计价币种。" />} rules={[{ required: true }]}><Input /></Form.Item></Col><Col xs={24} md={10}><Form.Item name="seatLimit" label={<InfoLabel label="名额" info="活动最多可确认合作的 KOL 数量。" />} rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} min={1} /></Form.Item></Col>
    <Col xs={24} md={8}><Form.Item name="startAt" label={<InfoLabel label="开始时间" info="从该时间起，项目方可以向 KOL 发出邀约。" />} rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="endAt" label={<InfoLabel label="结束时间" info="到达该时间后，系统不再允许发出或接受新邀约。" />} rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col xs={12} md={4}><Form.Item name="reviewerMode" label={<InfoLabel label="审核方" info="决定合作内容由项目方还是 EchoHunt 审核。" />}><Select options={[{ value: "project", label: "项目方" }, { value: "echohunt", label: "EchoHunt" }]} /></Form.Item></Col><Col xs={12} md={4}><Form.Item name="status" label={<InfoLabel label="状态" info="draft 为草稿；open 才允许发出新邀约。" />}><Select options={statuses.map((value) => ({ value, label: value }))} /></Form.Item></Col>
    {!editing && <Col span={24}><Form.Item name="authCenterUserIds" label={<InfoLabel label="项目方人员" info="所选人员可以看到该活动，并代表项目方在 EchoHunt 向 KOL 发送邀约。" />} extra="名单与 Nacos 活动页的“内部测试人员”保持一致；所选人员创建后可在 EchoHunt 查看本活动并代发邀约。标记“尚未登录”的人员需先登录一次 EchoHunt 后才能授权。"><Select mode="multiple" showSearch optionFilterProp="label" options={internalTestUserOptions} placeholder="选择内部测试人员（可多选）" loading={internalTestUsersQuery.isFetching} /></Form.Item></Col>}
    <Col span={24}><Card size="small" title={<InfoLabel label="邀约默认模板" info="以下内容会自动带入每一份新邀约，之后仍可针对单个 KOL 调整。" />}><Row gutter={16}><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "title"]} label={<InfoLabel label="邀约标题" info="KOL 收到邀约时看到的标题；留空则使用活动名称。" />}><Input placeholder="留空时使用活动名称" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "contentFormat"]} label={<InfoLabel label="内容形式" info="KOL 需要交付的内容类型；可多选，也可输入自定义形式后按回车。" />}><Select mode="tags" options={CONTENT_FORMAT_OPTIONS} tokenSeparators={[",", "，", "\n"]} placeholder="选择或输入内容形式" /></Form.Item></Col><Col span={24}><Form.Item name={["invitationTemplate", "message"]} label={<InfoLabel label="给 KOL 的邀约说明" info="KOL 在收到邀约时直接看到的简要合作说明。" />}><Input.TextArea rows={2} placeholder="简明介绍合作内容、预算与下一步" /></Form.Item></Col><Col span={24}><Form.Item name={["invitationTemplate", "brief"]} label={<InfoLabel label="合作 Brief" info="给创作参考的详细背景、创作方向、链接及禁忌事项。" />}><Input.TextArea rows={3} placeholder="背景、创作方向、链接、禁忌事项等" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "contentCount"]} label={<InfoLabel label="内容数量" info="本次合作需要交付的内容总数量，例如 1 条帖子。" />}><InputNumber style={{ width: "100%" }} min={1} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "language"]} label={<InfoLabel label="内容语言" info="KOL 创作内容可使用的语言；默认已选中文和英文，可多选或新增。" />}><Select mode="tags" options={LANGUAGE_OPTIONS} tokenSeparators={[",", "，", "\n"]} placeholder="选择或输入内容语言" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "minimumOfferAmount"]} label={<InfoLabel label="最低邀约金额" info="单次邀约金额不得低于此数值，避免项目方误发过低报价。" />}><InputNumber style={{ width: "100%" }} min={0.01} precision={2} stringMode /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "confirmationDeadlineHours"]} label={<InfoLabel label="项目方确认时限（小时）" info="KOL 接受邀约后，项目方完成确认合作的最长时限。" />}><InputNumber style={{ width: "100%" }} min={1} max={720} /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "requiredPoints"]} label={<InfoLabel label="必须表达事项" info="KOL 内容中必须覆盖的要点。可从常用项选择，也可输入新要求后按回车。" />}><Select mode="tags" options={REQUIRED_POINT_OPTIONS} tokenSeparators={[",", "，", "\n"]} placeholder="选择或输入必须表达事项" /></Form.Item></Col></Row></Card></Col>
  </Row></Form></Modal><Modal open={!!accessActivity} title={`授权 · ${accessActivity?.name || ""}`} footer={null} onCancel={() => setAccessActivity(null)}><Form form={accessForm} layout="vertical" onFinish={(values) => grant.mutate(values)}><Form.Item name="authCenterUserId" label="项目方人员" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={internalTestUserOptions} placeholder="选择内部测试人员" loading={internalTestUsersQuery.isFetching} /></Form.Item><Form.Item name="role" label="角色" initialValue="project_manager"><Select options={[{ value: "project_manager", label: "项目方管理者（可代发邀约）" }, { value: "agency_manager", label: "Agency 管理者" }]} /></Form.Item><Form.Item name="reason" label="授权说明"><Input /></Form.Item><Button htmlType="submit" type="primary" loading={grant.isPending}>保存授权</Button></Form><Descriptions column={1} size="small" title="现有授权" style={{ marginTop: 20 }}>{accessActivity?.accesses?.map((access) => <Descriptions.Item key={access.id} label={access.user?.displayName || access.user?.accountName || access.authCenterUserId}><Space><Tag>{access.role}</Tag><Tag>{access.status}</Tag>{access.status !== "revoked" && <Button size="small" onClick={() => changeAccess.mutate({ activityId: accessActivity.id, accessId: access.id, status: "revoked" })}>撤销</Button>}</Space></Descriptions.Item>)}</Descriptions></Modal></></PageSection></PermissionGuard>;
}
