import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Input,
  List,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { clearCacheByPrefix, fetchDeviceStatus } from "@/services/stats";
import type { DeviceStatusResponse } from "@/types/stats";

const TABLE_MAX_HEIGHT = 360;

export function DeviceMonitorPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [cachePrefix, setCachePrefix] = useState("");

  const query = useQuery({
    queryKey: ["device-status"],
    queryFn: fetchDeviceStatus,
    refetchInterval: 60_000,
  });

  const clearCacheMutation = useMutation({
    mutationFn: clearCacheByPrefix,
    onSuccess: (result) => {
      messageApi.success(result.message || `已处理 ${result.deletedCount || 0} 个键`);
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "清除缓存失败");
    },
  });

  const data = query.data;

  const pm2Columns: ColumnsType<NonNullable<DeviceStatusResponse["pm2"]>[number]> = [
    { title: "进程", dataIndex: "name", key: "name" },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (value?: string) => (
        <Tag color={value === "online" ? "success" : "default"}>{value || "-"}</Tag>
      ),
    },
    { title: "CPU", dataIndex: "cpu", key: "cpu", width: 90 },
    { title: "内存", dataIndex: "memory", key: "memory", width: 120 },
    { title: "重启次数", dataIndex: "restarts", key: "restarts", width: 100 },
    { title: "运行时长", dataIndex: "uptime", key: "uptime", width: 160 },
  ];

  const diskColumns: ColumnsType<NonNullable<DeviceStatusResponse["disk"]>[number]> = [
    { title: "文件系统", dataIndex: "filesystem", key: "filesystem" },
    { title: "大小", dataIndex: "size", key: "size", width: 100 },
    { title: "已用", dataIndex: "used", key: "used", width: 100 },
    { title: "可用", dataIndex: "available", key: "available", width: 100 },
    { title: "使用率", dataIndex: "usePercent", key: "usePercent", width: 100 },
    { title: "挂载点", dataIndex: "mounted", key: "mounted" },
  ];

  return (
    <PermissionGuard permission="device-status:read">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="设备监控"
          description="查看服务器系统、PM2、Redis、PostgreSQL、磁盘与 SSE 的实时状态。"
          extra={
            <Button onClick={() => query.refetch()} loading={query.isFetching}>
              刷新
            </Button>
          }
        >
          {query.isError ? (
            <Alert type="error" showIcon message="加载设备状态失败" />
          ) : data ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Typography.Text type="secondary">更新时间：{data.timestamp}</Typography.Text>
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={8}>
                  <Card title="系统信息">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="平台">{data.system?.platform || "-"}</Descriptions.Item>
                      <Descriptions.Item label="主机">{data.system?.hostname || "-"}</Descriptions.Item>
                      <Descriptions.Item label="运行时长">{data.system?.uptime || "-"}</Descriptions.Item>
                      <Descriptions.Item label="架构">{data.system?.arch || "-"}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col xs={24} xl={8}>
                  <Card title="CPU">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="核数">{data.cpu?.cores || "-"}</Descriptions.Item>
                      <Descriptions.Item label="型号">{data.cpu?.model || "-"}</Descriptions.Item>
                      <Descriptions.Item label="使用率">{data.cpu?.usage || "-"}</Descriptions.Item>
                      <Descriptions.Item label="负载">{data.cpu?.loadAverage || "-"}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col xs={24} xl={8}>
                  <Card title="内存">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="总内存">{data.memory?.total || "-"}</Descriptions.Item>
                      <Descriptions.Item label="已使用">{data.memory?.used || "-"}</Descriptions.Item>
                      <Descriptions.Item label="可用">{data.memory?.free || "-"}</Descriptions.Item>
                      <Descriptions.Item label="使用率">{data.memory?.usagePercent || "-"}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
              </Row>

              <Card title="PM2 进程状态">
                <Table
                  rowKey={(record) =>
                    [record.name, record.status, record.uptime].filter(Boolean).join("-")
                  }
                  columns={pm2Columns}
                  dataSource={data.pm2 || []}
                  scroll={{ y: TABLE_MAX_HEIGHT }}
                  pagination={false}
                  locale={{ emptyText: <Empty description="暂无 PM2 数据" /> }}
                />
              </Card>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card title="Redis">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="连接状态">
                        <Tag color={data.redis?.connected ? "success" : "default"}>
                          {data.redis?.connected ? "已连接" : "未连接"}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="已用内存">{data.redis?.memory || "-"}</Descriptions.Item>
                      <Descriptions.Item label="内存限制">{data.redis?.maxMemory || "-"}</Descriptions.Item>
                      <Descriptions.Item label="内存使用率">{data.redis?.memoryUsagePercent || "-"}</Descriptions.Item>
                      <Descriptions.Item label="Key 数量">{data.redis?.keys ?? "-"}</Descriptions.Item>
                      <Descriptions.Item label="运行天数">{data.redis?.uptime || "-"}</Descriptions.Item>
                    </Descriptions>
                    {data.redis?.keyDistribution?.groups?.length ? (
                      <List
                        size="small"
                        header="Key 前缀分布（采样）"
                        bordered
                        dataSource={data.redis.keyDistribution.groups}
                        style={{ marginTop: 16 }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space style={{ width: "100%", justifyContent: "space-between" }}>
                              <Typography.Text code>{item.prefix}</Typography.Text>
                              <Typography.Text>
                                {item.count} / {item.percent}%
                              </Typography.Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : null}
                  </Card>
                </Col>

                <Col xs={24} xl={12}>
                  <Card title="PostgreSQL">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="连接状态">
                        <Tag color={data.postgresql?.connected ? "success" : "default"}>
                          {data.postgresql?.connected ? "已连接" : "未连接"}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="版本">{data.postgresql?.version || "-"}</Descriptions.Item>
                      <Descriptions.Item label="数据库大小">{data.postgresql?.size || "-"}</Descriptions.Item>
                      <Descriptions.Item label="活跃连接数">{data.postgresql?.connections ?? "-"}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                  <Card title="SSE 状态" style={{ marginTop: 16 }}>
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="可用状态">
                        <Tag color={data.sse?.available ? "success" : "default"}>
                          {data.sse?.available ? "可用" : "不可用"}
                        </Tag>
                      </Descriptions.Item>
                    </Descriptions>
                    <Collapse
                      size="small"
                      style={{ marginTop: 12 }}
                      items={[
                        {
                          key: "sse-raw",
                          label: "查看详细状态",
                          children: (
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                              {JSON.stringify(data.sse || {}, null, 2)}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  </Card>
                </Col>
              </Row>

              <Card title="磁盘使用情况">
                <Table
                  rowKey={(record) => `${record.filesystem}-${record.mounted}`}
                  columns={diskColumns}
                  dataSource={data.disk || []}
                  pagination={false}
                  scroll={{ y: TABLE_MAX_HEIGHT }}
                  locale={{ emptyText: <Empty description="暂无磁盘信息" /> }}
                />
              </Card>

              <Card title="清除缓存">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      value={cachePrefix}
                      onChange={(e) => setCachePrefix(e.target.value)}
                      placeholder="输入缓存 key 前缀"
                      style={{ minWidth: 260, flex: 1 }}
                    />
                    <Button
                      danger
                      type="primary"
                      loading={clearCacheMutation.isPending}
                      onClick={() => {
                        const prefix = cachePrefix.trim();
                        if (!prefix) return messageApi.warning("请输入缓存 key 前缀");
                        clearCacheMutation.mutate(prefix);
                      }}
                    >
                      清除
                    </Button>
                  </Space>
                  <Typography.Text type="secondary">
                    常见示例：rootdata_verified: / rootdata_search_ / dau: / twitter_oauth_state:
                  </Typography.Text>
                </Space>
              </Card>
            </Space>
          ) : (
            <Empty description="暂无设备状态数据" />
          )}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
