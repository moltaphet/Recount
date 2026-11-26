// GenLayer access for Recount (genlayer-js 2.0.0, Consensus v0.6).
//
// Rules this file follows (genlayer-dev skills / Studio v0.123 announcement):
// - every write carries fees from estimateTransactionFeesForWrite;
// - a transaction counts as done only when isSuccessful(tx): status
//   ACCEPTED/FINALIZED and execution FINISHED_WITH_RETURN;
// - time comes from the contract's get_time() view, never the local clock.

import { createAccount, createClient, generatePrivateKey, isSuccessful } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CONTRACT = import.meta.env.VITE_RECOUNT_ADDRESS as `0x${string}`;
export const ROUND_ID = Number(import.meta.env.VITE_RECOUNT_ROUND_ID ?? 1);
export const GEN = 10n ** 18n;

const BURNER_KEY = "recount.burnerKey";

type Client = ReturnType<typeof createClient>;
export type WalletKind = "metamask" | "temporary";

export interface Wallet {
  kind: WalletKind;
  address: `0x${string}`;
  client: Client;
}

// A read-only client with a throwaway account (readContract wants one).
const reader = createClient({ chain: studionet, account: createAccount(generatePrivateKey()) });

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectMetaMask(): Promise<Wallet> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or use a temporary account.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0] as `0x${string}`;
  const client = createClient({ chain: studionet, account: address, provider: window.ethereum as never });
  await client.connect("studionet");
  return { kind: "metamask", address, client };
}

export function openTemporaryAccount(): Wallet {
  let key = localStorage.getItem(BURNER_KEY) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(BURNER_KEY, key);
  }
  const account = createAccount(key);
  return { kind: "temporary", address: account.address, client: createClient({ chain: studionet, account }) };
}

export function forgetTemporaryAccount(): void {
  localStorage.removeItem(BURNER_KEY);
}

// ---------------------------------------------------------------- reads

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return (await reader.readContract({
    address: CONTRACT,
    functionName,
    args: args as never,
  })) as T;
}

export interface Tier { id: string; amount: string; description: string }
export interface Criterion { id: string; text: string }
export interface Round {
  id: number; title: string; criteria: Criterion[]; tiers: Tier[];
  explorer_api: string; snapshot_block: number; filing_bond: bigint;
  filing_ends: number; adjudication_ends: number; claims_start: number; claims_end: number;
  reserve: bigint; bonds_held: bigint; total_awarded: bigint; paid_out: bigint; closed: boolean;
  appeal_count: number; min_tx_count: number;
}
export interface Facts {
  tx_count: number; truncated: boolean; incoming_count: number; outgoing_count: number;
  failed_count: number; contract_creations: number; first_tx_date: string; last_tx_date: string;
  active_days: number; active_months: number; distinct_counterparties: number; first_funder: string;
}
export interface Appeal {
  id: number; round_id: number; claimant: string; criterion_id: string; statement: string;
  bond: bigint; status: "FILED" | "APPROVED" | "REJECTED" | "REFUNDED" | "CLAIMED";
  outcome_kind: string; outcome_code: string; tier: string; award: bigint; payout: bigint;
  evidence: { exclusion: { allocation: number; reason: string }; facts: Facts } | null;
  reasons: string[]; filed_at: number;
}

// Calldata maps come back as Map in genlayer-js; normalise to plain objects.
function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([k, v]) => [k, plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  return value;
}
const big = (v: unknown) => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));
const num = (v: unknown) => Number(v ?? 0);

export async function getTime(): Promise<number> {
  return num(await read("get_time"));
}

export async function getRound(id = ROUND_ID): Promise<Round> {
  const r = plain(await read("get_round", [id])) as Record<string, unknown>;
  return {
    ...(r as unknown as Round),
    id: num(r.id), snapshot_block: num(r.snapshot_block), filing_bond: big(r.filing_bond),
    filing_ends: num(r.filing_ends), adjudication_ends: num(r.adjudication_ends),
    claims_start: num(r.claims_start), claims_end: num(r.claims_end),
    reserve: big(r.reserve), bonds_held: big(r.bonds_held), total_awarded: big(r.total_awarded),
    paid_out: big(r.paid_out), appeal_count: num(r.appeal_count), min_tx_count: num(r.min_tx_count),
  };
}

export async function getAppeal(id: number): Promise<Appeal> {
  const a = plain(await read("get_appeal", [id])) as Record<string, unknown>;
  return {
    ...(a as unknown as Appeal),
    id: num(a.id), round_id: num(a.round_id), bond: big(a.bond), award: big(a.award),
    payout: big(a.payout), filed_at: num(a.filed_at),
  };
}

export async function getAppealOf(address: string, id = ROUND_ID): Promise<number> {
  return num(await read("get_appeal_of", [id, address.toLowerCase()]));
}

export async function listAppeals(id = ROUND_ID): Promise<Appeal[]> {
  const ids = (plain(await read("list_appeals", [id, 0, 100])) as unknown[]).map(num);
  return Promise.all(ids.map(getAppeal));
}

export async function previewPayout(appealId: number): Promise<bigint> {
  return big(await read("preview_payout", [appealId]));
}

export async function getBalance(address: string): Promise<bigint> {
  return (await reader.getBalance({ address: address as `0x${string}` })) as bigint;
}

// ---------------------------------------------------------------- writes

export type Stage = "estimating" | "signing" | "deciding" | "done";

export interface WriteResult {
  ok: boolean;
  hash: string;
  feeQuoted: bigint;
  error?: string;
}

export async function write(
  wallet: Wallet,
  functionName: string,
  args: unknown[],
  value: bigint,
  onStage: (s: Stage) => void,
): Promise<WriteResult> {
  onStage("estimating");
  const estimate = await wallet.client.estimateTransactionFeesForWrite({
    address: CONTRACT,
    functionName,
    args: args as never,
    value,
  });
  onStage("signing");
  const hash = (await wallet.client.writeContract({
    address: CONTRACT,
    functionName,
    args: args as never,
    value,
    fees: {
      distribution: estimate.distribution,
      feeValue: estimate.feeValue,
      ...(estimate.messageAllocations ? { messageAllocations: estimate.messageAllocations } : {}),
    } as never,
  })) as string;
  onStage("deciding");
  const tx = await wallet.client.waitForTransactionReceipt({
    hash: hash as never,
    waitUntil: "decided",
    interval: 3000,
    retries: 100,
  });
  onStage("done");
  const ok = isSuccessful(tx);
  return { ok, hash, feeQuoted: estimate.feeValue, error: ok ? undefined : describeFailure(tx) };
}

function describeFailure(tx: unknown): string {
  const t = tx as Record<string, unknown>;
  const status = String(t.statusName ?? t.status_name ?? "");
  if (status === "UNDETERMINED") return "Validators could not agree. Nothing changed; you can try again.";
  return "The network accepted the transaction, but the contract rejected it. Nothing changed.";
}

// Studio test networks fund accounts on request (sim_fundAccount). Test GEN only.
export async function addTestGen(address: string, amount = 2n * GEN): Promise<void> {
  await reader.request({ method: "sim_fundAccount", params: [address, Number(amount)] } as never);
}

/** Turn a simulation error into the contract's own message when possible. */
export function explain(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const m = text.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^"\\]*/);
  if (m) return m[0];
  if (/user rejected|denied/i.test(text)) return "You cancelled the signature.";
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}
