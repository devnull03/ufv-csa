import "server-only";
import { isDemoMode } from "./env";

export interface PrinterTelemetry {
  nozzle: { value: string; sub: string };
  bed: { value: string; sub: string };
  loaded: { value: string; sub: string };
  simulated: boolean;
}

/**
 * Live printer data. There is no printer connection yet (PrusaLink is the
 * planned source), so demo mode returns simulated readings that follow the
 * booking state, and production shows dashes.
 */
export function getPrinterTelemetry(printing: boolean): PrinterTelemetry {
  if (!isDemoMode()) {
    const soon = "Live data coming soon";
    return {
      nozzle: { value: "—", sub: soon },
      bed: { value: "—", sub: soon },
      loaded: { value: "—", sub: "Ask staff in D224" },
      simulated: false,
    };
  }
  const wobble = Math.round(Math.sin(Date.now() / 60_000) * 1);
  return {
    nozzle: printing ? { value: `${215 + wobble} °C`, sub: "Target 215 °C" } : { value: "27 °C", sub: "Idle" },
    bed: printing ? { value: "60 °C", sub: "Textured PEI sheet" } : { value: "25 °C", sub: "Textured PEI sheet" },
    loaded: { value: "PLA · White", sub: "~640 g left on spool" },
    simulated: true,
  };
}
