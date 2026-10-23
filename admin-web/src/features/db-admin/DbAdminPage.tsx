import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { DeleteOutlined, DownloadOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NoPermissionPage } from "@/pages/NoPermissionPage";
import { useAuth } from "@/app/auth";
import {
  beginDbAdminTotpSetup,
  createDbAdminRow,
  deleteDbAdminRow,
  exportDbAdminRows,
  fetchDbAdminAccessGrants,
  fetchDbAdminDatabases,
  fetchDbAdminRows,
  fetchDbAdminSchema,
  fetchDbAdminTables,
  fetchDbAdminWebAuthnOptions,
  fetchDbAdminWebAuthnStatus,
  grantDbAdminTableAccess,
  revokeDbAdminTableAccess,
  saveDbAdminCredentials,
  updateDbAdminRow,
  verifyDbAdminTotp,
  verifyDbAdminTotpSetup,
  verifyDbAdminWebAuthn,
} from "./api";
import type { DbAdminColumn, DbAdminDatabaseOption, DbAdminRow, DbAdminTableGrant, DbAdminTableMeta, DbAdminTotpSetupData, DbAdminWebAuthnStatus } from "./types";
import "./db-admin.css";

const { Text, Title } = Typography;

type SortOrder = "ASC" | "DESC";
type EditorMode = "create" | "edit";

function isJsonColumn(column: DbAdminColumn) {
  const type = `${column.dataType || ""} ${column.udtName || ""}`.toLowerCase();
  return type.includes("json");
}

function isBooleanColumn(column: DbAdminColumn) {
  const type = `${column.dataType || ""} ${column.udtName || ""}`.toLowerCase();
  return type.includes("boolean") || type.includes("bool");
}

function isNumberColumn(column: DbAdminColumn) {
  const type = `${column.dataType || ""} ${column.udtName || ""}`.toLowerCase();
  return /integer|bigint|smallint|numeric|double|real|int2|int4|int8|float/.test(type);
}

function isLongTextColumn(column: DbAdminColumn) {
  const type = `${column.dataType || ""} ${column.udtName || ""}`.toLowerCase();
  return type.includes("text") || isJsonColumn(column) || (column.maxLength || 0) > 300;
}

function valueToText(value: unknown) {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatValue(value: unknown) {
  const text = valueToText(value);
  const content = (
    <span className={value === null || value === undefined || value === "" ? "db-admin-cell-text db-admin-cell-text--null" : "db-admin-cell-text"}>
      {text}
    </span>
  );
  return text === "NULL" ? content : <Tooltip title={text}>{content}</Tooltip>;
}

function toFormValue(column: DbAdminColumn, value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (isJsonColumn(column)) return JSON.stringify(value, null, 2);
  return value;
}

function normalizeSubmitValue(column: DbAdminColumn, value: unknown) {
  if (value === undefined) return undefined;
  if (value === "") return column.nullable ? null : "";
  if (isJsonColumn(column)) {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text) return column.nullable ? null : value;
    return JSON.parse(text);
  }
  return value;
}

function columnTag(column: DbAdminColumn) {
  if (column.primaryKey) return <Tag color="blue">PK</Tag>;
  if (column.readonly) return <Tag>只读</Tag>;
  if (!column.nullable) return <Tag color="orange">必填</Tag>;
  return null;
}

function buildInitialValues(columns: DbAdminColumn[], row?: DbAdminRow | null) {
  if (!row) return {};
  return Object.fromEntries(columns.map((column) => [column.name, toFormValue(column, row[column.name])]));
}

