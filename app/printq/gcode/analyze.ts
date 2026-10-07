// Works out a print's numbers from the G-code itself, not from slicer
// comments: time (by simulating the motion planner), filament used, the real
// size of the part, layers, temperatures and pauses. Pure and streaming: feed
// it lines with push(), then call finish().

export interface MachineLimits {
  /** mm/s, per axis X Y Z E */
  maxFeedrate: [number, number, number, number];
  /** mm/s², per axis X Y Z E */
  maxAccel: [number, number, number, number];
  /** mm/s² for printing, retract-only and travel moves (M204 P R T) */
  printAccel: number;
  retractAccel: number;
  travelAccel: number;
  /** mm/s "jerk": the speed change allowed at a corner, per axis (M205 X Y Z E) */
  jerk: [number, number, number, number];
}

/**
 * Original Prusa i3 MK3S/MK3S+ in normal mode, as in PrusaSlicer's printer
 * profile. Files sliced in PrusaSlicer usually emit M201/M203/M204/M205 in the
 * start G-code, which override these.
 */
export const PRUSA_I3_MK3S_LIMITS: MachineLimits = {
  maxFeedrate: [200, 200, 12, 120],
  maxAccel: [1000, 1000, 200, 5000],
  printAccel: 1250,
  retractAccel: 1250,
  travelAccel: 1250,
  jerk: [8, 8, 0.4, 4.5],
};

/** g/cm³ by filament type, for files that don't state a density. */
export const FILAMENT_DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  PET: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  FLEX: 1.21,
  PC: 1.2,
  PA: 1.14,
  NYLON: 1.14,
  PVA: 1.23,
  HIPS: 1.03,
};

export interface GcodeAnalysis {
  /** Motion time in seconds (excludes waiting for heat-up). */
  estimatedSeconds: number;
  /** The slicer's own estimate from the first M73 R… line, if any. */
  m73Seconds: number | null;
  filamentMm: number;
  filamentCm3: number;
  filamentGrams: number;
  /** Extent of the extruded part (purge line excluded when layer markers exist). */
  size: { x: number; y: number; z: number } | null;
  extents: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  /** Everything printed on the bed, skirt and brim included: what must fit. */
  footprint: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  layers: number;
  firstLayerMm: number | null;
  layerHeightMm: number | null;
  maxHotendC: number | null;
  maxBedC: number | null;
  /** M600: someone has to swap filament mid-print. */
  filamentChanges: number;
  /** M601 / M0 / M1 / M25: the print stops and waits for a person. */
  pauses: number;
  /** Distinct tools used (more than one means a multi-material setup). */
  tools: number;
  moves: number;
}

interface Block {
  distance: number;
  nominal: number;
  accel: number;
  /** highest speed allowed when entering this block (corner limit) */
  maxEntry: number;
  entry: number;
}

type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
const emptyBox = (): Box => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });

// Printed helpers that aren't part of the model: they use bed space but don't count towards its size.
const HELPER_FEATURE = /skirt|brim|wipe tower|prime tower|support interface|^custom$/i;
const HELPER_COMMENT = /^(skirt|brim|wipe tower|wipe and retract|intro line)$/i;

const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
const PLAN_WINDOW = 400;
const EMIT = 200;

export class GcodeAnalyzer {
  private limits: MachineLimits;
  private pos = [0, 0, 0, 0];
  private absoluteXYZ = true;
  private absoluteE = true;
  private scale = 1;
  private feed = 25; // mm/s until the file sets one
  private seconds = 0;
  private blocks: Block[] = [];
  private lastUnit: number[] | null = null;
  private lastNominal = 0;
  private carryEntry = 0;
  private netE = 0;
  private moves = 0;
  private m73: number | null = null;
  private sawLayerMarker = false;
  private allBox = emptyBox();
  private layerBox = emptyBox();
  private modelBox = emptyBox();
  private featureIsHelper = false;
  private lineIsHelper = false;
  private layerZs: number[] = [];
  private maxHotend: number | null = null;
  private maxBed: number | null = null;
  private filamentChanges = 0;
  private pauses = 0;
  private tools = new Set<number>();

  constructor(limits: MachineLimits = PRUSA_I3_MK3S_LIMITS) {
    this.limits = {
      ...limits,
      maxFeedrate: [...limits.maxFeedrate],
      maxAccel: [...limits.maxAccel],
      jerk: [...limits.jerk],
    };
  }

