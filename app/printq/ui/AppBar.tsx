import { SiDiscord } from "@icons-pack/react-simple-icons";
import { Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { hasRole, type Viewer } from "../roles";

/** PrintQ bar under the site nav (spec C03): 3D Printing home, My prints, account chip or Sign in. */
export function AppBar({ viewer }: { viewer: Viewer | null }) {
  return (
    <nav className="pq-appbar" aria-label="3D printing">
      <div className="pq-appbar-inner">
        <Link href="/printing" className="pq-appbar-home">
          <Printer size={18} strokeWidth={1.5} aria-hidden />
          <span className="pq-heading">3D Printing</span>
        </Link>
        {viewer ? (
          <>
            {hasRole(viewer, "staff") ? (
              <Link href="/printing/admin" className="pq-desk-only" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={15} strokeWidth={1.5} aria-hidden />
                Staff
              </Link>
            ) : null}
            <Link href="/printing/me" className="pq-desk-only">
              My prints
            </Link>
            <Link href="/printing/me" className="pq-chip" aria-label={`My prints (signed in as ${viewer.discordUsername ?? viewer.name})`}>
              <span className="pq-avatar">
                {viewer.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={viewer.image} alt="" />
                ) : (
                  viewer.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <span>{viewer.discordUsername ?? viewer.name}</span>
            </Link>
          </>
        ) : (
          <Link href="/printing/login" className="btn btn-secondary" style={{ minHeight: 40 }}>
            <SiDiscord size={16} aria-hidden />
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
