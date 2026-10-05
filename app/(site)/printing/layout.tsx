import { Barlow, Barlow_Condensed } from "next/font/google";
import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";
import { Toaster } from "~/app/(site)/components/UI/sonner";
import { isPrintQEnabled } from "~/app/printq/env";
import "~/app/printq/printq.css";
import { AppBar } from "~/app/printq/ui/AppBar";
import { getViewer } from "~/app/printq/viewer";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const heading = Barlow_Condensed({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-heading" });

export const metadata = {
  title: { default: "3D Printing", template: "%s | 3D Printing" },
  description: "Book the CSA 3D printer: free for CSA members.",
};

export default async function PrintingLayout({ children }: PropsWithChildren) {
  if (!isPrintQEnabled()) notFound();
  const viewer = await getViewer();
  return (
    <div className={`pq ${body.variable} ${heading.variable} min-h-full`}>
      <AppBar viewer={viewer} />
      <main className="pq-main">{children}</main>
      <Toaster />
    </div>
  );
}
