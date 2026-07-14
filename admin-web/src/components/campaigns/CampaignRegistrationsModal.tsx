import { useEffect, useState } from "react";
import { Button, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { useAuth } from "@/app/auth";
import {
  checkCampaignRegistrationRanksAdmin,
  deleteCampaignRegistrationAdmin,
  fetchCampaignRegistrationsAdmin,
} from "@/services/nacos";
import type { CampaignRegistrationItem, CampaignRegistrationRankCheckRow, CampaignRegistrationRankItem } from "@/types/nacos";

function formatFullDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function formatRankValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toLocaleString() : "未上榜";
}

function getRankByDomain(row: CampaignRegistrationRankCheckRow | undefined, domain: "web3" | "ai") {
  return row?.ranks.find((item) => item.domain === domain);
}

function renderRankCell(rank?: CampaignRegistrationRankItem) {
  if (!rank) return <Tag>未查询</Tag>;
  if (rank.status !== "success") return <Tag color="red">{rank.error || "查询失败"}</Tag>;
  return (
    <Space size={4} wrap>
      <Tag color={typeof rank.kolRank === "number" && rank.kolRank > 0 ? "blue" : "default"}>
        {typeof rank.kolRank === "number" && rank.kolRank > 0 ? `#${formatRankValue(rank.kolRank)}` : formatRankValue(rank.kolRank)}
      </Tag>
      {rank.isCreator ? <Tag color="green">Creator</Tag> : null}
    </Space>
  );
}

function renderEligibility(row?: CampaignRegistrationRankCheckRow) {
  if (!row) return <Tag>未查询</Tag>;
  const status = row.eligibility.status;
  const color =
    status === "eligible" || status === "no_threshold"
      ? "green"
      : status === "not_eligible"
        ? "red"
        : "orange";
  return <Tag color={color} title={row.eligibility.reason}>{row.eligibility.label}</Tag>;
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [usernameSearch, setUsernameSearch] = useState("");
  const [rows, setRows] = useState<CampaignRegistrationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankRows, setRankRows] = useState<Record<string, CampaignRegistrationRankCheckRow>>({});

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
      const nextRows = resp.data?.rows || [];
      setRows(nextRows);
      setTotal(resp.data?.total || 0);
      setPage(resp.data?.page || nextPage);
      setPageSize(resp.data?.pageSize || nextPageSize);
      setRankRows({});
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
    setRankRows({});
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

  async function checkCurrentPageRanks() {
    const users = rows
      .filter((item) => item.twitterId)
      .map((item) => ({
        id: item.id,
        username: item.username || null,
        twitterId: item.twitterId,
      }));
    if (!users.length) {
      onToast?.("当前页没有可查询的 Twitter ID", "error");
      return;
    }

    setRankLoading(true);
    try {
      const resp = await checkCampaignRegistrationRanksAdmin({
        campaign,
        campaignConfig,
        users,
      });
      const next: Record<string, CampaignRegistrationRankCheckRow> = {};
      (resp.data?.rows || []).forEach((item) => {
        if (item.twitterId) next[item.twitterId] = item;
      });
      setRankRows(next);
      onToast?.(`已查询当前页 ${resp.data?.total || users.length} 个用户的 Web3 / AI 排名`, "success");
    } catch (error) {
      onToast?.(
        `排名查询失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setRankLoading(false);
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
          <Space wrap>
            <Button
              disabled={!rows.length}
              loading={rankLoading}
              onClick={() => void checkCurrentPageRanks()}
            >
              批量查询 Web3/AI 排名
            </Button>
            <Button onClick={() => void load()}>刷新</Button>
          </Space>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value: number) => `共 ${value} 条`,
            onChange: (nextPage: number, nextPageSize: number) =>
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
              title: "Web3 排名",
              key: "web3Rank",
              width: 130,
              render: (_value, record) => renderRankCell(getRankByDomain(rankRows[record.twitterId], "web3")),
            },
            {
              title: "AI 排名",
              key: "aiRank",
              width: 130,
              render: (_value, record) => renderRankCell(getRankByDomain(rankRows[record.twitterId], "ai")),
            },
            {
              title: "报名门槛",
              key: "rankEligibility",
              width: 140,
              render: (_value, record) => renderEligibility(rankRows[record.twitterId]),
            },
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
              title: "币安广场账户",
              dataIndex: "binanceSquareAccount",
              width: 240,
              ellipsis: true,
              render: (account) =>
                account ? (
                  <Space size={8}>
                    {account.binanceAvatar ? (
                      <img
                        src={account.binanceAvatar}
                        alt=""
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          objectFit: "cover",
                        }}
                      />
                    ) : null}
                    <span>
                      <strong>{account.binanceUsername || "-"}</strong>
                      <br />
                      <span style={{ color: "#94a3b8" }}>
                        {account.binanceSquareUid ? `UID: ${account.binanceSquareUid}` : "-"}
                      </span>
                    </span>
                  </Space>
                ) : (
                  "-"
                ),
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
