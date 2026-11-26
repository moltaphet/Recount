import json

import pytest

from conftest import (CONTRACT, GEN, T0_TS, FILING_ENDS, ADJ_ENDS, CLAIMS_START, CLAIMS_END,
                      iso, round_config, file, warp)


def _open(vm, contract, owner, cfg, value=100 * GEN):
    vm.sender = owner
    vm.value = value
    try:
        return contract.open_round(json.dumps(cfg))
    finally:
        vm.value = 0


def test_open_round_freezes_config_and_schedule(setup):
    contract, rid = setup
    r = contract.get_round(rid)
    assert rid == 1
    assert r["reserve"] == 100 * GEN
    assert r["filing_ends"] == FILING_ENDS
    assert r["adjudication_ends"] == ADJ_ENDS
    assert r["claims_start"] == CLAIMS_START
    assert r["claims_end"] == CLAIMS_END
    assert [t["id"] for t in r["tiers"]] == ["base", "plus"]
    assert r["closed"] is False


@pytest.mark.parametrize("override, message", [
    ({"exclusion_url": "https://x.example/{addr}.json"}, "contain {address}"),
    ({"exclusion_url": "http://x.example/{address}.json"}, "must be https"),
    ({"sources": [{"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api?x=1", "snapshot_block": 1}]},
     "explorer_api"),
    ({"sources": []}, "sources: 1-4 chains"),
    ({"sources": [{"chain": "eth", "explorer_api": "https://a.example/api", "snapshot_block": 1},
                  {"chain": "eth", "explorer_api": "https://b.example/api", "snapshot_block": 1}]}, "duplicate source chain"),
    ({"mode": "lottery"}, "mode must be payout or registry"),
    ({"claim_delay": 60}, "claim_delay must be >="),
    ({"filing_ends": T0_TS - 1}, "filing_ends must be in the future"),
    ({"adjudication_ends": FILING_ENDS - 1}, "adjudication_ends must be >= filing_ends"),
    ({"max_txs": 5000}, "max_txs too large"),
    ({"min_tx_count": 2000, "max_txs": 1000}, "min_tx_count must be <= max_txs x chains"),
    ({"tiers": [{"id": "a", "amount": "0", "description": "zero"}]}, "tier amount must be >= 1"),
    ({"tiers": [{"id": "a", "amount": "1", "description": "x"}, {"id": "A", "amount": "2", "description": "y"}]},
     "duplicate tier id"),
    ({"criteria": []}, "criteria: 1-10 items"),
])
def test_open_round_rejects_bad_config(direct_vm, direct_deploy, direct_owner, override, message):
    warp(direct_vm, iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    with direct_vm.expect_revert(message):
        _open(direct_vm, contract, direct_owner, round_config(**override))


def test_open_round_requires_reserve(direct_vm, direct_deploy, direct_owner):
    warp(direct_vm, iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    with direct_vm.expect_revert("reserve (value) must be > 0 in payout mode"):
        _open(direct_vm, contract, direct_owner, round_config(), value=0)


def test_file_appeal_records_bond_and_index(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    a = contract.get_appeal(aid)
    assert a["status"] == "FILED"
    assert a["bond"] == GEN
    assert contract.get_round(rid)["bonds_held"] == GEN
    assert contract.get_appeal_of(rid, a["claimant"]) == aid
    assert contract.list_appeals(rid, 0, 10) == [aid]


def test_file_appeal_guards(setup, direct_vm, direct_alice):
    contract, rid = setup
    with direct_vm.expect_revert("value must equal filing_bond"):
        file(direct_vm, contract, direct_alice, rid, bond=GEN // 2)
    with direct_vm.expect_revert("unknown criterion"):
        file(direct_vm, contract, direct_alice, rid, criterion="nope")
    with direct_vm.expect_revert("statement longer than"):
        file(direct_vm, contract, direct_alice, rid, statement="x" * 1001)
    file(direct_vm, contract, direct_alice, rid)
    with direct_vm.expect_revert("already appealed"):
        file(direct_vm, contract, direct_alice, rid)


def test_file_appeal_after_window(setup, direct_vm, direct_bob):
    contract, rid = setup
    warp(direct_vm, iso(FILING_ENDS + 1))
    with direct_vm.expect_revert("filing window over"):
        file(direct_vm, contract, direct_bob, rid)


def test_fund_round_only_tops_up_before_adjudication_ends(setup, direct_vm, direct_bob):
    contract, rid = setup
    direct_vm.sender = direct_bob
    direct_vm.value = 5 * GEN
    contract.fund_round(rid)
    direct_vm.value = 0
    assert contract.get_round(rid)["reserve"] == 105 * GEN
    warp(direct_vm, iso(ADJ_ENDS + 1))
    direct_vm.value = GEN
    with direct_vm.expect_revert("funding window over"):
        contract.fund_round(rid)
    direct_vm.value = 0


def test_get_time_reports_transaction_time(setup, direct_vm):
    contract, _ = setup
    warp(direct_vm, iso(T0_TS + 123))
    assert contract.get_time() == T0_TS + 123
