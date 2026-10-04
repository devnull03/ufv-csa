import { Placeholder } from "~/app/printq/components/Placeholder";
import { PrintQHeader } from "~/app/printq/components/shared";

export const metadata = { title: "Rules" };

// DESIGN_BRIEF §4.2. Copy is a draft for the executives to finalise.
const SECTIONS: { title: string; body: string }[] = [
  { title: "Eligibility", body: "Members of the CSA Discord server with the verified role." },
  { title: "What you can print", body: "Personal, course and club projects. No weapons or anything that breaks UFV policy." },
  { title: "Materials", body: "TBD by the executives (e.g. PLA and PETG only)." },
  { title: "Slicing requirements", body: "Slice in PrusaSlicer using the profile for our exact printer model." },
  { title: "Booking and holds", body: "Your slot is held while an admin reviews it. Unreviewed holds expire." },
  { title: "Check-in and no-shows", body: "Arrive at the start of your slot. After the grace period it becomes a no-show." },
  { title: "Pickup", body: "Collect your print from the SCC (D224) during lab hours." },
  { title: "Failed prints", body: "Tell staff; you can rebook." },
  { title: "Privacy", body: "See /privacy for what we store and for how long." },
];

export default function RulesPage() {
  return (
    <>
      <PrintQHeader title="How it works & rules" />
      {SECTIONS.map((section) => (
        <Placeholder key={section.title} name="RulesSection" spec="§4.2">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          <p className="text-sm text-slate-300">{section.body}</p>
        </Placeholder>
      ))}
    </>
  );
}
