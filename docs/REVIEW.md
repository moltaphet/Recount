# Recount — design review

A critical pass over the idea in the README before any code: does it need GenLayer, what breaks, and what changes as a result. Decisions marked **→ Decision** are carried into [ARCHITECTURE.md](ARCHITECTURE.md) and the contract.

Reviewed against the `genlayer-dev` 1.2.0 skills (`write-contract`, `genvm-lint`, `direct-tests`, `integration-tests`, `genlayer-cli`) and the v0.4 runner source (`py-genlayer:kzybg95x…`, genvm-manager v0.6.0-rc17 cache).

---

## 1. Does this need GenLayer?

The skill's test: *"the contract must coordinate or settle around a subjective, external, or AI-mediated judgment that multiple validators should verify independently."*

| Question | Answer |
|---|---|
| Is there a judgment a deterministic contract cannot make? | **Yes.** The criteria are natural language ("a real user, not a farming cluster") and must be applied against the project's own flag reason and the claimant's explanation. |
| Is the judgment tied to an on-chain effect? | **Yes.** An approval moves money out of a reserve; a rejection forfeits a bond. |
| Would a backend do as well? | **No.** The backend would be the project, judging its own refusals, which is exactly the trust problem. |
| Is any part of it deterministic and better kept out of the LLM? | **Yes.** On-chain activity facts (tx count, first tx date, active months, first funder) are pure data. → **Decision:** extract them deterministically and compare them exactly. The LLM only interprets them against the criteria. |

**Honest limit:** if a project's criteria are purely numeric ("≥ 5 txs before block N"), Recount degenerates into a deterministic checker. That still works (the pre-gate in §4 handles it without any LLM call), but the product's value is in the criteria that need interpretation. We say so in the README.

## 2. Boundary (skill-mandated)

| Owner | Responsibilities |
|---|---|
| **Frontend / backend** | Wallet connect, appeal form, non-authoritative "eligibility preview", indexing verdicts, round dashboards. |
| **Recount contract** | Frozen round config, reserve and bond custody, the verdict, the pro-rata payout, the claim, and the refund paths. |
| **External sources** | (a) a block explorer API, which provides raw transactions up to a fixed snapshot block; (b) the project's **exclusion record** endpoint, which provides proof that the address got 0 and the reason it was flagged. Both are trusted only as far as validators can re-fetch and normalize them. |

One-line flow, in the form the skill asks for:
**user action** (`file_appeal`) → **evidence** (explorer txs ≤ snapshot block, plus the exclusion record) → **nondet call** (`adjudicate`) → **equivalence principle** (exact facts, plus exact `approved`/`tier`) → **state update** (verdict, award, reserve) → **settlement** (`claim` after the finality buffer).

## 3. Problems found in the README draft, and fixes

### 3.1 First-come-first-served payouts are unfair
In the draft, approved appeals were paid immediately. A reserve that runs out on day 2 would leave equally valid claims filed on day 5 with nothing.
→ **Decision:**
- Two phases. Verdicts accrue during the round; **payouts happen only after `adjudication_ends`**.
- If the reserve covers the total approved, everyone is paid in full. Otherwise everyone is paid **pro rata**: `award × reserve ÷ total_awarded`, using integer atto maths, with the remainder returned to the project.

### 3.2 Paying before the verdict is final
GenLayer decisions can be appealed until they finalize, so paying the instant a verdict is stored risks paying on a verdict that gets overturned.
→ **Decision:**
- Claims open only at `claims_start = adjudication_ends + claim_delay`, where `claim_delay` has a floor in the contract. This gives late `adjudicate` transactions time to finalize before money moves.
- Value transfers (`Account.emit_transfer`) apply only on finalization anyway (per the runner source), so the buffer is about the *verdict*, not the transfer.

