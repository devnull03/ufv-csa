# The lab printer: Original Prusa i3

The lab has an **Original Prusa i3**. The exact variant isn't confirmed yet, so PrintQ defaults to the most common one, the **MK3S/MK3S+**. An admin can change it under **Staff → Settings → Printer**, which sets the build volume and the files members must upload.

## 1. Which i3 is it?

| Check | What it tells you |
|---|---|
| Idle screen says "Prusa i3 **MK3S** OK." (or MK3, MK2.5S…) | The firmware's variant. An **MK3S+** also says MK3S. |
| LCD → Support | Firmware version, and the board: **EINSy** (MK3 family) or **miniRambo** (MK2 family). |
| Filament sensor | None: MK2/MK2S. Optical sensor standing on edge: MK2.5/MK3. IR sensor lying flat under a cover: MK2.5S/MK3S. |
| MK3S vs MK3S+ | The MK3S+ has a SuperPINDA probe, screw-on Y-rod holders and metal bearing clips. |
| Bed | Fixed PEI: MK2/MK2S. Magnetic MK52 with a removable steel sheet: MK2.5 and up. |

## 2. What matters to PrintQ

| Variant | Build volume (PrusaSlicer) | `printer_model` in G-code | `.bgcode` | Raspberry Pi / PrusaLink |
|---|---|---|---|---|
| **MK3S / MK3S+** | 250 × 210 × 210 mm | `MK3S` | no | Pi Zero 2 W on the EINSy header, or a Pi 3/4/5 over USB |
| MK3 | 250 × 210 × 210 mm | `MK3` | no | same |
| MK2.5S / MK2.5 | 250 × 210 × 200 mm | `MK2.5S` / `MK2.5` | no | Pi 3/4/5 over USB |
| MK2S | 250 × 210 × 200 mm | `MK2S` | no | OctoPrint only (no PrusaLink) |

- Filament is 1.75 mm and the nozzle is 0.4 mm on every variant. The bed is heated.
- **Plain `.gcode` only.** Binary `.bgcode` needs Prusa's 32-bit firmware (MINI, MK3.5/3.9, MK4, XL, CORE One). The 8-bit i3 firmware (last release 3.14.1) can't read it. PrintQ now refuses `.bgcode` for these printers and tells the member how to export plain G-code.
- PrusaSlicer writes `; printer_model = MK3S`, and `M862.3 P "MK3S"` makes the printer itself warn on a mismatch. PrintQ checks the model on upload.
- PrusaSlicer embeds a 160×120 PNG thumbnail for MK2.5 and later, which PrintQ already shows.

## 3. Print calculations from the file

PrintQ reads every move in an uploaded `.gcode` (`app/printq/gcode/analyze.ts`), not just the slicer's comments:

- **Time:** it simulates the firmware's motion planner: acceleration, top speeds and corner speed ("jerk") per axis. It uses the MK3S limits, or the `M201/M203/M204/M205` the file sets itself, plus `G4` dwells, arcs (`G2/G3`) and relative/absolute modes.
- **Filament:** length from the E axis. Retracts cancel out. It converts to cm³ (1.75 mm) and grams using the file's `filament_density` or a per-material table (PLA 1.24, PETG 1.27, ABS 1.04, …).
- **Size:** the real extent of the model. The intro/purge line, skirt, brim and wipe tower are left out, but they still count towards the **footprint** that must fit on the bed.
- **Layers:** count, most common layer height and first layer.
- **Things a person has to be there for:**
  - `M600` filament changes (colour swaps);
  - `M601/M0/M1` pauses;
  - multi-material tool changes;
  - non-PLA temperatures (hotend ≥ 240 °C).

  These show on the booking page and on the staff card in Discord.

The slicer's own numbers still win when present: the time from `; estimated printing time (normal mode)` or the first `M73 R…`, and the grams. PrintQ's figures fill any gaps (e.g. files from other slicers) and are kept for comparison. A 25 MB file takes about 1.5 s.

**Accuracy** against PrusaSlicer, on Prusa's 15 official MK3S sample G-codes:

| File | PrusaSlicer | PrintQ | Δ time | Filament (slicer / PrintQ) |
|---|---|---|---|---|
| 3DBenchy 0.15 mm | 125 min | 132 min | +6.0 % | 11.9 / 12.0 g |
| Marvin (variable layers) | 52 | 53 | +1.8 % | 3.1 / 3.2 g |
| Adalinda 0.2 mm | 482 | 508 | +5.4 % | 70.7 / 70.8 g |
| Batman 0.2 mm | 23 | 24 | +1.7 % | 5.6 / 5.6 g |
| Buddy 0.15 mm | 134 | 138 | +3.3 % | 12.1 / 12.2 g |
| Castle 0.1 mm | 834 | 866 | +3.9 % | 84.1 / 84.1 g |
| Gear bearing 0.2 mm | 173 | 186 | +7.5 % | 20.3 / 20.3 g |
| Nefertiti 0.15 mm | 472 | 487 | +3.2 % | 62.4 / 62.5 g |
| Beer opener (with M600) | 54 | 55 | +2.5 % | 11.9 / 11.9 g |
| Prusa logo | 23 | 24 | +2.2 % | 5.0 / 5.0 g |
| Prusa logo, two colours (M600) | 23 | 24 | +2.2 % | 5.0 / 5.0 g |
| Treefrog (variable) | 96 | 99 | +3.9 % | 6.4 / 6.5 g |
| Triceratops skull | 313 | 328 | +5.0 % | 27.1 / 27.1 g |
| Vase | 393 | 403 | +2.8 % | 72.3 / 72.3 g |
| Whistle | 34 | 34 | +1.4 % | 3.9 / 4.0 g |

