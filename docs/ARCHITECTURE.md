# Recount: architecture

The engineering design for v1. The reasoning behind each choice is in [REVIEW.md](REVIEW.md). Diagrams are Mermaid, so they render on GitHub.

---

## 1. System context

```mermaid
flowchart LR
    subgraph Off-chain
        P[Project team]
        C[Claimant wallet]
        FE[Frontend<br/>genlayer-js 2.x<br/><i>non-authoritative preview</i>]
    end

    subgraph GenLayer["GenLayer (Studio v0.123 / Bradbury)"]
        R[[Recount contract<br/>GenVM v0.4]]
        V1((Validator))
        V2((Validator))
        V3((Validator))
    end

    subgraph Sources["External sources (fixed per round)"]
        X[(Block explorer API<br/>eth.blockscout.com<br/>txs ≤ snapshot block)]
        E[(Exclusion record<br/>project endpoint<br/>allocation + flag reason)]
    end

    P -- open_round / fund_round / close_round --> R
    C -- file_appeal / claim --> R
    FE -.reads views.-> R
    C --- FE
    R -- adjudicate: nondet block --> V1 & V2 & V3
    V1 & V2 & V3 -- fetch --> X
    V1 & V2 & V3 -- fetch --> E
```

## 2. Round lifecycle (time)

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d
    title Round timeline (example)
    section Project
    open_round (config frozen, reserve in)     :milestone, m1, 2026-12-01, 0d
    fund_round allowed (top-up only)           :a1, 2026-12-01, 21d
    section Claimants
    Filing window (file_appeal)                :a2, 2026-12-01, 14d
    Adjudication (adjudicate, anyone)          :a3, 2026-12-01, 21d
    Claim delay (finality buffer)              :crit, a4, 2026-12-22, 2d
    Claims (claim / withdraw_unjudged)         :a5, 2026-12-24, 14d
    section Project
    close_round (withdraw remainder)           :milestone, m2, 2027-01-07, 0d
```

The timestamps are enforced in contract code with the transaction time from `gl.message.raw["datetime"]`. Do not use `gl.vm.get_timestamp()`: the Studio v0.123 host rejects it (`SystemError: 2: inval`). Clients must schedule rounds from the contract's `get_time()` view, never from their own clock: on 2026-11-25 Studio was about 30 minutes ahead of a local clock.

```
created ≤ filing_ends ≤ adjudication_ends
claims_start = adjudication_ends + claim_delay     (claim_delay ≥ MIN_CLAIM_DELAY)
claims_start < claims_end
```

## 3. Appeal state machine

```mermaid
stateDiagram-v2
    [*] --> FILED: file_appeal (bond in)
    FILED --> FILED: adjudicate fails [TRANSIENT] / UNDETERMINED → retry
    FILED --> APPROVED: adjudicate → approved (award = tier amount)
    FILED --> REJECTED: adjudicate → rejected / invalid (bond → reserve)
    FILED --> REFUNDED: withdraw_unjudged (after adjudication_ends)
    APPROVED --> CLAIMED: claim (after claims_start, before claims_end)
    APPROVED --> EXPIRED: claims_end passes (award stays in round)
    REJECTED --> [*]
    REFUNDED --> [*]
    CLAIMED --> [*]
    EXPIRED --> [*]
```

## 4. Adjudication sequence (the consensus path)

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Anyone (usually claimant)
    participant R as Recount (deterministic)
    participant L as Leader (nondet)
    participant V as Validators (nondet)
    participant E as Exclusion record
    participant X as Explorer API
    participant M as LLM

    Caller->>R: adjudicate(appeal_id) + fees
    R->>R: checks [EXPECTED]: status FILED, now ≤ adjudication_ends
    R->>L: gl.vm.run_nondet(leader_fn, validator_fn)
    L->>E: GET exclusion_url(address)
    E-->>L: {allocation, reason}
    alt allocation > 0
        L-->>R: outcome = invalid ("already allocated")
    else excluded
        L->>X: GET txlist(address, endblock = snapshot, offset = max_txs)
        X-->>L: txs
        L->>L: compute facts (pure code)
        alt hard pre-gate fails
            L-->>R: outcome = rejected (no LLM)
        else
            L->>M: criteria + tiers + facts + reason + "statement" (quoted)
            M-->>L: {approved, tier, criterion_id, reasons}
            L-->>R: outcome = verdict
        end
    end
    R->>V: leader result
    V->>E: re-fetch independently
    V->>X: re-fetch independently
    V->>V: recompute facts and gate, then compare exactly
    V->>M: re-judge independently
    V-->>R: agree iff same kind, same facts, same approved (+ same tier if approved)
    R->>R: store verdict, update ledger
```

