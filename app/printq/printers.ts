// Printers PrintQ knows, keyed by the `; printer_model = …` value PrusaSlicer
// writes (an MK3S+ writes "MK3S"). Build volumes are PrusaSlicer's profile values.
// Pure: used by the seed scripts, the settings page and the API.

export interface PrinterSpec {
  model: string;
  name: string;
  bed: { x: number; y: number; z: number };
  /** Can read binary .bgcode (32-bit firmware only). */
  bgcode: boolean;
  /** Has the Raspberry Pi header / PrusaLink support (see docs/printq/PRINTER.md). */
  prusaLink: boolean;
}

export const PRINTER_SPECS: PrinterSpec[] = [
  { model: "MK3S", name: "Original Prusa i3 MK3S+", bed: { x: 250, y: 210, z: 210 }, bgcode: false, prusaLink: true },
  { model: "MK3", name: "Original Prusa i3 MK3", bed: { x: 250, y: 210, z: 210 }, bgcode: false, prusaLink: true },
  { model: "MK2.5S", name: "Original Prusa i3 MK2.5S", bed: { x: 250, y: 210, z: 200 }, bgcode: false, prusaLink: true },
  { model: "MK2.5", name: "Original Prusa i3 MK2.5", bed: { x: 250, y: 210, z: 200 }, bgcode: false, prusaLink: true },
  { model: "MK2S", name: "Original Prusa i3 MK2S", bed: { x: 250, y: 210, z: 200 }, bgcode: false, prusaLink: false },
  { model: "MK3.5", name: "Original Prusa MK3.5", bed: { x: 250, y: 210, z: 220 }, bgcode: true, prusaLink: true },
  { model: "MK4S", name: "Original Prusa MK4S", bed: { x: 250, y: 210, z: 220 }, bgcode: true, prusaLink: true },
];

/** The lab's printer: an Original Prusa i3. Most likely an MK3S/MK3S+; change it in Settings once confirmed. */
export const DEFAULT_PRINTER_MODEL = "MK3S";

export const printerSpec = (model: string) => PRINTER_SPECS.find((spec) => spec.model === model) ?? null;
