import type { ReactNode } from "react";

type ConfigWorkbenchProps = {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  toolbar?: ReactNode;
  sidebarTitle: ReactNode;
  sidebarMeta?: ReactNode;
  sidebarExtra?: ReactNode;
  sidebar: ReactNode;
  editorTitle: ReactNode;
  editorMeta?: ReactNode;
  editorExtra?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsed?: boolean;
  bodyClassName?: string;
  sidebarClassName?: string;
  editorClassName?: string;
  editorId?: string;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ConfigWorkbench({
  id,
  title,
  description,
  meta,
  toolbar,
  sidebarTitle,
  sidebarMeta,
  sidebarExtra,
  sidebar,
  editorTitle,
  editorMeta,
  editorExtra,
  children,
  className,
  collapsed = false,
  bodyClassName,
  sidebarClassName,
  editorClassName,
  editorId,
}: ConfigWorkbenchProps) {
  return (
    <div
      id={id}
      className={cx(
        "config-workbench",
        collapsed && "config-workbench-collapsed",
        className,
      )}
    >
      <div className="config-workbench-header">
        <div className="config-workbench-heading">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {meta ? <div className="config-workbench-meta">{meta}</div> : null}
      </div>

      {toolbar ? (
        <div className="config-workbench-toolbar">{toolbar}</div>
      ) : null}

      <div className={cx("config-workbench-body", bodyClassName)}>
        <aside className={cx("config-workbench-sidebar", sidebarClassName)}>
          <div className="config-workbench-panel-header">
            <div className="config-workbench-panel-title">{sidebarTitle}</div>
            <div className="config-workbench-panel-side">
              {sidebarMeta != null ? (
                <span className="config-workbench-count">{sidebarMeta}</span>
              ) : null}
              {sidebarExtra}
            </div>
          </div>
          <div className="config-workbench-sidebar-content">{sidebar}</div>
        </aside>

        <section
          id={editorId}
          className={cx("config-workbench-editor", editorClassName)}
        >
          <div className="config-workbench-panel-header">
            <div className="config-workbench-panel-title">{editorTitle}</div>
            <div className="config-workbench-panel-side">
              {editorMeta != null ? (
                <span className="config-workbench-editor-meta">
                  {editorMeta}
                </span>
              ) : null}
              {editorExtra}
            </div>
          </div>
          <div className="config-workbench-editor-content">{children}</div>
        </section>
      </div>
    </div>
  );
}
