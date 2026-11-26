# Recount

**An appeals court for airdrops.** Wrongly flagged as a sybil? File your case with public evidence. GenLayer validators re-read the project's own published criteria, check your evidence independently, and pay approved claims from a reserve the project locked up front.

> Project 1 of 6 · GenLayer Intelligent Contract · GenVM v0.4 · Studio v0.123+

> **Design refined after review.** The authoritative design is now in [docs/REVIEW.md](docs/REVIEW.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The main changes from the original sketch below:
> - payouts happen only after the adjudication window, pro rata if the reserve is oversubscribed;
> - a per-round **exclusion record** proves the address really got 0 and gives the flag reason;
> - claimants supply **no URLs**: evidence comes only from sources the project fixed at round creation, plus a quoted statement;
> - 403/429/5xx count as transient errors, never as a rejection;
> - on-chain facts up to a fixed snapshot block are compared exactly, and the LLM only interprets them.
>
> **Status:**
> - `contracts/recount.py` passes `genvm-lint` (only the E014 false positive the skill documents);
> - 44 direct tests pass;
> - the Studio dry-run passes (schema and constructor);
> - studionet integration tests pass:
>   - deploy, `open_round` and `file_appeal`, all with Consensus v0.6 fees;
>   - a duplicate appeal that fails on-chain with state unchanged;
>   - `adjudicate` with real validator consensus: live web fetches and an LLM judge, which rejected a no-history claimant despite a prompt-injection attempt in the statement.
> - Next: `fee-profile.json` and a genlayer-js frontend.
>
> ```bash
> GENVM_VERSION=v0.6.0-rc14 python -m pytest tests/direct
> RECOUNT_EXCLUSION_URL='https://raw.githubusercontent.com/moltaphet/Recount/main/fixtures/exclusion.json?a={address}' \
>   gltest tests/integration -v -s --network studionet
> ```

---

## The problem

Every large airdrop ships with a sybil filter, and every sybil filter has false positives. Real users get excluded with no explanation, no process, and no one to talk to. What happens next is always the same: angry threads, a Google Form nobody reads, a few loud accounts get quietly "fixed" in DMs, and everyone else is ignored. Projects lose goodwill at the exact moment they are trying to build community.

Projects do not refuse appeals because they are evil. They refuse because reviewing thousands of claims by hand is expensive, slow, and looks biased whichever way it goes.

## The idea

The project publishes its eligibility criteria in plain English and locks a **reserve pool** in a Recount contract. An excluded user files an **appeal**: their address, the criterion they believe they meet, and links to public evidence (explorer pages, a public API for their on-chain activity, governance votes, GitHub contributions, and so on).

The contract asks GenLayer validators to judge the appeal **against the project's own published rules**. Each validator fetches the evidence itself and decides independently. If the appeal is approved, the user receives the allocation for their tier from the reserve. Every decision, with its reasoning, stays on-chain and can be appealed.

The project keeps control of the rules. Recount only makes applying them transparent and cheap.

## Actors

| Actor | Role |
|---|---|
| **Project** | Creates a round: criteria text, tier table, reserve deposit, appeal window, filing bond |
| **Claimant** | Files an appeal with evidence links and posts a small filing bond (anti-spam) |
| **Validators** | Fetch the evidence, judge it against the criteria, agree on the verdict |
| **Anyone** | Can read every decision; can fund the reserve; can appeal a decision through GenLayer's appeal flow |

## How it works

1. **Open a round.** `open_round(criteria, tiers, window_end, filing_bond)` is payable, so the project deposits the reserve with the call. The criteria text and tier table are frozen once the first appeal is filed.
2. **File an appeal.** `file_appeal(round_id, criterion_id, evidence_urls, statement)` is payable and carries the filing bond. One open appeal per address per round.
3. **Adjudicate.** `adjudicate(appeal_id)` runs the nondeterministic block:
   - fetch every evidence URL (`gl.nondet.web.get` for APIs, `gl.nondet.web.render(mode="text")` for pages);
   - extract **stable facts only**: first transaction date, number of active months, contract interactions in the allowed set, and so on. Never include follower counts, "last seen" fields, or other values that change between validators;
   - ask the LLM to apply the frozen criterion to those facts and return `{"approved": bool, "tier": str, "reasons": [str]}`.
4. **Settle.**
   - Approved: the tier's allocation is sent from the reserve with `gl.chain.Account(claimant).emit_transfer(amount)` and the bond is refunded.
   - Rejected: the bond goes to the reserve.
   - Every verdict is stored with its reasons.
5. **Close.** After `window_end`, the project can withdraw what is left of the reserve.

## Why GenLayer (the boundary)

| Owner | Responsibilities |
|---|---|
| **Frontend / backend** | Wallet connect, evidence form, preview ("you look eligible for tier B"), indexing verdicts for a leaderboard. The preview is **not authoritative.** |
| **Recount contract** | Frozen criteria, reserve custody, the verdict, the payout, the appeal path |
| **External sources** | Raw on-chain history and public profiles. They are trusted only to the extent that validators can re-fetch and normalize them |

A backend cannot do this credibly, because the project would be judging its own refusals. A deterministic contract cannot do it either, because the criteria are written in natural language ("meaningful participation", "not a farming cluster") and the evidence is heterogeneous.

## Consensus design

- **Validator rule: comparative, never leader-only.** The validator reruns the same fetch → extract → judge pipeline and compares:
  - `approved` must match exactly;
  - `tier` must match exactly;
  - `reasons` are not compared (free text).
- **Normalization before comparison:** dates are bucketed to the day, counts to thresholds that appear in the criteria ("at least 3 months" → a boolean), and addresses are lower-cased.
- **Error classes:**
  - `[EXPECTED]`: the window is closed, there is a duplicate appeal, the bond is wrong, or the criterion is unknown;
  - `[EXTERNAL]`: an evidence URL returns 4xx. This is deterministic, so the appeal is rejected with the reason "evidence unavailable";
  - `[TRANSIENT]`: 5xx or a timeout. Validators agree to retry later rather than reject;
  - `[LLM_ERROR]`: malformed model output. Validators always disagree, which forces leader rotation.
- **Anti-gaming:** the criteria are frozen before the first appeal, so neither side can move the goalposts. Evidence URLs must come from an allow-list of domains set per round, so a claimant cannot point validators at a page they wrote themselves. The filing bond prices out spam.

## Contract sketch

```python
# v0.4.0
# { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray, TreeMap

class Recount(gl.contract.Contract):
    rounds: TreeMap[u256, Round]           # criteria, tiers (JSON), reserve, window, bond, allowed domains
    appeals: TreeMap[u256, Appeal]         # claimant, round, criterion, evidence (JSON), status, verdict
    open_appeal_of: TreeMap[str, u256]     # f"{round}:{address}" -> appeal id
    next_round_id: u256
    next_appeal_id: u256

    @gl.public.write.payable
    def open_round(self, criteria: str, tiers_json: str, window_end: str,
                   filing_bond: u256, allowed_domains_json: str) -> u256: ...

    @gl.public.write.payable
    def file_appeal(self, round_id: u256, criterion_id: str,
                    evidence_json: str, statement: str) -> u256: ...

    @gl.public.write
    def adjudicate(self, appeal_id: u256) -> None: ...   # gl.vm.run_nondet(leader_fn, validator_fn)

    @gl.public.write
    def close_round(self, round_id: u256) -> None: ...

    @gl.public.view
    def get_appeal(self, appeal_id: u256) -> dict: ...
```

## MVP scope

- One project per round, three tiers, up to five evidence URLs per appeal.
- A Studio demo with mock evidence pages hosted in this repo (GitHub raw), so that integration tests are reproducible.
- Direct-mode tests:
  - criteria freezing, bond handling, duplicate appeals, payout maths;
  - validator replay with conflicting evidence (`direct_vm.run_validator()`).
- A minimal frontend (genlayer-js): file an appeal and see the verdict.

## Stretch

- Batch adjudication for rounds with many appeals.
- Allocation paid in an ERC-20 on an EVM chain instead of GEN (message to a bridge or EVM proxy).
- A public "fairness report" per round: approval rate by criterion.

## Open questions

- Should claimants be able to amend their evidence after a rejection, or must they file a fresh appeal (with a new bond)?
- How should we handle criteria that need private data, such as KYC? Probably out of scope: Recount should only accept criteria that can be checked with public evidence.

---

## Build baseline (applies to every project in this series)

- **Contract header (GenVM v0.4):**
  ```python
  # v0.4.0
  # { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }
  ```
- **API:** `import genlayer as gl`, `gl.contract.Contract`, and `from genlayer.storage import DynArray, TreeMap`.
  - Storage dataclasses use `@gl.storage.allow`.
  - Value is sent with `gl.chain.Account(addr).emit_transfer(v)`.
  - Methods that receive value use `@gl.public.write.payable`.
  - `__receive__` does not exist on v0.4.
- **Tooling:** genlayer CLI 0.40.x, genlayer-js 2.x, genlayer-py 0.19.x, genlayer-test 0.30.x, genvm-linter ≥ 0.11.1 (`pip install -U --pre`).
- **Fees:** every deploy and write carries fees. Estimate them first (`estimateTransactionFees` / `estimate_transaction_fees` / `genlayer estimate-fees`); otherwise the transaction fails with `FeesDistributionMissing`. Commit a `fee-profile.json` generated with `gltest --fee-profile`.
- **Success check:** a transaction succeeded only if its status is `ACCEPTED` or `FINALIZED` **and** its execution result is `FINISHED_WITH_RETURN`.
- **Workflow:**
  1. architecture note;
  2. `genvm-lint check`;
  3. direct tests;
  4. a free dry-run on the target network (`gen_getContractSchemaForCode` on Studio);
  5. integration tests;
  6. deploy.

---

## Frontend

`frontend/` holds a Vite + React app built with genlayer-js 2.0.0 and three.js (react-three-fiber).

The hero is a 3D recount chamber that follows your case:
- your wallet's coin waits in the cloud of excluded wallets;
- when you file, it rises into the glass chamber;
- while consensus runs, five validator lenses converge and beam into it;
- with the verdict it turns green (eligible) or red (not eligible).

Connect with MetaMask so validators recount your real Ethereum address. You can also try the flow with a temporary in-browser account: it has no history, so it is found not eligible.

```bash
python scripts/deploy_demo.py      # deploys to studionet, opens a demo round, writes frontend/.env.local
cd frontend && npm install && npm run dev
```

How the frontend follows the Consensus v0.6 rules:
- every write is priced with `estimateTransactionFeesForWrite` and sent with `fees`;
- a case only moves forward when `isSuccessful(tx)` holds;
- countdowns use the contract's `get_time()` (chain time), never the browser clock.
