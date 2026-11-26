import { GEN } from "./genlayer";

export function gen(amount: bigint, digits = 2): string {
  const whole = amount / GEN;
  const frac = Number(amount % GEN) / 1e18;
  const value = Number(whole) + frac;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} GEN`;
}

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function until(target: number, now: number): string {
  const s = target - now;
  if (s <= 0) return "closed";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function date(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

export type Phase = "filing" | "deciding" | "waiting" | "claims" | "over";

export function phaseOf(r: { filing_ends: number; adjudication_ends: number; claims_start: number; claims_end: number }, now: number): Phase {
  if (now <= r.filing_ends) return "filing";
  if (now <= r.adjudication_ends) return "deciding";
  if (now < r.claims_start) return "waiting";
  if (now < r.claims_end) return "claims";
  return "over";
}

/** Payout rounds pay GEN; registry rounds list the project's own token (18 decimals) for an off-GenLayer payout. */
export function amountText(amount: bigint, mode: "payout" | "registry"): string {
  return mode === "payout" ? gen(amount) : gen(amount).replace(" GEN", " tokens");
}
