import { useState } from "react";
import { parseUnits } from "viem";
import type { Mode, Stage, Wallet } from "../lib/genlayer";
import { explain, getTime, roundCount, write } from "../lib/genlayer";
import { href } from "../lib/route";
import Connect from "../components/Connect";

// Explorers that answered a browser-like User-Agent without an API key (checked 2026-11-26).
const CHAINS = [
  { chain: "ethereum", explorer_api: "https://eth.blockscout.com/api", example: "21000000" },
  { chain: "optimism", explorer_api: "https://explorer.optimism.io/api", example: "128000000" },
  { chain: "arbitrum", explorer_api: "https://arbitrum.blockscout.com/api", example: "280000000" },
  { chain: "base", explorer_api: "https://base.blockscout.com/api", example: "23000000" },
  { chain: "polygon", explorer_api: "https://polygon.blockscout.com/api", example: "65000000" },
  { chain: "zksync", explorer_api: "https://zksync.blockscout.com/api", example: "50000000" },
];
const MAX_SOURCES = 4;
const DAY = 86400;

interface Row { id: string; text: string }
interface TierRow { id: string; amount: string; description: string }

const STAGE_TEXT: Record<Stage, string> = {
  estimating: "Estimating the network fee",
  signing: "Waiting for your signature",
  deciding: "The network is recording your round",
  done: "Checking the result",
};

