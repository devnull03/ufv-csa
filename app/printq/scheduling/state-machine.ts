import type { BookingStatus } from "../constants";

export type BookingActor = "owner" | "staff" | "system";

export const BOOKING_ACTIONS = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  expire: "expired",
  check_in: "checked_in",
  start: "printing",
  finish: "finished",
  fail: "failed",
  collect: "collected",
  no_show: "no_show",
  lab_closed: "lab_closed",
} as const satisfies Record<string, BookingStatus>;

export type BookingAction = keyof typeof BOOKING_ACTIONS;

const TRANSITIONS: Partial<Record<BookingStatus, Partial<Record<BookingStatus, BookingActor[]>>>> = {
  pending: {
    approved: ["staff"],
    rejected: ["staff"],
    cancelled: ["owner", "staff"],
    expired: ["system"],
  },
  approved: {
    checked_in: ["staff"],
    cancelled: ["owner", "staff"],
    no_show: ["staff", "system"],
    lab_closed: ["staff", "system"],
  },
  checked_in: {
    printing: ["staff"],
    cancelled: ["staff"],
  },
  printing: {
    finished: ["staff"],
    failed: ["staff"],
  },
  finished: {
    collected: ["staff"],
  },
};

export function canTransition(from: BookingStatus, to: BookingStatus, actor: BookingActor) {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export function nextStatus(from: BookingStatus, action: BookingAction, actor: BookingActor): BookingStatus {
  const to = BOOKING_ACTIONS[action];
  if (!canTransition(from, to, actor)) {
    throw new InvalidTransitionError(from, to, actor);
  }
  return to;
}

export function allowedActions(from: BookingStatus, actor: BookingActor): BookingAction[] {
  return (Object.keys(BOOKING_ACTIONS) as BookingAction[]).filter((action) =>
    canTransition(from, BOOKING_ACTIONS[action], actor)
  );
}

export function isTerminal(status: BookingStatus) {
  return !TRANSITIONS[status];
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
    readonly actor: BookingActor
  ) {
    super(`A ${actor} cannot move a booking from ${from} to ${to}`);
  }
}
