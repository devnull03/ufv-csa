// Pure helpers shared by the server parser and the browser upload step.

export function printerModelMatches(fileModel: string | null | undefined, printerModel: string) {
  if (!fileModel) return false;
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9.]/g, "");
  // Accept variants such as MK4S vs MK4SMMU3, but not MK4 vs MK4S.
  const file = normalize(fileModel);
  const printer = normalize(printerModel);
  return file === printer || (file.startsWith(printer) && /^MMU|^IS/.test(file.slice(printer.length)));
}

export function fitsBuildVolume(
  bbox: { x: number; y: number; z: number } | null | undefined,
  bed: { bedX: number; bedY: number; bedZ: number }
) {
  if (!bbox) return null;
  return bbox.x <= bed.bedX && bbox.y <= bed.bedY && bbox.z <= bed.bedZ;
}