## 5. Validator decision (equivalence rule)

```mermaid
flowchart TD
    A[Leader result] --> B{Leader returned<br/>or errored?}
    B -- errored --> C[Run own pipeline]
    C --> C1{Own result}
    C1 -- succeeded --> NO[Disagree]
    C1 -- "[EXPECTED] / [EXTERNAL]" --> C2{Same message?}
    C2 -- yes --> YES[Agree]
    C2 -- no --> NO
    C1 -- "[TRANSIENT] and leader [TRANSIENT]" --> YES
    C1 -- "[LLM_ERROR] / other" --> NO
    B -- returned --> D[Recompute exclusion record + facts + gate]
    D --> E{exclusion and facts<br/>equal?}
    E -- no --> NO
    E -- yes --> F{Same outcome kind?}
    F -- no --> NO
    F -- "yes: invalid / rejected" --> G{Same reason code?}
    G -- yes --> YES
    G -- no --> NO
    F -- "yes: verdict" --> H[Re-judge with LLM]
    H --> I{Same approved?}
    I -- no --> NO
    I -- "yes, both false" --> YES
    I -- "yes, both true" --> J{Same tier?}
    J -- yes --> YES
    J -- no --> NO
```

## 6. Money flow (per round ledger)

```mermaid
flowchart LR
    P[Project] -- "open_round / fund_round (value)" --> RES[(round.reserve)]
    C[Claimant] -- "file_appeal (bond)" --> BH[(round.bonds_held)]
    BH -- "rejected: bond forfeited" --> RES
    BH -- "approved: refunded on claim" --> C
    BH -- "withdraw_unjudged" --> C
    RES -- "claim: award × min(1, reserve ÷ total_awarded)" --> C
    RES -- "close_round: reserve − paid" --> P
```

Invariants, checked in direct tests:

- `paid_out ≤ reserve` at all times.
- After `adjudication_ends`, `reserve` and `total_awarded` never change. Claims depend only on those two numbers, so payouts are order-independent.
- `payout(a) = award(a)` if `reserve ≥ total_awarded`, otherwise `award(a) × reserve // total_awarded`.
- Contract-wide: the sum over all rounds of `reserve + bonds_held − paid_out − withdrawn` equals the contract's balance (ignoring fees, which are not paid from the balance).

## 7. Storage layout

All storage fields are class-level annotations. Dataclasses use `@gl.storage.allow`, and new fields are only ever appended at the end.

```mermaid
classDiagram
    class Recount {
        TreeMap~u256, Round~ rounds
        TreeMap~u256, Appeal~ appeals
        TreeMap~str, u256~ appeal_of
        TreeMap~u256, DynArray~ round_appeals
        u256 next_round_id
        u256 next_appeal_id
    }
    class Round {
        Address project
        str title
        str criteria_json
        str tiers_json
        str explorer_api
        u256 snapshot_block
        str exclusion_url
        u256 max_txs
        u256 min_tx_count
        u256 min_active_months
        u256 filing_bond
        u256 filing_ends
        u256 adjudication_ends
        u256 claims_start
        u256 claims_end
        u256 reserve
        u256 bonds_held
        u256 total_awarded
        u256 paid_out
        bool closed
    }
    class Appeal {
        u256 round_id
        Address claimant
        str criterion_id
        str statement
        u256 bond
        str status
        str outcome_kind
        str tier
        u256 award
        str facts_json
        str reasons_json
        u256 filed_at
    }
    Recount "1" --> "*" Round
    Recount "1" --> "*" Appeal
    Round "1" --> "*" Appeal
```

Key formats: `appeal_of` keys are `"<round_id>:<address lowercase>"`; `criteria_json` is `[{id, text}]`; `tiers_json` is `[{id, amount, description}]` (amount in atto); `Appeal.status` ∈ `FILED APPROVED REJECTED REFUNDED CLAIMED`; `outcome_kind` ∈ `invalid rejected verdict`.

