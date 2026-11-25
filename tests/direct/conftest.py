"""Shared helpers for Recount direct-mode tests (genlayer-test 0.30.x).

Do not import `genlayer` at module level: the SDK is only on sys.path after
`direct_deploy(...)` has run (direct-tests skill, "SDK Loading Order").
"""

import datetime
import json

import pytest

CONTRACT = "contracts/recount.py"
GEN = 10**18

T0 = datetime.datetime(2026, 12, 1, tzinfo=datetime.timezone.utc)
DAY = 86400


def warp(vm, timestamp: str) -> None:
    """vm.warp plus gl.message.raw["datetime"], which the contract reads.

    genlayer-test 0.30 freezes message.raw at deploy and its warp only patches
    datetime.now(); update the raw message too so the contract sees the time.
    """
    import sys
    vm.warp(timestamp)
    msg = sys.modules.get("genlayer.message")
    if msg is not None and isinstance(getattr(msg, "raw", None), dict):
        msg.raw["datetime"] = timestamp


def iso(ts: int) -> str:
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


T0_TS = int(T0.timestamp())
FILING_ENDS = T0_TS + 14 * DAY
ADJ_ENDS = T0_TS + 21 * DAY
CLAIM_DELAY = 2 * DAY
CLAIMS_START = ADJ_ENDS + CLAIM_DELAY
CLAIMS_END = CLAIMS_START + 14 * DAY

SNAPSHOT = 20_000_000
EXPLORER = "https://eth.blockscout.com/api"
EXCLUSION = "https://example-project.github.io/airdrop/exclusion/{address}.json"


def round_config(**overrides) -> dict:
    cfg = {
        "title": "Example Season 1 airdrop",
        "criteria": [
            {"id": "early", "text": "Used the protocol for at least 3 distinct months before the snapshot."},
            {"id": "organic", "text": "Wallet was funded organically (not by the same source as a farming cluster)."},
        ],
        "tiers": [
            {"id": "base", "amount": str(10 * GEN), "description": "Meets one criterion."},
            {"id": "plus", "amount": str(25 * GEN), "description": "Meets both criteria with sustained activity."},
        ],
        "explorer_api": EXPLORER,
        "snapshot_block": SNAPSHOT,
        "exclusion_url": EXCLUSION,
        "max_txs": 1000,
        "min_tx_count": 3,
        "min_active_months": 0,
        "filing_bond": str(1 * GEN),
        "filing_ends": FILING_ENDS,
        "adjudication_ends": ADJ_ENDS,
        "claim_delay": CLAIM_DELAY,
        "claims_duration": 14 * DAY,
    }
    cfg.update(overrides)
    return cfg


def make_txs(address: str, months: list[str], funder: str = "0x1111111111111111111111111111111111111111",
             after_snapshot: int = 0) -> list[dict]:
    """One incoming funding tx, then one outgoing tx in each listed month (YYYY-MM)."""
    address = address.lower()
    txs = [{
        "blockNumber": "100", "timeStamp": str(int(datetime.datetime(2024, 1, 5, tzinfo=datetime.timezone.utc).timestamp())),
        "hash": "0xf0", "from": funder, "to": address, "value": str(GEN), "isError": "0", "contractAddress": "",
    }]
    for i, m in enumerate(months):
        y, mo = (int(x) for x in m.split("-"))
        ts = int(datetime.datetime(y, mo, 10, tzinfo=datetime.timezone.utc).timestamp())
        txs.append({
            "blockNumber": str(200 + i), "timeStamp": str(ts), "hash": f"0x{i:02x}",
            "from": address, "to": f"0x{(0xa0 + i):040x}", "value": "0", "isError": "0", "contractAddress": "",
        })
    for j in range(after_snapshot):
        txs.append({
            "blockNumber": str(SNAPSHOT + 1 + j), "timeStamp": str(T0_TS), "hash": f"0xff{j}",
            "from": address, "to": "0x2222222222222222222222222222222222222222", "value": "0", "isError": "0",
            "contractAddress": "",
        })
    return txs


def mock_sources(vm, allocation: str = "0", reason: str = "Funded by the same address as 40 other wallets within 1 hour.",
                 txs: list | None = None, explorer_status: int = 200, exclusion_status: int = 200,
                 explorer_body: dict | None = None) -> None:
    vm.mock_web(r".*exclusion/.*\.json", {"status": exclusion_status,
                                          "body": json.dumps({"allocation": allocation, "reason": reason})})
    body = explorer_body if explorer_body is not None else (
        {"status": "1", "message": "OK", "result": txs} if txs else
        {"status": "0", "message": "No transactions found", "result": []}
    )
    vm.mock_web(r".*module=account&action=txlist.*", {"status": explorer_status, "body": json.dumps(body)})


# genlayer-test 0.30 json.loads every string mock; the v0.4 SDK expects the raw
# model text, so wrap once more (direct-tests skill, "Mock strings on v0.3/v0.4").
def llm_json(obj) -> str:
    return json.dumps(json.dumps(obj))


def mock_judgment(vm, approved: bool, tier: str = "", reasons=None) -> None:
    vm.mock_llm(r".*airdrop appeals court.*", llm_json({
        "approved": approved, "tier": tier, "criterion_id": "early",
        "reasons": reasons or ["test"],
    }))


@pytest.fixture
def setup(direct_vm, direct_deploy, direct_owner):
    """Deploy at T0 and open a round funded with 100 GEN by direct_owner."""
    direct_vm.warp(iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    direct_vm.sender = direct_owner
    direct_vm.value = 100 * GEN
    round_id = contract.open_round(json.dumps(round_config()))
    direct_vm.value = 0
    return contract, round_id


def file(vm, contract, sender, round_id: int, criterion: str = "early", statement: str = "I am a real user.",
         bond: int = GEN) -> int:
    vm.sender = sender
    vm.value = bond
    appeal_id = contract.file_appeal(round_id, criterion, statement)
    vm.value = 0
    return appeal_id
