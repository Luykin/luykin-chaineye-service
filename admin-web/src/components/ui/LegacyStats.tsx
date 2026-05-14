import type { CSSProperties, ReactNode } from "react";

export type LegacyStatsIconName =
  | "monitor"
  | "layers"
  | "bars"
  | "calendar"
  | "trend"
  | "users"
  | "message"
  | "user"
  | "user-plus"
  | "week"
  | "empty";

export type LegacyTone = "blue" | "purple" | "teal" | "indigo" | "green" | "orange" | "pink";

interface LegacyStatsIconProps {
  name: LegacyStatsIconName;
}

export function LegacyStatsIcon({ name }: LegacyStatsIconProps) {
  if (name === "monitor") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }

  if (name === "layers") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    );
  }

  if (name === "bars") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  if (name === "trend") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="m18.7 8-5.1 5.2-2.8-2.7L7 14.3" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (name === "message") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
      </svg>
    );
  }

  if (name === "user") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }

  if (name === "user-plus") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    );
  }

  if (name === "week") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M2 12h20" />
        <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" />
        <path d="m12 12 4-4" />
        <path d="m12 12-4-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

interface LegacyStatsSectionHeaderProps {
  title: ReactNode;
  icon?: LegacyStatsIconName;
  tone?: LegacyTone;
  badge?: ReactNode;
  live?: boolean;
  className?: string;
}

export function LegacyStatsSectionHeader({
  title,
  icon,
  tone = "blue",
  badge,
  live,
  className,
}: LegacyStatsSectionHeaderProps) {
  return (
    <div className={["legacy-stats-section-header", className || ""].filter(Boolean).join(" ")}>
      <div className="legacy-stats-section-title-wrapper">
        {icon ? (
          <div className={`legacy-stats-section-icon legacy-stats-section-icon--${tone}`}>
            <LegacyStatsIcon name={icon} />
          </div>
        ) : null}
        <h2 className="legacy-stats-section-title">{title}</h2>
      </div>
      {badge ? (
        <span className={`legacy-stats-section-badge ${live ? "legacy-stats-section-badge--live" : ""}`}>
          {live ? <span className="legacy-stats-live-pulse" /> : null}
          {badge}
        </span>
      ) : null}
    </div>
  );
}

interface LegacyStatsGridProps {
  children: ReactNode;
  variant?: "default" | "daily" | "core" | "total";
  className?: string;
}

export function LegacyStatsGrid({
  children,
  variant = "default",
  className,
}: LegacyStatsGridProps) {
  return (
    <div
      className={[
        "legacy-stats-grid",
        `legacy-stats-grid--${variant}`,
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

interface LegacyStatCardProps {
  title: ReactNode;
  value: ReactNode;
  icon?: LegacyStatsIconName;
  tone?: LegacyTone;
  meta?: ReactNode;
  badge?: ReactNode;
  trend?: ReactNode;
  suffix?: ReactNode;
  highlighted?: boolean;
  minimal?: boolean;
  centered?: boolean;
  accent?: string;
  className?: string;
}

export function LegacyStatCard({
  title,
  value,
  icon,
  tone = "blue",
  meta,
  badge,
  trend,
  suffix,
  highlighted,
  minimal,
  centered,
  accent,
  className,
}: LegacyStatCardProps) {
  const style = accent ? ({ "--legacy-card-accent": accent } as CSSProperties) : undefined;

  return (
    <div
      className={[
        "legacy-stat-card",
        icon ? "legacy-stat-card--with-icon" : "",
        minimal ? "legacy-stat-card--minimal" : "",
        centered ? "legacy-stat-card--centered" : "",
        highlighted ? "legacy-stat-card--highlighted" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {icon ? (
        <>
          <div className={`legacy-stat-card__icon legacy-stat-card__icon--${tone}`}>
            <LegacyStatsIcon name={icon} />
          </div>
          <div className="legacy-stat-card__content">
            <div className="legacy-stat-card__title">{title}</div>
            <div className="legacy-stat-card__value">
              {value}
              {suffix ? <span className="legacy-stat-card__suffix">{suffix}</span> : null}
            </div>
            {meta ? <div className="legacy-stat-card__meta">{meta}</div> : null}
          </div>
        </>
      ) : (
        <>
          <div className="legacy-stat-card__header">
            <span className="legacy-stat-card__title">{title}</span>
            {badge ? <span className="legacy-stat-card__badge">{badge}</span> : null}
          </div>
          <div className="legacy-stat-card__value">
            {value}
            {suffix ? <span className="legacy-stat-card__suffix">{suffix}</span> : null}
          </div>
          {meta ? <div className="legacy-stat-card__meta">{meta}</div> : null}
          {trend ? <div className="legacy-stat-card__trend">{trend}</div> : null}
        </>
      )}
    </div>
  );
}
