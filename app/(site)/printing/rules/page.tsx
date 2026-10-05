import Link from "next/link";

export const metadata = { title: "Printing rules" };

// DESIGN_BRIEF §4.2. Copy is a draft for the executives to finalise.
const SECTIONS: { title: string; body: string }[] = [
  { title: "Who can book", body: "Members of the CSA Discord server with the verified role." },
  { title: "What you can print", body: "Personal, course and club projects. Nothing that breaks UFV policy, and no weapons." },
  { title: "Materials", body: "PLA and PETG, supplied by the CSA while stock lasts. Ask staff before bringing your own filament." },
  { title: "Slicing", body: "Slice in PrusaSlicer with the profile for our exact printer and upload the .gcode or .bgcode file." },
  { title: "Booking and holds", body: "Your slot is held while staff review it. Requests that aren't reviewed in time expire." },
  { title: "Check-in and no-shows", body: "Come to D224 at the start of your slot and start the print with staff. Missing the grace period counts as a no-show." },
  { title: "Pickup", body: "Collect your print from the Student Computing Centre (D224) during lab hours, the same day if you can." },
  { title: "Failed prints", body: "Tell staff and rebook. Failed prints don't count against you." },
];

export default function RulesPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="pq-overline">PrintQ · Rules</span>
        <h2>How it works &amp; rules</h2>
        <p className="pq-soft">Free for CSA members. Read these before you book.</p>
      </div>
      <div className="pq-panel flex flex-col">
        {SECTIONS.map((section, index) => (
          <div
            key={section.title}
            className={`grid gap-x-6 gap-y-1 px-5 py-4 ${index ? "pq-rule-t" : ""}`}
            style={{ gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)" }}
          >
            <span className="pq-heading" style={{ fontSize: 20 }}>
              {section.title}
            </span>
            <span className="pq-soft">{section.body}</span>
          </div>
        ))}
      </div>
      <p className="pq-muted text-[13px]">
        What we store about you and for how long: <Link href="/privacy">privacy</Link>.
      </p>
    </>
  );
}
