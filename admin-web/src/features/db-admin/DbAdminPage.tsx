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
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NoPermissionPage } from "@/pages/NoPermissionPage";
import { useAuth } from "@/app/auth";
import {
  createDbAdminRow,
  deleteDbAdminRow,
  fetchDbAdminRows,
  fetchDbAdminSchema,
  fetchDbAdminTables,
  fetchDbAdminWebAuthnOptions,
  fetchDbAdminWebAuthnStatus,
  updateDbAdminRow,
  verifyDbAdminWebAuthn,
} from "./api";
import type { DbAdminColumn, DbAdminRow, DbAdminTableMeta } from "./types";
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

async function browserSupportsWebAuthn() {
  const browserApi = window.SimpleWebAuthnBrowser;
  if (browserApi) {
    return Promise.resolve(browserApi.browserSupportsWebAuthn()).catch(() => false);
  }
  return typeof window.PublicKeyCredential !== "undefined";
}

export function DbAdminPage() {
  const { user, hasPermission } = useAuth();
  const [messageApi, contextHolder] = message.useMessage();
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

  const canRead = user?.role === "super" && hasPermission("db-admin:read");
  const canWrite = user?.role === "super" && hasPermission("db-admin:write");

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

      setReauthVerified(true);
      setReauthChecked(true);
      messageApi.success("指纹认证通过，可以进入数据表管理");
      return true;
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
        if (statusResponse.data?.verified) {
          setReauthVerified(true);
          setReauthChecked(true);
          return;
        }
        if (!statusResponse.data?.enrolled) {
          setReauthVerified(false);
          setReauthChecked(true);
          setReauthError("DB Admin 需要先在当前管理员账号录入指纹 / Face ID / 通行密钥");
          return;
        }
        await performDbAdminReauth();
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

  const tablesQuery = useQuery({
    queryKey: ["db-admin", "tables"],
    queryFn: fetchDbAdminTables,
    enabled: canRead && reauthVerified,
  });
  const tables = tablesQuery.data?.data || [];

  useEffect(() => {
    if (!selectedKey && tables.length) setSelectedKey(tables[0].key);
  }, [selectedKey, tables]);

  const schemaQuery = useQuery({
    queryKey: ["db-admin", "schema", selectedKey],
    queryFn: () => fetchDbAdminSchema(selectedKey!),
    enabled: canRead && reauthVerified && !!selectedKey,
  });
  const currentTable = schemaQuery.data?.data || tables.find((item) => item.key === selectedKey) || null;

  const rowsQuery = useQuery({
    queryKey: ["db-admin", "rows", selectedKey, page, pageSize, appliedSearch, sortBy, sortOrder],
    queryFn: () => fetchDbAdminRows(selectedKey!, { page, pageSize, q: appliedSearch, sortBy, sortOrder }),
    enabled: canRead && reauthVerified && !!selectedKey,
  });

  const rowsData = rowsQuery.data?.data;
  const rows = rowsData?.rows || [];
  const columns = currentTable?.columns || rowsData?.table.columns || [];
  const primaryKey = currentTable?.primaryKey || rowsData?.table.primaryKey || "id";

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createDbAdminRow(selectedKey!, values),
    onSuccess: () => {
      messageApi.success("记录已新增");
      setEditorOpen(false);
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "新增失败"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string | number; values: Record<string, unknown> }) => updateDbAdminRow(selectedKey!, id, values),
    onSuccess: () => {
      messageApi.success("记录已更新");
      setEditorOpen(false);
      setEditingRow(null);
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "更新失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) => deleteDbAdminRow(selectedKey!, id),
    onSuccess: () => {
      messageApi.success("记录已删除");
      void rowsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
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
                icon={<DeleteOutlined />}
                disabled={!canWrite || !currentTable?.allowDelete || id === undefined}
              />
            </Popconfirm>
          </Space>
        );
      },
    });

    return baseColumns;
  }, [canWrite, columns, currentTable?.allowDelete, currentTable?.allowUpdate, deleteMutation, primaryKey]);

  if (!canRead) return <NoPermissionPage />;

  if (!reauthVerified) {
    return (
      <div className="db-admin-page">
        {contextHolder}
        <section className="db-admin-hero db-admin-hero--locked">
          <div>
            <Text className="db-admin-eyebrow">Protected PostgreSQL Console</Text>
            <Title level={2}>需要指纹认证后进入</Title>
            <Text type="secondary">数据表管理是高危入口。除了 super + db-admin 权限，进入页面和调用接口都必须完成指纹 / Face ID / 通行密钥二次验证。</Text>
          </div>
          <Space wrap>
            <Tag color="blue">super only</Tag>
            <Tag color="gold">WebAuthn required</Tag>
          </Space>
        </section>
        <Card className="db-admin-lock-card">
          <Alert
            type={reauthError ? "warning" : "info"}
            showIcon
            message={reauthError || (reauthChecked ? "请完成指纹认证" : "正在检查指纹认证状态...")}
            description="验证通过后，后端会在短时间内允许访问 DB Admin 接口；过期后需要重新验证。"
          />
          <Space className="db-admin-lock-actions" wrap>
            <Button type="primary" loading={reauthing} onClick={() => void performDbAdminReauth()}>
              {reauthing ? "等待设备验证" : "重新进行指纹认证"}
            </Button>
            <Text type="secondary">如果提示未录入，请先在右上角账号菜单里添加生物识别。</Text>
          </Space>
        </Card>
      </div>
    );
  }

  function applySearch() {
    setPage(1);
    setAppliedSearch(searchText.trim());
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

  return (
    <div className="db-admin-page">
      {contextHolder}
      <section className="db-admin-hero db-admin-hero--compact">
        <div>
          <Text className="db-admin-eyebrow">PostgreSQL</Text>
          <Title level={2}>数据表管理</Title>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void tablesQuery.refetch(); void schemaQuery.refetch(); void rowsQuery.refetch(); }}>
          刷新
        </Button>
      </section>

      <div className="db-admin-workbench">
        <Card className="db-admin-sidebar" title="白名单表" loading={tablesQuery.isLoading}>
          {tables.length ? (
            <List
              dataSource={tables}
              renderItem={(item) => (
                <List.Item
                  className={item.key === selectedKey ? "db-admin-table-item db-admin-table-item--active" : "db-admin-table-item"}
                  onClick={() => {
                    setSelectedKey(item.key);
                    setPage(1);
                    setAppliedSearch("");
                    setSearchText("");
                    setSortBy(undefined);
                    setSortOrder("DESC");
                  }}
                >
                  <List.Item.Meta
                    title={<Space><span>{item.label}</span>{item.allowDelete ? <Tag color="red">可删</Tag> : null}</Space>}
                  />
                </List.Item>
              )}
            />
          ) : <Empty description="暂无配置表" />}
        </Card>

        <Card
          className="db-admin-data-card"
          title={currentTable ? <Space wrap><span>{currentTable.label}</span><Text type="secondary">{currentTable.table}</Text></Space> : "请选择表"}
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
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canWrite || !currentTable?.allowCreate}
                onClick={openCreate}
              >
                新增
              </Button>
            </Space>
          }
        >
          {currentTable?.description ? <Text className="db-admin-table-desc" type="secondary">{currentTable.description}</Text> : null}
          <Table<DbAdminRow>
            rowKey={(row) => String(row[primaryKey])}
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
    </div>
  );
}
