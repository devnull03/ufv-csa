"use client";

import { RotateCw } from "lucide-react";
import dynamic from "next/dynamic";

// three.js needs the browser; load it after hydration.
const PrinterModel = dynamic(() => import("./PrinterModel"), { ssr: false });

export function PrinterViewer({ label, progress, printing }: { label: string; progress: number; printing: boolean }) {
  return (
    <div className="pq-viewer" role="img" aria-label="Interactive 3D model of the Original Prusa i3 printer">
      <PrinterModel progress={progress} printing={printing} />
      <span className="pq-overline" style={{ position: "absolute", left: 14, top: 12, pointerEvents: "none" }}>
        {label}
      </span>
      <span
        className="pq-muted"
        style={{ position: "absolute", right: 14, bottom: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 12, pointerEvents: "none" }}
      >
        <RotateCw size={13} strokeWidth={1.5} aria-hidden />
        Drag to rotate
      </span>
      {/* CC BY: credit the model's authors (full chain in public/printq/prusa-i3-mk3.CREDITS.txt). */}
      <a
        href="/printq/prusa-i3-mk3.CREDITS.txt"
        className="pq-muted"
        style={{ position: "absolute", left: 14, bottom: 12, fontSize: 11, textDecoration: "none" }}
        title="Original Prusa i3 MK3 model by Swesen (CC BY) and jzkmath (GPL), after Prusa Research (GPL)"
      >
        Model: Swesen, jzkmath · CC BY / GPL
      </a>
    </div>
  );
}
