import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, DatePicker, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useAuth } from "@/app/auth";
import {
  deleteCampaignTweetSubmissionAdmin,
  fetchCampaignTweetSubmissionsAdmin,
} from "@/services/nacos";
import type { CampaignTweetSubmissionItem } from "@/types/nacos";

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const DEFAULT_PAGE_SIZE = 50;

type DateRange = [Dayjs | null, Dayjs | null] | null;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getLeaderboardOptions(campaignConfig?: Record<string, unknown> | null) {
  const items = Array.isArray(campaignConfig?.customLeaderboards)
    ? campaignConfig.customLeaderboards
    : [];
  return items
    .map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, any> : {};
      const value = String(row.id || "").trim();
      if (!value) return null;
      const label = row.short_name?.zh || row.name?.zh || row.short_name?.en || row.name?.en || value || `榜单 ${index + 1}`;
      return { value, label: `${label}（${value}）` };
    })
    .filter((item): item is { value: string; label: string } => !!item);
}

export function CampaignTweetSubmissionsModal({
  open,
  campaign,
  campaignConfig,
  onClose,
  onToast,
}: {
  open: boolean;
  campaign: string;
  campaignConfig?: Record<string, unknown> | null;
  onClose: () => void;
  onToast?: (message: string, type?: "success" | "error" | "info") => void;
}) {
  const { hasPermission } = useAuth();
  const canDelete = hasPermission("campaign-tweet-submissions:delete");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rows, setRows] = useState<CampaignTweetSubmissionItem[]>([]);
  const [leaderboardKey, setLeaderboardKey] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [appliedLeaderboardKey, setAppliedLeaderboardKey] = useState("");
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(null);
  const [appliedPageSize, setAppliedPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const leaderboardOptions = useMemo(
    () => getLeaderboardOptions(campaignConfig),
    [campaignConfig],
  );

  async function loadPage({
    cursor,
    nextPageIndex,
    nextLeaderboardKey = leaderboardKey,
    nextDateRange = dateRange,
    nextPageSize = pageSize,
  }: {
    cursor: string | null;
    nextPageIndex: number;
    nextLeaderboardKey?: string;
    nextDateRange?: DateRange;
    nextPageSize?: number;
  }) {
    if (!campaign) return;
    setLoading(true);
    try {
      const resp = await fetchCampaignTweetSubmissionsAdmin({
        campaign,
        leaderboardKey: nextLeaderboardKey || undefined,
        from: nextDateRange?.[0]?.toISOString(),
        to: nextDateRange?.[1]?.toISOString(),
        cursor: cursor || undefined,
        limit: nextPageSize,
      });
      setRows(resp.data.items || []);
      setNextCursor(resp.data.nextCursor || null);
      setPageIndex(nextPageIndex);
      setAppliedLeaderboardKey(nextLeaderboardKey);
      setAppliedDateRange(nextDateRange);
      setAppliedPageSize(nextPageSize);
    } catch (error) {
      onToast?.(
        `投稿记录加载失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !campaign) return;
    setLeaderboardKey("");
    setDateRange(null);
    setPageSize(DEFAULT_PAGE_SIZE);
    setAppliedLeaderboardKey("");
    setAppliedDateRange(null);
    setAppliedPageSize(DEFAULT_PAGE_SIZE);
    setRows([]);
    setPageIndex(0);
    setPageCursors([null]);
    setNextCursor(null);
    void loadPage({
      cursor: null,
      nextPageIndex: 0,
      nextLeaderboardKey: "",
      nextDateRange: null,
      nextPageSize: DEFAULT_PAGE_SIZE,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign]);

  function queryFirstPage() {
    setPageCursors([null]);
    void loadPage({ cursor: null, nextPageIndex: 0 });
  }

  function resetFilters() {
    setLeaderboardKey("");
    setDateRange(null);
    setPageSize(DEFAULT_PAGE_SIZE);
    setPageCursors([null]);
    void loadPage({
      cursor: null,
      nextPageIndex: 0,
      nextLeaderboardKey: "",
      nextDateRange: null,
      nextPageSize: DEFAULT_PAGE_SIZE,
    });
  }

  function loadNextPage() {
    if (!nextCursor) return;
    const targetPageIndex = pageIndex + 1;
    setPageCursors((current) => [...current.slice(0, targetPageIndex), nextCursor]);
    void loadPage({
      cursor: nextCursor,
      nextPageIndex: targetPageIndex,
      nextLeaderboardKey: appliedLeaderboardKey,
      nextDateRange: appliedDateRange,
      nextPageSize: appliedPageSize,
    });
  }

  function loadPreviousPage() {
    if (pageIndex <= 0) return;
    const targetPageIndex = pageIndex - 1;
    void loadPage({
      cursor: pageCursors[targetPageIndex] || null,
      nextPageIndex: targetPageIndex,
      nextLeaderboardKey: appliedLeaderboardKey,
      nextDateRange: appliedDateRange,
      nextPageSize: appliedPageSize,
    });
  }

  async function deleteRecord(record: CampaignTweetSubmissionItem) {
    setDeletingId(record.id);
    try {
      await deleteCampaignTweetSubmissionAdmin(record.id, campaign);
      onToast?.("投稿记录已删除", "success");
      const targetPageIndex = rows.length <= 1 && pageIndex > 0 ? pageIndex - 1 : pageIndex;
      if (targetPageIndex !== pageIndex) {
        setPageCursors((current) => current.slice(0, targetPageIndex + 1));
      }
      await loadPage({
        cursor: pageCursors[targetPageIndex] || null,
        nextPageIndex: targetPageIndex,
        nextLeaderboardKey: appliedLeaderboardKey,
        nextDateRange: appliedDateRange,
        nextPageSize: appliedPageSize,
      });
    } catch (error) {
      onToast?.(
        `删除失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setDeletingId(null);
    }
  }

  const externalUrl = useMemo(() => {
    const origin = typeof window === "undefined" ? "https://your-domain.example" : window.location.origin;
    const url = new URL(
      `/api/xhunt/echohunt/external/campaigns/${encodeURIComponent(campaign)}/tweet-submissions`,
      origin,
    );
    if (leaderboardKey) url.searchParams.set("leaderboardKey", leaderboardKey);
    if (dateRange?.[0]) url.searchParams.set("from", dateRange[0].toISOString());
    if (dateRange?.[1]) url.searchParams.set("to", dateRange[1].toISOString());
    url.searchParams.set("limit", String(pageSize));
    return url.toString();
  }, [campaign, leaderboardKey, dateRange, pageSize]);

  const curlExample = `curl '${externalUrl}'`;

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onToast?.(`${label}已复制`, "success");
    } catch {
      onToast?.(`${label}复制失败，请手动复制`, "error");
    }
  }

  return (
    <Modal
      open={open}
      title={`投稿记录 · ${campaign || "未选择活动"}`}
      width="94%"
      style={{ maxWidth: 1280 }}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card size="small">
          <Space wrap size={[12, 8]} align="end">
            <Space direction="vertical" size={4}>
              <Text strong>榜单</Text>
              <Select
                aria-label="榜单筛选"
                style={{ minWidth: 220 }}
                value={leaderboardKey}
                onChange={setLeaderboardKey}
                options={[{ value: "", label: "全部榜单" }, ...leaderboardOptions]}
              />
            </Space>
            <Space direction="vertical" size={4}>
              <Text strong>投稿时间</Text>
              <RangePicker
                aria-label="投稿时间范围"
                showTime
                value={dateRange}
                onChange={(value) => setDateRange(value ? [value[0], value[1]] : null)}
                placeholder={["投稿开始时间", "投稿结束时间"]}
              />
            </Space>
            <Space direction="vertical" size={4}>
              <Text strong>每页数量</Text>
              <Select
                aria-label="每页数量"
                value={pageSize}
                onChange={setPageSize}
                options={[20, 50, 100].map((value) => ({ value, label: `${value} 条/页` }))}
              />
            </Space>
            <Button type="primary" loading={loading} disabled={!!deletingId} onClick={queryFirstPage}>查询</Button>
            <Button disabled={loading || !!deletingId} onClick={resetFilters}>重置</Button>
          </Space>
        </Card>

        <Table<CampaignTweetSubmissionItem>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1000 }}
          locale={{ emptyText: "当前筛选条件下暂无投稿记录" }}
          columns={[
            {
              title: "投稿",
              dataIndex: "title",
              width: 420,
              render: (value, record) => (
                <div style={{ minWidth: 0 }}>
                  <a href={record.tweetUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                    {value || "查看原帖"}
                  </a>
                  <div><Text type="secondary">ID: {record.tweetId}</Text></div>
                </div>
              ),
            },
            {
              title: "榜单",
              dataIndex: "leaderboardKey",
              width: 180,
              render: (value) => <Tag color="blue">{value}</Tag>,
            },
            {
              title: "投稿用户",
              key: "user",
              width: 220,
              render: (_value, record) => (
                <div>
                  <strong>{record.user?.username ? `@${record.user.username}` : "-"}</strong>
                  <div><Text type="secondary">{record.user?.twitterId || "无 Twitter ID"}</Text></div>
                </div>
              ),
            },
            {
              title: "投稿时间",
              dataIndex: "submittedAt",
              width: 190,
              render: formatDateTime,
            },
            {
              title: "操作",
              key: "actions",
              width: 110,
              fixed: "right",
              render: (_value, record) =>
                canDelete ? (
                  <Popconfirm
                    title="删除投稿记录"
                    description={`确认删除 @${record.user?.username || record.user?.twitterId || "该用户"} 的这条投稿？此操作不可恢复，删除后对应投稿限额会释放。`}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void deleteRecord(record)}
                  >
                    <Button
                      size="small"
                      danger
                      disabled={!!deletingId && deletingId !== record.id}
                      loading={deletingId === record.id}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tag>无删除权限</Tag>
                ),
            },
          ]}
        />

        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Text type="secondary">第 {pageIndex + 1} 页 · 本页 {rows.length} 条</Text>
          <Space>
            <Button disabled={loading || !!deletingId || pageIndex === 0} onClick={loadPreviousPage}>上一页</Button>
            <Button disabled={loading || !!deletingId || !nextCursor} onClick={loadNextPage}>下一页</Button>
          </Space>
        </Space>

        <Card size="small">
          <Title level={5} style={{ marginTop: 0 }}>对外投稿查询接口</Title>
          <Alert
            type="warning"
            showIcon
            message="公开只读接口，无需鉴权"
            description="任何获得该地址的人都可以读取该活动的投稿记录；筛选条件会同步到下方示例 URL。"
            style={{ marginBottom: 12 }}
          />
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text strong>接口地址</Text>
            <Input.TextArea value={externalUrl} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
            <Button onClick={() => void copyText(externalUrl, "接口地址")}>复制接口地址</Button>
            <Text type="secondary">
              支持 leaderboardKey、from、to、cursor、limit；翻页时把响应中的 nextCursor 原样传回 cursor。
            </Text>
            <Text strong style={{ marginTop: 4 }}>cURL 示例</Text>
            <Input.TextArea value={curlExample} readOnly autoSize={{ minRows: 3, maxRows: 6 }} />
            <Button onClick={() => void copyText(curlExample, "cURL 示例")}>复制 cURL</Button>
          </Space>
        </Card>
      </Space>
    </Modal>
  );
}