interface EditorDrawerProps {
  open: boolean;
  mode: EditorMode;
  table: DbAdminTableMeta | null;
  row: DbAdminRow | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

function DbAdminEditorDrawer({ open, mode, table, row, saving, onClose, onSubmit }: EditorDrawerProps) {
  const [form] = Form.useForm();
  const columns = table?.columns || [];
  const writableColumns = columns.filter((column) => !column.readonly);
  const formColumns = mode === "create" ? writableColumns : columns;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(buildInitialValues(columns, row));
  }, [columns, form, open, row]);

  function handleFinish(rawValues: Record<string, unknown>) {
    const payload: Record<string, unknown> = {};
    for (const column of writableColumns) {
      if (Object.prototype.hasOwnProperty.call(rawValues, column.name)) {
        payload[column.name] = normalizeSubmitValue(column, rawValues[column.name]);
      }
    }
    onSubmit(payload);
  }

  return (
    <Drawer
      title={mode === "create" ? `新增 · ${table?.label || "数据"}` : `编辑 · ${table?.label || "数据"}`}
      width={680}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        className="db-admin-editor-alert"
        type="warning"
        showIcon
        message="写入会记录操作日志"
        description="只允许写入白名单字段；隐藏字段、主键、时间戳等只读字段不会提交。JSON 字段保存前会校验格式。"
      />
      <Form form={form} layout="vertical" onFinish={handleFinish} className="db-admin-editor-form">
        {formColumns.map((column) => {
          const readonly = column.readonly;
          const label = (
            <Space size={6} wrap>
              <span>{column.name}</span>
              {columnTag(column)}
              <Text type="secondary">{column.dataType}</Text>
            </Space>
          );
          const rules = [
            ...(column.nullable || readonly || column.defaultValue ? [] : [{ required: true, message: `${column.name} 必填` }]),
            ...(isJsonColumn(column) && !readonly
              ? [
                  {
                    validator: (_: unknown, value: unknown) => {
                      if (value === undefined || value === "" || value === null) return Promise.resolve();
                      try {
                        JSON.parse(String(value));
                        return Promise.resolve();
                      } catch {
                        return Promise.reject(new Error("请输入合法 JSON"));
                      }
                    },
                  },
                ]
              : []),
          ];

          let control;
          if (column.enumOptions?.length) {
            control = <Select allowClear disabled={readonly} options={column.enumOptions.map((item) => ({ label: item, value: item }))} />;
          } else if (isBooleanColumn(column)) {
            control = <Switch disabled={readonly} />;
          } else if (isNumberColumn(column) && column.udtName !== "int8" && column.dataType !== "numeric") {
            control = <InputNumber disabled={readonly} className="db-admin-full-input" />;
          } else if (isLongTextColumn(column)) {
            control = <Input.TextArea disabled={readonly} rows={isJsonColumn(column) ? 8 : 4} />;
          } else {
            control = <Input disabled={readonly} />;
          }

          return (
            <Form.Item
              key={column.name}
              name={column.name}
              label={label}
              valuePropName={isBooleanColumn(column) ? "checked" : "value"}
              rules={rules}
              extra={column.comment || (column.defaultValue ? `默认值：${column.defaultValue}` : undefined)}
            >
              {control}
            </Form.Item>
          );
        })}
      </Form>
    </Drawer>
  );
}

const TABLE_GROUPS = [
  { key: "e2e", label: "E2E 互动任务", patterns: [/^e2e/i] },
  { key: "twitter-dev", label: "Twitter 底层库 (dev)", patterns: [/^dev\./i] },
  { key: "xhunt-core", label: "XHunt 核心", patterns: [/xhunt.*user/i, /^xaccounts?$/i, /review/i, /note/i, /message/i, /point/i] },
  { key: "campaign", label: "活动 / 运营", patterns: [/campaign/i, /registration/i, /mantle/i, /vip/i, /tag/i, /banner/i] },
  { key: "auth", label: "认证中心", patterns: [/authcenter/i, /auth_center/i, /credential/i, /identity/i, /session/i, /client/i] },
  { key: "web", label: "网站业务", patterns: [/website/i, /webuser/i, /cryptohunt/i, /tg/i] },
  { key: "stats", label: "统计 / 日志", patterns: [/stats/i, /stat/i, /active/i, /audit/i, /log/i, /violation/i, /snapshot/i] },
  { key: "admin", label: "后台 / 系统", patterns: [/admin/i, /config/i, /collector/i, /token/i] },
  { key: "other", label: "其他", patterns: [] },
];

function getTableGroup(table: DbAdminTableMeta) {
  const name = `${table.table || table.key || table.label}`;
  return TABLE_GROUPS.find((group) => group.patterns.some((pattern) => pattern.test(name))) || TABLE_GROUPS[TABLE_GROUPS.length - 1];
}

function sortTablesForSidebar(tables: DbAdminTableMeta[]) {
  return [...tables].sort((a, b) => {
    const groupA = getTableGroup(a);
    const groupB = getTableGroup(b);
    const groupDiff = TABLE_GROUPS.findIndex((item) => item.key === groupA.key) - TABLE_GROUPS.findIndex((item) => item.key === groupB.key);
    if (groupDiff !== 0) return groupDiff;
    return String(a.label || a.table).localeCompare(String(b.label || b.table), "zh-CN");
  });
}

function groupTablesForSidebar(tables: DbAdminTableMeta[]) {
  const grouped = new Map<string, { key: string; label: string; items: DbAdminTableMeta[] }>();
  for (const table of sortTablesForSidebar(tables)) {
    const group = getTableGroup(table);
    if (!grouped.has(group.key)) grouped.set(group.key, { key: group.key, label: group.label, items: [] });
    grouped.get(group.key)!.items.push(table);
  }
  return Array.from(grouped.values()).filter((group) => group.items.length);
}

async function browserSupportsWebAuthn() {
  const browserApi = window.SimpleWebAuthnBrowser;
  if (browserApi) {
    return Promise.resolve(browserApi.browserSupportsWebAuthn()).catch(() => false);
  }
  return typeof window.PublicKeyCredential !== "undefined";
}

