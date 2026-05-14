import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchGenericStatsAggregate,
  fetchGenericStatsEvents,
  fetchGenericStatsTypes,
} from "@/services/stats";
import { ApiError } from "@/services/apiClient";
import type {
  GenericStatEventItem,
  GenericStatsAggregateItem,
  GenericStatsTypeItem,
} from "@/types/stats";

const AGGREGATE_TYPE = "xhunt.kol_chat.chat";
const EVENT_PAGE_SIZE = 20;
const TABLE_MAX_HEIGHT = 520;

function getDefaultDateFrom() {
  return dayjs().subtract(7, "day").startOf("day");
}

function formatDateTime(date?: string | null) {
  if (!date) return "-";
  return dayjs(date).format("YYYY-MM-DD HH:mm:ss");
}

function formatDateTimeForInput(value?: Dayjs | null) {
  return value ? value.toISOString() : undefined;
}

function buildEventSummary(item: GenericStatEventItem) {
  const metricsCount =
    item.metrics && typeof item.metrics === "object" ? Object.keys(item.metrics).length : 0;
  const dimensionsCount =
    item.dimensions && typeof item.dimensions === "object"
      ? Object.keys(item.dimensions).length
      : 0;
  const metaCount = item.meta && typeof item.meta === "object" ? Object.keys(item.meta).length : 0;

  return [
    item.action ? `动作 ${item.action}` : null,
    metricsCount ? `指标 ${metricsCount}` : null,
    dimensionsCount ? `维度 ${dimensionsCount}` : null,
    metaCount ? `附加 ${metaCount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildEventTooltip(item: GenericStatEventItem) {
  const details = {
    source: item.source,
    action: item.action,
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    subjectName: item.subjectName,
    actorType: item.actorType,
    actorId: item.actorId,
    actorName: item.actorName,
    countValue: item.countValue,
    numericValue: item.numericValue,
    dimensions: item.dimensions,
    metrics: item.metrics,
    meta: item.meta,
  };

  return JSON.stringify(details, null, 2);
}

export function GenericStatsPage() {
  const [form] = Form.useForm();
  const [page, setPage] = useState(1);
  const [selectedType, setSelectedType] = useState<string | undefined>(undefined);

  const typesQuery = useQuery({
    queryKey: ["generic-stats", "types"],
    queryFn: fetchGenericStatsTypes,
  });

  const filters = Form.useWatch([], form) as
    | {
        type?: string;
        dateFrom?: Dayjs;
        dateTo?: Dayjs;
        subjectId?: string;
        actorId?: string;
      }
    | undefined;

  useEffect(() => {
    if (!typesQuery.data?.data?.length) return;
    if (selectedType) return;

    const hasAggregateType = typesQuery.data.data.some(
      (item: GenericStatsTypeItem) => item.type === AGGREGATE_TYPE
    );
    if (hasAggregateType) {
      form.setFieldValue("type", AGGREGATE_TYPE);
      setSelectedType(AGGREGATE_TYPE);
    }
  }, [form, selectedType, typesQuery.data]);

  const queryParams = useMemo(
    () => ({
      type: filters?.type?.trim() || undefined,
      dateFrom: formatDateTimeForInput(filters?.dateFrom),
      dateTo: formatDateTimeForInput(filters?.dateTo),
      subjectId: filters?.subjectId?.trim() || undefined,
      actorId: filters?.actorId?.trim() || undefined,
    }),
    [filters]
  );

  const aggregateQuery = useQuery({
    queryKey: ["generic-stats", "aggregate", queryParams.type, queryParams.dateFrom, queryParams.dateTo, queryParams.subjectId],
    queryFn: () =>
      fetchGenericStatsAggregate({
        type: queryParams.type!,
        dateFrom: queryParams.dateFrom,
        dateTo: queryParams.dateTo,
        subjectId: queryParams.subjectId,
      }),
    enabled: Boolean(queryParams.type),
    retry: false,
  });

  const eventsQuery = useQuery({
    queryKey: [
      "generic-stats",
      "events",
      queryParams.type,
      queryParams.dateFrom,
      queryParams.dateTo,
      queryParams.subjectId,
      queryParams.actorId,
      page,
    ],
    queryFn: () =>
      fetchGenericStatsEvents({
        ...queryParams,
        page,
        pageSize: EVENT_PAGE_SIZE,
      }),
  });

  const aggregateSupported = queryParams.type === AGGREGATE_TYPE;
  const aggregateErrorMessage =
    aggregateQuery.error instanceof ApiError ? aggregateQuery.error.message : "加载聚合数据失败";

  const aggregateColumns: ColumnsType<GenericStatsAggregateItem> = [
    {
      title: "对象 ID",
      dataIndex: "subjectId",
      key: "subjectId",
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "对象名称",
      dataIndex: "subjectName",
      key: "subjectName",
      render: (value: string) => <Typography.Text strong>{value || "-"}</Typography.Text>,
    },
    {
      title: "事件条数",
      dataIndex: "callCount",
      key: "callCount",
    },
    {
      title: "累计计数",
      dataIndex: "questionCount",
      key: "questionCount",
    },
    {
      title: "去重触发者数",
      dataIndex: "uniqueUserCount",
      key: "uniqueUserCount",
    },
  ];

  const eventColumns: ColumnsType<GenericStatEventItem> = [
    {
      title: "时间",
      dataIndex: "eventAt",
      key: "eventAt",
      width: 180,
      render: (value: string, record) => (
        <Tooltip title={buildEventTooltip(record)}>
          <Typography.Text>{formatDateTime(value)}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 220,
      ellipsis: true,
      render: (value: string) => <Typography.Text>{value}</Typography.Text>,
    },
    {
      title: "对象",
      key: "subject",
      width: 220,
      render: (_, record) => (
        <Space size={8}>
          <Tag>{record.subjectType || "-"}</Tag>
          <Typography.Text ellipsis style={{ maxWidth: 120 }}>
            {record.subjectId || record.subjectName || "-"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "用户",
      key: "actor",
      width: 220,
      render: (_, record) => (
        <Space size={8}>
          <Tag color="blue">{record.actorType || "-"}</Tag>
          <Typography.Text ellipsis style={{ maxWidth: 120 }}>
            {record.actorName || record.actorId || "-"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "计数",
      dataIndex: "countValue",
      key: "countValue",
      width: 90,
    },
    {
      title: "事件信息",
      key: "summary",
      ellipsis: true,
      render: (_, record) => (
        <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{buildEventTooltip(record)}</pre>}>
          <Typography.Text ellipsis>{buildEventSummary(record) || "-"}</Typography.Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <PermissionGuard permission="generic-stats">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="通用统计"
          description="统一查看低频统计事件，支持按类型、时间、对象、用户筛选。"
          extra={
            <Space>
              <Button
                onClick={() => {
                  form.resetFields();
                  form.setFieldsValue({ dateFrom: getDefaultDateFrom() });
                  setSelectedType(undefined);
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  void typesQuery.refetch();
                  void aggregateQuery.refetch();
                  void eventsQuery.refetch();
                }}
                loading={typesQuery.isFetching || aggregateQuery.isFetching || eventsQuery.isFetching}
              >
                刷新
              </Button>
            </Space>
          }
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{ dateFrom: getDefaultDateFrom() }}
            onValuesChange={(changedValues) => {
              if (Object.prototype.hasOwnProperty.call(changedValues, "type")) {
                setSelectedType(changedValues.type || undefined);
              }
              setPage(1);
            }}
          >
            <Row gutter={[16, 8]}>
              <Col xs={24} md={8} lg={6}>
                <Form.Item label="统计类型" name="type">
                  <Select
                    allowClear
                    placeholder="全部类型"
                    loading={typesQuery.isLoading}
                    options={(typesQuery.data?.data || []).map((item) => ({
                      value: item.type,
                      label: `${item.type} (${item.count})`,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8} lg={6}>
                <Form.Item label="开始时间" name="dateFrom">
                  <DatePicker showTime style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8} lg={6}>
                <Form.Item label="结束时间" name="dateTo">
                  <DatePicker showTime style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8} lg={3}>
                <Form.Item label="对象 ID" name="subjectId">
                  <Input placeholder="如 cz" allowClear />
                </Form.Item>
              </Col>
              <Col xs={24} md={8} lg={3}>
                <Form.Item label="用户 ID" name="actorId">
                  <Input placeholder="用户 UUID" allowClear />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </PageSection>

        <PageSection
          title="对象聚合"
          description={
            !queryParams.type
              ? "请选择具体 type 后查看对象聚合。"
              : aggregateSupported
                ? "当前展示按对象维度的聚合结果。"
                : "当前 type 暂不支持对象聚合。"
          }
        >
          {aggregateSupported && aggregateQuery.data?.data?.summary ? (
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={6}>
                <Card>
                  <Statistic title="对象数量" value={aggregateQuery.data.data.summary.totalKols} />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card>
                  <Statistic title="事件条数" value={aggregateQuery.data.data.summary.totalCallCount} />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card>
                  <Statistic title="累计计数" value={aggregateQuery.data.data.summary.totalQuestionCount} />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card>
                  <Statistic
                    title="去重触发者数"
                    value={aggregateQuery.data.data.summary.totalUniqueUserCount}
                  />
                </Card>
              </Col>
            </Row>
          ) : null}

          {!queryParams.type ? (
            <Empty description="请选择具体 type 后查看对象聚合" />
          ) : !aggregateSupported ? (
            <Empty description="当前 type 暂不支持对象聚合" />
          ) : aggregateQuery.isError ? (
            <Empty description={aggregateErrorMessage} />
          ) : (
            <Table
              rowKey={(record) => record.subjectId}
              columns={aggregateColumns}
              dataSource={aggregateQuery.data?.data?.items || []}
              loading={aggregateQuery.isLoading || aggregateQuery.isFetching}
              locale={{ emptyText: <Empty description="当前筛选条件下暂无聚合数据" /> }}
              pagination={false}
              scroll={{ y: TABLE_MAX_HEIGHT }}
            />
          )}
        </PageSection>

        <PageSection title="原始事件" description="展示原始事件列表，可继续按页查看。">
          <Table
            rowKey={(record) => String(record.id)}
            columns={eventColumns}
            dataSource={eventsQuery.data?.data?.items || []}
            loading={eventsQuery.isLoading || eventsQuery.isFetching}
            locale={{
              emptyText: eventsQuery.isError ? (
                <Empty description="加载统计事件失败" />
              ) : (
                <Empty description="当前筛选条件下暂无事件" />
              ),
            }}
            pagination={{
              current: eventsQuery.data?.data?.pagination.page || page,
              pageSize: eventsQuery.data?.data?.pagination.pageSize || EVENT_PAGE_SIZE,
              total: eventsQuery.data?.data?.pagination.total || 0,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (nextPage) => setPage(nextPage),
            }}
            onChange={(pagination: TablePaginationConfig) => {
              if (pagination.current) {
                setPage(pagination.current);
              }
            }}
            scroll={{ y: TABLE_MAX_HEIGHT, x: 1100 }}
          />
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
