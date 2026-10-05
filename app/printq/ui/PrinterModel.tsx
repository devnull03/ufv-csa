"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Interactive Prusa MK4S model (spec C04, from the design's printer3d.html).
 * Auto-rotates until the first drag; zoom and pan are off so the page still
 * scrolls. While printing, the part grows with `progress` and the head and
 * bed move.
 */
export default function PrinterModel({ progress, printing }: { progress: number; printing: boolean }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const amount = Math.max(0, Math.min(1, progress));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    camera.position.set(1.1, 0.78, 1.5);

    const standard = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(params);
    const M = {
      frame: standard({ color: 0x2a3340, metalness: 0.6, roughness: 0.42 }),
      printed: standard({ color: 0x52a040, metalness: 0, roughness: 0.6 }),
      steel: standard({ color: 0xd7dde5, metalness: 0.95, roughness: 0.22 }),
      brass: standard({ color: 0xc6a15b, metalness: 0.9, roughness: 0.3 }),
      black: standard({ color: 0x10151d, metalness: 0.2, roughness: 0.7 }),
      bed: standard({ color: 0x1b2028, metalness: 0.5, roughness: 0.5 }),
      sheet: standard({ color: 0x8c7349, metalness: 0.6, roughness: 0.5 }),
      screen: standard({ color: 0x0b1220, emissive: 0x8fc63d, emissiveIntensity: 0.55, roughness: 0.3 }),
      heater: standard({ color: 0x8a8f96, emissive: 0xf97316, emissiveIntensity: printing ? 0.35 : 0, metalness: 0.6, roughness: 0.4 }),
      filament: standard({ color: 0xe8ecef, metalness: 0, roughness: 0.55 }),
    };
    const printTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const printMat = standard({ color: 0xeef2f5, roughness: 0.5, side: THREE.DoubleSide, clippingPlanes: [printTop] });

    const printer = new THREE.Group();
    scene.add(printer);
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = printer) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const cyl = (
      r: number,
      len: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      axis?: "x" | "z",
      parent: THREE.Object3D = printer,
      segments = 32
    ) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), mat);
      mesh.position.set(x, y, z);
      if (axis === "x") mesh.rotation.z = Math.PI / 2;
      if (axis === "z") mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Base / Y axis
    box(0.03, 0.04, 0.44, M.frame, -0.17, 0.028, 0);
    box(0.03, 0.04, 0.44, M.frame, 0.17, 0.028, 0);
    box(0.38, 0.06, 0.012, M.frame, 0, 0.038, 0.222);
    box(0.38, 0.06, 0.012, M.frame, 0, 0.038, -0.222);
    for (const [x, z] of [[-0.17, 0.2], [0.17, 0.2], [-0.17, -0.2], [0.17, -0.2]]) cyl(0.014, 0.008, M.black, x, 0.004, z);
    cyl(0.004, 0.43, M.steel, -0.06, 0.056, 0, "z");
    cyl(0.004, 0.43, M.steel, 0.06, 0.056, 0, "z");
    box(0.042, 0.042, 0.042, M.black, 0, 0.04, -0.2);

    // LCD
    const lcd = new THREE.Group();
    lcd.position.set(-0.1, 0.05, 0.245);
    lcd.rotation.x = -0.45;
    printer.add(lcd);
    box(0.13, 0.055, 0.02, M.printed, 0, 0, 0, lcd);
    box(0.085, 0.036, 0.002, M.screen, -0.012, 0.002, 0.0105, lcd);
    cyl(0.009, 0.012, M.black, 0.048, 0, 0.014, "z", lcd);

    // Bed (moves in z)
    const bed = new THREE.Group();
    printer.add(bed);
    box(0.2, 0.006, 0.2, M.frame, 0, 0.066, 0, bed);
    box(0.255, 0.006, 0.235, M.bed, 0, 0.074, 0, bed);
    box(0.25, 0.0015, 0.23, M.sheet, 0, 0.0778, 0, bed);
    const sheetTop = 0.0786;

    // The print: an L-bracket with a gusset, revealed by a clipping plane
    const PH = 0.06;
    const profile = new THREE.Shape();
    profile.moveTo(-0.035, 0);
    profile.lineTo(0.035, 0);
    profile.lineTo(0.035, 0.008);
    profile.lineTo(-0.019, 0.008);
    profile.lineTo(-0.019, PH);
    profile.lineTo(-0.027, PH);
    profile.lineTo(-0.027, 0.008);
    profile.lineTo(-0.035, 0.008);
    profile.lineTo(-0.035, 0);
    const bracket = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.05, bevelEnabled: false }), printMat);
    bracket.rotation.y = Math.PI / 2;
    bracket.position.set(-0.025, sheetTop, 0);
    bracket.castShadow = true;
    bed.add(bracket);
    const gussetShape = new THREE.Shape();
    gussetShape.moveTo(-0.019, 0.008);
    gussetShape.lineTo(0.02, 0.008);
    gussetShape.lineTo(-0.019, 0.045);
    gussetShape.lineTo(-0.019, 0.008);
    const gusset = new THREE.Mesh(new THREE.ExtrudeGeometry(gussetShape, { depth: 0.006, bevelEnabled: false }), printMat);
    gusset.rotation.y = Math.PI / 2;
    gusset.position.set(-0.003, sheetTop, 0);
    gusset.castShadow = true;
    bed.add(gusset);
    const printHeight = printing ? 0.0005 + PH * amount : 0;
    bracket.visible = gusset.visible = printing;

    // Frame
    const FZ = -0.012;
    box(0.04, 0.42, 0.012, M.frame, -0.215, 0.255, FZ);
    box(0.04, 0.42, 0.012, M.frame, 0.215, 0.255, FZ);
    box(0.47, 0.04, 0.012, M.frame, 0, 0.465, FZ);
    box(0.47, 0.03, 0.012, M.frame, 0, 0.03, FZ);

    // Z axes
    for (const side of [-1, 1]) {
      box(0.042, 0.042, 0.042, M.black, side * 0.18, 0.066, 0.016);
      cyl(0.004, 0.36, M.brass, side * 0.18, 0.267, 0.016);
      cyl(0.004, 0.37, M.steel, side * 0.16, 0.265, 0.03);
      box(0.06, 0.022, 0.04, M.printed, side * 0.172, 0.452, 0.02);
    }

    // X gantry (moves in y)
    const gantry = new THREE.Group();
    printer.add(gantry);
    box(0.055, 0.07, 0.045, M.printed, -0.172, 0, 0.022, gantry);
    box(0.055, 0.07, 0.045, M.printed, 0.172, 0, 0.022, gantry);
    box(0.042, 0.042, 0.042, M.black, -0.21, 0, 0.03, gantry);
    cyl(0.004, 0.33, M.steel, 0, 0.022, 0.035, "x", gantry);
    cyl(0.004, 0.33, M.steel, 0, -0.022, 0.035, "x", gantry);

    // Extruder (moves in x)
    const head = new THREE.Group();
    gantry.add(head);
    box(0.05, 0.065, 0.016, M.printed, 0, 0, 0.05, head);
    box(0.052, 0.07, 0.048, M.printed, 0, 0.012, 0.078, head);
    box(0.042, 0.04, 0.042, M.black, 0, 0.066, 0.072, head);
    const fan = cyl(0.017, 0.008, M.black, 0, 0, 0.106, "z", head);
    cyl(0.006, 0.01, M.frame, 0, 0, 0.108, "z", head);
    box(0.02, 0.012, 0.016, M.heater, 0, -0.03, 0.078, head);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.01, 24), M.brass);
    nozzle.rotation.x = Math.PI;
    nozzle.position.set(0, -0.041, 0.078);
    head.add(nozzle);
    const TIP = -0.046;
    const HEADZ = 0.078;

    // Spool
    const spool = new THREE.Group();
    spool.position.set(0, 0.585, -0.06);
    printer.add(spool);
    box(0.02, 0.04, 0.09, M.printed, 0, -0.1, 0, spool);
    cyl(0.1, 0.004, M.black, -0.034, 0, 0, "x", spool, 64);
    cyl(0.1, 0.004, M.black, 0.034, 0, 0, "x", spool, 64);
    cyl(0.082, 0.064, M.filament, 0, 0, 0, "x", spool, 64);
    cyl(0.028, 0.072, M.black, 0, 0, 0, "x", spool);

    // PTFE tube, rebuilt as the head moves
    const tubeMat = standard({ color: 0xdbe3ea, roughness: 0.4, transparent: true, opacity: 0.75 });
    let tube: THREE.Mesh | null = null;
    const tubeStart = new THREE.Vector3(0, 0.5, -0.03);
    const headPoint = new THREE.Vector3();
    const updateTube = () => {
      head.localToWorld(headPoint.set(0, 0.09, 0.075));
      const mid = new THREE.Vector3(
        (tubeStart.x + headPoint.x) / 2,
        Math.max(tubeStart.y, headPoint.y) + 0.12,
        (tubeStart.z + headPoint.z) / 2 + 0.08
      );
      const geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(tubeStart, mid, headPoint), 24, 0.0025, 8, false);
      if (tube) {
        tube.geometry.dispose();
        tube.geometry = geometry;
      } else {
        tube = new THREE.Mesh(geometry, tubeMat);
        printer.add(tube);
      }
    };

    // Ground and grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: 0.45 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(1.6, 32, 0x3b4a5e, 0x263244);
    grid.position.y = 0.0005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);

    // Lights
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(0.9, 1.6, 1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -0.6, right: 0.6, top: 0.8, bottom: -0.4, near: 0.1, far: 4 });
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fc63d, 1.4);
    rim.position.set(-1.2, 0.9, -1);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.5);
    fill.position.set(-1, 0.4, 1);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.31, 0.02);
    controls.enableDamping = true;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = 0.5;
    controls.maxPolarAngle = 1.45;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.5;
    const stopRotate = () => {
      controls.autoRotate = false;
    };
    renderer.domElement.addEventListener("pointerdown", stopRotate);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 36 : 28;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let frameId = 0;
    const animate = () => {
      const t = reducedMotion ? 0 : clock.getElapsedTime();
      const moving = printing && !reducedMotion;
      head.position.x = moving ? 0.028 * Math.sin(t * 2.1) + 0.006 * Math.sin(t * 7.3) : printing ? 0 : -0.13;
      bed.position.z = HEADZ + (moving ? 0.022 * Math.sin(t * 1.3 + 0.7) : printing ? 0 : 0.08);
      const topY = sheetTop + printHeight;
      printTop.constant = topY;
      gantry.position.y = printing ? topY - TIP + 0.0004 : 0.24;
      if (moving) fan.rotation.y += 0.6;
      updateTube();
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", stopRotate);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [progress, printing]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} aria-hidden />;
}
