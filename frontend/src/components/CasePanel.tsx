import { useState } from "react";
import type { Appeal, Round, Stage, Wallet } from "../lib/genlayer";
import { addTestGen, connectMetaMask, explain, hasInjectedWallet, openTemporaryAccount, write } from "../lib/genlayer";
import { gen, phaseOf, short, until } from "../lib/format";
import Verdict from "./Verdict";

const STAGE_TEXT: Record<Stage, string> = {
  estimating: "Estimating the network fee",
  signing: "Waiting for your signature",
  deciding: "Validators are deciding",
  done: "Checking the result",
};

interface Props {
  round: Round;
  now: number;
  wallet: Wallet | null;
  balance: bigint | null;
  appeal: Appeal | null;
  payout: bigint | null;
  onWallet: (w: Wallet | null) => void;
  onChanged: () => Promise<void>;
  onJudging: (judging: boolean) => void;
}

export default function CasePanel({ round, now, wallet, balance, appeal, payout, onWallet, onChanged, onJudging }: Props) {
  const [criterion, setCriterion] = useState(round.criteria[0]?.id ?? "");
  const [statement, setStatement] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const phase = phaseOf(round, now);
  const busy = stage !== null;

  async function run(label: string, fn: string, args: unknown[], value = 0n, judging = false) {
    if (!wallet) return;
    setError(null);
    setNotice(null);
    if (judging) onJudging(true);
    try {
      const res = await write(wallet, fn, args, value, setStage);
      if (!res.ok) setError(res.error ?? "The transaction failed.");
      else setNotice(label);
      await onChanged();
    } catch (e) {
      setError(explain(e));
    } finally {
      setStage(null);
      if (judging) onJudging(false);
    }
  }

  async function fund() {
    if (!wallet) return;
    setError(null);
    try {
      await addTestGen(wallet.address);
      await onChanged();
      setNotice("Added 2 test GEN to your account.");
    } catch (e) {
      setError(explain(e));
    }
  }

  async function connect(kind: "metamask" | "temporary") {
    setError(null);
    try {
      onWallet(kind === "metamask" ? await connectMetaMask() : openTemporaryAccount());
    } catch (e) {
      setError(explain(e));
    }
  }

  const needsGen = balance !== null && balance < round.filing_bond + round.filing_bond; // bond plus fee headroom

  return (
    <aside className="case" id="case" aria-labelledby="case-title">
      <h2 id="case-title">Your case</h2>

      {!wallet && (
        <div className="case-body">
          <p>Connect the wallet that was excluded. Validators read its real Ethereum history, so use the address you want recounted.</p>
          <div className="stack">
            <button className="btn btn-primary" onClick={() => connect("metamask")} disabled={!hasInjectedWallet()}>
              Connect MetaMask
            </button>
            <button className="btn" onClick={() => connect("temporary")}>Try with a temporary account</button>
          </div>
          {!hasInjectedWallet() && <p className="hint">No browser wallet detected. A temporary account works for trying the flow; it has no Ethereum history, so it will be found not eligible.</p>}
        </div>
      )}

      {wallet && (
        <div className="case-body">
          <div className="who">
            <span className={`dot dot-${wallet.kind}`} aria-hidden="true" />
            <span>{wallet.kind === "metamask" ? "MetaMask" : "Temporary account"} {short(wallet.address)}</span>
            <button className="link" onClick={() => onWallet(null)}>Disconnect</button>
          </div>
          {balance !== null && (
            <p className="balance">
              Balance on studionet: <strong>{gen(balance, 3)}</strong>
              {needsGen && <> <button className="link" onClick={fund}>Add test GEN</button></>}
            </p>
          )}

          {!appeal && phase === "filing" && (
            <form className="file" onSubmit={(e) => { e.preventDefault(); run("Appeal filed. Ask validators to decide when you're ready.", "file_appeal", [round.id, criterion, statement], round.filing_bond); }}>
              <fieldset>
                <legend>Which rule do you meet?</legend>
                {round.criteria.map((c) => (
                  <label key={c.id} className={`choice ${criterion === c.id ? "is-on" : ""}`}>
                    <input type="radio" name="criterion" value={c.id} checked={criterion === c.id} onChange={() => setCriterion(c.id)} />
                    <span>{c.text}</span>
                  </label>
                ))}
              </fieldset>
              <label className="field">
                <span>Your explanation <em>{statement.length}/1000</em></span>
                <textarea maxLength={1000} rows={5} value={statement} onChange={(e) => setStatement(e.target.value)}
                  placeholder="For example: I bridged in 2023 and used the protocol every month. My first funds came from a centralized exchange, not a farming wallet." />
              </label>
              <p className="hint">Filing locks a {gen(round.filing_bond)} bond. You get it back if you qualify or if nobody decides your case in time. If validators find you not eligible, it goes to the reserve.</p>
              <button className="btn btn-primary" type="submit" disabled={busy || needsGen}>File appeal</button>
            </form>
          )}

          {!appeal && phase !== "filing" && <p>Filing for this round has closed. You can still follow the docket below.</p>}

          {appeal?.status === "FILED" && (
            <div className="pending">
              <p className="state">Appeal #{appeal.id} is filed and waiting for a decision.</p>
              <p>Five validators will each fetch the project's exclusion record and your history up to the snapshot, then judge it against the rules. The verdict stands only if they agree.</p>
              {phase === "filing" || phase === "deciding" ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => run("Validators reached a verdict.", "adjudicate", [appeal.id], 0n, true)}>
                  Ask validators to decide
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => run("Your bond was returned.", "withdraw_unjudged", [appeal.id])}>
                  Take back your bond
                </button>
              )}
            </div>
          )}

          {appeal && appeal.status !== "FILED" && appeal.evidence && <Verdict appeal={appeal} round={round} />}

          {appeal?.status === "APPROVED" && (
            <div className="claim">
              {phase === "claims" ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => run("Paid. The award and your bond are on their way.", "claim", [appeal.id])}>
                  Claim {payout !== null ? gen(payout + appeal.bond) : "award"}
                </button>
              ) : (
                <p className="hint">Claims open in {until(round.claims_start, now)}. Payouts wait until every case is decided, so the reserve is split fairly.</p>
              )}
            </div>
          )}
          {appeal?.status === "CLAIMED" && <p className="state">Claimed {gen(appeal.payout + appeal.bond)}.</p>}
          {appeal?.status === "REFUNDED" && <p className="state">Your bond was returned.</p>}
        </div>
      )}

      {stage && (
        <div className="progress" role="status">
          <span className="spinner" aria-hidden="true" />
          {STAGE_TEXT[stage]}
          {stage === "deciding" && <small>Each validator fetches the evidence and asks its model on its own. This usually takes one to two minutes.</small>}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && !error && <p className="notice" role="status">{notice}</p>}
    </aside>
  );
}
