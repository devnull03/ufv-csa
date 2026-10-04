import type { ReactNode } from "react";
import type { BookingStatus } from "../constants";
import { formatDuration, formatTime, STATUS_LABELS } from "../format";
import { Placeholder } from "./Placeholder";

// Shared and brand components. DESIGN_BRIEF §5.1. Bodies are wireframes; keep names and props.

export function StatusBadge({ status }: { status: BookingStatus; size?: "sm" | "md" }) {
  return (
    <span data-placeholder="StatusBadge" className="rounded border border-dashed border-slate-500 px-2 py-0.5 text-xs">
      {STATUS_LABELS[status]}
    </span>
  );
}

export function LabStatusBadge({ open, since }: { open: boolean | null; since?: Date | string | null }) {
  return (
    <span data-placeholder="LabStatusBadge" className="rounded border border-dashed border-slate-500 px-2 py-0.5 text-xs">
      {open === null ? "Lab status unknown" : open ? "Lab open" : "Lab closed"}
      {since ? ` · since ${formatTime(since)}` : ""}
    </span>
  );
}

export function PrinterStatusPill({ state }: { state: "idle" | "printing" | "maintenance" | "offline"; until?: Date }) {
  return <span data-placeholder="PrinterStatusPill" className="text-xs">[{state}]</span>;
}

export function Callout({ tone, title, children }: { tone: "info" | "warning" | "danger" | "success"; title?: string; children: ReactNode }) {
  return (
    <Placeholder name={`Callout (${tone})`} spec="§5.1">
      {title && <p className="font-semibold">{title}</p>}
      <div className="text-sm">{children}</div>
    </Placeholder>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Placeholder name="EmptyState" spec="§5.1" className="text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="text-sm text-slate-400">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Placeholder>
  );
}

export function PrintQHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {description && <p className="text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function QuotaMeter({ used, max }: { used: number; max: number }) {
  return (
    <span data-placeholder="QuotaMeter" className="text-sm text-slate-400">
      {used} of {max} active bookings used
    </span>
  );
}

export function HoldCountdown({ expiresAt }: { expiresAt: Date | string }) {
  return (
    <span data-placeholder="HoldCountdown" className="text-sm">
      Hold expires {new Date(expiresAt).toLocaleString("en-CA")}
    </span>
  );
}

export function DurationText({ minutes }: { minutes: number }) {
  return <span>{formatDuration(minutes)}</span>;
}

export function DiscordUserChip({ name, username, image }: { name: string; username?: string | null; image?: string | null }) {
  return (
    <span data-placeholder="DiscordUserChip" className="inline-flex items-center gap-2 text-sm">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-6 rounded-full" />
      ) : null}
      {name}
      {username && <span className="text-slate-400">@{username}</span>}
    </span>
  );
}

export function StepsStrip({ steps }: { steps: string[] }) {
  return (
    <Placeholder name="StepsStrip" spec="§4.1">
      <ol className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step} className="rounded border border-slate-700 p-2 text-sm">
            {index + 1}. {step}
          </li>
        ))}
      </ol>
    </Placeholder>
  );
}
