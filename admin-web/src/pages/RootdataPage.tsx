import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  List,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchRootdataDaily,
  fetchRootdataDetailPollutionAudit,
  fetchRootdataQuota,
  forceVerifyRootdata,
  manualCrawlRootdata,
  setRootdataInitial,
} from "@/services/stats";
import type {
  RootdataDetailPollutionProject,
  RootdataProjectItem,
  RootdataRelationshipItem,
} from "@/types/stats";

const TABLE_MAX_HEIGHT = 480;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
}

function resolveForceVerifyQuery(input: string) {
  if (input.includes("rootdata.com")) {
    return { projectLink: input };
  }
  if (input.includes("x.com") || input.includes("twitter.com")) {
    return { twitterUrl: input };
  }
  return { keyword: input };
}

export function RootdataPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [forceInput, setForceInput] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualForce, setManualForce] = useState(false);

  const quotaQuery = useQuery({
    queryKey: ["rootdata", "quota"],
    queryFn: fetchRootdataQuota,
  });

  const dailyQuery = useQuery({
    queryKey: ["rootdata", "daily", date],
    queryFn: () => fetchRootdataDaily({ date }),
    enabled: Boolean(date),
  });

  const pollutionAuditQuery = useQuery({
    queryKey: ["rootdata", "detail-pollution-audit"],
    queryFn: () => fetchRootdataDetailPollutionAudit({ limit: 100 }),
  });

  const forceVerifyMutation = useMutation({
    mutationFn: forceVerifyRootdata,
    onSuccess: (result) => {
      messageApi.success(result.message || `更新成功，项目 ID: ${result.projectId || "-"}`);
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "强制更新失败");
    },
  });

  const manualCrawlMutation = useMutation({
    mutationFn: manualCrawlRootdata,
    onSuccess: (result) => {
      messageApi.success(result.message || "手动抓取请求已完成");
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "手动抓取失败");
    },
  });

  const setInitialMutation = useMutation({
    mutationFn: setRootdataInitial,
    onSuccess: (result) => {
      messageApi.success(result.data.message || "批量设置成功");
      void dailyQuery.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "设置初始项目失败");
    },
  });

  const quota = quotaQuery.data?.data;
  const daily = dailyQuery.data?.data;
  const pollutionAudit = pollutionAuditQuery.data?.data;

  const projectColumns: ColumnsType<RootdataProjectItem> = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 90,
    },
    {
      title: "项目",
      key: "projectName",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Link href={record.projectLink || undefined} target="_blank">
            {record.projectName || "-"}
          </Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.createdAt ? dayjs(record.createdAt).format("YYYY-MM-DD HH:mm") : "-"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "状态",
      key: "isInitial",
      width: 120,
      render: (_, record) => (
        <Tag color={record.isInitial ? "blue" : "default"}>
          {record.isInitial ? "初始项目" : "普通项目"}
        </Tag>
      ),
    },
    {
      title: "抓取失败次数",
      dataIndex: "detailFailuresNumber",
      key: "detailFailuresNumber",
      width: 130,
    },
  ];

  const relationshipColumns: ColumnsType<RootdataRelationshipItem> = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 90,
    },
    {
      title: "投资方",
      key: "investor",
      render: (_, record) => record.investorProject?.projectName || "-",
    },
    {
      title: "被投资方",
      key: "funded",
      render: (_, record) => record.fundedProject?.projectName || "-",
    },
    {
      title: "轮次",
      dataIndex: "round",
      key: "round",
      width: 120,
      render: (value: string | null | undefined) => value || "-",
    },
  ];

  const pollutionColumns: ColumnsType<RootdataDetailPollutionProject> = [
    {
      title: "等级",
      dataIndex: "severity",
      key: "severity",
      width: 100,
      render: (value: RootdataDetailPollutionProject["severity"]) => {
        const color = value === "critical" ? "red" : value === "warning" ? "orange" : "blue";
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: "项目",
      key: "projectName",
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Link href={record.projectLink || undefined} target="_blank">
            {record.projectName || "-"}
          </Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.entityType || "-"} · ID: {record.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "原因",
      key: "reasons",
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {[...record.reasons, ...record.reviewReasons.map((item) => `review:${item}`)].map((reason) => (
            <Tag key={reason}>{reason}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "Twitter",
      dataIndex: "twitterUrl",
      key: "twitterUrl",
      width: 220,
      ellipsis: true,
      render: (value: string | null | undefined) =>
        value ? (
          <Typography.Link href={value} target="_blank">
            {value}
          </Typography.Link>
        ) : (
          "-"
        ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 170,
      render: (value: string | null | undefined) => formatDateTime(value),
    },
  ];

  const manualSummaryItems = useMemo(() => {
    const data = manualCrawlMutation.data?.data;
    if (!data) return [];
    return [
      `项目：${data.project?.projectName || "-"}`,
      `耗时：${data.duration || "-"}`,
      `投资项目：${Array.isArray(data.asInvestor) ? data.asInvestor.length : 0}`,
      `被投关系：${Array.isArray(data.asInvestee) ? data.asInvestee.length : 0}`,
    ];
  }, [manualCrawlMutation.data]);

  return (
    <PermissionGuard permission="rootdata">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="RootData"
          description="RootData API 配额监控、每日新增数据查询，以及强制校验 / 手动抓取工具。"
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card
                title="API 配额"
                extra={
                  <Button onClick={() => quotaQuery.refetch()} loading={quotaQuery.isFetching}>
                    刷新
                  </Button>
                }
              >
                {quotaQuery.isError ? (
                  <Alert type="error" showIcon message="加载 RootData 配额失败" />
                ) : quota ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space align="baseline">
                      <Typography.Title level={2} style={{ margin: 0 }}>
                        {quota.credits?.toLocaleString?.() ?? quota.credits}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        / {quota.totalCredits?.toLocaleString?.() ?? quota.totalCredits}
                      </Typography.Text>
                      <Tag color="blue">{quota.level || "-"}</Tag>
                    </Space>
                    <Progress percent={Number(quota.usagePercent || 0)} />
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="已用">
                        {quota.used?.toLocaleString?.() ?? quota.used}
                      </Descriptions.Item>
                      <Descriptions.Item label="周期开始">
                        {formatDateTime(quota.periodStart)}
                      </Descriptions.Item>
                      <Descriptions.Item label="周期结束">
                        {formatDateTime(quota.periodEnd)}
                      </Descriptions.Item>
                    </Descriptions>
                  </Space>
                ) : (
                  <Empty description="暂无配额数据" />
                )}
              </Card>
            </Col>

            <Col xs={24} xl={12}>
              <Card title="强制 API 更新">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input
                    value={forceInput}
                    onChange={(e) => setForceInput(e.target.value)}
                    placeholder="Keyword / Twitter / RootData 链接"
                  />
                  <Button
                    type="primary"
                    loading={forceVerifyMutation.isPending}
                    onClick={() => {
                      const input = forceInput.trim();
                      if (!input) return messageApi.warning("请输入要校验的关键词或链接");
                      forceVerifyMutation.mutate(resolveForceVerifyQuery(input));
                    }}
                  >
                    更新
                  </Button>
                  <Typography.Text type="secondary">
                    清除缓存后通过 RootData API 重新验证数据，适合修复脏数据。
                  </Typography.Text>
                </Space>
              </Card>
            </Col>

            <Col xs={24} xl={12}>
              <Card title="手动触发爬虫">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="RootData 项目 / 机构 / 成员 URL"
                  />
                  <Checkbox checked={manualForce} onChange={(e) => setManualForce(e.target.checked)}>
                    强制重新爬取（会先删除旧数据与投资关系）
                  </Checkbox>
                  <Button
                    type="primary"
                    loading={manualCrawlMutation.isPending}
                    onClick={() => {
                      const url = manualUrl.trim();
                      if (!url) return messageApi.warning("请输入 RootData 链接");
                      manualCrawlMutation.mutate({ url, force: manualForce });
                    }}
                  >
                    抓取
                  </Button>
                  {manualSummaryItems.length ? (
                    <List
                      size="small"
                      bordered
                      dataSource={manualSummaryItems}
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  ) : null}
                </Space>
              </Card>
            </Col>

            <Col span={24}>
              <Card
                title="详情污染验证"
                extra={
                  <Space wrap>
                    <Button onClick={() => pollutionAuditQuery.refetch()} loading={pollutionAuditQuery.isFetching}>
                      刷新验证
                    </Button>
                    <Button
                      disabled={!pollutionAudit?.tampermonkeyQueue.length}
                      onClick={async () => {
                        if (!pollutionAudit?.tampermonkeyQueue.length) return;
                        const queue = pollutionAudit.tampermonkeyQueue.map(({ projectName, projectLink }) => ({
                          projectName,
                          projectLink,
                        }));
                        const command = `await RootDataFundraisingCollector.recrawlDetails(${JSON.stringify(queue)}, { maxInitial: ${queue.length}, maxSub: 0 })`;
                        await navigator.clipboard.writeText(command);
                        messageApi.success(`已复制 ${queue.length} 个确定污染项的全量重爬命令`);
                      }}
                    >
                      复制全量重爬命令
                    </Button>
                  </Space>
                }
              >
                {pollutionAuditQuery.isError ? (
                  <Alert type="error" showIcon message="加载详情污染验证失败" />
                ) : pollutionAudit ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Alert
                      type={pollutionAudit.summary.definite > 0 ? "warning" : "success"}
                      showIcon
                      message={
                        pollutionAudit.summary.definite > 0
                          ? `还有 ${pollutionAudit.summary.definite} 个确定污染项需要重爬`
                          : "当前没有确定污染项"
                      }
                      description={`扫描 ${pollutionAudit.summary.scanned} 个项目，生成时间：${formatDateTime(pollutionAudit.generatedAt)}。列表仅展示前 ${pollutionAudit.filter.listLimit} 个异常，复制命令会包含全部确定污染项。`}
                    />
                    <Row gutter={[16, 16]}>
                      <Col xs={12} md={6}>
                        <Card size="small"><Statistic title="Critical" value={pollutionAudit.summary.critical} valueStyle={{ color: "#cf1322" }} /></Card>
                      </Col>
                      <Col xs={12} md={6}>
                        <Card size="small"><Statistic title="Warning" value={pollutionAudit.summary.warning} valueStyle={{ color: "#d46b08" }} /></Card>
                      </Col>
                      <Col xs={12} md={6}>
                        <Card size="small"><Statistic title="Review" value={pollutionAudit.summary.review} /></Card>
                      </Col>
                      <Col xs={12} md={6}>
                        <Card size="small"><Statistic title="确定重爬" value={pollutionAudit.summary.definite} /></Card>
                      </Col>
                    </Row>
                    <Table
                      rowKey={(record) => String(record.id)}
                      columns={pollutionColumns}
                      dataSource={pollutionAudit.projects}
                      scroll={{ y: TABLE_MAX_HEIGHT, x: 980 }}
                      pagination={{ pageSize: 20 }}
                      locale={{ emptyText: <Empty description="暂无异常项目" /> }}
                    />
                  </Space>
                ) : (
                  <Empty description="暂无验证数据" />
                )}
              </Card>
            </Col>

            <Col xs={24} xl={12}>
              <Card
                title="每日新增数据"
                extra={
                  <Space wrap>
                    <DatePicker
                      value={dayjs(date)}
                      onChange={(value) => {
                        if (value) setDate(value.format("YYYY-MM-DD"));
                      }}
                      allowClear={false}
                    />
                    <Button type="primary" onClick={() => dailyQuery.refetch()} loading={dailyQuery.isFetching}>
                      查询
                    </Button>
                    <Button
                      onClick={() => setInitialMutation.mutate(date)}
                      loading={setInitialMutation.isPending}
                    >
                      全部标记为初始
                    </Button>
                  </Space>
                }
              >
                {dailyQuery.isError ? (
                  <Alert type="error" showIcon message="加载每日新增数据失败" />
                ) : daily ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Card size="small"><Statistic title="新增项目" value={daily.summary.projectsCount} /></Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small"><Statistic title="新增关系" value={daily.summary.relationshipsCount} /></Card>
                      </Col>
                    </Row>
                    <Tabs
                      items={[
                        {
                          key: "projects",
                          label: `项目 (${daily.summary.projectsCount})`,
                          children: (
                            <Table
                              rowKey={(record) => String(record.id)}
                              columns={projectColumns}
                              dataSource={daily.projects}
                              scroll={{ y: TABLE_MAX_HEIGHT }}
                              pagination={false}
                              locale={{ emptyText: <Empty description="该日期暂无新增项目" /> }}
                            />
                          ),
                        },
                        {
                          key: "relationships",
                          label: `关系 (${daily.summary.relationshipsCount})`,
                          children: (
                            <Table
                              rowKey={(record) => String(record.id)}
                              columns={relationshipColumns}
                              dataSource={daily.relationships}
                              scroll={{ y: TABLE_MAX_HEIGHT }}
                              pagination={false}
                              locale={{ emptyText: <Empty description="该日期暂无新增关系" /> }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Space>
                ) : (
                  <Empty description="请选择日期后查询" />
                )}
              </Card>
            </Col>
          </Row>
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
