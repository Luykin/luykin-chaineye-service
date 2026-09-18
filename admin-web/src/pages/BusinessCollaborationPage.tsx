import { useState } from "react";
import { AutoComplete, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
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

const toLocalInput = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const normalizeHandle = (value: unknown) => String(value || "").trim().replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "").split(/[/?#]/)[0].replace(/^@+/, "");

function cleanInvitationTemplate(template: Record<string, unknown> = {}) {
  const clean: Record<string, unknown> = { ...template };
  ["title", "message", "brief", "contentFormat", "language", "minimumOfferAmount"].forEach((key) => {
    const value = template[key];
    if (typeof value === "string" && value.trim()) clean[key] = value.trim();
    else if (key === "minimumOfferAmount" && typeof value === "number" && Number.isFinite(value)) clean[key] = String(value);
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
    form.setFieldsValue(item ? { ...item, startAt: toLocalInput(item.startAt), endAt: toLocalInput(item.endAt), authCenterUserIds: [], invitationTemplate: item.invitationTemplate || {} } : { currency: "USDT", status: "draft", reviewerMode: "project", authCenterUserIds: [], invitationTemplate: { minimumOfferAmount: "100.00", confirmationDeadlineHours: 72 } });
  };
  const submit = (values: Record<string, unknown>) => {
    const startAt = new Date(String(values.startAt)); const endAt = new Date(String(values.endAt));
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return messageApi.error("请填写有效的活动时间");
    save.mutate({ ...values, startAt: startAt.toISOString(), endAt: endAt.toISOString(), invitationTemplate: cleanInvitationTemplate(values.invitationTemplate as Record<string, unknown>) });
  };
  const internalTestUserOptions = (internalTestUsersQuery.data?.data || []).map((user) => ({ value: user.id, label: user.username }));
  const columns = [
    { title: "活动 / 项目 X", key: "name", render: (_: unknown, row: CollaborationActivity) => <><Typography.Text strong>{row.name}</Typography.Text><br /><Typography.Text type="secondary">{row.projectDisplayName || "-"} · @{row.projectTwitterHandle || "-"} · {row.projectTwitterId}</Typography.Text></> },
    { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "open" ? "green" : value === "archived" ? "default" : "orange"}>{value}</Tag> },
    { title: "资金池", render: (_: unknown, row: CollaborationActivity) => <>{row.fundingPoolAmount} {row.currency}<br /><Typography.Text type="secondary">可用 {row.availableAmount}</Typography.Text></> },
    { title: "时间", render: (_: unknown, row: CollaborationActivity) => <>{new Date(row.startAt).toLocaleString()}<br />至 {new Date(row.endAt).toLocaleString()}</> },
    { title: "授权", render: (_: unknown, row: CollaborationActivity) => <Tag>{row.accesses?.filter((access) => access.status === "active").length || 0} 人</Tag> },
    { title: "操作", render: (_: unknown, row: CollaborationActivity) => <Space><Button size="small" onClick={() => openEdit(row)}>编辑</Button><Button size="small" onClick={() => { setAccessActivity(row); accessForm.resetFields(); }}>授权</Button><Popconfirm title="仅 draft 且无金额承诺的活动可删除，确认继续？" onConfirm={() => remove.mutate(row.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
  ];
  return <PermissionGuard permission="business_collaboration_manage"><PageSection title="定向合作活动" description="选择项目 X 账号后自动带出资料，并为项目方人员分配可见和代发邀约权限。"><>{contextHolder}<Card extra={<Space><Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>新建活动</Button></Space>}><Table rowKey="id" loading={query.isLoading} columns={columns} dataSource={query.data?.data || []} pagination={false} /></Card><Modal open={editorOpen} title={editing ? "编辑定向合作活动" : "新建定向合作活动"} width={920} onCancel={() => { setEditorOpen(false); setEditing(null); setProjectAccount(null); }} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnClose><Form form={form} layout="vertical" onFinish={submit}><Row gutter={20}>
    <Col span={24}><Form.Item name="name" label="活动名称" rules={[{ required: true }]}><Input placeholder="例如：Binance Wallet KOL 推广活动" /></Form.Item></Col>
    <Col span={24}><Form.Item name="description" label="活动说明"><Input.TextArea rows={2} placeholder="说明合作目标、适合邀请的 KOL 等信息" /></Form.Item></Col>
    <Col span={24}><Form.Item label="项目 X 账号" required extra="输入 @handle 或 x.com 链接后查询；下拉提供常用合作方账号。"><Form.Item name="projectTwitterHandle" noStyle rules={[{ required: true, message: "请输入或选择项目 X Handle" }]}><AutoComplete options={PROJECT_ACCOUNT_OPTIONS} onSelect={(value) => lookupProject.mutate(value)} onChange={() => { form.setFieldValue("projectTwitterId", undefined); setProjectAccount(null); }}><Input.Search placeholder="输入 @handle 或 x.com 链接" enterButton="查询" loading={lookupProject.isPending} onSearch={(value) => lookupProject.mutate(value)} /></AutoComplete></Form.Item></Form.Item><Form.Item name="projectTwitterId" hidden rules={[{ required: true, message: "请先查询并确认项目 X 账号" }]}><Input /></Form.Item></Col>
    <Col span={24}>{projectAccount && <Card size="small" style={{ marginBottom: 16 }}><Typography.Text strong>{projectAccount.displayName || projectAccount.handle}</Typography.Text><Typography.Text type="secondary"> · @{projectAccount.handle} · X ID {projectAccount.twitterId}{projectAccount.followers ? ` · ${projectAccount.followers.toLocaleString()} followers` : ""}</Typography.Text></Card>}<Form.Item name="projectDisplayName" hidden><Input /></Form.Item></Col>
    <Col xs={24} md={7}><Form.Item name="fundingPoolAmount" label="资金池" rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} min={0.01} precision={2} stringMode /></Form.Item></Col><Col xs={24} md={7}><Form.Item name="currency" label="币种" rules={[{ required: true }]}><Input /></Form.Item></Col><Col xs={24} md={10}><Form.Item name="seatLimit" label="名额" rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} min={1} /></Form.Item></Col>
    <Col xs={24} md={8}><Form.Item name="startAt" label="开始时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="endAt" label="结束时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col xs={12} md={4}><Form.Item name="reviewerMode" label="审核方"><Select options={[{ value: "project", label: "项目方" }, { value: "echohunt", label: "EchoHunt" }]} /></Form.Item></Col><Col xs={12} md={4}><Form.Item name="status" label="状态"><Select options={statuses.map((value) => ({ value, label: value }))} /></Form.Item></Col>
    {!editing && <Col span={24}><Form.Item name="authCenterUserIds" label="项目方人员" extra="名单与 Nacos 活动页的“内部测试人员”保持一致；所选人员创建后可在 EchoHunt 查看本活动并代发邀约。"><Select mode="multiple" showSearch optionFilterProp="label" options={internalTestUserOptions} placeholder="选择内部测试人员（可多选）" loading={internalTestUsersQuery.isFetching} /></Form.Item></Col>}
    <Col span={24}><Card size="small" title="邀约默认模板" extra={<Typography.Text type="secondary">创建后发邀约时自动带入，可在单次邀约中调整</Typography.Text>}><Row gutter={16}><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "title"]} label="邀约标题"><Input placeholder="留空时使用活动名称" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "contentFormat"]} label="内容形式"><Input placeholder="例如：X 帖子 + 体验分享" /></Form.Item></Col><Col span={24}><Form.Item name={["invitationTemplate", "message"]} label="给 KOL 的邀约说明"><Input.TextArea rows={2} placeholder="简明介绍合作内容、预算与下一步" /></Form.Item></Col><Col span={24}><Form.Item name={["invitationTemplate", "brief"]} label="合作 Brief"><Input.TextArea rows={3} placeholder="背景、创作方向、链接、禁忌事项等" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "contentCount"]} label="内容数量"><InputNumber style={{ width: "100%" }} min={1} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "language"]} label="内容语言"><Input placeholder="例如：中文 / English" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name={["invitationTemplate", "minimumOfferAmount"]} label="最低邀约金额"><InputNumber style={{ width: "100%" }} min={0.01} precision={2} stringMode /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "confirmationDeadlineHours"]} label="项目方确认时限（小时）"><InputNumber style={{ width: "100%" }} min={1} max={720} /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["invitationTemplate", "requiredPoints"]} label="必须表达事项"><Select mode="tags" tokenSeparators={[",", "，", "\n"]} placeholder="输入后回车，可添加多项" /></Form.Item></Col></Row></Card></Col>
  </Row></Form></Modal><Modal open={!!accessActivity} title={`授权 · ${accessActivity?.name || ""}`} footer={null} onCancel={() => setAccessActivity(null)}><Form form={accessForm} layout="vertical" onFinish={(values) => grant.mutate(values)}><Form.Item name="authCenterUserId" label="项目方人员" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={internalTestUserOptions} placeholder="选择内部测试人员" loading={internalTestUsersQuery.isFetching} /></Form.Item><Form.Item name="role" label="角色" initialValue="project_manager"><Select options={[{ value: "project_manager", label: "项目方管理者（可代发邀约）" }, { value: "agency_manager", label: "Agency 管理者" }]} /></Form.Item><Form.Item name="reason" label="授权说明"><Input /></Form.Item><Button htmlType="submit" type="primary" loading={grant.isPending}>保存授权</Button></Form><Descriptions column={1} size="small" title="现有授权" style={{ marginTop: 20 }}>{accessActivity?.accesses?.map((access) => <Descriptions.Item key={access.id} label={access.user?.displayName || access.user?.accountName || access.authCenterUserId}><Space><Tag>{access.role}</Tag><Tag>{access.status}</Tag>{access.status !== "revoked" && <Button size="small" onClick={() => changeAccess.mutate({ activityId: accessActivity.id, accessId: access.id, status: "revoked" })}>撤销</Button>}</Space></Descriptions.Item>)}</Descriptions></Modal></></PageSection></PermissionGuard>;
}