export function DbAdminPage() {
  const { user, hasPermission } = useAuth();
  const isSuper = user?.role === "super";
  const isDelegatedReader = !isSuper && (user?.permissions || []).includes("db-admin:delegated-read");
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedDb, setSelectedDb] = useState<string>(isDelegatedReader ? "" : "luykindatabase");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<SortOrder>("DESC");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingRow, setEditingRow] = useState<DbAdminRow | null>(null);
  const [reauthChecked, setReauthChecked] = useState(false);
  const [reauthVerified, setReauthVerified] = useState(false);
  const [reauthing, setReauthing] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<DbAdminWebAuthnStatus | null>(null);
  const [totpSetup, setTotpSetup] = useState<DbAdminTotpSetupData | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [exportingTableKey, setExportingTableKey] = useState<string | null>(null);
  const [credForm] = Form.useForm<{ username: string; password: string }>();
  const [grantForm] = Form.useForm<{ adminId: number; databaseKey: string; tableKey: string }>();
  const grantDatabaseKey = Form.useWatch("databaseKey", grantForm);

  const canRead = isSuper || isDelegatedReader;
  const canWrite = isSuper && hasPermission("db-admin:write");

  function applySecurityStatus(status: DbAdminWebAuthnStatus) {
    setSecurityStatus(status);
    setReauthVerified(status.accessVerified);
    setReauthChecked(true);
  }

  const performDbAdminReauth = async () => {
    try {
      setReauthing(true);
      setReauthError(null);
      const browserApi = window.SimpleWebAuthnBrowser;
      const supports = await browserSupportsWebAuthn();

      if (!supports || !browserApi) {
        throw new Error("当前环境不支持指纹 / Face ID / 通行密钥，请换用支持 WebAuthn 的浏览器或设备");
      }

      messageApi.loading({ content: "等待指纹 / Face ID 验证...", key: "db-admin-webauthn", duration: 0 });
      const optionsData = await fetchDbAdminWebAuthnOptions();
      if (!optionsData.success) {
        throw new Error("获取 DB Admin 指纹认证参数失败");
      }

      const assertion = await browserApi.startAuthentication(optionsData.options);
      const verifyData = await verifyDbAdminWebAuthn(assertion);
      if (!verifyData.success || !verifyData.data?.verified) {
        throw new Error("DB Admin 指纹认证失败");
      }

      const statusResponse = await fetchDbAdminWebAuthnStatus();
      applySecurityStatus(statusResponse.data);
      messageApi.success(statusResponse.data.accessVerified
        ? "指纹认证通过，可以进入数据表管理"
        : "生物识别已通过，请继续完成 Authenticator 验证");
      return statusResponse.data.accessVerified;
    } catch (error) {
      const text = error instanceof Error ? error.message : "DB Admin 指纹认证失败";
      setReauthVerified(false);
      setReauthChecked(true);
      setReauthError(text);
      messageApi.error(text);
      return false;
    } finally {
      messageApi.destroy("db-admin-webauthn");
      setReauthing(false);
    }
  };

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;

    async function checkStatusThenReauth() {
      try {
        setReauthError(null);
        const statusResponse = await fetchDbAdminWebAuthnStatus();
        if (cancelled) return;
        setSecurityStatus(statusResponse.data);
        if (statusResponse.data?.accessVerified) {
          applySecurityStatus(statusResponse.data);
          return;
        }
        if (!statusResponse.data?.enrolled) {
          setReauthVerified(false);
          setReauthChecked(true);
          setReauthError("DB Admin 需要先在当前管理员账号录入指纹 / Face ID / 通行密钥");
          return;
        }
        if (!statusResponse.data.verified) {
          await performDbAdminReauth();
          return;
        }
        applySecurityStatus(statusResponse.data);
      } catch (error) {
        if (cancelled) return;
        setReauthVerified(false);
        setReauthChecked(true);
        setReauthError(error instanceof Error ? error.message : "检查 DB Admin 指纹认证状态失败");
      }
    }

    void checkStatusThenReauth();
    return () => {
      cancelled = true;
    };
    // 进入 DB Admin 时只检查一次，避免重复弹出系统指纹窗口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    if (!securityStatus?.accessVerified) return;
    const factorTtls = [securityStatus.ttlSeconds];
    if (securityStatus.totpRequired && securityStatus.totp) factorTtls.push(securityStatus.totp.ttlSeconds);
    const ttlSeconds = Math.min(...factorTtls);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchDbAdminWebAuthnStatus();
        applySecurityStatus(response.data);
      } catch (error) {
        setReauthVerified(false);
        setReauthError(error instanceof Error ? error.message : "检查 DB Admin 安全认证状态失败");
      }
    }, Math.max(1, ttlSeconds) * 1000 + 250);
    return () => window.clearTimeout(timer);
  }, [securityStatus?.accessVerified, securityStatus?.totp?.ttlSeconds, securityStatus?.totpRequired, securityStatus?.ttlSeconds]);

  async function beginTotpSetup() {
    try {
      setTotpSubmitting(true);
      setTotpError(null);
      const response = await beginDbAdminTotpSetup();
      setTotpSetup(response.data);
      setTotpCode("");
    } catch (error) {
      setTotpError(error instanceof Error ? error.message : "生成 Authenticator 绑定信息失败");
    } finally {
      setTotpSubmitting(false);
    }
  }

  async function submitTotp() {
    if (!/^\d{6}$/.test(totpCode)) {
      setTotpError("请输入 6 位 Authenticator 验证码");
      return;
    }
    try {
      setTotpSubmitting(true);
      setTotpError(null);
      if (securityStatus?.totp?.enrolled) {
        await verifyDbAdminTotp(totpCode);
      } else {
        await verifyDbAdminTotpSetup(totpCode);
      }
      const response = await fetchDbAdminWebAuthnStatus();
      applySecurityStatus(response.data);
      setTotpCode("");
      setTotpSetup(null);
      messageApi.success("Authenticator 验证通过，可以进入数据表管理");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Authenticator 验证失败";
      setTotpError(text);
      messageApi.error(text);
      try {
        const response = await fetchDbAdminWebAuthnStatus();
        applySecurityStatus(response.data);
      } catch (_) {}
    } finally {
      setTotpSubmitting(false);
    }
  }

  const databasesQuery = useQuery({
    queryKey: ["db-admin", "databases"],
    queryFn: fetchDbAdminDatabases,
    enabled: canRead && reauthVerified,
  });
  const databaseOptions: DbAdminDatabaseOption[] = databasesQuery.data?.data?.databases || (
    isDelegatedReader
      ? []
      : [
          { key: "luykindatabase", name: "luykindatabase", label: "luykindatabase（主业务库）" },
          { key: "dev", name: "dev", label: "dev（Twitter 底层库 · 只读）", readOnly: true, schema: "dev" },
          { key: "luykindatabase2", name: "luykindatabase2", label: "luykindatabase2（数据 / E2E 库）", configurableCredentials: true, username: "luykin2" },
        ]
  );
  const currentDbOption = databaseOptions.find((item) => item.key === selectedDb) || databaseOptions[0];
  const isReadOnlyMode = isDelegatedReader || Boolean(currentDbOption?.readOnly);

  useEffect(() => {
    if (!databaseOptions.length || databaseOptions.some((item) => item.key === selectedDb)) return;
    setSelectedDb(databasesQuery.data?.data?.defaultDatabase || databaseOptions[0].key);
    setSelectedKey(null);
  }, [databaseOptions, databasesQuery.data?.data?.defaultDatabase, selectedDb]);

  const saveCredsMutation = useMutation({
    mutationFn: (values: { username: string; password: string }) => saveDbAdminCredentials(selectedDb, values),
    onSuccess: () => {
      messageApi.success("数据库账号密码验证通过并已保存");
      setCredModalOpen(false);
      credForm.resetFields(["password"]);
      void databasesQuery.refetch();
      void tablesQuery.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "保存数据库账号配置失败");
    },
  });

  function openCredModal() {
    credForm.setFieldsValue({
      username: currentDbOption?.username || "luykin2",
      password: "",
    });
    setCredModalOpen(true);
  }

  function openGrantModal() {
    const databaseKey = selectedDb || databasesQuery.data?.data?.defaultDatabase || databaseOptions[0]?.key;
    if (databaseKey) grantForm.setFieldsValue({ databaseKey });
    setGrantModalOpen(true);
  }

  const tablesQuery = useQuery({
    queryKey: ["db-admin", "tables", selectedDb],
    queryFn: () => fetchDbAdminTables(selectedDb),
    enabled: canRead && reauthVerified && databaseOptions.some((item) => item.key === selectedDb),
  });
  const tables = tablesQuery.data?.data || [];
  const groupedTables = useMemo(() => groupTablesForSidebar(tables), [tables]);
  const sortedTables = useMemo(() => groupedTables.flatMap((group) => group.items), [groupedTables]);

  useEffect(() => {
    if (!sortedTables.length) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    if (!selectedKey || !sortedTables.some((item) => item.key === selectedKey)) {
      setSelectedKey(sortedTables[0].key);
    }
  }, [selectedKey, sortedTables]);

  const schemaQuery = useQuery({
    queryKey: ["db-admin", "schema", selectedDb, selectedKey],
    queryFn: () => fetchDbAdminSchema(selectedKey!, selectedDb),
    enabled: canRead && reauthVerified && !!selectedKey,
  });
  const currentTable = schemaQuery.data?.data || tables.find((item) => item.key === selectedKey) || null;

  const rowsQuery = useQuery({
    queryKey: ["db-admin", "rows", selectedDb, selectedKey, page, pageSize, appliedSearch, sortBy, sortOrder],
    queryFn: () => fetchDbAdminRows(selectedKey!, { db: selectedDb, page, pageSize, q: appliedSearch, sortBy, sortOrder }),
    enabled: canRead && reauthVerified && !!selectedKey,
  });

  const rowsData = rowsQuery.data?.data;
  const rows = rowsData?.rows || [];
  const columns = currentTable?.columns || rowsData?.table.columns || [];
  const primaryKey = currentTable?.primaryKey || rowsData?.table.primaryKey || "id";

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createDbAdminRow(selectedKey!, values, selectedDb),
    onSuccess: () => {
      messageApi.success("记录已新增");
      setEditorOpen(false);
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "新增失败"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string | number; values: Record<string, unknown> }) =>
      updateDbAdminRow(selectedKey!, id, values, selectedDb),
    onSuccess: () => {
      messageApi.success("记录已更新");
      setEditorOpen(false);
      setEditingRow(null);
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "更新失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) => deleteDbAdminRow(selectedKey!, id, selectedDb),
    onSuccess: () => {
      messageApi.success("记录已删除");
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
  });

  const accessQuery = useQuery({
    queryKey: ["db-admin", "access-grants"],
    queryFn: fetchDbAdminAccessGrants,
    enabled: isSuper && reauthVerified && grantModalOpen,
  });

  const grantableTablesQuery = useQuery({
    queryKey: ["db-admin", "grantable-tables", grantDatabaseKey],
    queryFn: () => fetchDbAdminTables(grantDatabaseKey!),
    enabled: isSuper && reauthVerified && grantModalOpen && !!grantDatabaseKey,
  });

  const grantMutation = useMutation({
    mutationFn: grantDbAdminTableAccess,
    onSuccess: (response) => {
      messageApi.success(response.data.created ? "表查看权限已授予" : "该用户已拥有此表的查看权限");
      grantForm.resetFields(["tableKey"]);
      void accessQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "授权失败"),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: revokeDbAdminTableAccess,
    onSuccess: () => {
      messageApi.success("表查看权限已撤销");
      void accessQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "撤销失败"),
  });

  const tableColumns = useMemo<ColumnsType<DbAdminRow>>(() => {
    const baseColumns: ColumnsType<DbAdminRow> = columns.map((column) => ({
      title: (
        <Tooltip title={column.comment || column.dataType}>
          <Space size={4}>
            <span>{column.name}</span>
            {column.primaryKey ? <Tag color="blue">PK</Tag> : null}
          </Space>
        </Tooltip>
      ),
      dataIndex: column.name,
      key: column.name,
      sorter: true,
      ellipsis: true,
      width: column.primaryKey ? 120 : isLongTextColumn(column) ? 260 : 180,
      render: (value: unknown) => formatValue(value),
    }));

    if (!isReadOnlyMode) {
      baseColumns.push({
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 150,
        render: (_: unknown, row: DbAdminRow) => {
          const id = row[primaryKey] as string | number | undefined;
          return (
            <Space size={6}>
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={!canWrite || !currentTable?.allowUpdate}
                onClick={() => {
                  setEditorMode("edit");
                  setEditingRow(row);
                  setEditorOpen(true);
                }}
              >
                编辑
              </Button>
              <Popconfirm
                title="确认删除这条记录？"
                description="删除会立即写入数据库，并记录操作日志。"
                okText="删除"
                okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
                onConfirm={() => id !== undefined && deleteMutation.mutate(id)}
              >
                <Button
                  size="small"
                  danger
                  aria-label="删除记录"
                  icon={<DeleteOutlined />}
                  disabled={!canWrite || !currentTable?.allowDelete || id === undefined}
                />
              </Popconfirm>
            </Space>
          );
        },
      });
    }

    return baseColumns;
  }, [canWrite, columns, currentTable?.allowDelete, currentTable?.allowUpdate, deleteMutation, isReadOnlyMode, primaryKey]);

  if (!canRead) return <NoPermissionPage />;

  if (!reauthVerified) {
    return (
      <div className="db-admin-page">
        {contextHolder}
        <section className="db-admin-hero db-admin-hero--locked">
          <div>
            <Text className="db-admin-eyebrow">Protected PostgreSQL Console</Text>
            <Title level={2}>{isSuper ? "需要双重认证后进入" : "需要指纹认证后进入"}</Title>
            <Text type="secondary">
              {isDelegatedReader
                ? "你仅能查看超级管理员授权的数据库和数据表；进入页面和调用接口仍需完成指纹 / Face ID / 通行密钥二次验证。"
                : "数据表管理是高危入口。超级管理员进入页面和调用接口都必须完成生物识别与 Authenticator 双重认证。"}
            </Text>
          </div>
          <Space wrap>
            <Tag color="blue">{isDelegatedReader ? "授权表只读" : "超级管理员"}</Tag>
            <Tag color="gold">WebAuthn required</Tag>
            {isSuper ? <Tag color="purple">Authenticator required</Tag> : null}
          </Space>
        </section>
        <Card className="db-admin-lock-card">
          {isSuper ? (
            <Steps
              current={!securityStatus?.verified ? 0 : !securityStatus.totp?.verified ? 1 : 2}
              items={[
                { title: "生物识别", description: securityStatus?.verified ? "已验证" : "等待验证" },
                { title: "Authenticator", description: securityStatus?.totp?.verified ? "已验证" : securityStatus?.totp?.enrolled ? "等待验证" : "需要绑定" },
                { title: "进入管理", description: "双重认证通过" },
              ]}
              style={{ marginBottom: 20 }}
            />
          ) : null}

          {isSuper && securityStatus?.verified ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Alert
                type="success"
                showIcon
                message="生物识别已通过"
                description={securityStatus.totp?.enrolled
                  ? "请输入已绑定 Authenticator 中当前显示的 6 位验证码。"
                  : "当前账号尚未绑定 Authenticator，请完成绑定后进入 DB Admin。"}
              />
              {!securityStatus.totp?.enrolled && !totpSetup ? (
                <Button size="large" type="primary" icon={<KeyOutlined />} loading={totpSubmitting} onClick={() => void beginTotpSetup()}>
                  生成 Authenticator 绑定信息
                </Button>
              ) : null}
              {!securityStatus.totp?.enrolled && totpSetup ? (
                <Card size="small" title="添加 Authenticator 账户">
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Text type="secondary">在 Authenticator 应用中选择“输入设置密钥”，账户填写当前管理员邮箱，密钥类型选择“基于时间”：</Text>
                    <Text code copyable={{ text: totpSetup.secret }} style={{ overflowWrap: "anywhere" }}>{totpSetup.secret}</Text>
                    <Typography.Link href={totpSetup.otpauthUri}>在支持的 Authenticator 应用中直接打开</Typography.Link>
                  </Space>
                </Card>
              ) : null}
              {totpError ? <Alert type="error" showIcon message={totpError} /> : null}
              {(securityStatus.totp?.enrolled || totpSetup) ? (
                <Form layout="vertical" onFinish={() => void submitTotp()} style={{ maxWidth: 380 }}>
                  <Form.Item label="Authenticator 验证码" required>
                    <Input
                      value={totpCode}
                      onChange={(event) => { setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError(null); }}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={6}
                      size="large"
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button size="large" type="primary" htmlType="submit" loading={totpSubmitting}>
                      {securityStatus.totp?.enrolled ? "验证并进入 DB Admin" : "确认绑定并进入"}
                    </Button>
                    {!securityStatus.totp?.enrolled ? (
                      <Button size="large" loading={totpSubmitting} onClick={() => void beginTotpSetup()}>
                        重新生成密钥
                      </Button>
                    ) : null}
                  </Space>
                </Form>
              ) : null}
            </Space>
          ) : (
            <>
              <Alert
                type={reauthError ? "warning" : "info"}
                showIcon
                message={reauthError || (reauthChecked ? "请完成指纹认证" : "正在检查指纹认证状态...")}
                description="验证通过后，后端会在短时间内允许访问 DB Admin 接口；过期后需要重新验证。"
              />
              <Space className="db-admin-lock-actions" wrap>
                <Button size="large" type="primary" loading={reauthing} onClick={() => void performDbAdminReauth()}>
                  {reauthing ? "等待设备验证" : "重新进行指纹认证"}
                </Button>
                <Text type="secondary">如果提示未录入，请先在右上角账号菜单里添加生物识别。</Text>
              </Space>
            </>
          )}
        </Card>
      </div>
    );
  }

  function applySearch() {
    setPage(1);
    setAppliedSearch(searchText.trim());
  }

  function selectTable(tableKey: string) {
    setSelectedKey(tableKey);
    setPage(1);
    setAppliedSearch("");
    setSearchText("");
    setSortBy(undefined);
    setSortOrder("DESC");
  }

  function handleTableChange(pagination: TablePaginationConfig, _: unknown, sorter: unknown) {
    setPage(pagination.current || 1);
    setPageSize(pagination.pageSize || 20);
    const sortInfo = Array.isArray(sorter) ? sorter[0] : sorter as { field?: string; order?: "ascend" | "descend" };
    if (sortInfo?.field) {
      setSortBy(String(sortInfo.field));
      setSortOrder(sortInfo.order === "ascend" ? "ASC" : "DESC");
    }
  }

  function openCreate() {
    setEditorMode("create");
    setEditingRow(null);
    setEditorOpen(true);
  }

  function handleEditorSubmit(values: Record<string, unknown>) {
    try {
      // JSON parse errors are thrown by normalizeSubmitValue before mutation.
      if (editorMode === "create") {
        createMutation.mutate(values);
        return;
      }
      const id = editingRow?.[primaryKey] as string | number | undefined;
      if (id === undefined) {
        messageApi.error("缺少主键，无法更新");
        return;
      }
      updateMutation.mutate({ id, values });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "表单数据不合法");
    }
  }

  async function handleExport() {
    if (!selectedKey) return;
    try {
      setExportingTableKey(selectedKey);
      const result = await exportDbAdminRows(selectedKey, {
        db: selectedDb,
        q: appliedSearch,
        sortBy,
        sortOrder,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success(`已导出 ${currentTable?.label || selectedKey}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExportingTableKey(null);
    }
  }

  return (
    <div className="db-admin-page">
      {contextHolder}
      <section className="db-admin-hero db-admin-hero--compact">
        <div>
          <Text className="db-admin-eyebrow">PostgreSQL</Text>
          <Title level={2}>数据表管理</Title>
        </div>
        <Space wrap size={12}>
          <Select
            value={selectedDb || undefined}
            aria-label="选择数据库"
            loading={databasesQuery.isLoading}
            placeholder="选择数据库"
            style={{ minWidth: 260 }}
            options={databaseOptions.map((item) => ({
              value: item.key,
              label: item.label || item.name,
            }))}
            onChange={(nextDb) => {
              setSelectedDb(nextDb);
              setSelectedKey(null);
              setPage(1);
              setAppliedSearch("");
              setSearchText("");
              setSortBy(undefined);
              setSortOrder("DESC");
            }}
          />
          {isSuper && currentDbOption?.configurableCredentials ? (
            <Button icon={<KeyOutlined />} onClick={openCredModal}>
              连接账号配置
            </Button>
          ) : null}
          {isSuper ? (
            <Button icon={<SafetyCertificateOutlined />} onClick={openGrantModal}>
              表查看授权
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={() => { void tablesQuery.refetch(); void schemaQuery.refetch(); void rowsQuery.refetch(); }}>
            刷新
          </Button>
        </Space>
      </section>

      {isReadOnlyMode ? (
        <Alert
          className="db-admin-readonly-alert"
          type="info"
          showIcon
          message={isDelegatedReader ? "当前账号为授权表只读模式" : `${selectedDb} 数据源为只读模式`}
          description={isDelegatedReader
            ? "当前仅展示超级管理员授权给你的数据库和数据表，支持分页、搜索、排序和 Excel 导出，不具备任何写入权限。"
            : `当前仅展示 ${selectedDb} 中允许查看的数据表，支持分页、搜索、排序和 Excel 导出；新增、编辑和删除在界面与后端均已禁用。`}
        />
      ) : null}

      {databasesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="加载数据库列表失败"
          description={databasesQuery.error instanceof Error ? databasesQuery.error.message : "请刷新页面后重试"}
        />
      ) : null}

      {tablesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={`加载数据库 ${selectedDb} 的数据表失败`}
          description={tablesQuery.error instanceof Error ? tablesQuery.error.message : "请检查数据库账号密码配置"}
          action={
            currentDbOption?.configurableCredentials ? (
              <Button size="small" type="primary" icon={<KeyOutlined />} onClick={openCredModal}>
                配置账号密码
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div className="db-admin-workbench">
        <Card className="db-admin-sidebar" title={`数据表（${selectedDb}${isReadOnlyMode ? " · 只读" : ""}）`} loading={tablesQuery.isLoading}>
          {groupedTables.length ? (
            <div className="db-admin-table-groups">
              {groupedTables.map((group) => (
                <div className="db-admin-table-group" key={group.key}>
                  <div className="db-admin-table-group-title">
                    <span>{group.label}</span>
                    <span>{group.items.length}</span>
                  </div>
                  <List
                    dataSource={group.items}
                    renderItem={(item) => (
                      <List.Item
                        className={item.key === selectedKey ? "db-admin-table-item db-admin-table-item--active" : "db-admin-table-item"}
                        role="button"
                        tabIndex={0}
                        aria-pressed={item.key === selectedKey}
                        onClick={() => selectTable(item.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectTable(item.key);
                          }
                        }}
                      >
                      <List.Item.Meta
                        title={<span className="db-admin-table-label">{item.label}</span>}
                        description={<span className="db-admin-table-identifier">{item.table}</span>}
                      />
                      </List.Item>
                    )}
                  />
                </div>
              ))}
            </div>
          ) : <Empty description="暂无数据表" />}
        </Card>

        <Card
          className="db-admin-data-card"
          title={currentTable ? (
            <div className="db-admin-current-table-title">
              <span>
                {currentTable.label}
                {isReadOnlyMode ? <Tag color="blue">只读</Tag> : null}
              </span>
              <Text type="secondary">{currentTable.table}</Text>
            </div>
          ) : "请选择表"}
          extra={
            <Space wrap>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={(currentTable?.searchableColumns || []).length ? `搜索：${currentTable?.searchableColumns.join(" / ")}` : "该表未配置搜索字段"}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onPressEnter={applySearch}
                className="db-admin-search"
              />
              <Button onClick={applySearch}>搜索</Button>
              <Button
                icon={<DownloadOutlined />}
                disabled={!selectedKey}
                loading={exportingTableKey === selectedKey}
                onClick={() => void handleExport()}
              >
                导出 Excel
              </Button>
              {!isReadOnlyMode ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canWrite || !currentTable?.allowCreate}
                  onClick={openCreate}
                >
                  新增
                </Button>
              ) : null}
            </Space>
          }
        >
          {currentTable?.description ? <Text className="db-admin-table-desc" type="secondary">{currentTable.description}</Text> : null}
          <Table<DbAdminRow>
            rowKey={(row, index) =>
              currentTable?.hasSinglePrimaryKey && row[primaryKey] !== undefined
                ? String(row[primaryKey])
                : `${String(row[primaryKey] ?? "")}-${index}`
            }
            columns={tableColumns}
            dataSource={rows}
            loading={rowsQuery.isLoading || schemaQuery.isLoading}
            scroll={{ x: Math.max(900, tableColumns.length * 180) }}
            pagination={{
              current: rowsData?.pagination.page || page,
              pageSize: rowsData?.pagination.pageSize || pageSize,
              total: rowsData?.pagination.total || 0,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            onChange={handleTableChange}
            locale={{ emptyText: <Empty description={selectedKey ? "暂无数据" : "请选择左侧表"} /> }}
          />
        </Card>
      </div>

      <DbAdminEditorDrawer
        open={editorOpen}
        mode={editorMode}
        table={currentTable}
        row={editingRow}
        saving={createMutation.isPending || updateMutation.isPending}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleEditorSubmit}
      />

      <Modal
        open={grantModalOpen}
        title="数据库表查看授权"
        width={1120}
        footer={null}
        destroyOnClose
        onCancel={() => {
          setGrantModalOpen(false);
          grantForm.resetFields();
        }}
      >
        <Alert
          className="db-admin-grant-alert"
          type="warning"
          showIcon
          message="授权仅包含单表只读和 Excel 导出"
          description="被授权管理员只能看到授权清单中的数据库和数据表，不能新增、编辑或删除数据。撤销后，其后续 API 请求会立即被拒绝。"
        />
        {accessQuery.isError || grantableTablesQuery.isError ? (
          <Alert
            className="db-admin-grant-error"
            type="error"
            showIcon
            message="授权数据加载失败"
            description={(accessQuery.error || grantableTablesQuery.error) instanceof Error
              ? (accessQuery.error || grantableTablesQuery.error as Error).message
              : "请关闭弹窗后重试"}
          />
        ) : null}
        <Form
          form={grantForm}
          layout="vertical"
          className="db-admin-grant-form"
          onFinish={(values) => grantMutation.mutate(values)}
        >
          <Form.Item name="adminId" label="授权管理员" rules={[{ required: true, message: "请选择管理员" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择非 super 管理员"
              loading={accessQuery.isLoading}
              options={(accessQuery.data?.data?.admins || []).map((admin) => ({
                value: admin.id,
                label: `${admin.email}${admin.isActive && admin.canLogin ? "" : "（已停用）"}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="databaseKey" label="数据库" rules={[{ required: true, message: "请选择数据库" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择数据库"
              loading={databasesQuery.isLoading}
              options={databaseOptions.map((database) => ({
                value: database.key,
                label: database.label || database.name,
              }))}
              onChange={() => grantForm.resetFields(["tableKey"])}
            />
          </Form.Item>
          <Form.Item name="tableKey" label="数据表" rules={[{ required: true, message: "请选择数据表" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!grantDatabaseKey}
              placeholder={grantDatabaseKey ? "选择仅可查看的表" : "请先选择数据库"}
              loading={grantableTablesQuery.isLoading}
              options={(grantableTablesQuery.data?.data || []).map((table) => ({
                value: table.key,
                label: `${table.label} · ${table.table}`,
              }))}
            />
          </Form.Item>
          <Form.Item label=" ">
            <Button type="primary" htmlType="submit" loading={grantMutation.isPending}>
              新增只读授权
            </Button>
          </Form.Item>
        </Form>

        <Table<DbAdminTableGrant>
          rowKey="id"
          size="small"
          loading={accessQuery.isLoading}
          dataSource={accessQuery.data?.data?.grants || []}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="暂无表查看授权" /> }}
          columns={[
            {
              title: "管理员",
              dataIndex: ["admin", "email"],
              render: (_value, grant) => (
                <Space size={6} wrap>
                  <Text>{grant.admin?.email || `Admin #${grant.adminId}`}</Text>
                  {grant.admin && (!grant.admin.isActive || !grant.admin.canLogin) ? <Tag>已停用</Tag> : null}
                </Space>
              ),
            },
            { title: "数据库", dataIndex: "databaseKey", width: 150, render: (value: string) => <Text code>{value}</Text> },
            { title: "数据表", dataIndex: "tableKey", render: (value: string) => <Text code>{value}</Text> },
            { title: "授权人", dataIndex: ["grantedByAdmin", "email"], render: (value?: string) => value || "-" },
            { title: "授权时间", dataIndex: "createdAt", width: 180, render: (value: string) => value ? new Date(value).toLocaleString() : "-" },
            {
              title: "操作",
              width: 100,
              fixed: "right",
              render: (_value, grant) => (
                <Popconfirm
                  title="撤销这条表查看权限？"
                  description="撤销后该管理员将无法继续查看或导出此表。"
                  okText="撤销"
                  okButtonProps={{ danger: true, loading: revokeGrantMutation.isPending }}
                  onConfirm={() => revokeGrantMutation.mutateAsync(grant.id)}
                >
                  <Button size="small" danger>撤销</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={credModalOpen}
        title={`配置数据库连接账号（${selectedDb}）`}
        okText="保存并测试连接"
        cancelText="取消"
        confirmLoading={saveCredsMutation.isPending}
        onCancel={() => setCredModalOpen(false)}
        onOk={() => {
          void credForm.validateFields().then((values) => {
            saveCredsMutation.mutate(values);
          });
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`默认也可在服务器 .env-pro 中配置 PG2_USERNAME / PG2_PASSWORD；在此保存后会测试连接并加密持久化到 Redis。`}
        />
        <Form form={credForm} layout="vertical" initialValues={{ username: currentDbOption?.username || "luykin2" }}>
          <Form.Item
            name="username"
            label="数据库用户名 (PG User)"
            rules={[{ required: true, message: "请输入数据库用户名，如 luykin2" }]}
          >
            <Input placeholder="例如：luykin2" />
          </Form.Item>
          <Form.Item
            name="password"
            label="数据库密码 (PG Password)"
            rules={[{ required: true, message: "请输入数据库密码" }]}
          >
            <Input.Password placeholder={`请输入 ${selectedDb} 的数据库密码`} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
