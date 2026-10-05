import Link from "next/link";
import type { ReactNode } from "react";
import type { UserRole } from "../constants";
import { DataPreview, Placeholder } from "./Placeholder";

// Admin components. DESIGN_BRIEF §5.4.

const ADMIN_LINKS: { href: string; label: string; minRole: Exclude<UserRole, "member"> }[] = [
  { href: "/printing/admin", label: "Dashboard", minRole: "staff" },
  { href: "/printing/admin/approvals", label: "Approvals", minRole: "staff" },
  { href: "/printing/admin/session", label: "Session", minRole: "staff" },
  { href: "/printing/admin/schedule", label: "Schedule", minRole: "staff" },
  { href: "/printing/admin/discord", label: "Discord", minRole: "staff" },
  { href: "/printing/admin/settings", label: "Settings", minRole: "admin" },
  { href: "/printing/admin/users", label: "Users", minRole: "admin" },
  { href: "/printing/admin/audit", label: "Audit", minRole: "admin" },
];

export function AdminNav({ role, pendingCount }: { role: UserRole; pendingCount: number }) {
  return (
    <nav className="pq-panel flex flex-wrap" aria-label="Staff">
      {ADMIN_LINKS.filter((link) => role === "admin" || link.minRole === "staff").map((link, index) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-4 py-2.5 text-sm ${index ? "pq-rule-l" : ""}`}
          style={{ color: "var(--color-text)", textDecoration: "none" }}
        >
          {link.label}
          {link.label === "Approvals" && pendingCount > 0 ? (
            <span className="tag tag-pending" style={{ marginLeft: 6, padding: "0 6px" }}>
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Placeholder name="StatTile" spec="§4.7">
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Placeholder>
  );
}

export function SettingsPanel({ name, spec, value, note }: { name: string; spec: string; value: unknown; note?: string }) {
  return (
    <Placeholder name={name} spec={spec}>
      {note && <p className="mb-2 text-sm text-slate-400">{note}</p>}
      <DataPreview value={value} />
    </Placeholder>
  );
}
