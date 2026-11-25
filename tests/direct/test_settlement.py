from conftest import warp, GEN, ADJ_ENDS, CLAIMS_START, CLAIMS_END, iso, make_txs, mock_sources, mock_judgment, file


def _approved(contract, vm, who, rid, tier):
    aid = file(vm, contract, who, rid)
    me = contract.get_appeal(aid)["claimant"].lower()
    vm.clear_mocks()
    mock_sources(vm, txs=make_txs(me, ["2024-01", "2024-02", "2024-03"]))
    mock_judgment(vm, True, tier)
    contract.adjudicate(aid)
    return aid


def _rejected(contract, vm, who, rid):
    aid = file(vm, contract, who, rid)
    vm.clear_mocks()
    mock_sources(vm, txs=[])
    contract.adjudicate(aid)
    return aid


def test_full_payout_when_reserve_covers_awards(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = _approved(contract, direct_vm, direct_alice, rid, "plus")
    warp(direct_vm, iso(CLAIMS_START))
    assert contract.preview_payout(aid) == 25 * GEN

    direct_vm.sender = direct_alice
    contract.claim(aid)

    a = contract.get_appeal(aid)
    assert a["status"] == "CLAIMED"
    assert a["payout"] == 25 * GEN
    r = contract.get_round(rid)
    assert r["paid_out"] == 25 * GEN
    assert r["bonds_held"] == 0


def test_pro_rata_when_oversubscribed_is_order_independent(direct_vm, direct_deploy, direct_owner,
                                                           direct_alice, direct_bob, direct_charlie):
    import json
    from conftest import CONTRACT, T0_TS, round_config

    warp(direct_vm, iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    direct_vm.sender = direct_owner
    direct_vm.value = 30 * GEN  # three "plus" approvals = 75 GEN awarded
    rid = contract.open_round(json.dumps(round_config()))
    direct_vm.value = 0

    ids = [_approved(contract, direct_vm, who, rid, "plus") for who in (direct_alice, direct_bob, direct_charlie)]
    r = contract.get_round(rid)
    assert r["total_awarded"] == 75 * GEN

    warp(direct_vm, iso(CLAIMS_START + 1))
    expected = 25 * GEN * (30 * GEN) // (75 * GEN)
    for aid, who in reversed(list(zip(ids, (direct_alice, direct_bob, direct_charlie)))):
        assert contract.preview_payout(aid) == expected
        direct_vm.sender = who
        contract.claim(aid)
        assert contract.get_appeal(aid)["payout"] == expected
    r = contract.get_round(rid)
    assert r["paid_out"] == 3 * expected
    assert r["paid_out"] <= r["reserve"]


def test_rejected_bond_increases_reserve_for_everyone(setup, direct_vm, direct_alice, direct_bob):
    contract, rid = setup
    _rejected(contract, direct_vm, direct_bob, rid)
    assert contract.get_round(rid)["reserve"] == 101 * GEN


def test_claim_timing_and_ownership(setup, direct_vm, direct_alice, direct_bob):
    contract, rid = setup
    aid = _approved(contract, direct_vm, direct_alice, rid, "base")

    warp(direct_vm, iso(CLAIMS_START - 1))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("claims not open yet"):
        contract.claim(aid)

    warp(direct_vm, iso(CLAIMS_START))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the claimant can claim"):
        contract.claim(aid)

    direct_vm.sender = direct_alice
    contract.claim(aid)
    with direct_vm.expect_revert("already claimed"):
        contract.claim(aid)


def test_late_claim_returns_bond_only(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = _approved(contract, direct_vm, direct_alice, rid, "base")
    warp(direct_vm, iso(CLAIMS_END))
    direct_vm.sender = direct_alice
    contract.claim(aid)
    a = contract.get_appeal(aid)
    assert a["status"] == "CLAIMED"
    assert a["payout"] == 0
    assert contract.get_round(rid)["bonds_held"] == 0


def test_withdraw_unjudged_after_window(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("adjudication window still open"):
        contract.withdraw_unjudged(aid)
    warp(direct_vm, iso(ADJ_ENDS + 1))
    contract.withdraw_unjudged(aid)
    assert contract.get_appeal(aid)["status"] == "REFUNDED"
    assert contract.get_round(rid)["bonds_held"] == 0


def test_close_round_sweeps_remainder_but_not_bonds(setup, direct_vm, direct_owner, direct_alice, direct_bob):
    contract, rid = setup
    claimed = _approved(contract, direct_vm, direct_alice, rid, "plus")
    unclaimed = _approved(contract, direct_vm, direct_bob, rid, "base")

    warp(direct_vm, iso(CLAIMS_START))
    direct_vm.sender = direct_alice
    contract.claim(claimed)

    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("claims still open"):
        contract.close_round(rid)

    warp(direct_vm, iso(CLAIMS_END))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the project can close"):
        contract.close_round(rid)

    direct_vm.sender = direct_owner
    contract.close_round(rid)
    r = contract.get_round(rid)
    assert r["closed"] is True
    assert r["swept"] == 100 * GEN - 25 * GEN
    assert r["bonds_held"] == GEN  # bob's bond is still his

    direct_vm.sender = direct_bob
    contract.claim(unclaimed)
    assert contract.get_appeal(unclaimed)["payout"] == 0
    assert contract.get_round(rid)["bonds_held"] == 0
