import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";
import { Toaster } from "~/app/(site)/components/UI/sonner";
import { isPrintQEnabled } from "~/app/printq/env";

export const metadata = {
  title: { default: "3D Printing", template: "%s | 3D Printing" },
  description: "Book the CSA 3D printer: free for CSA members.",
};

export default function PrintingLayout({ children }: PropsWithChildren) {
  if (!isPrintQEnabled()) notFound();
  return (
    <div className="mx-auto w-11/12 space-y-6 py-8 md:w-10/12 lg:w-9/12">
      <p className="rounded border border-dashed border-yellow-600/60 px-3 py-1 text-xs text-yellow-200/80">
        PrintQ preview: placeholder UI. Layouts and styling come from docs/printq/DESIGN_BRIEF.md.
      </p>
      {children}
      <Toaster />
    </div>
  );
}