Time is within 1.4–7.5 % and always slightly over, which is the safe side for booking slots. Filament matches to 0.1 g. The sample files aren't committed (Prusa's licence for them is unclear). The unit tests use synthetic G-code with hand-checked answers.

## 4. How far we can integrate it

The i3 has **no network of its own**. Everything goes through a small computer next to it:

| Option | Gets us | Needs |
|---|---|---|
| **PrusaLink** (Prusa's official) | Local REST API. `GET /api/v1/status` gives state (IDLE, PRINTING, PAUSED, FINISHED, STOPPED, ERROR, ATTENTION), temperatures, progress, time printing and time remaining. Also: pause/resume/stop, upload with print-after-upload, camera snapshots. Auth by API key. | Pi Zero 2 W on the EINSy header (MK3 family), or a Pi 3/4/5 over USB. Printer firmware **3.14.0+**. PrusaLink 0.8.x (Dec 2024; still maintained, slowly). |
| OctoPrint | Same, plus push events (PrintStarted, PrintDone, PrintFailed, FilamentChange) through the MQTT or Webhooks plugins. | Pi 3B+/4 (not a Zero W). |
| Prusa Connect (cloud) | Remote view and queue through PrusaLink. | No general API for us. Not a basis for PrintQ. |

**Recommendation:**

1. **Now (no hardware):** what PrintQ does today. Staff press Check in / Start / Finished in Discord or on the website. The file analysis already gives accurate times, filament and size.
2. **Live status (next step, about $60 of hardware):**
   - Put a **Raspberry Pi 3B+/4 on a wired port**, USB to the printer, running PrusaLink. Update the printer firmware to 3.14.1 first.
   - A small bridge script on the Pi polls `127.0.0.1/api/v1/status` every 5–10 s and **pushes** to PrintQ (`POST /api/printq/printer/status` with a token). The campus network only needs outbound traffic from the Pi.
   - PrintQ can then show real progress and time left on the home page and the Discord board, in place of today's estimate.
   - It can also mark a booking *Finished* when the printer reports FINISHED, flag STOPPED/ERROR as a possible failure for staff to confirm, and ping #printq-staff on ATTENTION (filament runout, M600, crash).
3. **Remote start: possible, but don't automate it.**
   - PrusaLink can upload and start a job, but someone must check the bed is clear and the right filament is loaded first. That's why Prusa's own queue has a "Set Ready" step.
   - If we add it, make it a staff-only button that only appears after check-in.
   - Prusa's manual says not to leave the printer unattended while it's on (fire risk). Keep prints to staffed hours, keep a smoke detector and an extinguisher in D224, and consider a webcam. **Cancel** is the only action safe to offer fully remotely.

**Gotchas:**
- UFV's Wi-Fi is likely WPA2-Enterprise with client isolation, so ask IT for a wired port.
- The serial link runs at 115200 baud.
- When the Pi is on the EINSy header, set *Settings → RPi port: On* and `enable_uart=1`.
- A Pi Zero W is too slow for OctoPrint with a webcam.
- PrusaLink 0.8 needs printer firmware 3.14.0 or newer.

## 5. 3D model on the site

`public/printq/prusa-i3-mk3.glb` is a real CAD assembly of an **Original Prusa i3 MK3**:
- **Source:** "Original Prusa i3 MK3 for Fusion 360 (and STL)" by Swesen (Printables #179638, **CC BY**), based on jzkmath's SolidWorks assembly (**GPL**), after Prusa Research's GPL sources.
- **Processing:** decimated from 1.67 M to 150 k triangles (meshoptimizer, error 0.03 %), then coloured by part shape: frame, orange printed parts, aluminium, rods, PEI sheet, electronics.
- **Size:** 478 KB, meshopt-compressed.
- **Credits:** the required credit is linked under the viewer, with the full chain in `prusa-i3-mk3.CREDITS.txt`.

The MK3 and MK3S look nearly identical; the S changed the extruder and filament sensor.

**Upgrade option:** Sketchfab has an already-coloured **MK3S** ("Prusa Mk3s" by flavio.astudillo, CC BY 4.0, https://sketchfab.com/3d-models/prusa-mk3s-b43508c8df3f4340af8de230c35ad559). Downloading it needs a free Sketchfab login. To use it:
1. Export it as GLB.
2. Compress it with `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt`.
3. Replace the file.
4. Update the offsets in `app/printq/ui/PrinterModel.tsx` and the credits.

Avoid the "CC0" STEP re-uploads on Printables and GrabCAD models; their licences don't hold up.

## Sources

- PrusaSlicer printer profiles: https://github.com/prusa3d/PrusaSlicer/blob/master/resources/profiles/PrusaResearch.ini
- Prusa-Firmware (MK3 branch): https://github.com/prusa3d/Prusa-Firmware
- PrusaLink and its API spec: https://github.com/prusa3d/Prusa-Link, https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml
- Binary G-code support: https://help.prusa3d.com/article/binary-g-code_646763
- PrusaLink on the MK3S: https://help.prusa3d.com/guide/prusalink-and-prusa-connect-mk3s-mk3s_221744
- Sample G-codes used for the accuracy table: https://help.prusa3d.com/article/sample-g-codes_529630
- OctoPrint REST API and events: https://docs.octoprint.org/en/master/api/
- 3D model: https://www.printables.com/model/179638, https://www.thingiverse.com/thing:2699771, https://github.com/prusa3d/Original-Prusa-i3