  push(rawLine: string) {
    const semicolon = rawLine.indexOf(";");
    let comment = "";
    if (semicolon >= 0) {
      comment = rawLine.slice(semicolon + 1).trim();
      // PrusaSlicer 2.3+: ;LAYER_CHANGE; 2.2: ;BEFORE_/;AFTER_LAYER_CHANGE; Cura: ;LAYER:n
      if (/^(BEFORE_|AFTER_)?LAYER_CHANGE$/.test(comment) || comment.startsWith("LAYER:")) this.sawLayerMarker = true;
      // Feature type: ;TYPE:Skirt/Brim (PrusaSlicer 2.3+), ;TYPE:SKIRT (Cura)
      if (semicolon === 0 && comment.startsWith("TYPE:")) this.featureIsHelper = HELPER_FEATURE.test(comment.slice(5));
    }
    this.lineIsHelper = semicolon > 0 && HELPER_COMMENT.test(comment); // PrusaSlicer 2.2 verbose: "; skirt"
    const code = (semicolon >= 0 ? rawLine.slice(0, semicolon) : rawLine).trim().toUpperCase();
    if (!code) return;
    const command = /^([GMT])(\d+)(?:\.\d+)?/.exec(code);
    if (!command) return;
    const letter = command[1];
    const number = Number(command[2]);
    const words: Record<string, number> = {};
    for (const match of code.slice(command[0].length).matchAll(WORD)) words[match[1]] = Number(match[2]);

    if (letter === "T") {
      this.tools.add(number);
      return;
    }
    if (letter === "G") {
      switch (number) {
        case 0:
        case 1:
          return this.linear(words);
        case 2:
        case 3:
          return this.arc(words, number === 2);
        case 4:
          this.flush(true);
          this.seconds += words.S !== undefined ? words.S : (words.P ?? 0) / 1000;
          return;
        case 20:
          this.scale = 25.4;
          return;
        case 21:
          this.scale = 1;
          return;
        case 28:
          // Homing: the head ends at the origin of each homed axis.
          this.flush(true);
          for (const [index, axis] of ["X", "Y", "Z"].entries()) {
            if (!("X" in words || "Y" in words || "Z" in words) || axis in words) this.pos[index] = 0;
          }
          this.lastUnit = null;
          return;
        case 90:
          this.absoluteXYZ = true;
          this.absoluteE = true;
          return;
        case 91:
          this.absoluteXYZ = false;
          this.absoluteE = false;
          return;
        case 92:
          ["X", "Y", "Z", "E"].forEach((axis, index) => {
            if (axis in words) this.pos[index] = words[axis] * (index < 3 ? this.scale : 1);
          });
          return;
      }
      return;
    }
    // M codes
    switch (number) {
      case 73:
        if (this.m73 === null && words.R !== undefined) this.m73 = words.R * 60;
        return;
      case 82:
        this.absoluteE = true;
        return;
      case 83:
        this.absoluteE = false;
        return;
      case 104:
      case 109:
        if (words.S !== undefined) this.maxHotend = Math.max(this.maxHotend ?? 0, words.S);
        return;
      case 140:
      case 190:
        if (words.S !== undefined) this.maxBed = Math.max(this.maxBed ?? 0, words.S);
        return;
      case 600:
        this.filamentChanges++;
        return;
      case 0:
      case 1:
      case 25:
      case 601:
        this.pauses++;
        return;
      case 201:
        this.setAxes(this.limits.maxAccel, words);
        return;
      case 203:
        this.setAxes(this.limits.maxFeedrate, words);
        return;
      case 204:
        if (words.S !== undefined) this.limits.printAccel = this.limits.travelAccel = words.S;
        if (words.P !== undefined) this.limits.printAccel = words.P;
        if (words.R !== undefined) this.limits.retractAccel = words.R;
        if (words.T !== undefined) this.limits.travelAccel = words.T;
        return;
      case 205:
        this.setAxes(this.limits.jerk, words);
        return;
    }
  }

  private setAxes(target: number[], words: Record<string, number>) {
    ["X", "Y", "Z", "E"].forEach((axis, index) => {
      if (axis in words && words[axis] > 0) target[index] = words[axis];
    });
  }

  private target(words: Record<string, number>) {
    const next = [...this.pos];
    ["X", "Y", "Z"].forEach((axis, index) => {
      if (axis in words) next[index] = this.absoluteXYZ ? words[axis] * this.scale : this.pos[index] + words[axis] * this.scale;
    });
    if ("E" in words) next[3] = this.absoluteE ? words.E : this.pos[3] + words.E;
    if ("F" in words && words.F > 0) this.feed = (words.F * this.scale) / 60;
    return next;
  }

  private linear(words: Record<string, number>) {
    const next = this.target(words);
    this.move(next, null);
  }

