import { useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { deleteReview, searchReviewsByHandle } from "@/services/reviews";
import type { ReviewSearchItem } from "@/types/reviews";

const TABLE_MAX_HEIGHT = 520;

export function ReviewsManagementPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [inputHandle, setInputHandle] = useState("");
  const [submittedHandle, setSubmittedHandle] = useState("");

  const query = useQuery({
    queryKey: ["reviews-management", submittedHandle],
    queryFn: () => searchReviewsByHandle(submittedHandle),
    enabled: Boolean(submittedHandle),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReview,
    onSuccess: (result) => {
      messageApi.success(result.message || "评论已删除");
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "删除评论失败");
    },
  });

  const data = query.data?.data;
  const rows = data?.reviews || [];

  const columns: ColumnsType<ReviewSearchItem> = useMemo(
    () => [
      {
        title: "评论人",
        key: "reviewer",
        width: 220,
        render: (_, record) => (
          <Space size={10}>
            <Avatar src={record.reviewer.avatar || undefined}>
              {record.reviewer.displayName?.[0] || record.reviewer.username?.[0] || "U"}
            </Avatar>
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{record.reviewer.displayName || "-"}</Typography.Text>
              <Typography.Text type="secondary">@{record.reviewer.username || "-"}</Typography.Text>
            </Space>
          </Space>
        ),
      },
      {
        title: "评分",
        dataIndex: "rating",
        key: "rating",
        width: 90,
        render: (value: number) => <Tag color="gold">{value}</Tag>,
      },
      {
        title: "标签",
        dataIndex: "tags",
        key: "tags",
        width: 220,
        render: (tags: string[]) =>
          tags?.length ? (
            <Space size={[4, 4]} wrap>
              {tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
      },
      {
        title: "评论内容",
        dataIndex: "comment",
        key: "comment",
        render: (value: string) => (
          <Typography.Paragraph
            ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
            style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
          >
            {value || "-"}
          </Typography.Paragraph>
        ),
      },
      {
        title: "时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 160,
      },
      {
        title: "操作",
        key: "action",
        width: 100,
        render: (_, record) => (
          <Popconfirm
            title="确认删除这条评论？"
            description="删除后会将评论指向虚拟账号，无法直接恢复。"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button
              danger
              type="link"
              loading={deleteMutation.isPending}
              style={{ paddingInline: 0 }}
            >
              删除
            </Button>
          </Popconfirm>
        ),
      },
    ],
    [deleteMutation, messageApi]
  );

  return (
    <PermissionGuard permission="reviews-management">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="点评管理"
          description="通过被点评账号的 Twitter Handle 搜索评论，并支持软删除。"
          extra={
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="输入被评论人 Handle，例如 elonmusk"
                enterButton="搜索"
                value={inputHandle}
                onChange={(event) => setInputHandle(event.target.value)}
                onSearch={(value) => setSubmittedHandle(value.trim().replace(/^@+/, ""))}
                style={{ width: 340 }}
                loading={query.isFetching}
              />
              <Button onClick={() => void query.refetch()} disabled={!submittedHandle}>
                刷新
              </Button>
            </Space>
          }
        >
          {!submittedHandle ? (
            <Empty description="请输入 Handle 后开始搜索" />
          ) : query.isError ? (
            <Alert
              type="error"
              showIcon
              message="搜索评论失败"
              description={query.error instanceof Error ? query.error.message : "请稍后重试"}
            />
          ) : rows.length ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card>
                <Space
                  align="center"
                  style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}
                >
                  <Space size={12}>
                    <Avatar
                      size={56}
                      src={data?.targetAccount.avatar || undefined}
                    >
                      {data?.targetAccount.displayName?.[0] || data?.targetAccount.handle?.[0] || "T"}
                    </Avatar>
                    <Space direction="vertical" size={0}>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        {data?.targetAccount.displayName || "-"}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        @{data?.targetAccount.handle || submittedHandle}
                      </Typography.Text>
                    </Space>
                  </Space>
                  <Statistic title="收到评论" value={data?.total || 0} />
                </Space>
              </Card>

              <Table
                rowKey="id"
                columns={columns}
                dataSource={rows}
                pagination={false}
                scroll={{ y: TABLE_MAX_HEIGHT, x: 980 }}
              />
            </Space>
          ) : query.isFetched ? (
            <Empty description="未找到评论或账号不存在" />
          ) : (
            <Empty description="暂无数据" />
          )}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
