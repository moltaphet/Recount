from conftest import warp, GEN, ADJ_ENDS, iso, make_txs, mock_sources, mock_judgment, file


def _claimant(contract, aid) -> str:
    return contract.get_appeal(aid)["claimant"].lower()


def test_approved_verdict_awards_tier(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    me = _claimant(contract, aid)
    mock_sources(direct_vm, txs=make_txs(me, ["2024-01", "2024-02", "2024-03", "2024-05"], after_snapshot=3))
    mock_judgment(direct_vm, True, "PLUS")  # tier matching is case-insensitive

    contract.adjudicate(aid)

    a = contract.get_appeal(aid)
    assert a["status"] == "APPROVED"
    assert a["outcome_kind"] == "verdict"
    assert a["tier"] == "plus"
    assert a["award"] == 25 * GEN
    facts = a["evidence"]["facts"]["total"]
    assert a["evidence"]["facts"]["chains"]["ethereum"] == facts  # single chain: total equals the chain
    # Post-snapshot txs are ignored: 1 funding + 4 outgoing.
    assert facts["tx_count"] == 5
    assert facts["active_months"] == 4
    assert facts["first_tx_date"] == "2024-01-05"
    assert facts["first_funder"] == "0x1111111111111111111111111111111111111111"
    assert facts["distinct_counterparties"] == 5
    r = contract.get_round(rid)
    assert r["total_awarded"] == 25 * GEN
    assert r["bonds_held"] == GEN


def test_llm_rejection_forfeits_bond_to_reserve(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=make_txs(_claimant(contract, aid), ["2024-01", "2024-02", "2024-03"]))
    mock_judgment(direct_vm, False)

    contract.adjudicate(aid)

    a = contract.get_appeal(aid)
    assert a["status"] == "REJECTED"
    assert a["award"] == 0
    r = contract.get_round(rid)
    assert r["reserve"] == 101 * GEN
    assert r["bonds_held"] == 0


def test_already_allocated_is_invalid_without_llm(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, allocation=str(50 * GEN), txs=make_txs(_claimant(contract, aid), ["2024-01"]))
    # No LLM mock: if the contract called the model, the test would fail.

    contract.adjudicate(aid)

    a = contract.get_appeal(aid)
    assert a["status"] == "REJECTED"
    assert a["outcome_kind"] == "invalid"
    assert a["outcome_code"] == "already_allocated"


def test_hard_gate_rejects_without_llm(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=make_txs(_claimant(contract, aid), ["2024-01"]))  # 2 txs < min_tx_count 3

    contract.adjudicate(aid)

    a = contract.get_appeal(aid)
    assert a["status"] == "REJECTED"
    assert a["outcome_kind"] == "rejected"
    assert a["outcome_code"] == "min_tx_count"


def test_empty_history_is_valid_input(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=[])

    contract.adjudicate(aid)

    a = contract.get_appeal(aid)
    assert a["outcome_code"] == "min_tx_count"
    assert a["evidence"]["facts"]["total"]["tx_count"] == 0


def test_bot_protection_403_is_transient_and_keeps_appeal_pending(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, explorer_status=403, explorer_body={"error": "blocked"})

    with direct_vm.expect_revert("[TRANSIENT] explorer ethereum returned 403"):
        contract.adjudicate(aid)
    assert contract.get_appeal(aid)["status"] == "FILED"


def test_server_error_is_transient(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, exclusion_status=503)

    with direct_vm.expect_revert("[TRANSIENT] exclusion record returned 503"):
        contract.adjudicate(aid)


def test_missing_exclusion_record_is_external(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, exclusion_status=404)

    with direct_vm.expect_revert("[EXTERNAL] exclusion record returned 404"):
        contract.adjudicate(aid)


def test_explorer_notok_is_transient(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, explorer_body={"status": "0", "message": "NOTOK", "result": "Max rate limit reached"})

    with direct_vm.expect_revert("[TRANSIENT] explorer ethereum said NOTOK"):
        contract.adjudicate(aid)


def test_unknown_tier_is_llm_error(setup, direct_vm, direct_alice):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=make_txs(_claimant(contract, aid), ["2024-01", "2024-02", "2024-03"]))
    mock_judgment(direct_vm, True, "gold")

    with direct_vm.expect_revert("[LLM_ERROR] unknown tier"):
        contract.adjudicate(aid)
    assert contract.get_appeal(aid)["status"] == "FILED"


def test_cannot_adjudicate_twice_or_after_window(setup, direct_vm, direct_alice, direct_bob):
    contract, rid = setup
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=[])
    contract.adjudicate(aid)
    with direct_vm.expect_revert("appeal is not pending"):
        contract.adjudicate(aid)

    aid2 = file(direct_vm, contract, direct_bob, rid)
    warp(direct_vm, iso(ADJ_ENDS + 1))
    with direct_vm.expect_revert("adjudication window over"):
        contract.adjudicate(aid2)
