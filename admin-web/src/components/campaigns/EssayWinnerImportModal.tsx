import { useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Col,
  Divider,
  Input,
  Modal,
  Radio,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  FileExcelOutlined,
  ImportOutlined,
  LinkOutlined,
  LoadingOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import {
  previewEssayWinnerFile,
  previewGoogleSheetEssayWinners,
  type EssayWinnerDraft,
  type EssayWinnerImportPreview,
  type EssayWinnerImportRow,
} from "@/services/essay-winner-import";

type ExistingWinner = Partial<EssayWinnerDraft>;
type ImportMode = "replace" | "append";
type SourceType = "google-sheet" | "file";

const FIELD_LABELS: Record<keyof EssayWinnerDraft, string> = {
  handler: "推特账号",
  name: "姓名",
  avatar: "头像",
  url: "作品链接",
  post: "文章概要",
  reward: "奖励",
  award: "奖项",
};

function normalizeHandle(value: string) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "");
}

function normalizeUrl(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

function validateWinner(winner: EssayWinnerDraft) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const handler = normalizeHandle(winner.handler);
  if (!handler) errors.push("缺少推特账号");
  else if (!/^[A-Za-z0-9_]{1,128}$/.test(handler)) errors.push("推特账号格式不正确");
  if (!winner.url.trim()) warnings.push("缺少作品链接");
  else {
    try {
      const parsed = new URL(winner.url);
      if (!/^https?:$/.test(parsed.protocol)) errors.push("作品链接格式不正确");
    } catch {
      errors.push("作品链接格式不正确");
    }
  }
  if (!winner.name.trim()) warnings.push("缺少姓名");
  if (!winner.avatar.trim()) warnings.push("缺少头像");
  if (!winner.reward.trim()) warnings.push("缺少奖励");
  return { errors, warnings };
}

function getInitialSelectedRowIds(rows: EssayWinnerImportRow[]) {
  const handles = new Set<string>();
  const urls = new Set<string>();
  return rows.filter((row) => {
    if (validateWinner(row.winner).errors.length) return false;
    const handlerKey = normalizeHandle(row.winner.handler).toLowerCase();
    const urlKey = normalizeUrl(row.winner.url);
    if ((handlerKey && handles.has(handlerKey)) || (urlKey && urls.has(urlKey))) return false;
    if (handlerKey) handles.add(handlerKey);
    if (urlKey) urls.add(urlKey);
    return true;
  }).map((row) => row.id);
}

function buildRowValidation(rows: EssayWinnerImportRow[], selectedRowIds: string[]) {
  const selected = new Set(selectedRowIds);
  const handles = new Map<string, number>();
  const urls = new Map<string, number>();
  return new Map(rows.map((row) => {
    const validation = validateWinner(row.winner);
    if (selected.has(row.id)) {
      const handlerKey = normalizeHandle(row.winner.handler).toLowerCase();
      const urlKey = normalizeUrl(row.winner.url);
      if (handlerKey && handles.has(handlerKey)) {
        validation.errors.push(`与第 ${handles.get(handlerKey)} 行的推特账号重复`);
      } else if (handlerKey) {
        handles.set(handlerKey, row.sourceRow);
      }
      if (urlKey && urls.has(urlKey)) {
        validation.errors.push(`与第 ${urls.get(urlKey)} 行的作品链接重复`);
      } else if (urlKey) {
        urls.set(urlKey, row.sourceRow);
      }
    }
    return [row.id, validation];
  }));
}

function cloneRows(rows: EssayWinnerImportRow[]) {
  return rows.map((row) => ({ ...row, winner: { ...row.winner }, issues: [...row.issues] }));
}

