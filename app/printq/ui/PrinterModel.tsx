"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Interactive Original Prusa i3 (spec C04). The model is a real CAD assembly
 * (credits in public/printq/prusa-i3-mk3.CREDITS.txt), decimated to ~150k
 * triangles and coloured by part. Auto-rotates until the first drag; zoom and
 * pan are off so the page still scrolls. While printing, a part grows on the
 * bed with `progress` and the hotend glows.
 */
export const PRINTER_MODEL_URL = "/printq/prusa-i3-mk3.glb";

// Where things are in the model (metres, after centring on the bed).
const OFFSET = new THREE.Vector3(-0.0008, -0.0059, -0.0539); // bed centre → origin, feet on the ground
const SHEET_TOP = 0.0774 - 0.0059;
const NOZZLE = new THREE.Vector3(-0.022, 0.19, -0.016);

export default function PrinterModel({ progress, printing }: { progress: number; printing: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const amount = Math.max(0, Math.min(1, progress));
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    camera.position.set(0.8, 0.48, 1.05);

    // The printer.
    const printer = new THREE.Group();
    scene.add(printer);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.load(PRINTER_MODEL_URL, (gltf) => {
      if (disposed) return;
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          // No normals in the file: flat shading suits the machined look and keeps it small.
          object.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, flatShading: true });
          object.castShadow = object.receiveShadow = true;
        }
      });
      gltf.scene.position.copy(OFFSET);
      printer.add(gltf.scene);
      setLoaded(true);
    });

    // The print: an L-bracket with a gusset, revealed by a clipping plane as it progresses.
    const printTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const printMat = new THREE.MeshStandardMaterial({ color: 0x8fc63d, roughness: 0.5, side: THREE.DoubleSide, clippingPlanes: [printTop] });
    const PH = 0.05;
    const profile = new THREE.Shape();
    profile.moveTo(-0.03, 0);
    profile.lineTo(0.03, 0);
    profile.lineTo(0.03, 0.007);
    profile.lineTo(-0.016, 0.007);
    profile.lineTo(-0.016, PH);
    profile.lineTo(-0.023, PH);
    profile.lineTo(-0.023, 0.007);
    profile.lineTo(-0.03, 0.007);
    profile.lineTo(-0.03, 0);
    const bracket = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.04, bevelEnabled: false }), printMat);
    bracket.rotation.y = Math.PI / 2;
    bracket.position.set(-0.02, SHEET_TOP, 0);
    bracket.castShadow = true;
    bracket.visible = printing;
    printer.add(bracket);
    printTop.constant = SHEET_TOP + (printing ? 0.0005 + PH * amount : 0);

    // Hotend glow while printing.
    const glow = new THREE.PointLight(0xff7a1a, printing ? 0.6 : 0, 0.25, 2);
    glow.position.copy(NOZZLE);
    printer.add(glow);

    // Ground and grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: 0.45 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(1.4, 28, 0x3b4a5e, 0x263244);
    grid.position.y = 0.0005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);

    // Lights
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(0.7, 1.3, 0.9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -0.45, right: 0.45, top: 0.55, bottom: -0.3, near: 0.1, far: 3 });
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fc63d, 1.2);
    rim.position.set(-1, 0.7, -0.8);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fill.position.set(-0.8, 0.35, 0.9);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.17, 0);
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
      if (printing && !reducedMotion) glow.intensity = 0.5 + 0.15 * Math.sin(clock.getElapsedTime() * 3);
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
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

  return (
    <div ref={container} style={{ position: "absolute", inset: 0, opacity: loaded ? 1 : 0, transition: "opacity 400ms ease" }} aria-hidden />
  );
}
