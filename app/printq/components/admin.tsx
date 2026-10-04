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
  { href: "/printing/admin/settings", label: "Settings", minRole: "admin" },
  { href: "/printing/admin/users", label: "Users", minRole: "admin" },
  { href: "/printing/admin/audit", label: "Audit", minRole: "admin" },
];

export function AdminNav({ role, pendingCount }: { role: UserRole; pendingCount: number }) {
  return (
    <Placeholder name="AdminNav" spec="§4.7">
      <nav className="flex flex-wrap gap-3 text-sm">
        {ADMIN_LINKS.filter((link) => role === "admin" || link.minRole === "staff").map((link) => (
          <Link key={link.href} href={link.href} className="underline underline-offset-4">
            {link.label}
            {link.label === "Approvals" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Link>
        ))}
      </nav>
    </Placeholder>
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
