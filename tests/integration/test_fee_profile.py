"""Measure real fees for every Recount write and record them as fee-profile.json.

Run (studionet, slow polling to stay under Studio's 500 requests/hour):
    RECOUNT_EXCLUSION_URL='https://raw.githubusercontent.com/moltaphet/Recount/main/fixtures/exclusion.json?a={address}' \\
    gltest tests/integration/test_fee_profile.py -v -s --network studionet \\
      --fee-profile frontend/fee-profile.json --default-wait-interval 8000 --default-wait-retries 90

Covers (integration-tests skill: every expensive branch and every value transfer):
- deploy, open_round (payout with value, registry without), file_appeal (value = bond)
- adjudicate: the expensive branch (web fetches on two chains + Snapshot + LLM)
- seal_round: Merkle root after the decision window
- withdraw_unjudged: an external value message (emit_transfer), which needs a message-fee budget
Every transaction waits for FINALIZED so fee accounting and refunds are settled.
"""

import json
import os
import time

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

GEN = 10**18
FEE_KEYS = ("distribution", "messageAllocations", "feeValue")
WINDOW = 240  # seconds of filing/decision window, so seal and withdraw can run in the same test


def _fees(estimate) -> dict:
    return {k: estimate[k] for k in FEE_KEYS if k in estimate}


def _round(now: int, exclusion_url: str, mode: str) -> dict:
    return {
        "title": f"Fee profile {mode}",
        "mode": mode,
        "criteria": [{"id": "active", "text": "Was active on Ethereum or Base before the snapshot."}],
        "tiers": [{"id": "base", "amount": str(GEN // 10), "description": "Meets the rule."}],
        "sources": [
            {"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api", "snapshot_block": 20_000_000},
            {"chain": "base", "explorer_api": "https://base.blockscout.com/api", "snapshot_block": 15_000_000},
        ],
        "governance_time": 1_718_000_000,
        "exclusion_url": exclusion_url,
        "max_txs": 50,
        "min_tx_count": 0,
        "min_active_months": 0,
        "filing_bond": str(GEN // 100),
        "filing_ends": now + WINDOW,
        "adjudication_ends": now + WINDOW,
        "claim_delay": 3600,
        "claims_duration": 3600,
    }


@pytest.mark.skipif(not os.environ.get("RECOUNT_EXCLUSION_URL"), reason="needs a public exclusion record URL")
def test_fee_profile_all_writes(gl_client, accounts):
    project, claimant, idle = accounts[0], accounts[1], accounts[2]
    for acct in (project, claimant, idle):
        gl_client.fund_account(acct.address, 2 * GEN)

    contract = get_contract_factory("Recount").deploy(
        args=[], account=project, fees=_fees(gl_client.estimate_transaction_fees()), wait_until="finalized")

    def send(who, method, args, value=0):
        est = gl_client.estimate_transaction_fees_for_write(
            address=contract.address, function_name=method, account=who, args=args, value=value)
        receipt = getattr(contract.connect(who), method)(args=args).transact(
            value=value, fees=_fees(est), wait_until="finalized")
        assert tx_execution_succeeded(receipt), f"{method} failed"
        return receipt

    url = os.environ["RECOUNT_EXCLUSION_URL"]
    now = contract.get_time(args=[]).call()
    send(project, "open_round", [json.dumps(_round(now, url, "payout"))], value=GEN // 5)     # round 1
    send(project, "open_round", [json.dumps(_round(now, url, "registry"))])                  # round 2

    send(claimant, "file_appeal", [2, "active", "I used Ethereum and Base before the snapshot."], value=GEN // 100)
    send(idle, "file_appeal", [1, "active", "Filed and never decided."], value=GEN // 100)
    aid = contract.get_appeal_of(args=[2, claimant.address.lower()]).call()
    send(claimant, "adjudicate", [aid])

    # Wait out the window on chain time, then seal and refund.
    end = now + WINDOW
    while contract.get_time(args=[]).call() <= end:
        time.sleep(20)
    send(idle, "seal_round", [2])
    unjudged = contract.get_appeal_of(args=[1, idle.address.lower()]).call()
    send(idle, "withdraw_unjudged", [unjudged])
