import type { Appeal, Round } from "../lib/genlayer";
import { gen, short } from "../lib/format";

const CODE_TEXT: Record<string, string> = {
  already_allocated: "The project's record shows this address already received an allocation.",
  min_tx_count: "The address had fewer transactions before the snapshot than this round requires.",
  min_active_months: "The address was active in fewer months than this round requires.",
};

export default function Verdict({ appeal, round }: { appeal: Appeal; round: Round }) {
  const approved = appeal.status === "APPROVED" || (appeal.status === "CLAIMED" && appeal.award > 0n);
  const facts = appeal.evidence?.facts;
  const tier = round.tiers.find((t) => t.id === appeal.tier);
  const reasons = appeal.outcome_kind === "verdict" ? appeal.reasons : [CODE_TEXT[appeal.outcome_code] ?? appeal.outcome_code];

  return (
    <article className={`verdict ${approved ? "is-approved" : "is-rejected"}`} aria-live="polite">
      <div className="verdict-stamp" aria-hidden="true">{approved ? "Recounted: eligible" : "Recounted: not eligible"}</div>
      <h3 className="verdict-title">{approved ? `You qualify for the ${tier?.id ?? appeal.tier} tier` : "Your exclusion stands"}</h3>
      <p className="verdict-lede">
        {approved
          ? `Validators agreed you meet the published rules. Award: ${gen(appeal.award)}${round.total_awarded > round.reserve ? ", paid pro rata if the reserve runs short" : ""}.`
          : "Validators independently re-checked your history and agreed you don't meet the published rules. Your bond went to the reserve."}
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

      {facts && (
        <div className="verdict-block">
          <h4>What validators found before block {round.snapshot_block.toLocaleString("en-US")}</h4>
          <dl className="facts">
            <div><dt>Transactions</dt><dd>{facts.tx_count}{facts.truncated ? "+" : ""}</dd></div>
            <div><dt>Active months</dt><dd>{facts.active_months}</dd></div>
            <div><dt>Active days</dt><dd>{facts.active_days}</dd></div>
            <div><dt>Counterparties</dt><dd>{facts.distinct_counterparties}</dd></div>
            <div><dt>First transaction</dt><dd>{facts.first_tx_date || "None"}</dd></div>
            <div><dt>First funded by</dt><dd>{facts.first_funder ? short(facts.first_funder) : "Nobody"}</dd></div>
          </dl>
        </div>
      )}
    </article>
  );
}
