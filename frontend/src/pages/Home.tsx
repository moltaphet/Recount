import { lazy, Suspense, useEffect, useState } from "react";
import type { RoundSummary } from "../lib/genlayer";
import { getTime, listRounds } from "../lib/genlayer";
import { amountText, until } from "../lib/format";
import { href } from "../lib/route";
import { rateLimitText } from "./RoundPage";

const AirdropScene = lazy(() => import("../scene/AirdropScene"));

function status(r: RoundSummary, now: number): string {
  if (now <= r.filing_ends) return `Filing open, ${until(r.filing_ends, now)} left`;
  if (now <= r.adjudication_ends) return "Deciding";
  return r.sealed ? "Sealed" : "Decisions closed";
}

export default function Home() {
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listRounds(0, 50), getTime()])
      .then(([r, t]) => { if (live) { setRounds(r); setNow(t); } })
      .catch((e) => { const m = e instanceof Error ? e.message : String(e); if (live) setError(rateLimitText(m) ?? `Couldn't load rounds: ${m}`); });
    return () => { live = false; };
  }, []);

  return (
    <>
      <section className="hero" aria-label="Recount">
        <div className="scene" aria-hidden="true">
          <Suspense fallback={null}><AirdropScene phase="idle" /></Suspense>
        </div>
        <div className="hero-copy">
          <h1>Cut from the airdrop by mistake?<br />Ask for a recount.</h1>
          <p className="lede">
            Projects publish their airdrop rules. Wallets that were left out can appeal. Validators on GenLayer each re-check
            the wallet's history on every listed chain and agree on a verdict that pays out, or that any chain can verify.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#rounds">Find your airdrop</a>
            <a className="btn" href={href.open}>Open a round for your project</a>
          </div>
        </div>
      </section>

      <main className="ledger" id="rounds" aria-labelledby="rounds-title">
        <h2 id="rounds-title">Open rounds</h2>
        {error && <p className="notice-soft">{error}</p>}
        {rounds === null && !error && <p className="muted">Loading rounds from GenLayer…</p>}
        {rounds !== null && rounds.length === 0 && (
          <p className="muted">No rounds yet. <a href={href.open}>Open the first one.</a></p>
        )}
        {rounds !== null && rounds.length > 0 && (
          <table className="rounds">
            <thead>
              <tr><th scope="col">Airdrop</th><th scope="col">Evidence</th><th scope="col">Pays out</th><th scope="col">Status</th><th scope="col" className="num">Appeals</th></tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <th scope="row"><a href={href.round(r.id)}>{r.title}</a></th>
                  <td>{r.chains.join(", ")}</td>
                  <td>{r.mode === "payout" ? `${amountText(r.reserve, "payout")} reserve` : "Project's own token, via Merkle root"}</td>
                  <td>{status(r, now)}</td>
                  <td className="num">{r.appeal_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
