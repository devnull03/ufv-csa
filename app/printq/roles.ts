import type { UserRole } from "./constants";

export type IneligibleReason = "not_in_server" | "missing_role" | "banned";

export interface Viewer {
  userId: string;
  name: string;
  image: string | null;
  discordId: string;
  discordUsername: string | null;
  role: UserRole;
  ineligibleReason: IneligibleReason | null;
  bannedUntil: Date | null;
}

const RANK: Record<UserRole, number> = { member: 0, staff: 1, admin: 2 };

export const hasRole = (viewer: Pick<Viewer, "role">, role: UserRole) => RANK[viewer.role] >= RANK[role];
