import { auth } from "~/app/printq/auth";
import { disabledResponse } from "~/app/printq/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return disabledResponse() ?? auth().handler(request);
}

export async function POST(request: Request) {
  return disabledResponse() ?? auth().handler(request);
}
