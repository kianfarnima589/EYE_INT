import React, { useId } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleSectionProps = {
  title: string;
  subtitle?: string;
  badge?: string | number;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testId?: string;
  className?: string;
};

/**
 * Progressive-disclosure container aligned with the Strider Editorial tokens.
 * Keeps advanced controls collapsed by default until the editor opens them.
 */
export function CollapsibleSection({
  title,
  subtitle,
  badge,
  icon,
  open,
  onToggle,
  children,
  testId,
  className = "",
}: CollapsibleSectionProps) {
  const contentId = useId();

  return (
    <div
      className={[
        "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--background-subtle)]",
        "transition-colors duration-[var(--duration-fast)]",
        open ? "bg-[var(--card)]" : "hover:border-[var(--border)]",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-right rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <span className="size-6 rounded-[var(--radius-sm)] bg-[var(--background-muted)] text-[var(--foreground-muted)] grid place-items-center shrink-0">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--foreground)] truncate">
              {title}
            </div>
            {subtitle && !open && (
              <div className="text-[11px] text-[var(--foreground-subtle)] truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {badge !== undefined && badge !== "" && badge !== 0 && (
            <span className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-foreground)] text-[10.5px] font-medium tabular-nums">
              {badge}
            </span>
          )}
          <ChevronDown
            className={`size-4 text-[var(--foreground-subtle)] transition-transform duration-150 ${
              open ? "rotate-180 text-[var(--foreground)]" : ""
            }`}
          />
        </div>
      </button>

      {open && (
        <div
          id={contentId}
          className="px-3 pb-3 pt-2 border-t border-[var(--border-subtle)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