### 3.3 Nothing proved the claimant was actually excluded
Without this check, an eligible address could also "appeal" and get paid twice.
→ **Decision:**
- Each round declares an `exclusion_url` template with `{address}` in it. It must return JSON of the form `{"allocation": "<atto>", "reason": "<text>"}`.
- Validators fetch it. An allocation above 0 is rejected as `already allocated`.
- The `reason` (why the project's filter flagged the address) is the main thing the claimant argues against, and it goes to the LLM as input.

### 3.4 Claimant-supplied evidence URLs are an injection and forgery vector
If the claimant chooses the URLs, they can point validators at pages they wrote.
→ **Decision:**
- In v1 the claimant supplies **no URLs**. Evidence comes only from sources the project fixed at round creation (the explorer and the exclusion record), queried for the claimant's own address.
- The claimant's free text (`statement`, capped at 1,000 chars) is passed to the LLM **as quoted, untrusted data**.
- Any additional evidence types (GitHub, forums) are post-MVP and need an allow-list per round.

### 3.5 An appeal could be filed for someone else's wallet
→ **Decision:** the claimant is `gl.message.sender_address`. You can only appeal for the address you sign with.

### 3.6 "4xx is deterministic" is wrong for explorers
The skill classifies 4xx as `[EXTERNAL]` (deterministic, exact match), but we measured something different on 2026-11-25:

| Host | Result |
|---|---|
| `eth.blockscout.com` | 200 |
| `base.blockscout.com` | 403 |
| `arbitrum.blockscout.com` | 403 |
| `optimism.blockscout.com` | 301 |

All of these were the same request, from the same machine. 403 here is bot protection, which can differ from validator to validator.
→ **Decision:**
- `400/404/410` → `[EXTERNAL]` (deterministic, comparable).
- `401/403/408/429/5xx` and redirects → `[TRANSIENT]`. Validators agree to fail the transaction so it can be retried, and nobody gets rejected because of a CDN.
- The round's explorer is chosen by the project, and v1 targets `eth.blockscout.com`, which responded cleanly.

### 3.7 Unbounded explorer responses hit compute limits
→ **Decision:**
- Query with `sort=asc`, `page=1` and `offset=max_txs` (≤ 1,000, set per round). The facts include `truncated: bool`.
- Criteria about "more than N txs" still work for N < `max_txs`.

### 3.8 Non-deterministic data must not reach the comparison
→ **Decision:**
- The explorer is queried with `endblock = snapshot_block`. History up to a past block is immutable, so leader and validators see the same transactions.
- We normalize to a facts dict (sorted keys, lowercase addresses, dates as `YYYY-MM-DD`, months as `YYYY-MM`) and compare it **exactly**.
- Nothing time-varying ("current balance", "latest tx") is ever used.

### 3.9 Appeals that nobody adjudicates
If the claimant never pays for `adjudicate` and nobody else does either, the bond must not be locked forever.
→ **Decision:** after `adjudication_ends`, an appeal still in `FILED` can be refunded with `withdraw_unjudged`.

### 3.10 Project rug and abandonment
→ **Decision:**
- The config is immutable from `open_round`, not just "frozen at the first appeal". That is simpler and stronger.
- The reserve can only be topped up (`fund_round`, before `adjudication_ends`), never reduced.
- `close_round` (by the project, after `claims_end`) withdraws the remainder: unspent reserve, rounding dust, and unclaimed awards.

## 4. Consensus design (final)

The whole verdict runs as one `gl.vm.run_nondet(leader_fn, validator_fn)`:

1. **Exclusion record.** Fetch it and parse `allocation` and `reason`. An allocation above 0 ends the run with `invalid: already allocated`.
2. **Explorer facts.** Fetch the transaction list and compute `facts`. This is pure code, with no LLM involved.
3. **Hard pre-gate (deterministic).** Rounds can set `min_tx_count` and `min_active_months`. If a minimum is not met, the outcome is `rejected` and no LLM is called.
4. **LLM judgment.** The prompt contains the frozen criteria and tiers, the `facts`, the `reason`, and the quoted `statement`. It returns `{approved, tier, criterion_id, reasons}`.

The validator recomputes 1–3 **independently** and requires:

- the exclusion record (`allocation`, `reason`) to be equal;
- `facts` to be equal (exact dict equality);
- the same outcome kind (`invalid` / `rejected` / `verdict`);
- for `verdict`: it reruns the LLM and requires the same `approved`; when approved, also the same `tier`. `reasons` and `criterion_id` are not compared.

Error comparison uses the canonical handler from the skill, with the §3.6 status mapping. `[LLM_ERROR]` (non-JSON output, an unknown tier, a missing `approved`) always means disagreement, which forces rotation.

**Why not `prompt_comparative`?** The skill prefers a custom validator, and we need exact equality on the data layer plus exact equality on two decision fields. A free-form LLM comparison would be weaker on both.

## 5. Abuse analysis

| Attack | Mitigation |
|---|---|
| Spam appeals | Filing bond, forfeited to the reserve on rejection. The caller of `adjudicate` also pays the GenLayer fees. |
| Prompt injection in `statement` | Quoted as untrusted data, length cap, and the instruction to ignore embedded instructions. Validators re-judge independently, so an injection has to fool every validator, not one. |
| Forged evidence | Only round-fixed sources, queried for the sender's own address. |
| Double dipping (eligible address appeals) | The exclusion record must show an allocation of 0. |
| Same claimant, many appeals | One appeal per `(round, address)`, ever. |
| Sybil farm files thousands of appeals | Every one costs a bond plus adjudication fees, and is judged against the same flag reason that caught it. Recount does not make sybils cheaper. |
| Project withdraws the reserve | Impossible before `claims_end`. |
| Project changes the rules after seeing appeals | The config is immutable. |
| Last-minute adjudication followed by an appeal flip | `claim_delay` buffer before claims open. |
| Explorer outage makes everyone get rejected | Outages are `[TRANSIENT]`, never a rejection. |

## 6. Economics and fees

- Consensus v0.6: every `open_round`, `fund_round`, `file_appeal`, `adjudicate`, `claim`, `withdraw_unjudged` and `close_round` carries fees estimated with `estimateTransactionFees` / `estimate_transaction_fees` / `genlayer estimate-fees`.
- `adjudicate` is the expensive call: 2 web fetches and 1 LLM call per validator.
- `claim`, `withdraw_unjudged` and `close_round` call `gl.chain.Account(...).emit_transfer`, which the runner documents as an **external message whose fee comes from the external allocation pool**. Their fee profile must include message fees, and the integration tests must cover every branch that transfers.
- A `fee-profile.json` generated with `gltest --fee-profile` gets committed once the integration tests exist.

## 7. Product and strategy risks

| Risk | Note |
|---|---|
| Airdrops are ERC-20s on other chains, but the v1 reserve is GEN | v1 is a working demo of the full loop on GenLayer. v2 makes Recount a **verdict registry** that an EVM distributor reads (bridge or attestation), so the reserve can live where the token lives. |
| Projects must publish an exclusion endpoint | This is the price of entry, and it is cheap: a static JSON per address (for example on GitHub Pages) is enough. The demo ships one. |
| Explorer coverage per chain | v1: Ethereum via `eth.blockscout.com`. Other chains need an explorer that validators can actually reach (§3.6). |
| Legal and region filters (KYC, sanctions) | Out of scope. Rounds should only use criteria that can be checked from public on-chain data. |

## 8. What v1 is

- **In:**
  - one contract, `contracts/recount.py` (single file, v0.4 header);
  - rounds, appeals, adjudication, pro-rata claims, refunds, close;
  - direct tests for all deterministic logic, plus validator replay;
  - lint;
  - a free Studio dry-run.
- **Next:**
  - integration tests on Studio, which need a GenLayer account (0 GEN is fine on studionet, but each transaction carries fees);
  - `fee-profile.json`;
  - a frontend with genlayer-js.
- **Out (v2):**
  - extra evidence types;
  - multi-chain explorers;
  - EVM distributor integration.
