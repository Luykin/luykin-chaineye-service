import { useEffect, useState } from "react";
import { Button, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { useAuth } from "@/app/auth";
import {
  deleteCampaignRegistrationAdmin,
  fetchCampaignRegistrationsAdmin,
} from "@/services/nacos";
import type { CampaignRegistrationItem } from "@/types/nacos";

function formatFullDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export function getRegistrationCampaignKey(target?: Record<string, any> | null) {
  const raw =
    target?.campaignKey ||
    target?.nacosPayload?.campaignKey ||
    target?.slug ||
    target?.id ||
    target?.nacosCampaignId ||
    "";
  const key = String(raw || "").trim();
  return key.endsWith("-hunter") ? key.slice(0, -7) : key;
}

export function CampaignRegistrationsModal({
  open,
  campaign,
  onClose,
  onToast,
}: {
  open: boolean;
  campaign: string;
  onClose: () => void;
  onToast?: (message: string, type?: "success" | "error" | "info") => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [usernameSearch, setUsernameSearch] = useState("");
  const [rows, setRows] = useState<CampaignRegistrationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function load(params?: {
    page?: number;
    pageSize?: number;
    username?: string;
  }) {
    if (!campaign) return;
    const nextPage = params?.page || page;
    const nextPageSize = params?.pageSize || pageSize;
    const nextUsername = params?.username ?? usernameSearch;
    setLoading(true);
    try {
      const resp = await fetchCampaignRegistrationsAdmin({
        campaign,
        page: nextPage,
        pageSize: nextPageSize,
        username: nextUsername,
      });
      setRows(resp.data?.rows || []);
      setTotal(resp.data?.total || 0);
      setPage(resp.data?.page || nextPage);
      setPageSize(resp.data?.pageSize || nextPageSize);
    } catch (error) {
      onToast?.(
        `报名名单加载失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !campaign) return;
    setRows([]);
    setTotal(0);
    setPage(1);
    setUsernameSearch("");
    void load({ page: 1, username: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign]);

  async function deleteRecord(record: CampaignRegistrationItem) {
    try {
      await deleteCampaignRegistrationAdmin(record.id, campaign);
      onToast?.("报名记录已删除", "success");
      const nextPage = rows.length <= 1 && page > 1 ? page - 1 : page;
      await load({ page: nextPage });
    } catch (error) {
      onToast?.(
        `删除失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    }
  }

  return (
    <Modal
      open={open}
      title={
        <Space size={8}>
          <span>报名名单</span>
          <Tag color="blue">{campaign || "未选择活动"}</Tag>
          <Tag>{total} 条</Tag>
        </Space>
      }
      width="92%"
      style={{ maxWidth: 1280 }}
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Input.Search
            allowClear
            style={{ width: 280 }}
            placeholder="按用户名模糊搜索"
            value={usernameSearch}
            onChange={(e) => setUsernameSearch(e.target.value)}
            onSearch={(value) => {
              setUsernameSearch(value);
              void load({ page: 1, username: value });
            }}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1180 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextPageSize) =>
              void load({ page: nextPage, pageSize: nextPageSize }),
          }}
          columns={[
            {
              title: "用户",
              dataIndex: "username",
              width: 210,
              fixed: "left",
              render: (_value, record) => (
                <Space size={8}>
                  {record.avatar ? (
                    <img
                      src={record.avatar}
                      alt=""
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        objectFit: "cover",
                      }}
                    />
                  ) : null}
                  <span>
                    <strong>@{record.username || "-"}</strong>
                    <br />
                    <span style={{ color: "#94a3b8" }}>
                      {record.displayName || record.xHuntUser?.displayName || "-"}
                    </span>
                  </span>
                </Space>
              ),
            },
            { title: "Twitter ID", dataIndex: "twitterId", width: 150 },
            {
              title: "EVM",
              dataIndex: "evmAddress",
              width: 260,
              ellipsis: true,
              render: (value) => value || "-",
            },
            {
              title: "Email",
              dataIndex: "email",
              width: 220,
              ellipsis: true,
              render: (value) => value || "-",
            },
            {
              title: "邀请码",
              dataIndex: ["xHuntUser", "inviteCode"],
              width: 120,
              render: (value) => value || "-",
            },
            {
              title: "邀请人",
              dataIndex: "invitedByUsername",
              width: 140,
              render: (value) => (value ? `@${value}` : "-"),
            },
            {
              title: "报名时间",
              dataIndex: "registeredAt",
              width: 180,
              render: (value) => formatFullDateTime(value),
            },
            {
              title: "来源 URL",
              dataIndex: "registrationUrl",
              width: 260,
              ellipsis: true,
              render: (value) => value || "-",
            },
            {
              title: "操作",
              key: "actions",
              width: 100,
              fixed: "right",
              render: (_value, record) =>
                user?.role === "super" ? (
                  <Popconfirm
                    title="删除报名记录"
                    description={`确认删除 @${record.username || record.twitterId || "该用户"} 的报名记录？`}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void deleteRecord(record)}
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tag>仅 super 可删</Tag>
                ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
