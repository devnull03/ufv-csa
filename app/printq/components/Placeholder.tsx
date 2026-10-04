import type { PropsWithChildren } from "react";
import { cn } from "~/app/(site)/utils";

/**
 * Wireframe frame for a component the design agent will replace.
 * `spec` points at the section of docs/printq/DESIGN_BRIEF.md that describes it.
 */
export function Placeholder({
  name,
  spec,
  className,
  children,
}: PropsWithChildren<{ name: string; spec?: string; className?: string }>) {
  return (
    <section
      data-placeholder={name}
      className={cn("rounded-lg border-2 border-dashed border-slate-600 bg-slate-900/40 p-4", className)}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-200">PLACEHOLDER</span>
        <span>{name}</span>
        {spec && <span className="text-slate-500">· DESIGN_BRIEF {spec}</span>}
      </div>
      {children}
    </section>
  );
}

export function DataPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-slate-950/60 p-2 text-xs text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
