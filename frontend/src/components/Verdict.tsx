import type { Appeal, Facts, Round } from "../lib/genlayer";
import { amountText, short } from "../lib/format";

const CODE_TEXT: Record<string, string> = {
  already_allocated: "The project's record shows this address already received an allocation.",
  min_tx_count: "The address had fewer transactions before the snapshot than this round requires.",
  min_active_months: "The address was active in fewer months than this round requires.",
};

function FactsGrid({ f }: { f: Facts }) {
  return (
    <dl className="facts">
      <div><dt>Transactions</dt><dd>{f.tx_count}{f.truncated ? "+" : ""}</dd></div>
      <div><dt>Active months</dt><dd>{f.active_months}</dd></div>
      <div><dt>Active days</dt><dd>{f.active_days}</dd></div>
      <div><dt>Counterparties</dt><dd>{f.distinct_counterparties}</dd></div>
      <div><dt>First transaction</dt><dd>{f.first_tx_date || "None"}</dd></div>
      <div><dt>First funded by</dt><dd>{f.first_funder ? short(f.first_funder) : "Nobody"}</dd></div>
    </dl>
  );
}

export default function Verdict({ appeal, round }: { appeal: Appeal; round: Round }) {
  const approved = appeal.status === "APPROVED" || (appeal.status === "CLAIMED" && appeal.award > 0n);
  const facts = appeal.evidence?.facts;
  const hasFacts = facts && "total" in facts;
  const chains = hasFacts ? Object.entries(facts.chains) : [];
  const tier = round.tiers.find((t) => t.id === appeal.tier);
  const reasons = appeal.outcome_kind === "verdict" ? appeal.reasons : [CODE_TEXT[appeal.outcome_code] ?? appeal.outcome_code];

  return (
    <article className={`verdict ${approved ? "is-approved" : "is-rejected"}`} aria-live="polite">
      <div className="verdict-stamp" aria-hidden="true">{approved ? "Recounted: eligible" : "Recounted: not eligible"}</div>
      <h3 className="verdict-title">{approved ? `You qualify for the ${tier?.id ?? appeal.tier} tier` : "Your exclusion stands"}</h3>
      <p className="verdict-lede">
        {approved
          ? round.mode === "payout"
            ? `Validators agreed you meet the published rules. Award: ${amountText(appeal.award, "payout")}${round.total_awarded > round.reserve ? ", paid pro rata if the reserve runs short" : ""}.`
            : `Validators agreed you meet the published rules. Your ${amountText(appeal.award, "registry")} goes into the sealed verdict registry the project pays from.`
          : "Validators independently re-checked your history and agreed you don't meet the published rules. Your bond went to the round."}
      </p>

      {reasons.length > 0 && (
        <div className="verdict-block">
          <h4>Why</h4>
          <ul className="reasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {appeal.evidence && (
        <div className="verdict-block">
          <h4>Why the project excluded you</h4>
          <p className="quote">{appeal.evidence.exclusion.reason || "No reason given."}</p>
        </div>
      )}

      {hasFacts && (
        <div className="verdict-block">
          <h4>What validators found{chains.length > 1 ? ", all chains together" : ""}</h4>
          <FactsGrid f={facts.total} />
        </div>
      )}

      {chains.length > 1 && (
        <details className="verdict-block">
          <summary>Per chain</summary>
          {chains.map(([name, f]) => (
            <div key={name} className="per-chain">
              <h4>{name}</h4>
              <FactsGrid f={f} />
            </div>
          ))}
        </details>
      )}

      {hasFacts && facts.governance && (
        <div className="verdict-block">
          <h4>Governance on Snapshot</h4>
          <dl className="facts">
            <div><dt>Votes</dt><dd>{facts.governance.votes}</dd></div>
            <div><dt>DAOs</dt><dd>{facts.governance.spaces}</dd></div>
            <div><dt>First vote</dt><dd>{facts.governance.first_vote_date || "None"}</dd></div>
            <div><dt>Last vote</dt><dd>{facts.governance.last_vote_date || "None"}</dd></div>
          </dl>
        </div>
      )}
    </article>
  );
}
