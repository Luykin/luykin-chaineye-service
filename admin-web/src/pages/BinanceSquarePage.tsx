import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Row,
  Select,
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
  addBinanceSquareSeed,
  calculateBinanceSquareTargets,
  crawlBinanceSquarePosts,
  fetchBinanceSquareConfig,
  fetchBinanceSquareFollowingList,
  fetchBinanceSquareLogs,
  fetchBinanceSquarePosts,
  fetchBinanceSquareProgress,
  fetchBinanceSquareSeeds,
  fetchBinanceSquareStats,
  fetchBinanceSquareStatus,
  fetchBinanceSquareTargets,
  forceStopBinanceSquareCrawl,
  pauseBinanceSquareScheduler,
  removeBinanceSquareSeed,
  startBinanceSquareScheduler,
  syncAllBinanceSquareFollowings,
  syncBinanceSquareSeedFollowing,
  updateBinanceSquareConfig,
} from "@/services/binance-square";
import type {
  BinanceSquareActionResult,
  BinanceSquareConfigItem,
  BinanceSquareCrawlLogItem,
  BinanceSquareFollowingUser,
  BinanceSquarePostItem,
  BinanceSquareSeedItem,
  BinanceSquareTargetRankItem,
} from "@/types/binance-square";

const TABLE_MAX_HEIGHT = 480;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function statusTagColor(status?: string | null) {
  if (!status) return "default";
  if (status === "success" || status === "running") return "success";
  if (status === "partial") return "warning";
  if (status === "failed") return "error";
  return "default";
}

