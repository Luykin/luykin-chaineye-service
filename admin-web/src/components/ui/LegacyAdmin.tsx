import { Button } from "antd";
import type { ButtonProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

type LegacyActionVariant =
  | "primary"
  | "success"
  | "danger"
  | "neutral"
  | "sync"
  | "remove"
  | "view";

interface LegacyActionButtonProps extends ButtonProps {
  variant?: LegacyActionVariant;
  compact?: boolean;
}

export function LegacyActionButton({
  variant = "neutral",
  compact,
  className,
  ...props
}: LegacyActionButtonProps) {
  return (
    <Button
      {...props}
      className={[
        "legacy-action-btn",
        `legacy-action-btn--${variant}`,
        compact ? "legacy-action-btn--compact" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

interface LegacyMetricCardProps {
  label: ReactNode;
  value: ReactNode;
  indicatorColor?: string;
}

export function LegacyMetricCard({
  label,
  value,
  indicatorColor = "#94a3b8",
}: LegacyMetricCardProps) {
  return (
    <div className="legacy-metric-card">
      <div className="legacy-metric-card__meta">
        <div className="legacy-metric-card__label">{label}</div>
        <div className="legacy-metric-card__value">{value}</div>
      </div>
      <div
        className="legacy-metric-card__indicator"
        style={{ "--indicator-color": indicatorColor } as CSSProperties}
      />
    </div>
  );
}
