import { describe, expect, it } from "vitest";
import { analyzeGcodeText, trapezoidSeconds, type MachineLimits } from "../analyze";

// Round numbers so the expected times are easy to check by hand.
const SIMPLE: MachineLimits = {
  maxFeedrate: [500, 500, 12, 120],
  maxAccel: [1000, 1000, 200, 5000],
  printAccel: 1000,
  retractAccel: 1000,
  travelAccel: 1000,
  jerk: [8, 8, 0.4, 4.5],
};

describe("motion time", () => {
  it("accelerates, cruises and brakes on a straight move", () => {
    // 100 mm at 100 mm/s with 1000 mm/s²: 0.1 s up, 0.9 s cruising, 0.1 s down.
    expect(trapezoidSeconds(100, 0, 0, 100, 1000)).toBeCloseTo(1.1, 6);
    expect(analyzeGcodeText("G1 X100 F6000", SIMPLE).estimatedSeconds).toBe(1);
  });

  it("doesn't slow down between moves in a straight line", () => {
    const one = analyzeGcodeText("G1 X200 F6000", SIMPLE);
    const two = analyzeGcodeText("G1 X100 F6000\nG1 X200", SIMPLE);
    expect(two.estimatedSeconds).toBe(one.estimatedSeconds);
  });

  it("slows to the jerk limit at a sharp corner", () => {
    // Each leg: accelerate 0→100, cruise, brake 100→8 (or the reverse).
    const leg = 0.1 + (100 - 8) / 1000 + (100 - 5 - (100 ** 2 - 8 ** 2) / 2000) / 100;
    const text = "G1 X100 F6000\nG1 Y100";
    const analyzer = analyzeGcodeText(text, SIMPLE);
    expect(Math.abs(analyzer.estimatedSeconds - 2 * leg)).toBeLessThanOrEqual(0.5);
  });

  it("follows the file's own machine limits and dwell time", () => {
    const slow = analyzeGcodeText("M201 X100 Y100\nM204 P100\nG1 X100 F6000", SIMPLE);
    expect(slow.estimatedSeconds).toBe(2); // 100 mm/s² can't reach 100 mm/s within 100 mm
    expect(analyzeGcodeText("G4 S30\nG4 P1500", SIMPLE).estimatedSeconds).toBe(32);
  });

  it("reads the slicer's own M73 estimate", () => {
    expect(analyzeGcodeText("M73 P0 R83\nM73 Q0 S90\nM73 P1 R82", SIMPLE).m73Seconds).toBe(83 * 60);
  });
});

describe("filament and size", () => {
  const part = [
    "M104 S215",
    "M140 S60",
    "M190 S60",
    "M109 S215",
    "G28 W",
    "G92 E0",
    "M83",
    // PrusaSlicer's purge line, before the first layer marker
    "G1 Y-3 X60 Z0.2 E9 F1000",
    "G1 X100 E12.5",
    ";LAYER_CHANGE",
    ";Z:0.2",
    "G1 X100 Y100 Z0.2 F7200",
    "G1 X120 Y100 E1",
    "G1 X120 Y110 E0.5",
    "G1 E-0.8 F2100",
    "G1 E0.8",
    ";LAYER_CHANGE",
    ";Z:0.4",
    "G1 Z0.4",
    "G1 X100 Y100 E1",
    ";LAYER_CHANGE",
    ";Z:0.6",
    "G1 Z0.6",
    "M600",
    "G1 X120 Y110 E1",
    "M104 S0",
  ].join("\n");

  it("measures filament from the E axis and converts it to grams", () => {
    const result = analyzeGcodeText(part, SIMPLE, { filamentType: "PLA" });
    expect(result.filamentMm).toBe(9 + 12.5 + 1 + 0.5 + 1 + 1); // retract and unretract cancel out
    const cm3 = (Math.PI * 0.875 ** 2 * 25) / 1000;
    expect(result.filamentCm3).toBeCloseTo(cm3, 2);
    expect(result.filamentGrams).toBeCloseTo(cm3 * 1.24, 1);
    expect(analyzeGcodeText(part, SIMPLE, { filamentType: "PETG", filamentDiameterMm: 1.75 }).filamentGrams).toBeCloseTo(cm3 * 1.27, 1);
  });

  it("sizes the part without the purge line, and counts layers, temperatures and pauses", () => {
    const result = analyzeGcodeText(part, SIMPLE);
    expect(result.extents).toMatchObject({ minX: 100, maxX: 120, minY: 100, maxY: 110 });
    expect(result.size).toEqual({ x: 20, y: 10, z: 0.6 });
    expect(result.layers).toBe(3);
    expect(result.firstLayerMm).toBe(0.2);
    expect(result.layerHeightMm).toBe(0.2);
    expect(result.maxHotendC).toBe(215);
    expect(result.maxBedC).toBe(60);
    expect(result.filamentChanges).toBe(1);
  });

  it("handles absolute extrusion and G92 resets", () => {
    const result = analyzeGcodeText("M82\nG92 E0\nG1 X10 E2\nG1 X20 E4\nG92 E0\nG1 X30 E2", SIMPLE);
    expect(result.filamentMm).toBe(6);
  });

  it("measures arcs (G2/G3) by their length, not their chord", () => {
    // Quarter circle of radius 10 around (10, 0), clockwise from (0,0) to (10,10).
    const arc = analyzeGcodeText("G1 X0 Y0 F600\nG2 X10 Y10 I10 J0 E1 F600", SIMPLE);
    const quarter = (Math.PI / 2) * 10;
    expect(arc.estimatedSeconds).toBeGreaterThanOrEqual(Math.floor(quarter / 10));
    expect(arc.extents!.maxY).toBeGreaterThan(9.9);
  });
});