  private arc(words: Record<string, number>, clockwise: boolean) {
    const next = this.target(words);
    const [x0, y0] = this.pos;
    const cx = x0 + (words.I ?? 0) * this.scale;
    const cy = y0 + (words.J ?? 0) * this.scale;
    const radius = Math.hypot(x0 - cx, y0 - cy);
    let sweep = Math.atan2(next[1] - cy, next[0] - cx) - Math.atan2(y0 - cy, x0 - cx);
    if (clockwise && sweep >= 0) sweep -= 2 * Math.PI;
    if (!clockwise && sweep <= 0) sweep += 2 * Math.PI;
    const length = Math.hypot(radius * Math.abs(sweep), next[2] - this.pos[2]);
    this.move(next, { length, cx, cy, radius, start: Math.atan2(y0 - cy, x0 - cx), sweep });
  }

  private move(next: number[], arc: { length: number; cx: number; cy: number; radius: number; start: number; sweep: number } | null) {
    const delta = next.map((value, index) => value - this.pos[index]);
    const xyz = arc ? arc.length : Math.hypot(delta[0], delta[1], delta[2]);
    const dE = delta[3];
    const extruding = dE > 1e-6 && xyz > 1e-6;
    this.netE += dE;

    if (extruding) {
      const helper = this.featureIsHelper || this.lineIsHelper;
      const boxes = [this.allBox, ...(this.sawLayerMarker ? [this.layerBox] : []), ...(this.sawLayerMarker && !helper ? [this.modelBox] : [])];
      const points: [number, number, number][] = [[next[0], next[1], next[2]]];
      if (arc) {
        for (let step = 1; step < 8; step++) {
          const angle = arc.start + (arc.sweep * step) / 8;
          points.push([arc.cx + arc.radius * Math.cos(angle), arc.cy + arc.radius * Math.sin(angle), next[2]]);
        }
      }
      for (const box of boxes) {
        for (const [x, y, z] of [[this.pos[0], this.pos[1], this.pos[2]] as [number, number, number], ...points]) {
          box.minX = Math.min(box.minX, x);
          box.maxX = Math.max(box.maxX, x);
          box.minY = Math.min(box.minY, y);
          box.maxY = Math.max(box.maxY, y);
          box.minZ = Math.min(box.minZ, z);
          box.maxZ = Math.max(box.maxZ, z);
        }
      }
      const z = Math.round(next[2] * 1000) / 1000;
      if (this.layerZs.length === 0 || z > this.layerZs[this.layerZs.length - 1] + 1e-4) this.layerZs.push(z);
    }
    this.pos = next;

    const distance = xyz > 1e-6 ? xyz : Math.abs(dE);
    if (distance < 1e-6) return;
    this.moves++;
    // Unit vector over X Y Z E, relative to the move's length.
    // (For arcs this uses the chord's direction: close enough for corner speeds.)
    const unit = delta.map((value) => value / distance);
    const { maxFeedrate, maxAccel, jerk } = this.limits;
    let nominal = this.feed;
    let accel = xyz > 1e-6 ? (extruding ? this.limits.printAccel : this.limits.travelAccel) : this.limits.retractAccel;
    for (let axis = 0; axis < 4; axis++) {
      const share = Math.abs(unit[axis]);
      if (share > 1e-9) {
        nominal = Math.min(nominal, maxFeedrate[axis] / share);
        accel = Math.min(accel, maxAccel[axis] / share);
      }
    }
    // Corner speed: the largest speed whose change on every axis stays within jerk.
    let junction = nominal;
    for (let axis = 0; axis < 4; axis++) {
      const change = Math.abs(unit[axis] - (this.lastUnit ? this.lastUnit[axis] : 0));
      if (change > 1e-9) junction = Math.min(junction, jerk[axis] / change);
    }
    junction = Math.min(junction, this.lastUnit ? this.lastNominal : junction);
    this.blocks.push({ distance, nominal, accel, maxEntry: junction, entry: 0 });
    this.lastUnit = unit;
    this.lastNominal = nominal;
    if (this.blocks.length >= PLAN_WINDOW) this.flush(false);
  }