export default function NewRound({ wallet, onWallet }: { wallet: Wallet | null; onWallet: (w: Wallet | null) => void }) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("registry");
  const [criteria, setCriteria] = useState<Row[]>([{ id: "active", text: "" }]);
  const [tiers, setTiers] = useState<TierRow[]>([{ id: "base", amount: "", description: "" }]);
  const [chains, setChains] = useState<Record<string, string>>({ ethereum: "" });
  const [useGov, setUseGov] = useState(false);
  const [govDate, setGovDate] = useState("");
  const [exclusionUrl, setExclusionUrl] = useState("");
  const [minTx, setMinTx] = useState("1");
  const [minMonths, setMinMonths] = useState("0");
  const [bond, setBond] = useState("0.1");
  const [reserve, setReserve] = useState("");
  const [filingDays, setFilingDays] = useState("14");
  const [decideDays, setDecideDays] = useState("2");
  const [claimDays, setClaimDays] = useState("7");
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = CHAINS.filter((c) => c.chain in chains);

  function toggleChain(chain: string) {
    setChains((prev) => {
      const next = { ...prev };
      if (chain in next) delete next[chain];
      else if (Object.keys(next).length < MAX_SOURCES) next[chain] = "";
      return next;
    });
  }

  function problems(): string[] {
    const p: string[] = [];
    if (!title.trim()) p.push("Give the round a title.");
    if (criteria.some((c) => !c.id.trim() || !c.text.trim())) p.push("Every rule needs a short id and its text.");
    if (new Set(criteria.map((c) => c.id.trim())).size !== criteria.length) p.push("Rule ids must be different.");
    if (tiers.some((t) => !t.id.trim() || !t.description.trim() || !(Number(t.amount) > 0))) p.push("Every tier needs an id, a description and an amount above 0.");
    if (new Set(tiers.map((t) => t.id.trim().toLowerCase())).size !== tiers.length) p.push("Tier ids must be different.");
    if (chosen.length === 0) p.push("Pick at least one chain.");
    if (chosen.some((c) => !(Number(chains[c.chain]) > 0))) p.push("Every chosen chain needs a snapshot block.");
    if (useGov && !govDate) p.push("Pick the cutoff date for governance votes.");
    if (!/^https:\/\/.+\{address\}/.test(exclusionUrl.trim())) p.push("The exclusion record URL must start with https:// and contain {address}.");
    if (mode === "payout" && !(Number(reserve) > 0)) p.push("A payout round needs a reserve above 0.");
    if (!(Number(filingDays) > 0) || !(Number(claimDays) > 0) || Number(decideDays) < 0) p.push("Check the schedule.");
    return p;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    const p = problems();
    if (p.length) { setError(p.join(" ")); return; }
    setError(null);
    try {
      // Schedule from chain time, never the browser clock (Studio ran ~30 min ahead of a local clock).
      const now = await getTime();
      const filingEnds = now + Math.round(Number(filingDays) * DAY);
      const cfg = {
        title: title.trim(),
        mode,
        criteria: criteria.map((c) => ({ id: c.id.trim(), text: c.text.trim() })),
        tiers: tiers.map((t) => ({ id: t.id.trim(), amount: parseUnits(t.amount, 18).toString(), description: t.description.trim() })),
        sources: chosen.map((c) => ({ chain: c.chain, explorer_api: c.explorer_api, snapshot_block: Number(chains[c.chain]) })),
        governance_time: useGov ? Math.floor(Date.parse(`${govDate}T00:00:00Z`) / 1000) : 0,
        exclusion_url: exclusionUrl.trim(),
        max_txs: 500,
        min_tx_count: Number(minTx) || 0,
        min_active_months: Number(minMonths) || 0,
        filing_bond: parseUnits(bond || "0", 18).toString(),
        filing_ends: filingEnds,
        adjudication_ends: filingEnds + Math.round(Number(decideDays) * DAY),
        claim_delay: 3600,
        claims_duration: Math.round(Number(claimDays) * DAY),
      };
      const value = mode === "payout" ? parseUnits(reserve, 18) : 0n;
      const res = await write(wallet, "open_round", [JSON.stringify(cfg)], value, setStage);
      if (!res.ok) { setError(res.error ?? "The round was not opened."); return; }
      const id = await roundCount();
      window.location.hash = href.round(id);
    } catch (err) {
      setError(explain(err));
    } finally {
      setStage(null);
    }
  }

  return (
    <main className="new-round">
      <p className="crumb"><a href={href.home}>All rounds</a></p>
      <h1>Open a round</h1>
      <p className="lede">
        Publish your airdrop's rules once. Excluded wallets appeal, validators judge each case against these rules,
        and nobody, including you, can change them after the round opens.
      </p>

      <form onSubmit={submit} className="round-form">
        <fieldset>
          <legend>The airdrop</legend>
          <label className="field"><span>Title</span>
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Season 1 early users" />
          </label>
          <div className="choices-row" role="radiogroup" aria-label="How approved wallets are paid">
            <label className={`choice ${mode === "registry" ? "is-on" : ""}`}>
              <input type="radio" checked={mode === "registry"} onChange={() => setMode("registry")} />
              <span><strong>Your own token, on your chain.</strong> Approved wallets go into a Merkle root you pay from with a standard distributor.</span>
            </label>
            <label className={`choice ${mode === "payout" ? "is-on" : ""}`}>
              <input type="radio" checked={mode === "payout"} onChange={() => setMode("payout")} />
              <span><strong>A GEN reserve on GenLayer.</strong> You lock it now; approved wallets claim from it, pro rata if it runs short.</span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Rules a wallet can appeal under</legend>
          {criteria.map((c, i) => (
            <div key={i} className="row-2">
              <input aria-label={`Rule ${i + 1} id`} value={c.id} maxLength={32} placeholder="id"
                onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
              <textarea aria-label={`Rule ${i + 1} text`} rows={2} value={c.text} maxLength={600}
                placeholder="Was active on the protocol in at least 3 different months before the snapshot."
                onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              {criteria.length > 1 && <button type="button" className="link" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          {criteria.length < 10 && <button type="button" className="link" onClick={() => setCriteria([...criteria, { id: "", text: "" }])}>Add a rule</button>}
        </fieldset>

        <fieldset>
          <legend>Tiers</legend>
          {tiers.map((t, i) => (
            <div key={i} className="row-3">
              <input aria-label={`Tier ${i + 1} id`} value={t.id} maxLength={32} placeholder="id"
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
              <input aria-label={`Tier ${i + 1} amount`} value={t.amount} inputMode="decimal" placeholder={mode === "payout" ? "GEN" : "tokens"}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <input aria-label={`Tier ${i + 1} description`} value={t.description} maxLength={300} placeholder="Meets one rule."
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              {tiers.length > 1 && <button type="button" className="link" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          {tiers.length < 10 && <button type="button" className="link" onClick={() => setTiers([...tiers, { id: "", amount: "", description: "" }])}>Add a tier</button>}
        </fieldset>

        <fieldset>
          <legend>Evidence validators read</legend>
          <p className="hint">Up to {MAX_SOURCES} chains. Each needs the block your snapshot was taken at: activity after it is ignored.</p>
          <div className="chains">
            {CHAINS.map((c) => (
              <div key={c.chain} className={`chain ${c.chain in chains ? "is-on" : ""}`}>
                <label><input type="checkbox" checked={c.chain in chains} onChange={() => toggleChain(c.chain)}
                  disabled={!(c.chain in chains) && chosen.length >= MAX_SOURCES} /> {c.chain}</label>
                {c.chain in chains && (
                  <input aria-label={`${c.chain} snapshot block`} inputMode="numeric" value={chains[c.chain]} placeholder={`block, e.g. ${c.example}`}
                    onChange={(e) => setChains({ ...chains, [c.chain]: e.target.value.replace(/\D/g, "") })} />
                )}
              </div>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={useGov} onChange={(e) => setUseGov(e.target.checked)} /> Also count Snapshot governance votes cast before</label>
          {useGov && <input type="date" aria-label="Governance cutoff date" value={govDate} onChange={(e) => setGovDate(e.target.value)} />}
          <label className="field"><span>Exclusion record URL</span>
            <input value={exclusionUrl} onChange={(e) => setExclusionUrl(e.target.value)} placeholder="https://your-project.org/airdrop/{address}.json" />
          </label>
          <p className="hint">It must return {"{"}"allocation": "0", "reason": "why this wallet was excluded"{"}"} for any address. A static JSON file per address works.</p>
          <div className="row-2 compact">
            <label className="field"><span>Minimum transactions</span><input inputMode="numeric" value={minTx} onChange={(e) => setMinTx(e.target.value.replace(/\D/g, ""))} /></label>
            <label className="field"><span>Minimum active months</span><input inputMode="numeric" value={minMonths} onChange={(e) => setMinMonths(e.target.value.replace(/\D/g, ""))} /></label>
          </div>
          <p className="hint">Wallets below these minimums are rejected by code before any model is asked, which keeps the cost down.</p>
        </fieldset>

        <fieldset>
          <legend>Money and time</legend>
          <div className="row-2 compact">
            <label className="field"><span>Appeal bond (GEN)</span><input inputMode="decimal" value={bond} onChange={(e) => setBond(e.target.value)} /></label>
            {mode === "payout" && <label className="field"><span>Reserve (GEN)</span><input inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} /></label>}
          </div>
          <div className="row-3 compact">
            <label className="field"><span>Filing, days</span><input inputMode="decimal" value={filingDays} onChange={(e) => setFilingDays(e.target.value)} /></label>
            <label className="field"><span>Then deciding, days</span><input inputMode="decimal" value={decideDays} onChange={(e) => setDecideDays(e.target.value)} /></label>
            <label className="field"><span>Claims, days</span><input inputMode="decimal" value={claimDays} onChange={(e) => setClaimDays(e.target.value)} /></label>
          </div>
          <p className="hint">Claims open one hour after decisions close, so late verdicts can finalize first.</p>
        </fieldset>

        {!wallet ? (
          <Connect onWallet={onWallet} why="Connect the wallet that will own this round. Opening it is a transaction with a network fee." />
        ) : (
          <button className="btn btn-primary" type="submit" disabled={stage !== null}>
            {mode === "payout" ? `Open round and lock ${reserve || "0"} GEN` : "Open round"}
          </button>
        )}
        {stage && <p className="progress" role="status"><span className="spinner" aria-hidden="true" />{STAGE_TEXT[stage]}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
