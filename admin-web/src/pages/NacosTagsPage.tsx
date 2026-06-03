import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SaveOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import {
  deleteUserTag,
  fetchUserTags,
  syncUserTagTwitterIds,
  upsertUserTag,
} from "@/services/nacos";
import type { UserTagItem } from "@/types/nacos";

type DraftTag = {
  id?: number;
  username: string;
  twitterId?: string | null;
  tagsZh: string[];
  tagsEn: string[];
};

function emptyDraft(): DraftTag {
  return { username: "", twitterId: null, tagsZh: [], tagsEn: [] };
}

function toDraft(item?: UserTagItem | null): DraftTag {
  if (!item) return emptyDraft();
  return {
    id: item.id,
    username: item.username || "",
    twitterId: item.twitterId || null,
    tagsZh: Array.isArray(item.tagsZh) ? item.tagsZh : [],
    tagsEn: Array.isArray(item.tagsEn) ? item.tagsEn : [],
  };
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function normalizeTags(tags: string[]) {
  return Array.from(new Set((tags || []).map((tag) => String(tag || "").trim()).filter(Boolean)));
}

function isSameDraft(a: DraftTag, b: DraftTag) {
  return JSON.stringify({ ...a, tagsZh: normalizeTags(a.tagsZh), tagsEn: normalizeTags(a.tagsEn) }) ===
    JSON.stringify({ ...b, tagsZh: normalizeTags(b.tagsZh), tagsEn: normalizeTags(b.tagsEn) });
}

export function NacosTagsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftTag>(emptyDraft());
  const [baseline, setBaseline] = useState<DraftTag>(emptyDraft());

  const query = useQuery({ queryKey: ["user-tags-db"], queryFn: fetchUserTags });
  const items = query.data?.data || [];
  const selectedItem = typeof selectedId === "number" ? items.find((item) => item.id === selectedId) || null : null;
  const dirty = !isSameDraft(draft, baseline);

  useEffect(() => {
    if (dirty) return;
    if (selectedId === "new") return;
    const nextSelected = typeof selectedId === "number" && items.some((item) => item.id === selectedId)
      ? selectedId
      : items[0]?.id || null;
    setSelectedId(nextSelected);
    const nextDraft = toDraft(items.find((item) => item.id === nextSelected));
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }, [dirty, items, selectedId]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items
      .filter((item) => {
        if (!keyword) return true;
        return item.username.toLowerCase().includes(keyword) || String(item.twitterId || "").includes(keyword);
      })
      .sort((a, b) => {
        const aMissingId = !a.twitterId;
        const bMissingId = !b.twitterId;
        if (aMissingId !== bMissingId) return aMissingId ? 1 : -1;
        return a.username.localeCompare(b.username);
      });
  }, [items, search]);

  const totalTags = items.reduce((sum, item) => sum + (item.tagsZh?.length || 0) + (item.tagsEn?.length || 0), 0);
  const missingIdCount = items.filter((item) => !item.twitterId).length;

  function selectRecord(id: number) {
    if (dirty && !window.confirm("当前有未保存修改，确认切换并丢弃修改吗？")) return;
    const item = items.find((record) => record.id === id);
    const nextDraft = toDraft(item);
    setSelectedId(id);
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }

  function addRecord() {
    if (dirty && !window.confirm("当前有未保存修改，确认新建并丢弃修改吗？")) return;
    const nextDraft = emptyDraft();
    setSelectedId("new");
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }

  function reload() {
    if (dirty && !window.confirm("当前有未保存修改，确认重新加载并丢弃修改吗？")) return;
    setSelectedId(null);
    setDraft(emptyDraft());
    setBaseline(emptyDraft());
    void query.refetch();
  }

  const saveMutation = useMutation({
    mutationFn: () => upsertUserTag({
      id: draft.id,
      username: normalizeUsername(draft.username),
      twitterId: draft.twitterId || null,
      tagsZh: normalizeTags(draft.tagsZh),
      tagsEn: normalizeTags(draft.tagsEn),
    }),
    onSuccess: (result) => {
      messageApi.success("标签已保存到数据库");
      const saved = result.data;
      if (saved) {
        const nextDraft = toDraft(saved);
        setSelectedId(saved.id);
        setDraft(nextDraft);
        setBaseline(nextDraft);
      }
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "保存失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUserTag,
    onSuccess: () => {
      messageApi.success("已删除");
      setSelectedId(null);
      setDraft(emptyDraft());
      setBaseline(emptyDraft());
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
  });

  const syncIdMutation = useMutation({
    mutationFn: () => syncUserTagTwitterIds(true),
    onSuccess: (result) => {
      const data = result.data;
      messageApi.success(`ID同步完成：更新 ${data.updated || 0}，跳过 ${data.skipped}，失败 ${data.failed || 0}`);
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "同步ID失败"),
  });

  const canSave = normalizeUsername(draft.username).length > 0 && dirty;
  const selectedPreview = JSON.stringify({
    username: normalizeUsername(draft.username),
    twitterId: draft.twitterId || null,
    tagsZh: normalizeTags(draft.tagsZh),
    tagsEn: normalizeTags(draft.tagsEn),
  }, null, 2);

  return (
    <PermissionGuard permission="nacos-tags">
      {contextHolder}
      <ConfigWorkbench
        className="nacos-tags-container"
        title="用户标签配置（数据库版）"
        meta={<Tag color={dirty ? "orange" : "green"}>{dirty ? "有未保存修改" : "已保存"}</Tag>}
        toolbar={
          <Space wrap size={6}>
            <Button icon={<ReloadOutlined />} onClick={reload} loading={query.isFetching}>刷新</Button>
            <Button icon={<PlusOutlined />} onClick={addRecord}>新增用户</Button>
            <Button icon={<SyncOutlined />} loading={syncIdMutation.isPending} disabled={!items.length} onClick={() => Modal.confirm({ title: "确认同步ID信息？", content: `将为 ${items.length} 个用户刷新 Twitter ID，当前待同步 ${missingIdCount} 个`, onOk: () => syncIdMutation.mutate() })}>同步ID信息</Button>
            <Popconfirm title={`确认删除 ${selectedItem?.username || "当前用户"}？`} disabled={!selectedItem?.id} onConfirm={() => selectedItem?.id && deleteMutation.mutate(selectedItem.id)}>
              <Button danger icon={<DeleteOutlined />} disabled={!selectedItem?.id} loading={deleteMutation.isPending}>删除</Button>
            </Popconfirm>
            <Button type="primary" icon={<SaveOutlined />} disabled={!canSave} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>保存到数据库</Button>
          </Space>
        }
        sidebarTitle={<span>用户列表</span>}
        sidebarMeta={`${filteredItems.length}/${items.length}`}
        sidebar={
          <>
            <div className="nacos-tags-search">
              <SearchOutlined />
              <Input variant="borderless" size="small" placeholder="搜索 username / twitterId..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="nacos-tags-list config-workbench-list">
              {filteredItems.length ? filteredItems.map((item) => {
                const active = item.id === selectedId;
                const firstZhTag = (item.tagsZh || []).find(Boolean) || "无中文标签";
                return (
                  <button key={item.id} type="button" className={active ? "config-workbench-list-item nacos-tags-item is-active active" : "config-workbench-list-item nacos-tags-item"} onClick={() => selectRecord(item.id)}>
                    <span className="nacos-tags-item-count">{item.twitterId ? "ID" : "--"}</span>
                    <span className="nacos-tags-item-main">
                      <span className="nacos-tags-item-handle">{item.username}</span>
                      <span className="nacos-tags-item-preview">
                        {item.twitterId ? (
                          <span className="nacos-tags-mini-chip">{item.twitterId}</span>
                        ) : (
                          <span className="nacos-tags-mini-chip" style={{ color: "#ff4d4f", borderColor: "rgba(255, 77, 79, 0.45)", background: "rgba(255, 77, 79, 0.08)" }}>未同步ID</span>
                        )}
                        <span className="nacos-tags-mini-chip">{firstZhTag}</span>
                      </span>
                    </span>
                  </button>
                );
              }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据，点击「新增用户」创建" />}
            </div>
          </>
        }
        editorTitle="编辑用户标签"
        editorMeta={draft.username ? `${normalizeTags(draft.tagsZh).length} 中文 / ${normalizeTags(draft.tagsEn).length} 英文` : "选择左侧用户或新增"}
      >
        {query.isError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="加载数据库标签失败" /> : null}
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="旧版 Nacos 配置仍保留在原 dataId 中；当前页面只读写数据库，不再发布到 Nacos。" />

        <div className="nacos-tags-stats">
          <div className="nacos-tags-stat-card"><span>用户总数</span><strong>{items.length}</strong></div>
          <div className="nacos-tags-stat-card"><span>标签总数</span><strong>{totalTags}</strong></div>
          <div className="nacos-tags-stat-card"><span>待同步ID</span><strong>{missingIdCount}</strong></div>
        </div>

        <div className="nacos-tags-editor-body">
          <div className="nacos-tags-field-row">
            <label>Username（推特账号，不带 @）</label>
            <Input value={draft.username} placeholder="例如：defiteddy2020" onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} onBlur={() => setDraft((current) => ({ ...current, username: normalizeUsername(current.username) }))} />
          </div>

          <div className="nacos-tags-field-row">
            <label>Twitter ID（可通过“同步ID信息”批量写入）</label>
            <Input value={draft.twitterId || ""} placeholder="例如：1300679567988801536" onChange={(event) => setDraft((current) => ({ ...current, twitterId: event.target.value.trim() || null }))} />
          </div>

          <div className="nacos-tags-field-row">
            <label>中文标签</label>
            <Select mode="tags" tokenSeparators={[",", "，", "\n"]} value={draft.tagsZh} placeholder="输入中文标签，回车添加" style={{ width: "100%" }} onChange={(value) => setDraft((current) => ({ ...current, tagsZh: normalizeTags(value) }))} />
          </div>

          <div className="nacos-tags-field-row">
            <label>英文标签</label>
            <Select mode="tags" tokenSeparators={[",", "，", "\n"]} value={draft.tagsEn} placeholder="Input English tags, press Enter" style={{ width: "100%" }} onChange={(value) => setDraft((current) => ({ ...current, tagsEn: normalizeTags(value) }))} />
          </div>

          <div className="nacos-tags-chip-preview-section">
            <div className="nacos-tags-preview-header">标签效果预览</div>
            <div className="nacos-tags-chip-preview">
              {[...normalizeTags(draft.tagsZh), ...normalizeTags(draft.tagsEn)].length ? [...normalizeTags(draft.tagsZh), ...normalizeTags(draft.tagsEn)].map((tag, index) => <span className="nacos-tags-preview-chip" key={`${tag}-${index}`}>{tag}</span>) : <span className="nacos-tags-preview-empty-text">暂无可预览标签</span>}
            </div>
          </div>

          <div className="nacos-tags-preview-section">
            <div className="nacos-tags-preview-header">JSON 预览</div>
            <pre className="nacos-tags-preview-pre">{selectedPreview}</pre>
          </div>
        </div>
      </ConfigWorkbench>
    </PermissionGuard>
  );
}