  /** Plans the buffered moves and adds their time. Keeps the tail buffered unless `all`. */
  private flush(all: boolean) {
    const blocks = this.blocks;
    if (blocks.length === 0) return;
    // Backward pass: each block must be able to slow down to the next one's entry (end at rest).
    let nextEntry = 0;
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      block.entry = Math.min(block.maxEntry, Math.sqrt(nextEntry * nextEntry + 2 * block.accel * block.distance));
      nextEntry = block.entry;
    }
    // Forward pass: and must be able to speed up from the previous one.
    blocks[0].entry = Math.min(blocks[0].entry, this.carryEntry);
    for (let index = 1; index < blocks.length; index++) {
      const previous = blocks[index - 1];
      blocks[index].entry = Math.min(blocks[index].entry, Math.sqrt(previous.entry * previous.entry + 2 * previous.accel * previous.distance));
    }
    const count = all ? blocks.length : EMIT;
    for (let index = 0; index < count; index++) {
      const block = blocks[index];
      const exit = index + 1 < blocks.length ? blocks[index + 1].entry : 0;
      this.seconds += trapezoidSeconds(block.distance, block.entry, exit, block.nominal, block.accel);
    }
    this.carryEntry = all ? 0 : blocks[count].entry;
    this.blocks = all ? [] : blocks.slice(count);
    if (all) this.lastUnit = null;
  }

  finish(options: { filamentDiameterMm?: number | null; densityGcm3?: number | null; filamentType?: string | null } = {}): GcodeAnalysis {
    this.flush(true);
    const diameter = options.filamentDiameterMm ?? 1.75;
    const type = options.filamentType?.toUpperCase() ?? "";
    const density = options.densityGcm3 ?? FILAMENT_DENSITY[type] ?? FILAMENT_DENSITY[Object.keys(FILAMENT_DENSITY).find((key) => type.startsWith(key)) ?? "PLA"];
    const filamentMm = Math.max(0, this.netE);
    const filamentCm3 = (Math.PI * (diameter / 2) ** 2 * filamentMm) / 1000;
    // Footprint: everything printed on the bed (skirt and brim included, intro line excluded).
    const footprintBox = this.sawLayerMarker && Number.isFinite(this.layerBox.minX) ? this.layerBox : this.allBox;
    const footprint = Number.isFinite(footprintBox.minX) ? { ...footprintBox } : null;
    // The model itself: without skirt, brim and wipe tower.
    const box = Number.isFinite(this.modelBox.minX) ? this.modelBox : footprintBox;
    const extents = Number.isFinite(box.minX) ? { ...box } : null;

    const heights: number[] = [];
    for (let index = 1; index < this.layerZs.length; index++) heights.push(Math.round((this.layerZs[index] - this.layerZs[index - 1]) * 100) / 100);
    const counts = new Map<number, number>();
    for (const height of heights) if (height > 0) counts.set(height, (counts.get(height) ?? 0) + 1);
    const commonHeight = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      estimatedSeconds: Math.round(this.seconds),
      m73Seconds: this.m73,
      filamentMm: round(filamentMm, 1),
      filamentCm3: round(filamentCm3, 2),
      filamentGrams: round(filamentCm3 * density, 1),
      extents,
      footprint,
      size: extents
        ? { x: round(extents.maxX - extents.minX, 1), y: round(extents.maxY - extents.minY, 1), z: round(extents.maxZ, 2) }
        : null,
      layers: this.layerZs.length,
      firstLayerMm: this.layerZs[0] ?? null,
      layerHeightMm: commonHeight,
      maxHotendC: this.maxHotend,
      maxBedC: this.maxBed,
      filamentChanges: this.filamentChanges,
      pauses: this.pauses,
      tools: Math.max(1, this.tools.size),
      moves: this.moves,
    };
  }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Time to cover `distance` starting at `entry`, ending at `exit`, cruising at most at `nominal`. */
export function trapezoidSeconds(distance: number, entry: number, exit: number, nominal: number, accel: number) {
  const accelDistance = Math.max(0, (nominal * nominal - entry * entry) / (2 * accel));
  const decelDistance = Math.max(0, (nominal * nominal - exit * exit) / (2 * accel));
  if (accelDistance + decelDistance <= distance) {
    return (nominal - entry) / accel + (nominal - exit) / accel + (distance - accelDistance - decelDistance) / nominal;
  }
  // Never reaches cruising speed: accelerate to a peak, then brake.
  const peak = Math.sqrt(Math.max(entry * entry, exit * exit, (2 * accel * distance + entry * entry + exit * exit) / 2));
  return Math.max(0, (peak - entry) / accel) + Math.max(0, (peak - exit) / accel);
}

/** Convenience for tests and small inputs. */
export function analyzeGcodeText(text: string, limits?: MachineLimits, options?: Parameters<GcodeAnalyzer["finish"]>[0]) {
  const analyzer = new GcodeAnalyzer(limits);
  for (const line of text.split("\n")) analyzer.push(line);
  return analyzer.finish(options);
}
