"""Replay the captured validator (direct-tests skill, "Replaying the Validator")."""

from conftest import warp, make_txs, mock_sources, mock_judgment, file


def _approve(contract, direct_vm, direct_alice, rid):
    aid = file(direct_vm, contract, direct_alice, rid)
    me = contract.get_appeal(aid)["claimant"].lower()
    txs = make_txs(me, ["2024-01", "2024-02", "2024-03"])
    mock_sources(direct_vm, txs=txs)
    mock_judgment(direct_vm, True, "base")
    contract.adjudicate(aid)
    return me, txs


def test_validator_agrees_on_same_evidence_and_judgment(setup, direct_vm, direct_alice):
    contract, rid = setup
    _approve(contract, direct_vm, direct_alice, rid)
    assert direct_vm.run_validator() is True


def test_validator_rejects_different_facts(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=txs[:-1])  # one tx fewer: facts differ
    mock_judgment(direct_vm, True, "base")
    assert direct_vm.run_validator() is False


def test_validator_rejects_different_flag_reason(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=txs, reason="something else")
    mock_judgment(direct_vm, True, "base")
    assert direct_vm.run_validator() is False


def test_validator_rejects_different_decision(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=txs)
    mock_judgment(direct_vm, False)
    assert direct_vm.run_validator() is False


def test_validator_rejects_different_tier(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=txs)
    mock_judgment(direct_vm, True, "plus")
    assert direct_vm.run_validator() is False


def test_validator_ignores_free_text_reasons(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=txs)
    mock_judgment(direct_vm, True, "base", reasons=["completely different wording"])
    assert direct_vm.run_validator() is True


def test_validator_agrees_on_shared_transient_error(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, explorer_status=503, explorer_body={})
    assert direct_vm.run_validator(leader_error=_user_error("[TRANSIENT] explorer returned 429")) is True


def test_validator_disagrees_when_leader_errored_but_validator_succeeds(setup, direct_vm, direct_alice):
    contract, rid = setup
    me, txs = _approve(contract, direct_vm, direct_alice, rid)
    assert direct_vm.run_validator(leader_error=_user_error("[TRANSIENT] explorer returned 503")) is False


def _user_error(msg):
    # run_validator wraps this as gl.vm.UserError(str(err)), so pass the bare message.
    return Exception(msg)
