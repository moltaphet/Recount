import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Appeal, Round, Wallet } from "./lib/genlayer";
import { CONTRACT, getAppeal, getAppealOf, getBalance, getRound, getTime, listAppeals, previewPayout } from "./lib/genlayer";
import { date, gen, phaseOf, short, until } from "./lib/format";
import type { ScenePhase } from "./scene/Chamber";
import CasePanel from "./components/CasePanel";

const Chamber = lazy(() => import("./scene/Chamber"));

const STATUS_TEXT: Record<Appeal["status"], string> = {
  FILED: "Waiting for a decision",
  APPROVED: "Eligible",
  REJECTED: "Not eligible",
  REFUNDED: "Bond returned",
  CLAIMED: "Paid",
};

export default function App() {
  const [round, setRound] = useState<Round | null>(null);
  const [now, setNow] = useState<number>(0);
  const [docket, setDocket] = useState<Appeal[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [payout, setPayout] = useState<bigint | null>(null);
  const [judging, setJudging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, t, d] = await Promise.all([getRound(), getTime(), listAppeals()]);
      setRound(r); setNow(t); setDocket(d); setLoadError(null);
      if (wallet) {
        const [b, id] = await Promise.all([getBalance(wallet.address), getAppealOf(wallet.address)]);
        setBalance(b);
        const a = id ? await getAppeal(id) : null;
        setAppeal(a);
        setPayout(a?.status === "APPROVED" ? await previewPayout(a.id) : null);
      } else {
        setBalance(null); setAppeal(null); setPayout(null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [wallet]);

  useEffect(() => { refresh(); }, [refresh]);
  // Chain time ticks locally between refreshes; re-sync every 30 s.
  useEffect(() => {
    const tick = setInterval(() => setNow((n) => (n ? n + 1 : n)), 1000);
    const sync = setInterval(refresh, 30000);
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
      <header className="top">
        <a className="wordmark" href="#">Recount</a>
        <span className="net">GenLayer studionet</span>
      </header>

      <section className="hero" aria-label="Recount">
        <div className="scene" aria-hidden="true">
          <Suspense fallback={null}><Chamber phase={scenePhase} /></Suspense>
        </div>
        <div className="hero-copy">
          <h1>Cut from the airdrop by mistake?<br />Ask for a recount.</h1>
          <p className="lede">
            Validators on GenLayer re-check your on-chain history against the project's own published rules.
            Each one fetches the evidence and judges it independently. If they agree you qualify, the reserve pays you.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#case">File an appeal</a>
            {round && (
              <p className="hero-round">
                <strong>{round.title}</strong>
                <span>{gen(round.reserve)} reserve</span>
                <span>{phase === "filing" ? `filing closes in ${until(round.filing_ends, now)}` : "filing closed"}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      {loadError && <p className="error page-error" role="alert">Couldn't read the contract at {short(CONTRACT ?? "0x")}: {loadError}</p>}

      {round && (
        <main className="file-room">
          <div className="rules">
            <section aria-labelledby="rules-title">
              <h2 id="rules-title">The rules</h2>
              <p className="muted">Frozen when the round opened. Nobody can change them now, including the project.</p>
              <ul className="criteria">
                {round.criteria.map((c) => (
                  <li key={c.id}><span className="cid">{c.id}</span>{c.text}</li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="pay-title">
              <h2 id="pay-title">What you can get</h2>
              <table className="tiers">
                <tbody>
                  {round.tiers.map((t) => (
                    <tr key={t.id}><th scope="row">{t.id}</th><td>{t.description}</td><td className="num">{gen(BigInt(t.amount))}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">If approved awards exceed the {gen(round.reserve)} reserve, everyone is paid the same share of their award.</p>
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
              <p className="muted">Evidence comes from {new URL(round.explorer_api).host} up to block {round.snapshot_block.toLocaleString("en-US")}, plus the project's exclusion record. You don't submit links.</p>
            </section>
          </div>

          <CasePanel
            round={round} now={now} wallet={wallet} balance={balance} appeal={appeal} payout={payout}
            onWallet={setWallet} onChanged={refresh} onJudging={setJudging}
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
                    <td className="num">{a.award > 0n ? gen(a.award) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <footer className="foot">
        <p>Contract <a href={`https://explorer-studio.genlayer.com/address/${CONTRACT}`} target="_blank" rel="noreferrer">{short(CONTRACT ?? "0x")}</a> on GenLayer studionet, GenVM v0.4. Test GEN only. <a href="https://github.com/moltaphet/Recount" target="_blank" rel="noreferrer">Source</a></p>
      </footer>
    </>
  );
}
