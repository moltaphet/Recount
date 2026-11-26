import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Appeal, Round, Wallet } from "../lib/genlayer";
import { approvedLeaves, getAppeal, getAppealOf, getBalance, getRound, getTime, listAppeals, previewPayout } from "../lib/genlayer";
import { amountText, date, phaseOf, short, until } from "../lib/format";
import type { ScenePhase } from "../scene/AirdropScene";
import CasePanel from "../components/CasePanel";
import SealPanel from "../components/SealPanel";
import { href } from "../lib/route";

const AirdropScene = lazy(() => import("../scene/AirdropScene"));

const STATUS_TEXT: Record<Appeal["status"], string> = {
  FILED: "Waiting for a decision",
  APPROVED: "Eligible",
  REJECTED: "Not eligible",
  REFUNDED: "Bond returned",
  CLAIMED: "Claimed",
};

export function rateLimitText(msg: string): string | null {
  return /rate limit|429|-32429|-32029/i.test(msg)
    ? "Studio is limiting requests from this connection for a moment. The page keeps the last data and retries automatically."
    : null;
}

interface Props { id: number; wallet: Wallet | null; onWallet: (w: Wallet | null) => void }

export default function RoundPage({ id, wallet, onWallet }: Props) {
  const [round, setRound] = useState<Round | null>(null);
  const [now, setNow] = useState<number>(0);
  const [docket, setDocket] = useState<Appeal[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [payout, setPayout] = useState<bigint | null>(null);
  const [leaves, setLeaves] = useState<{ address: `0x${string}`; amount: bigint }[]>([]);
  const [judging, setJudging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, t, d] = await Promise.all([getRound(id), getTime(), listAppeals(id)]);
      setRound(r); setNow(t); setDocket(d); setLoadError(null);
      setLeaves(r.merkle_root ? await approvedLeaves(id) : []);
      if (wallet) {
        const [b, aid] = await Promise.all([getBalance(wallet.address), getAppealOf(wallet.address, id)]);
        setBalance(b);
        const a = aid ? await getAppeal(aid) : null;
        setAppeal(a);
        setPayout(a?.status === "APPROVED" && r.mode === "payout" ? await previewPayout(a.id) : null);
      } else {
        setBalance(null); setAppeal(null); setPayout(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(rateLimitText(msg) ?? (/unknown round/i.test(msg) ? `There is no round #${id}.` : `Couldn't read round #${id}: ${msg}`));
    }
  }, [wallet, id]);

  useEffect(() => { refresh(); }, [refresh]);
  // Chain time ticks locally between refreshes; re-sync every 45 s (Studio: 60 req/min and 500 req/h per IP).
  useEffect(() => {
    const tick = setInterval(() => setNow((n) => (n ? n + 1 : n)), 1000);
    const sync = setInterval(() => { if (!document.hidden) refresh(); }, 45000);
    return () => { clearInterval(tick); clearInterval(sync); };
  }, [refresh]);

  const scenePhase: ScenePhase = useMemo(() => {
    if (judging) return "judging";
    if (!appeal) return "idle";
    if (appeal.status === "FILED") return "filed";
    if (appeal.status === "APPROVED" || (appeal.status === "CLAIMED" && appeal.award > 0n)) return "approved";
    if (appeal.status === "REJECTED") return "rejected";
    return "idle";
  }, [appeal, judging]);

  const phase = round ? phaseOf(round, now) : null;

  return (
    <>
      <section className="hero hero-round" aria-label={round?.title ?? "Round"}>
        <div className="scene" aria-hidden="true">
          <Suspense fallback={null}><AirdropScene phase={scenePhase} /></Suspense>
        </div>
        <div className="hero-copy">
          <p className="crumb"><a href={href.home}>All rounds</a></p>
          <h1>{round?.title ?? `Round #${id}`}</h1>
          {round && (
            <p className="lede">
              {round.mode === "payout"
                ? `Excluded from this airdrop? File an appeal. If validators agree you meet the rules, you're paid from a ${amountText(round.reserve, "payout")} reserve.`
                : "Excluded from this airdrop? File an appeal. Approved wallets go into a sealed Merkle root the project uses to pay its own token on its own chain."}
            </p>
          )}
          <div className="hero-actions">
            <a className="btn btn-primary" href="#case">{appeal ? "See your case" : "File an appeal"}</a>
            {round && (
              <p className="hero-round">
                <span>{round.sources.map((s) => s.chain).join(", ")}{round.governance_time ? ", Snapshot votes" : ""}</span>
                <span>{phase === "filing" ? `filing closes in ${until(round.filing_ends, now)}` : "filing closed"}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      {loadError && <p className={`page-error ${round ? "notice-soft" : "error"}`} role="status">{loadError}</p>}

      {round && (
        <main className="file-room">
          <div className="rules">
            <section aria-labelledby="rules-title">
              <h2 id="rules-title">The rules</h2>
              <p className="muted">Frozen when the round opened. Nobody can change them now, including the project.</p>
              <ul className="criteria">
                {round.criteria.map((c) => <li key={c.id}><span className="cid">{c.id}</span>{c.text}</li>)}
              </ul>
            </section>

            <section aria-labelledby="pay-title">
              <h2 id="pay-title">What you can get</h2>
              <table className="tiers">
                <tbody>
                  {round.tiers.map((t) => (
                    <tr key={t.id}><th scope="row">{t.id}</th><td>{t.description}</td><td className="num">{amountText(BigInt(t.amount), round.mode)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                {round.mode === "payout"
                  ? `If approved awards exceed the ${amountText(round.reserve, "payout")} reserve, everyone is paid the same share of their award.`
                  : "Amounts are in the project's own token units. The project pays them on its chain from the sealed Merkle root."}
              </p>
            </section>

            <section aria-labelledby="evidence-title">
              <h2 id="evidence-title">What validators check</h2>
              <table className="tiers">
                <tbody>
                  {round.sources.map((s) => (
                    <tr key={s.chain}><th scope="row">{s.chain}</th><td>Transactions on {new URL(s.explorer_api).host}</td><td className="num">up to block {s.snapshot_block.toLocaleString("en-US")}</td></tr>
                  ))}
                  {round.governance_time > 0 && (
                    <tr><th scope="row">snapshot</th><td>Governance votes on Snapshot</td><td className="num">before {date(round.governance_time)}</td></tr>
                  )}
                </tbody>
              </table>
              <p className="muted">Plus the project's own record of why your wallet was excluded. You don't submit links: every validator fetches the same sources itself.</p>
            </section>

            <section aria-labelledby="when-title">
              <h2 id="when-title">Schedule</h2>
              <ol className="timeline">
                {[
                  ["filing", "Filing closes", round.filing_ends],
                  ["deciding", "Decisions close", round.adjudication_ends],
                  ["waiting", "Claims open", round.claims_start],
                  ["claims", "Claims close", round.claims_end],
                ].map(([key, label, ts]) => (
                  <li key={key as string} className={phase === key ? "is-now" : ""}>
                    <span className="t-label">{label as string}</span>
                    <span className="t-date">{date(ts as number)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <SealPanel round={round} now={now} wallet={wallet} leaves={leaves} onChanged={refresh} />
          </div>

          <CasePanel
            round={round} now={now} wallet={wallet} balance={balance} appeal={appeal} payout={payout}
            onWallet={onWallet} onChanged={refresh} onJudging={setJudging}
          />
        </main>
      )}

      {round && (
        <section className="docket" aria-labelledby="docket-title">
          <h2 id="docket-title">Docket</h2>
          {docket.length === 0 ? (
            <p className="muted">No appeals yet. Be the first to ask for a recount.</p>
          ) : (
            <table>
              <thead><tr><th scope="col">Case</th><th scope="col">Wallet</th><th scope="col">Rule</th><th scope="col">Status</th><th scope="col" className="num">Award</th></tr></thead>
              <tbody>
                {[...docket].reverse().map((a) => (
                  <tr key={a.id} className={wallet && a.claimant.toLowerCase() === wallet.address.toLowerCase() ? "is-mine" : ""}>
                    <td>#{a.id}</td><td>{short(a.claimant)}</td><td>{a.criterion_id}</td>
                    <td><span className={`status status-${a.status.toLowerCase()}`}>{STATUS_TEXT[a.status]}</span></td>
                    <td className="num">{a.award > 0n ? amountText(a.award, round.mode) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