export function EssayWinnerImportModal({
  existingWinners,
  onImport,
  onMessage,
}: {
  existingWinners: ExistingWinner[];
  onImport: (winners: EssayWinnerDraft[]) => void;
  onMessage: (message: string, type?: "success" | "error" | "info") => void;
}) {
  const [open, setOpen] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>("google-sheet");
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<EssayWinnerImportPreview | null>(null);
  const [rows, setRows] = useState<EssayWinnerImportRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>(existingWinners.length ? "append" : "replace");
  const [batchReward, setBatchReward] = useState("");
  const [batchAward, setBatchAward] = useState("");

  const reset = () => {
    setSourceType("google-sheet");
    setGoogleSheetUrl("");
    setFileList([]);
    setLoading(false);
    setError("");
    setPreview(null);
    setRows([]);
    setSelectedRowIds([]);
    setBatchReward("");
    setBatchAward("");
    setImportMode(existingWinners.length ? "append" : "replace");
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const rowValidation = useMemo(
    () => buildRowValidation(rows, selectedRowIds),
    [rows, selectedRowIds],
  );
  const selectedRows = rows.filter((row) => selectedRowIds.includes(row.id));
  const selectedErrorCount = selectedRows.filter((row) => (rowValidation.get(row.id)?.errors.length || 0) > 0).length;
  const selectedWarningCount = selectedRows.filter((row) => (rowValidation.get(row.id)?.warnings.length || 0) > 0).length;

  const parseSource = async () => {
    setError("");
    if (sourceType === "google-sheet" && !googleSheetUrl.trim()) {
      setError("请先粘贴 Google Sheets 链接");
      return;
    }
    const file = fileList[0]?.originFileObj;
    if (sourceType === "file" && !file) {
      setError("请先选择 Excel 或 CSV 文件");
      return;
    }
    setLoading(true);
    try {
      const response = sourceType === "google-sheet"
        ? await previewGoogleSheetEssayWinners(googleSheetUrl.trim())
        : await previewEssayWinnerFile(file as File);
      const nextRows = cloneRows(response.data.rows);
      setPreview(response.data);
      setRows(nextRows);
      setSelectedRowIds(getInitialSelectedRowIds(nextRows));
    } catch (parseError) {
      setPreview(null);
      setRows([]);
      setSelectedRowIds([]);
      setError(parseError instanceof Error ? parseError.message : "解析失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const updateWinner = (rowId: string, field: keyof EssayWinnerDraft, value: string) => {
    setRows((current) => current.map((row) => (
      row.id === rowId ? { ...row, winner: { ...row.winner, [field]: value } } : row
    )));
  };

  const applyBatchValues = () => {
    if (!batchReward.trim() && !batchAward.trim()) return;
    setRows((current) => current.map((row) => {
      if (!selectedRowIds.includes(row.id)) return row;
      return {
        ...row,
        winner: {
          ...row.winner,
          ...(batchReward.trim() ? { reward: batchReward.trim() } : {}),
          ...(batchAward.trim() ? { award: batchAward.trim() } : {}),
        },
      };
    }));
  };

  const confirmImport = () => {
    if (!selectedRows.length || selectedErrorCount) return;
    const normalized = selectedRows.map(({ winner }) => ({
      ...winner,
      handler: normalizeHandle(winner.handler),
      name: winner.name.trim(),
      avatar: winner.avatar.trim(),
      reward: winner.reward.trim(),
      award: winner.award.trim(),
      post: winner.post.trim(),
      url: winner.url.trim(),
    }));
    let nextWinners = normalized;
    let duplicateCount = 0;
    if (importMode === "append") {
      const usedHandles = new Set(existingWinners.map((item) => normalizeHandle(item.handler || "").toLowerCase()).filter(Boolean));
      const usedUrls = new Set(existingWinners.map((item) => normalizeUrl(item.url || "")).filter(Boolean));
      const appended = normalized.filter((winner) => {
        const handlerKey = winner.handler.toLowerCase();
        const urlKey = normalizeUrl(winner.url);
        if ((handlerKey && usedHandles.has(handlerKey)) || (urlKey && usedUrls.has(urlKey))) {
          duplicateCount += 1;
          return false;
        }
        if (handlerKey) usedHandles.add(handlerKey);
        if (urlKey) usedUrls.add(urlKey);
        return true;
      });
      nextWinners = [...existingWinners.map((item) => ({
        name: item.name || "",
        handler: item.handler || "",
        avatar: item.avatar || "",
        reward: item.reward || "",
        award: item.award || "",
        post: item.post || "",
        url: item.url || "",
      })), ...appended];
    }
    onImport(nextWinners);
    onMessage(
      `已导入 ${importMode === "replace" ? normalized.length : nextWinners.length - existingWinners.length} 位获奖者到当前草稿${duplicateCount ? `，跳过 ${duplicateCount} 条重复数据` : ""}；检查无误后请点击页面发布按钮。`,
      "success",
    );
    close();
  };

  const columns = [
    {
      title: "来源",
      key: "source",
      width: 74,
      render: (_: unknown, row: EssayWinnerImportRow) => <Typography.Text type="secondary">第 {row.sourceRow} 行</Typography.Text>,
    },
    {
      title: "账号资料",
      key: "profile",
      width: 260,
      render: (_: unknown, row: EssayWinnerImportRow) => (
        <Space align="start" size={8} style={{ width: "100%" }}>
          <Avatar src={row.winner.avatar || undefined} icon={<UserOutlined />} size={38} />
          <Space direction="vertical" size={4} style={{ flex: 1 }}>
            <Input size="small" value={row.winner.handler} prefix="@" placeholder="Twitter handler" onChange={(event) => updateWinner(row.id, "handler", event.target.value)} />
            <Input size="small" value={row.winner.name} placeholder="姓名 / 昵称" onChange={(event) => updateWinner(row.id, "name", event.target.value)} />
            <Input size="small" value={row.winner.avatar} placeholder="头像 URL" onChange={(event) => updateWinner(row.id, "avatar", event.target.value)} />
          </Space>
        </Space>
      ),
    },
    {
      title: "获奖作品",
      key: "work",
      width: 360,
      render: (_: unknown, row: EssayWinnerImportRow) => (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} value={row.winner.post} placeholder="作品标题或概要" onChange={(event) => updateWinner(row.id, "post", event.target.value)} />
          <Input size="small" value={row.winner.url} prefix={<LinkOutlined />} placeholder="https://x.com/..." onChange={(event) => updateWinner(row.id, "url", event.target.value)} />
        </Space>
      ),
    },
    {
      title: "奖励与奖项",
      key: "reward",
      width: 220,
      render: (_: unknown, row: EssayWinnerImportRow) => (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Input size="small" value={row.winner.reward} placeholder="例如 1,000 USDC" onChange={(event) => updateWinner(row.id, "reward", event.target.value)} />
          <Input size="small" value={row.winner.award} placeholder="例如 🥇 1st Prize" onChange={(event) => updateWinner(row.id, "award", event.target.value)} />
        </Space>
      ),
    },
    {
      title: "校验",
      key: "validation",
      width: 190,
      render: (_: unknown, row: EssayWinnerImportRow) => {
        const validation = rowValidation.get(row.id) || { errors: [], warnings: [] };
        return (
          <Space direction="vertical" size={3}>
            {row.profileLookup === "completed" ? <Tag color="blue">资料已补全</Tag> : null}
            {row.profileLookup === "failed" ? <Tag color="orange">资料补全失败</Tag> : null}
            {!validation.errors.length && !validation.warnings.length ? <Tag color="success" icon={<CheckCircleOutlined />}>可导入</Tag> : null}
            {validation.errors.map((message) => <Tag key={message} color="error">{message}</Tag>)}
            {validation.warnings.map((message) => <Tag key={message} color="warning">{message}</Tag>)}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Button
        size="small"
        icon={<ImportOutlined />}
        onClick={() => {
          setImportMode(existingWinners.length ? "append" : "replace");
          setOpen(true);
        }}
      >
        批量导入
      </Button>
      <Modal
        open={open}
        width={1180}
        title="批量导入征文获奖名单"
        onCancel={close}
        destroyOnClose
        footer={preview ? [
          <Button key="cancel" onClick={close}>取消</Button>,
          <Button
            key="confirm"
            type="primary"
            icon={<ImportOutlined />}
            disabled={!selectedRows.length || selectedErrorCount > 0}
            onClick={confirmImport}
          >
            确认导入 {selectedRows.length} 条到当前名单
          </Button>,
        ] : null}
      >
        <Alert
          type="info"
          showIcon
          message="导入只会更新当前活动草稿，不会立即发布"
          description="系统会自动识别作者、作品链接、概要、奖励与奖项等列，并补全缺失的 Twitter 昵称和头像。预览确认后，仍需点击页面顶部的发布按钮才会生效。"
          style={{ marginBottom: 16 }}
        />

        {!preview ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Segmented<SourceType>
              block
              value={sourceType}
              onChange={(value) => {
                setSourceType(value);
                setError("");
              }}
              options={[
                { value: "google-sheet", label: "Google Sheets 链接", icon: <CloudDownloadOutlined /> },
                { value: "file", label: "Excel / CSV 文件", icon: <FileExcelOutlined /> },
              ]}
            />
            {sourceType === "google-sheet" ? (
              <div>
                <Typography.Text strong>Google Sheets 链接</Typography.Text>
                <Input
                  size="large"
                  value={googleSheetUrl}
                  onChange={(event) => setGoogleSheetUrl(event.target.value)}
                  onPressEnter={() => void parseSource()}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
                  prefix={<LinkOutlined />}
                  style={{ marginTop: 8 }}
                />
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                  文档需设置为“知道链接的任何人可查看”，系统只读取链接中 gid 对应的工作表。
                </Typography.Text>
              </div>
            ) : (
              <Upload.Dragger
                accept=".xlsx,.xls,.csv"
                maxCount={1}
                beforeUpload={() => false}
                fileList={fileList}
                onChange={({ fileList: nextFileList }) => {
                  setFileList(nextFileList.slice(-1));
                  setError("");
                }}
                onRemove={() => {
                  setFileList([]);
                  return true;
                }}
              >
                <p className="ant-upload-drag-icon"><FileExcelOutlined /></p>
                <p className="ant-upload-text">点击或拖入 Excel / CSV 文件</p>
                <p className="ant-upload-hint">支持 .xlsx、.xls、.csv，文件不超过 3MB，最多读取 500 行</p>
              </Upload.Dragger>
            )}
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Button type="primary" size="large" block loading={loading} icon={loading ? <LoadingOutlined /> : <CloudDownloadOutlined />} onClick={() => void parseSource()}>
              解析并补全 Twitter 资料
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Statistic title="识别数据" value={rows.length} suffix="行" /></Col>
              <Col xs={12} md={6}><Statistic title="已选择" value={selectedRows.length} suffix="行" valueStyle={{ color: "#1677ff" }} /></Col>
              <Col xs={12} md={6}><Statistic title="错误" value={selectedErrorCount} suffix="行" valueStyle={{ color: selectedErrorCount ? "#cf1322" : undefined }} /></Col>
              <Col xs={12} md={6}><Statistic title="需注意" value={selectedWarningCount} suffix="行" valueStyle={{ color: selectedWarningCount ? "#d46b08" : undefined }} /></Col>
            </Row>
            <Divider style={{ margin: 0 }} />
            <Row gutter={[12, 12]} align="bottom">
              <Col xs={24} md={8}>
                <Typography.Text strong>导入方式</Typography.Text>
                <Radio.Group value={importMode} onChange={(event) => setImportMode(event.target.value)} style={{ display: "flex", marginTop: 8 }}>
                  <Radio.Button value="replace">替换当前名单</Radio.Button>
                  <Radio.Button value="append">追加并跳过重复</Radio.Button>
                </Radio.Group>
              </Col>
              <Col xs={24} md={6}>
                <Typography.Text strong>批量奖励（可选）</Typography.Text>
                <Input value={batchReward} onChange={(event) => setBatchReward(event.target.value)} placeholder="例如 500 USDC" style={{ marginTop: 8 }} />
              </Col>
              <Col xs={24} md={6}>
                <Typography.Text strong>批量奖项（可选）</Typography.Text>
                <Input value={batchAward} onChange={(event) => setBatchAward(event.target.value)} placeholder="例如 🏅 Winner" style={{ marginTop: 8 }} />
              </Col>
              <Col xs={24} md={4}>
                <Button block disabled={!selectedRows.length || (!batchReward.trim() && !batchAward.trim())} onClick={applyBatchValues}>应用到已选择</Button>
              </Col>
            </Row>
            <Space size={[6, 6]} wrap>
              <Typography.Text type="secondary">列映射：</Typography.Text>
              {preview.columns.filter((column) => column.field).map((column) => (
                <Tag key={column.index}>{column.source} → {FIELD_LABELS[column.field as keyof EssayWinnerDraft]}</Tag>
              ))}
              {preview.truncated ? <Tag color="warning" icon={<WarningOutlined />}>只预览前 500 行</Tag> : null}
            </Space>
            {selectedErrorCount ? <Alert type="error" showIcon message={`已选择的数据中有 ${selectedErrorCount} 行错误，请修正或取消勾选后再导入。`} /> : null}
            <Table<EssayWinnerImportRow>
              size="small"
              rowKey="id"
              dataSource={rows}
              columns={columns}
              pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 行` }}
              scroll={{ x: 1120, y: 440 }}
              rowSelection={{
                selectedRowKeys: selectedRowIds,
                preserveSelectedRowKeys: true,
                onChange: (keys) => setSelectedRowIds(keys.map(String)),
              }}
            />
            <Button onClick={() => {
              setPreview(null);
              setRows([]);
              setSelectedRowIds([]);
              setError("");
            }}>
              重新选择来源
            </Button>
          </Space>
        )}
      </Modal>
    </>
  );
}