## 8. Public interface

| Method | Kind | Who | Effect |
|---|---|---|---|
| `open_round(config_json)` | `write.payable` | project | Validate and freeze the config; reserve = value sent |
| `fund_round(round_id)` | `write.payable` | anyone | Top up the reserve before `adjudication_ends` |
| `file_appeal(round_id, criterion_id, statement)` | `write.payable` | claimant | Value must equal `filing_bond`; one appeal per address per round |
| `adjudicate(appeal_id)` | `write` | anyone | Consensus verdict (§4) |
| `claim(appeal_id)` | `write` | claimant | Pro-rata award plus bond refund via `emit_transfer` |
| `withdraw_unjudged(appeal_id)` | `write` | claimant | Bond refund for an appeal that was never judged |
| `close_round(round_id)` | `write` | project | After `claims_end`: transfer the remainder to the project |
| `get_time()` | `view` | — | Chain time (unix seconds); use it to schedule rounds |
| `get_round(round_id)` | `view` | — | Config, ledger and phase |
| `get_appeal(appeal_id)` | `view` | — | Status, verdict, facts, reasons |
| `get_appeal_of(round_id, address)` | `view` | — | The appeal id for an address, or none |
| `list_appeals(round_id, offset, limit)` | `view` | — | Paged list of appeal ids |
| `preview_payout(appeal_id)` | `view` | — | What `claim` would pay right now |

## 9. Facts schema (exact-compared)

Computed from at most `max_txs` transactions with `blockNumber ≤ snapshot_block`. The explorer request is `module=account&action=txlist&startblock=0&endblock=<snapshot>&page=1&offset=<max_txs>&sort=asc`.

```json
{
  "tx_count": 42,
  "truncated": false,
  "outgoing_count": 30,
  "incoming_count": 12,
  "failed_count": 1,
  "first_tx_date": "2024-03-02",
  "last_tx_date": "2025-11-30",
  "active_months": 14,
  "active_days": 37,
  "distinct_counterparties": 19,
  "first_funder": "0xabc…",
  "contract_creations": 0
}
```

The facts are serialized with `json.dumps(sort_keys=True)` before comparison. Addresses are lowercase, and dates are UTC `YYYY-MM-DD`.

## 10. Error taxonomy

| Prefix | Raised when | Validator rule |
|---|---|---|
| `[EXPECTED]` | Bad phase or caller, wrong bond, duplicate appeal, unknown round or appeal, invalid config | Exact message match |
| `[EXTERNAL]` | Source returned 400/404/410, or malformed JSON from a source | Exact message match |
| `[TRANSIENT]` | 401/403/408/429/5xx, redirects, explorer `NOTOK` | Agree only if both are transient; the transaction fails and the appeal stays `FILED`, so it can be retried |
| `[LLM_ERROR]` | Non-dict output, missing `approved`, unknown tier | Always disagree, which forces rotation |

## 11. Fees

Every call carries fees (Consensus v0.6). Estimate them first:

- JS: `client.estimateTransactionFees(...)`
- Python: `client.estimate_transaction_fees(...)`
- CLI: `genlayer estimate-fees <addr> <method> --args … --json`

Then pass the result as `fees: {distribution, feeValue}` (or `--fees`). `claim`, `withdraw_unjudged` and `close_round` emit an external value message, so their estimates need a message-fee budget. The integration test suite will produce `fee-profile.json` with `gltest --fee-profile`, covering every transfer branch.

A transaction counts as successful only when its status is `ACCEPTED`/`FINALIZED` **and** its execution result is `FINISHED_WITH_RETURN`. Tests assert this with `tx_execution_succeeded`.

## 12. Repository layout

```
Recount/
├── README.md
├── docs/
│   ├── REVIEW.md
│   └── ARCHITECTURE.md
├── contracts/
│   └── recount.py                # single file, v0.4 header
├── fixtures/                     # mock explorer + exclusion JSON for tests and demo
├── tests/
│   ├── direct/                   # genlayer-test 0.30 direct mode
│   └── integration/              # gltest on studionet (needs fees)
├── gltest.config.yaml
├── requirements.txt
└── .gitignore
```
