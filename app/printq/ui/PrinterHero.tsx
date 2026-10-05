import { BookOpen, CalendarPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { formatDuration, formatTime } from "../format";
import { PrinterViewer } from "./PrinterViewer";

export interface HeroStat {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}

export interface PrinterHeroProps {
  printerName: string;
  printerLabel: string;
  status: "printing" | "ready" | "maintenance";
  lab: { open: boolean | null; text: string };
  job: { start: Date; end: Date; now: Date } | null;
  freeUntil: Date | null;
  stats: HeroStat[];
  bookHref: string;
}



/** Spec C04: interactive printer model on the left, live status on the right. Never names the job's owner. */
export function PrinterHero(props: PrinterHeroProps) {
  const { job } = props;
  const progress = job ? Math.max(0, Math.min(1, (job.now.getTime() - job.start.getTime()) / (job.end.getTime() - job.start.getTime()))) : 0;
  return (
    <section className="pq-hero" aria-label="Printer status">
      <PrinterViewer label={props.printerLabel} progress={progress} printing={props.status === "printing"} />
      <div className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <span className="pq-overline">PrintQ · Student Computing Centre</span>
          <h1>{props.printerName}</h1>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm">
            {props.status === "printing" ? (
              <span className="tag tag-printing">Printing</span>
            ) : props.status === "maintenance" ? (
              <span className="tag tag-closed">Maintenance</span>
            ) : (
              <span className="tag tag-approved">Ready</span>
            )}
            <span className="pq-soft flex items-center gap-2">
              <span className={`pq-pulse${props.lab.open ? "" : " is-off"}`} aria-hidden />
              {props.lab.text}
            </span>
          </div>
        </div>

        <div className="pq-panel flex flex-col gap-2.5 px-4 py-3.5">
          {job ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="pq-label mr-auto">Current job · booked print</span>
                <span className="pq-value" style={{ fontSize: 30, lineHeight: 1 }}>
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="pq-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="pq-soft pq-num flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <span className="mr-auto">Started {formatTime(job.start)}</span>
                <span>
                  Ends {formatTime(job.end)} ·{" "}
                  <strong className="font-medium" style={{ color: "var(--color-text)" }}>
                    {formatDuration(Math.max(0, (job.end.getTime() - job.now.getTime()) / 60_000))} left
                  </strong>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <span className="pq-label mr-auto">Printer idle</span>
                <span className="pq-value" style={{ fontSize: 30, lineHeight: 1 }}>
                  Ready
                </span>
              </div>
              <span className="pq-soft pq-num text-[13px]">
                {props.freeUntil ? `Free until ${formatTime(props.freeUntil)}` : "No more bookings today"}
              </span>
            </>
          )}
        </div>

        <div className="pq-stats">
          {props.stats.map(({ icon: Icon, label, value, sub }) => (
            <div key={label}>
              <span className="pq-label flex items-center gap-1.5">
                <Icon size={12} strokeWidth={1.5} aria-hidden />
                {label}
              </span>
              <span className="pq-value">{value}</span>
              <span className="pq-muted text-xs">{sub}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap gap-3">
          <Link href={props.bookHref} className="btn btn-primary btn-lg pq-cta">
            <CalendarPlus size={18} strokeWidth={1.5} aria-hidden />
            Book a print
          </Link>
          <Link href="/printing/rules" className="btn btn-secondary btn-lg pq-cta">
            <BookOpen size={16} strokeWidth={1.5} aria-hidden />
            Printing rules
          </Link>
        </div>
      </div>
    </section>
  );
}