export function BinanceSquarePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [seedForm] = Form.useForm();
  const [configForm] = Form.useForm();
  const [postsPage, setPostsPage] = useState(1);
  const [postsFilterUsername, setPostsFilterUsername] = useState("");
  const [postsFilterType, setPostsFilterType] = useState<string>();
  const [logsPage, setLogsPage] = useState(1);
  const [logsTaskType, setLogsTaskType] = useState<string>();
  const [logsStatus, setLogsStatus] = useState<string>();
  const [followingUser, setFollowingUser] = useState<string | null>(null);
  const [followingPage, setFollowingPage] = useState(1);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BinanceSquareConfigItem | null>(null);

  const statsQuery = useQuery({ queryKey: ["binance-square", "stats"], queryFn: fetchBinanceSquareStats, refetchInterval: 30_000 });
  const statusQuery = useQuery({ queryKey: ["binance-square", "status"], queryFn: fetchBinanceSquareStatus, refetchInterval: 15_000 });
  const progressQuery = useQuery({ queryKey: ["binance-square", "progress"], queryFn: fetchBinanceSquareProgress, refetchInterval: 15_000 });
  const seedsQuery = useQuery({ queryKey: ["binance-square", "seeds"], queryFn: fetchBinanceSquareSeeds });
  const targetsQuery = useQuery({ queryKey: ["binance-square", "targets"], queryFn: fetchBinanceSquareTargets });
  const configQuery = useQuery({ queryKey: ["binance-square", "config"], queryFn: fetchBinanceSquareConfig });
  const postsQuery = useQuery({
    queryKey: ["binance-square", "posts", postsPage, postsFilterUsername, postsFilterType],
    queryFn: () =>
      fetchBinanceSquarePosts({
        page: postsPage,
        pageSize: 20,
        username: postsFilterUsername || undefined,
        postType: postsFilterType || undefined,
      }),
  });
  const logsQuery = useQuery({
    queryKey: ["binance-square", "logs", logsPage, logsTaskType, logsStatus],
    queryFn: () =>
      fetchBinanceSquareLogs({
        page: logsPage,
        pageSize: 20,
        taskType: logsTaskType,
        status: logsStatus,
      }),
  });
  const followingQuery = useQuery({
    queryKey: ["binance-square", "following", followingUser, followingPage],
    queryFn: () =>
      fetchBinanceSquareFollowingList({
        username: followingUser || "",
        page: followingPage,
        pageSize: 20,
      }),
    enabled: Boolean(followingUser),
  });

  const handleActionSuccess = (title: string, result?: BinanceSquareActionResult) => {
    messageApi.success(result?.message || `${title}已完成`);
    void Promise.all([
      statsQuery.refetch(),
      statusQuery.refetch(),
      progressQuery.refetch(),
      seedsQuery.refetch(),
      targetsQuery.refetch(),
      postsQuery.refetch(),
      logsQuery.refetch(),
    ]);
  };

  const syncAllMutation = useMutation({
    mutationFn: syncAllBinanceSquareFollowings,
    onSuccess: (result) => handleActionSuccess("同步关注列表", result.data),
    onError: (error: Error) => messageApi.error(error.message || "同步失败"),
  });
  const calcTargetMutation = useMutation({
    mutationFn: calculateBinanceSquareTargets,
    onSuccess: (result) => handleActionSuccess("计算 Top50", result.data),
    onError: (error: Error) => messageApi.error(error.message || "计算失败"),
  });
  const crawlMutation = useMutation({
    mutationFn: crawlBinanceSquarePosts,
    onSuccess: (result) => handleActionSuccess("帖子抓取", result.data),
    onError: (error: Error) => messageApi.error(error.message || "抓取失败"),
  });
  const startMutation = useMutation({
    mutationFn: startBinanceSquareScheduler,
    onSuccess: (result) => handleActionSuccess("启动调度器", result.data),
    onError: (error: Error) => messageApi.error(error.message || "启动失败"),
  });
  const pauseMutation = useMutation({
    mutationFn: pauseBinanceSquareScheduler,
    onSuccess: (result) => handleActionSuccess("暂停调度器", result.data),
    onError: (error: Error) => messageApi.error(error.message || "暂停失败"),
  });
  const stopMutation = useMutation({
    mutationFn: forceStopBinanceSquareCrawl,
    onSuccess: (result) => handleActionSuccess("强制终止", result.data),
    onError: (error: Error) => messageApi.error(error.message || "终止失败"),
  });
  const addSeedMutation = useMutation({
    mutationFn: addBinanceSquareSeed,
    onSuccess: () => {
      messageApi.success("已添加种子用户");
      seedForm.resetFields();
      void seedsQuery.refetch();
      void statsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "添加失败"),
  });
  const removeSeedMutation = useMutation({
    mutationFn: removeBinanceSquareSeed,
    onSuccess: () => {
      messageApi.success("已移除种子用户");
      void seedsQuery.refetch();
      void statsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "移除失败"),
  });
  const syncSeedMutation = useMutation({
    mutationFn: syncBinanceSquareSeedFollowing,
    onSuccess: (result) => handleActionSuccess("单个种子同步", result.data),
    onError: (error: Error) => messageApi.error(error.message || "同步失败"),
  });
  const updateConfigMutation = useMutation({
    mutationFn: updateBinanceSquareConfig,
    onSuccess: () => {
      messageApi.success("配置已更新");
      setConfigModalOpen(false);
      setEditingConfig(null);
      configForm.resetFields();
      void configQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "配置更新失败"),
  });

  const stats = statsQuery.data?.data;
  const crawlStatus = statusQuery.data?.data;
  const progress = progressQuery.data?.data;
  const seeds = seedsQuery.data?.data || [];
  const targets = targetsQuery.data?.data || [];
  const posts = postsQuery.data?.data;
  const logs = logsQuery.data?.data;
  const configs = configQuery.data?.data || [];
  const followingData = followingQuery.data?.data;

  const seedColumns: ColumnsType<BinanceSquareSeedItem> = [
    { title: "用户名", dataIndex: "username", key: "username", width: 160 },
    { title: "显示名", dataIndex: "displayName", key: "displayName", render: (value) => value || "-" },
    { title: "关注数", dataIndex: "totalFollowingCount", key: "totalFollowingCount", width: 100, render: (value) => value ?? "-" },
    { title: "最后同步", dataIndex: "lastCrawledAt", key: "lastCrawledAt", width: 170, render: formatDateTime },
    {
      title: "状态",
      key: "status",
      width: 90,
      render: (_, record) => <Tag color={record.isActive ? "success" : "default"}>{record.isActive ? "启用" : "停用"}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_, record) => (
        <Space wrap>
          <Button size="small" onClick={() => { setFollowingUser(record.username); setFollowingPage(1); }}>
            关注列表
          </Button>
          <Button
            size="small"
            loading={syncSeedMutation.isPending}
            onClick={() => syncSeedMutation.mutate(record.username)}
          >
            同步
          </Button>
          <Popconfirm title="确认移除该种子用户？" onConfirm={() => removeSeedMutation.mutate(record.username)}>
            <Button size="small" danger loading={removeSeedMutation.isPending}>
              移除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const targetColumns: ColumnsType<BinanceSquareTargetRankItem> = [
    { title: "排名", dataIndex: "rank", key: "rank", width: 80 },
    { title: "用户名", dataIndex: "username", key: "username", width: 180 },
    { title: "被关注次数", dataIndex: "followerCount", key: "followerCount", width: 120 },
    {
      title: "种子来源",
      key: "seedFollowers",
      render: (_, record) =>
        record.seedFollowers?.length ? (
          <Space wrap>
            {record.seedFollowers.map((item) => (
              <Tag key={`${record.username}-${item.username}`}>{item.displayName || item.username}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        ),
    },
  ];

  const postColumns: ColumnsType<BinanceSquarePostItem> = [
    { title: "类型", dataIndex: "postType", key: "postType", width: 90, render: (value) => <Tag>{value || "-"}</Tag> },
    { title: "用户名", dataIndex: "username", key: "username", width: 150 },
    {
      title: "标题 / 内容",
      key: "content",
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Link href={record.postUrl || undefined} target="_blank">
            {record.title || "查看帖子"}
          </Typography.Link>
          <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, maxWidth: 420 }}>
            {record.contentText || record.content || "-"}
          </Typography.Paragraph>
        </Space>
      ),
    },
    { title: "点赞", dataIndex: "likeCount", key: "likeCount", width: 80, render: (value) => value ?? "-" },
    { title: "评论", dataIndex: "commentCount", key: "commentCount", width: 80, render: (value) => value ?? "-" },
    { title: "分享", dataIndex: "shareCount", key: "shareCount", width: 80, render: (value) => value ?? "-" },
    { title: "浏览", dataIndex: "viewCount", key: "viewCount", width: 80, render: (value) => value ?? "-" },
    { title: "发布时间", dataIndex: "publishedAt", key: "publishedAt", width: 170, render: formatDateTime },
  ];

  const logColumns: ColumnsType<BinanceSquareCrawlLogItem> = [
    { title: "任务类型", dataIndex: "taskType", key: "taskType", width: 140 },
    { title: "状态", dataIndex: "status", key: "status", width: 90, render: (value) => <Tag color={statusTagColor(value)}>{value || "-"}</Tag> },
    { title: "目标", dataIndex: "targetId", key: "targetId", width: 140, render: (value) => value || "-" },
    { title: "数量", dataIndex: "itemsCount", key: "itemsCount", width: 90, render: (value) => value ?? "-" },
    { title: "耗时(ms)", dataIndex: "durationMs", key: "durationMs", width: 100, render: (value) => value ?? "-" },
    { title: "批次", dataIndex: "snapshotId", key: "snapshotId", width: 150, render: (value) => value || "-" },
    {
      title: "错误",
      dataIndex: "errorMessage",
      key: "errorMessage",
      render: (value) => (
        <Typography.Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ marginBottom: 0, maxWidth: 300 }}>
          {value || "-"}
        </Typography.Paragraph>
      ),
    },
    { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
  ];

  const followingColumns: ColumnsType<BinanceSquareFollowingUser> = [
    { title: "用户名", dataIndex: "followingUsername", key: "followingUsername", width: 180 },
    { title: "显示名", dataIndex: "displayName", key: "displayName", render: (value) => value || "-" },
    { title: "粉丝数", dataIndex: "totalFollowerCount", key: "totalFollowerCount", width: 100, render: (value) => value ?? "-" },
    { title: "帖子数", dataIndex: "totalPostCount", key: "totalPostCount", width: 100, render: (value) => value ?? "-" },
    { title: "同步时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
  ];

  return (
    <PermissionGuard permission="binance-square">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="币安广场"
          description="种子用户关注同步、Top50 目标计算、帖子抓取、调度状态与配置管理。"
          extra={
            <Space wrap>
              <Button onClick={() => { void statsQuery.refetch(); void statusQuery.refetch(); void progressQuery.refetch(); }}>
                刷新
              </Button>
              <Button type="primary" loading={syncAllMutation.isPending} onClick={() => syncAllMutation.mutate()}>
                同步关注列表
              </Button>
              <Button type="primary" loading={calcTargetMutation.isPending} onClick={() => calcTargetMutation.mutate()}>
                计算 Top50
              </Button>
              <Button loading={crawlMutation.isPending} onClick={() => crawlMutation.mutate("incremental")}>
                增量抓取
              </Button>
              <Button loading={crawlMutation.isPending} onClick={() => crawlMutation.mutate("full")}>
                全量抓取
              </Button>
            </Space>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="种子用户" value={stats?.seedCount || 0} /></Card>
            </Col>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="目标用户" value={stats?.targetCount || 0} /></Card>
            </Col>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="帖子总数" value={stats?.postCount || 0} /></Card>
            </Col>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="镜像记录" value={stats?.snapshotCount || 0} /></Card>
            </Col>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="镜像存储" value={formatBytes(stats?.snapshotStorageBytes)} /></Card>
            </Col>
            <Col xs={12} md={8} xl={4}>
              <Card size="small"><Statistic title="上次抓取" value={stats?.lastCrawlAt ? dayjs(stats.lastCrawlAt).format("MM-DD HH:mm") : "-"} /></Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 0 }}>
            <Col xs={24} xl={12}>
              <Card title="调度与任务状态">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="调度器">
                    <Tag color={crawlStatus?.isRunning ? "success" : "default"}>
                      {crawlStatus?.isRunning ? "运行中" : "已暂停"}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="当前抓取">
                    <Tag color={crawlStatus?.isCrawling ? "processing" : "default"}>
                      {crawlStatus?.isCrawling ? "执行中" : "空闲"}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="最近任务状态">
                    <Tag color={statusTagColor(crawlStatus?.lastCrawl?.status)}>{crawlStatus?.lastCrawl?.status || "-"}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="最近任务时间">{formatDateTime(crawlStatus?.lastCrawl?.createdAt)}</Descriptions.Item>
                </Descriptions>
                <Space wrap style={{ marginTop: 12 }}>
                  <Button type="primary" loading={startMutation.isPending} onClick={() => startMutation.mutate()}>
                    启动调度器
                  </Button>
                  <Button loading={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>
                    暂停调度器
                  </Button>
                  <Button danger loading={stopMutation.isPending} onClick={() => stopMutation.mutate()}>
                    强制终止
                  </Button>
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="实时抓取进度">
                {progress?.running ? (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Progress percent={progress.totalUsers ? Math.round(((progress.processedUsers || 0) / progress.totalUsers) * 100) : 0} />
                    <Descriptions size="small" column={2}>
                      <Descriptions.Item label="已处理">{`${progress.processedUsers || 0}/${progress.totalUsers || 0}`}</Descriptions.Item>
                      <Descriptions.Item label="成功">{progress.successUsers || 0}</Descriptions.Item>
                      <Descriptions.Item label="失败">{progress.failedUsers || 0}</Descriptions.Item>
                      <Descriptions.Item label="出错率">{progress.errorRate || 0}%</Descriptions.Item>
                      <Descriptions.Item label="帖子 ALL">{progress.totalPostsAll || 0}</Descriptions.Item>
                      <Descriptions.Item label="帖子 REPLY">{progress.totalPostsReply || 0}</Descriptions.Item>
                    </Descriptions>
                  </Space>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={progress?.message || "当前没有执行中的抓取任务"} />
                )}
              </Card>
            </Col>
          </Row>

          <Tabs
            style={{ marginTop: 16 }}
            items={[
              {
                key: "seeds",
                label: `种子用户 (${seeds.length})`,
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Card size="small">
                      <Form form={seedForm} layout="inline" onFinish={(values) => addSeedMutation.mutate(values)}>
                        <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                          <Input placeholder="用户名（如 CZ）" style={{ width: 220 }} />
                        </Form.Item>
                        <Form.Item name="displayName">
                          <Input placeholder="显示名（可选）" style={{ width: 220 }} />
                        </Form.Item>
                        <Form.Item>
                          <Button type="primary" htmlType="submit" loading={addSeedMutation.isPending}>
                            添加种子用户
                          </Button>
                        </Form.Item>
                      </Form>
                    </Card>
                    <Table rowKey="username" columns={seedColumns} dataSource={seeds} pagination={false} scroll={{ y: TABLE_MAX_HEIGHT }} />
                  </Space>
                ),
              },
              {
                key: "targets",
                label: `目标用户 (${targets.length})`,
                children: (
                  <Table rowKey="username" columns={targetColumns} dataSource={targets} pagination={false} scroll={{ y: TABLE_MAX_HEIGHT }} />
                ),
              },
              {
                key: "posts",
                label: "帖子列表",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space wrap>
                      <Input
                        placeholder="筛选用户名"
                        value={postsFilterUsername}
                        onChange={(event) => setPostsFilterUsername(event.target.value)}
                        onPressEnter={() => setPostsPage(1)}
                        style={{ width: 220 }}
                      />
                      <Select
                        allowClear
                        placeholder="帖子类型"
                        value={postsFilterType}
                        onChange={(value) => { setPostsFilterType(value); setPostsPage(1); }}
                        style={{ width: 160 }}
                        options={[
                          { label: "文章", value: "article" },
                          { label: "引用", value: "quote" },
                          { label: "回复", value: "reply" },
                        ]}
                      />
                      <Button onClick={() => { setPostsPage(1); void postsQuery.refetch(); }}>筛选</Button>
                    </Space>
                    <Table
                      rowKey={(record) => String(record.id)}
                      columns={postColumns}
                      dataSource={posts?.data || []}
                      pagination={false}
                      scroll={{ y: TABLE_MAX_HEIGHT, x: 1200 }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Pagination
                        current={posts?.page || 1}
                        pageSize={posts?.pageSize || 20}
                        total={posts?.total || 0}
                        showSizeChanger={false}
                        onChange={(page) => setPostsPage(page)}
                      />
                    </div>
                  </Space>
                ),
              },
              {
                key: "logs",
                label: "抓取日志",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space wrap>
                      <Select
                        allowClear
                        placeholder="任务类型"
                        value={logsTaskType}
                        onChange={(value) => { setLogsTaskType(value); setLogsPage(1); }}
                        style={{ width: 180 }}
                        options={[
                          { label: "following", value: "following" },
                          { label: "target_calculate", value: "target_calculate" },
                          { label: "post", value: "post" },
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="状态"
                        value={logsStatus}
                        onChange={(value) => { setLogsStatus(value); setLogsPage(1); }}
                        style={{ width: 140 }}
                        options={[
                          { label: "success", value: "success" },
                          { label: "partial", value: "partial" },
                          { label: "failed", value: "failed" },
                        ]}
                      />
                    </Space>
                    <Table rowKey="id" columns={logColumns} dataSource={logs?.data || []} pagination={false} scroll={{ y: TABLE_MAX_HEIGHT, x: 1200 }} />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Pagination
                        current={logs?.page || 1}
                        pageSize={logs?.pageSize || 20}
                        total={logs?.total || 0}
                        showSizeChanger={false}
                        onChange={(page) => setLogsPage(page)}
                      />
                    </div>
                  </Space>
                ),
              },
              {
                key: "config",
                label: `配置项 (${configs.length})`,
                children: configs.length ? (
                  <Row gutter={[16, 16]}>
                    {configs.map((item) => (
                      <Col xs={24} md={12} xl={8} key={item.configKey}>
                        <Card
                          size="small"
                          title={item.configKey}
                          extra={
                            <Button
                              size="small"
                              onClick={() => {
                                setEditingConfig(item);
                                configForm.setFieldsValue({ configValue: item.configValue });
                                setConfigModalOpen(true);
                              }}
                            >
                              修改
                            </Button>
                          }
                        >
                          <Descriptions size="small" column={1}>
                            <Descriptions.Item label="当前值">{item.configValue}{item.unit ? ` ${item.unit}` : ""}</Descriptions.Item>
                            <Descriptions.Item label="说明">{item.description || "-"}</Descriptions.Item>
                            <Descriptions.Item label="范围">
                              {item.minValue ?? "-"} ~ {item.maxValue ?? "-"}
                            </Descriptions.Item>
                            <Descriptions.Item label="更新人">{item.updatedBy || "-"}</Descriptions.Item>
                            <Descriptions.Item label="更新时间">{formatDateTime(item.updatedAt)}</Descriptions.Item>
                          </Descriptions>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                ) : (
                  <Empty description="暂无配置项" />
                ),
              },
            ]}
          />

          {statsQuery.isError || statusQuery.isError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 16 }}
              message="币安广场数据加载存在异常"
              description="请检查数据库迁移、接口权限或后端服务状态。"
            />
          ) : null}
        </PageSection>

        <Drawer
          title={followingUser ? `${followingUser} 的关注列表` : "关注列表"}
          width={720}
          open={Boolean(followingUser)}
          onClose={() => setFollowingUser(null)}
        >
          <Table
            rowKey={(record) => `${record.followingUsername}-${record.createdAt}`}
            columns={followingColumns}
            dataSource={followingData?.data || []}
            loading={followingQuery.isFetching}
            pagination={false}
            scroll={{ y: 520 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Pagination
              current={followingData?.page || 1}
              pageSize={followingData?.pageSize || 20}
              total={followingData?.total || 0}
              showSizeChanger={false}
              onChange={(page) => setFollowingPage(page)}
            />
          </div>
        </Drawer>

        <Modal
          title={editingConfig ? `修改配置：${editingConfig.configKey}` : "修改配置"}
          open={configModalOpen}
          onCancel={() => {
            setConfigModalOpen(false);
            setEditingConfig(null);
            configForm.resetFields();
          }}
          onOk={() => {
            void configForm.validateFields().then((values) => {
              if (!editingConfig) return;
              updateConfigMutation.mutate({
                configKey: editingConfig.configKey,
                configValue: String(values.configValue),
              });
            });
          }}
          confirmLoading={updateConfigMutation.isPending}
        >
          <Form form={configForm} layout="vertical">
            <Form.Item label="配置值" name="configValue" rules={[{ required: true, message: "请输入配置值" }]}>
              <Input />
            </Form.Item>
            {editingConfig ? (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="说明">{editingConfig.description || "-"}</Descriptions.Item>
                <Descriptions.Item label="范围">
                  {editingConfig.minValue ?? "-"} ~ {editingConfig.maxValue ?? "-"}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </Form>
        </Modal>
      </Space>
    </PermissionGuard>
  );
}
