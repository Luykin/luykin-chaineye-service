import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Pagination,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchSecurityViolations } from "@/services/stats";

const PAGE_SIZE = 50;

function reasonColor(reason?: string | null) {
  if (!reason) return "default";
  if (reason.includes("signature") || reason.includes("timestamp")) return "error";
  if (reason.includes("fingerprint") || reason.includes("duplicate")) return "warning";
  return "processing";
}

export function SecurityViolationsPage() {
  const [page, setPage] = useState(1);
  const [reasonCode, setReasonCode] = useState<string | undefined>();
  const [ip, setIp] = useState("");
  const [submittedIp, setSubmittedIp] = useState("");

  const query = useQuery({
    queryKey: ["security-violations", page, reasonCode, submittedIp],
    queryFn: () =>
      fetchSecurityViolations({
        page,
        limit: PAGE_SIZE,
        reasonCode,
        ip: submittedIp || undefined,
      }),
  });

  const topIps = query.data?.topIps || [];
  const rows = query.data?.data || [];
  const pagination = query.data?.pagination;

  const reasonOptions = useMemo(
    () => [
      "missing_headers",
      "invalid_fingerprint",
      "invalid_request_id",
      "invalid_timestamp",
      "duplicate_request",
      "invalid_signature",
      "unknown",
    ].map((value) => ({ label: value, value })),
    []
  );

  return (
    <PermissionGuard permission="security-violations">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="安全违规"
          description="查看安全校验失败请求，支持按原因与 IP 筛选，并查看最近 7 天高频风险 IP。"
          extra={
            <Space wrap>
              <Select
                allowClear
                placeholder="筛选 reasonCode"
                style={{ width: 220 }}
                value={reasonCode}
                onChange={(value) => {
                  setReasonCode(value);
                  setPage(1);
                }}
                options={reasonOptions}
              />
              <Input.Search
                allowClear
                placeholder="按 IP 搜索"
                style={{ width: 220 }}
                onSearch={(value) => {
                  setSubmittedIp(value.trim());
                  setPage(1);
                }}
                onChange={(e) => setIp(e.target.value)}
                value={ip}
              />
              <Button onClick={() => query.refetch()} loading={query.isFetching}>
                刷新
              </Button>
            </Space>
          }
        >
          {topIps.length ? (
            <Card size="small" title="最近 7 天风险 IP Top 10" style={{ marginBottom: 16 }}>
              <Space wrap>
                {topIps.map((item) => (
                  <Tag key={item.ip} color="red">
                    {item.ip} · {item.count}
                  </Tag>
                ))}
              </Space>
            </Card>
          ) : null}

          {rows.length ? (
            <List
              dataSource={rows}
              loading={query.isLoading || query.isFetching}
              renderItem={(item) => (
                <List.Item style={{ padding: 0, marginBottom: 16, border: "none" }}>
                  <Card style={{ width: "100%" }}>
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                        <Typography.Text strong>
                          {dayjs(item.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                        </Typography.Text>
                        <Space wrap>
                          <Tag color={reasonColor(item.reasonCode)}>{item.reasonCode || "-"}</Tag>
                          <Tag>{item.requestMethod || "-"}</Tag>
                          <Tag color="blue">{item.clientIp || "-"}</Tag>
                        </Space>
                      </Space>

                      <Space direction="vertical" size={4}>
                        <Typography.Text>
                          <strong>Path：</strong>
                          {item.requestPath || "-"}
                        </Typography.Text>
                        <Typography.Text>
                          <strong>Detail：</strong>
                          {item.errorDetail || "-"}
                        </Typography.Text>
                        <Typography.Text>
                          <strong>Request ID：</strong>
                          {item.requestId || "-"}
                        </Typography.Text>
                        <Typography.Text>
                          <strong>Fingerprint：</strong>
                          {item.fingerprint || "-"}
                        </Typography.Text>
                        <Typography.Text>
                          <strong>Extension：</strong>
                          {item.extensionVersion || "-"}
                        </Typography.Text>
                      </Space>

                      <Collapse
                        size="small"
                        items={[
                          {
                            key: "details",
                            label: "查看 Headers / Body / User-Agent 详情",
                            children: (
                              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                                <div>
                                  <Typography.Text strong>Headers</Typography.Text>
                                  <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                                    {JSON.stringify(item.headers || {}, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <Typography.Text strong>Request Body</Typography.Text>
                                  <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                                    {item.requestBody || "-"}
                                  </pre>
                                </div>
                                <div>
                                  <Typography.Text strong>User-Agent</Typography.Text>
                                  <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                                    {item.userAgent || "-"}
                                  </pre>
                                </div>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </Space>
                  </Card>
                </List.Item>
              )}
              locale={{
                emptyText: <Empty description="暂无安全违规记录" />,
              }}
            />
          ) : (
            <Empty description={query.isError ? "加载安全违规失败" : "暂无安全违规记录"} />
          )}

          {pagination ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Pagination
                current={pagination.page}
                pageSize={pagination.limit}
                total={pagination.total}
                showSizeChanger={false}
                onChange={(nextPage: number) => setPage(nextPage)}
              />
            </div>
          ) : null}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
