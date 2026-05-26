import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { buildApiUrl } from "@/services/apiClient";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchBackupStatus,
  restoreBackupTables,
  triggerBackup,
} from "@/services/stats";
import type { BackupFileItem } from "@/types/stats";

function formatBackupTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
}

export function BackupRestorePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedBackupName, setSelectedBackupName] = useState<string>();
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>();
  const [confirmText, setConfirmText] = useState("");
  const [reauthVerified, setReauthVerified] = useState(false);
  const [reauthing, setReauthing] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);

  const performBackupReauth = async () => {
    try {
      setReauthing(true);
      setReauthError(null);
      const browserApi = window.SimpleWebAuthnBrowser;
      const supports = browserApi
        ? await browserApi.browserSupportsWebAuthn()
        : typeof window.PublicKeyCredential !== "undefined";

      if (!supports || !browserApi) {
        throw new Error("当前环境不支持生物识别，请使用支持指纹 / Face ID / 通行密钥的设备");
      }

      const optionsResponse = await fetch(buildApiUrl(`/admin/webauthn/backup-restore/options?_ts=${Date.now()}`), {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const optionsData = await optionsResponse.json().catch(() => ({ success: false, error: "获取验证参数失败" }));
      if (!optionsResponse.ok || !optionsData.success) {
        throw new Error(optionsData.message || optionsData.error || "获取验证参数失败");
      }

      const assertion = await browserApi.startAuthentication(optionsData.options);
      const verifyResponse = await fetch(buildApiUrl("/admin/webauthn/backup-restore/verify"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ assertion }),
      });
      const verifyData = await verifyResponse.json().catch(() => ({ success: false, error: "验证失败" }));
      if (!verifyResponse.ok || !verifyData.success) {
        throw new Error(verifyData.message || verifyData.error || "验证失败");
      }

      setReauthVerified(true);
      messageApi.success("生物识别验证通过，可以进入备份恢复");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "生物识别验证失败";
      setReauthVerified(false);
      setReauthError(message);
      messageApi.error(message);
      return false;
    } finally {
      setReauthing(false);
    }
  };

  const backupQuery = useQuery({
    queryKey: ["backup-status"],
    queryFn: fetchBackupStatus,
    enabled: reauthVerified,
    retry: false,
  });

  useEffect(() => {
    void performBackupReauth();
    // 进入备份恢复页必须立即二次验证；不放依赖避免重复弹出生物识别窗口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleProtectedMutationError = (error: Error, fallbackMessage: string) => {
    const text = error.message || fallbackMessage;
    if (text.includes("生物识别") || text.includes("二次验证")) {
      setReauthVerified(false);
      setReauthError(text);
    }
    messageApi.error(text || fallbackMessage);
  };

  const triggerBackupMutation = useMutation({
    mutationFn: triggerBackup,
    onSuccess: (result) => {
      messageApi.success(result.message || "备份任务已启动");
      window.setTimeout(() => backupQuery.refetch(), 1500);
    },
    onError: (error: Error) => {
      handleProtectedMutationError(error, "触发备份失败");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: restoreBackupTables,
    onSuccess: (result) => {
      messageApi.success(result.message || "表恢复完成");
      setConfirmText("");
      void backupQuery.refetch();
    },
    onError: (error: Error) => {
      handleProtectedMutationError(error, "表恢复失败");
    },
  });

  const data = backupQuery.data?.data;
  const backups = data?.backups || [];
  const restoreGroups = data?.restoreGroups || [];
  const selectedGroup = restoreGroups.find((group) => group.key === selectedGroupKey);
  const selectedBackup = backups.find((backup) => backup.name === selectedBackupName);
  const latestBackup = backups[0];

  const backupOptions = useMemo(
    () =>
      backups.map((backup) => ({
        value: backup.name,
        label: `${formatBackupTime(backup.mtime)} · ${backup.sizeMB} MB`,
      })),
    [backups]
  );

  const groupOptions = useMemo(
    () =>
      restoreGroups.map((group) => ({
        value: group.key,
        label: group.label,
      })),
    [restoreGroups]
  );

  const restoreResult = restoreMutation.data?.data;

  const columns: ColumnsType<BackupFileItem> = [
    {
      title: "备份时间",
      dataIndex: "mtime",
      key: "mtime",
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{formatBackupTime(value)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "大小",
      dataIndex: "sizeMB",
      key: "sizeMB",
      width: 120,
      render: (value: string) => `${value} MB`,
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_, record) => (
        <Button size="small" onClick={() => setSelectedBackupName(record.name)}>
          选中恢复
        </Button>
      ),
    },
  ];

  return (
    <PermissionGuard permission="backup:operate">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="数据库备份恢复"
          description="查看 PostgreSQL 定时备份，并把白名单表组恢复到某个备份时间点。"
          extra={
            reauthVerified ? (
              <Space wrap>
                <Button
                  onClick={() => {
                    void backupQuery.refetch();
                  }}
                  loading={backupQuery.isFetching}
                >
                  刷新
                </Button>
                <Button
                  type="primary"
                  loading={triggerBackupMutation.isPending}
                  onClick={() => triggerBackupMutation.mutate()}
                >
                  立即备份
                </Button>
              </Space>
            ) : null
          }
        >
          {!reauthVerified ? (
            <Card>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="error"
                  showIcon
                  message="进入备份恢复前必须完成生物识别二次验证"
                  description={
                    reauthError ||
                    "如果当前账号没有录入指纹 / Face ID / 通行密钥，将无法进入该页面，也不能执行备份或恢复。"
                  }
                />
                <Button type="primary" loading={reauthing} onClick={() => void performBackupReauth()}>
                  重新进行生物识别验证
                </Button>
              </Space>
            </Card>
          ) : backupQuery.isError ? (
            <Alert type="error" showIcon message="加载备份状态失败" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic title="备份数量" value={data?.stats.totalBackups || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic title="总大小 (MB)" value={data?.stats.totalSizeMB || "0"} />
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic
                      title="最新备份"
                      value={latestBackup ? formatBackupTime(latestBackup.mtime) : "-"}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Card>
                </Col>
              </Row>

              <Alert
                type="warning"
                showIcon
                message="恢复会覆盖所选表组"
                description="点击恢复前，后端会先自动创建一份安全备份。当前仅允许恢复白名单表组，避免误操作到其它业务表。旧备份如果没有包含 Projects / InvestmentRelationships 等表，会直接失败，不会改数据库。"
              />

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={10}>
                  <Card title="选择恢复点">
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Select
                        style={{ width: "100%" }}
                        placeholder="选择备份时间点"
                        value={selectedBackupName}
                        options={backupOptions}
                        onChange={setSelectedBackupName}
                        showSearch
                        optionFilterProp="label"
                      />
                      <Select
                        style={{ width: "100%" }}
                        placeholder="选择要恢复的表组"
                        value={selectedGroupKey}
                        options={groupOptions}
                        onChange={setSelectedGroupKey}
                      />
                      {selectedGroup ? (
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="表组说明">
                            {selectedGroup.description}
                          </Descriptions.Item>
                          <Descriptions.Item label="涉及表">
                            <Space wrap>
                              {selectedGroup.tables.map((table) => (
                                <Tag key={table}>{table}</Tag>
                              ))}
                            </Space>
                          </Descriptions.Item>
                          <Descriptions.Item label="恢复文件">
                            {selectedBackup?.name || "-"}
                          </Descriptions.Item>
                        </Descriptions>
                      ) : null}
                      <Input
                        value={confirmText}
                        onChange={(event) => setConfirmText(event.target.value)}
                        placeholder="输入 RESTORE 确认恢复"
                      />
                      <Popconfirm
                        title="确认恢复这些表？"
                        description="该操作会覆盖当前表数据；请确认已选中正确备份时间点。"
                        okText="确认恢复"
                        cancelText="取消"
                        disabled={
                          !selectedBackupName ||
                          !selectedGroupKey ||
                          confirmText !== "RESTORE" ||
                          restoreMutation.isPending
                        }
                        onConfirm={async () => {
                          if (!selectedBackupName || !selectedGroupKey) {
                            return messageApi.warning("请选择备份时间点和表组");
                          }
                          if (!reauthVerified && !(await performBackupReauth())) return;
                          restoreMutation.mutate({
                            backupName: selectedBackupName,
                            groupKey: selectedGroupKey,
                            confirmText,
                          });
                        }}
                      >
                        <Button
                          danger
                          type="primary"
                          block
                          loading={restoreMutation.isPending}
                          disabled={
                            !selectedBackupName ||
                            !selectedGroupKey ||
                            confirmText !== "RESTORE"
                          }
                        >
                          恢复到该时间点
                        </Button>
                      </Popconfirm>
                    </Space>
                  </Card>
                </Col>

                <Col xs={24} xl={14}>
                  <Card title="备份列表">
                    <Table
                      rowKey="name"
                      columns={columns}
                      dataSource={backups}
                      loading={backupQuery.isLoading || backupQuery.isFetching}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      locale={{ emptyText: <Empty description="暂无备份文件" /> }}
                    />
                  </Card>
                </Col>
              </Row>

              {restoreResult ? (
                <Card title="最近一次恢复结果">
                  <Descriptions size="small" bordered column={1}>
                    <Descriptions.Item label="恢复表组">
                      {restoreResult.groupLabel}
                    </Descriptions.Item>
                    <Descriptions.Item label="源备份">
                      {restoreResult.backupName}
                    </Descriptions.Item>
                    <Descriptions.Item label="安全备份">
                      {restoreResult.safetyBackup?.name || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="耗时">
                      {restoreResult.durationSeconds}s
                    </Descriptions.Item>
                    <Descriptions.Item label="恢复后行数">
                      <Space wrap>
                        {Object.entries(restoreResult.afterCounts).map(([table, count]) => (
                          <Tag key={table} color="blue">
                            {table}: {count}
                          </Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              ) : null}
            </Space>
          )}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
