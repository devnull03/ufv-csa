import { formatSlot, WEEKDAY_NAMES } from "../format";
import type { WeeklyHours } from "../scheduling/slots";
import { Placeholder } from "./Placeholder";

// Scheduling components. DESIGN_BRIEF §5.2.

export interface ScheduleBlockData {
  kind: "booking" | "pending" | "closure" | "maintenance" | "selection";
  start: Date | string;
  end: Date | string;
  label: string;
  bookingId?: string;
}

export function WeekSchedule({
  mode,
  weekStart,
  blocks,
  weeklyHours,
}: {
  mode: "public" | "admin";
  weekStart: Date;
  blocks: ScheduleBlockData[];
  weeklyHours: WeeklyHours[];
}) {
  return (
    <Placeholder name={`WeekSchedule (${mode})`} spec="§4.1 / §5.2">
      <p className="mb-2 text-sm text-slate-400">
        From {weekStart.toDateString()}: 7-day time grid with lab-hour bands ({weeklyHours.length} weekly windows),
        bookings, closures and a now-line. On mobile, swap to DayAgenda.
      </p>
      {blocks.length === 0 ? (
        <p className="text-sm">No bookings or closures this week.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {blocks.map((block) => (
            <li key={`${block.kind}-${new Date(block.start).toISOString()}`}>
              <ScheduleBlock {...block} />
            </li>
          ))}
        </ul>
      )}
    </Placeholder>
  );
}

export function ScheduleBlock({ kind, start, end, label }: ScheduleBlockData) {
  return (
    <span data-placeholder="ScheduleBlock">
      [{kind}] {label} · {formatSlot(start, end)}
    </span>
  );
}

export function DayAgenda({ date, blocks }: { date: Date; blocks: ScheduleBlockData[] }) {
  return (
    <Placeholder name="DayAgenda" spec="§5.2">
      {date.toDateString()}: {blocks.length} blocks
    </Placeholder>
  );
}

export function LabHoursSummary({ weeklyHours }: { weeklyHours: WeeklyHours[] }) {
  return (
    <Placeholder name="LabHoursSummary" spec="§4.1">
      {weeklyHours.length === 0 ? (
        <p className="text-sm">Lab hours have not been set yet.</p>
      ) : (
        <table className="text-sm">
          <tbody>
            {[...weeklyHours]
              .sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt))
              .map((hours) => (
                <tr key={`${hours.weekday}-${hours.opensAt}`}>
                  <td className="pr-4">{WEEKDAY_NAMES[hours.weekday]}</td>
                  <td>
                    {hours.opensAt.slice(0, 5)}–{hours.closesAt.slice(0, 5)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </Placeholder>
  );
}
