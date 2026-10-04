import type { PropsWithChildren } from "react";
import { AdminNav } from "~/app/printq/components/admin";
import { countPending } from "~/app/printq/queries";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// Staff gate for everything under /printing/admin. Admin-only pages check again.
export default async function AdminLayout({ children }: PropsWithChildren) {
  const viewer = await requireRolePage("staff", "/printing/admin");
  const pendingCount = await countPending();
  return (
    <div className="space-y-6">
      <AdminNav role={viewer.role} pendingCount={pendingCount} />
      {children}
    </div>
  );
}
