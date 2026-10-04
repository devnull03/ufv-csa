import type { Metadata } from "next";
import { AppEmail, AppFullName } from "../config";

export const metadata: Metadata = { title: "Privacy" };

// DRAFT. Needs executive review before launch (DESIGN_BRIEF §4.14).
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-11/12 space-y-4 py-8 md:w-10/12 lg:w-9/12">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p className="text-sm text-yellow-200/80">Draft: pending review by the {AppFullName} executives.</p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">3D printer bookings (PrintQ)</h2>
        <p>
          When you sign in with Discord we receive your Discord user ID, username, display name and avatar. We do not
          request your email address. We check with our Discord server whether you are a member and have the verified
          role.
        </p>
        <p>
          We store your bookings, the G-code files you upload and a preview image taken from them. Uploaded files are
          deleted a few days after your print is finished; booking history is kept for one academic year.
        </p>
        <p>
          This data is stored on the {AppFullName}&apos;s server at the University of the Fraser Valley in Canada.
          Only {AppFullName} executives and printer staff can see who booked what. Public schedules never show names.
        </p>
        <p>
          To ask for a copy or deletion of your data, email <a className="underline" href={`mailto:${AppEmail}`}>{AppEmail}</a>.
        </p>
      </section>
    </div>
  );
}
