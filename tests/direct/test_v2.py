"""Recount v2: multi-chain evidence, Snapshot governance, registry mode, Merkle sealing."""

import datetime
import json

from eth_abi import encode as abi_encode
from eth_utils import keccak

from conftest import (CONTRACT, GEN, T0_TS, ADJ_ENDS, CLAIMS_START, SNAPSHOT, iso, warp, round_config,
                      make_txs, mock_chain, mock_judgment, mock_snapshot, mock_sources, file)

BASE_API = "https://base.blockscout.com/api"
BASE_SNAPSHOT = 15_000_000


def _deploy(direct_vm, direct_deploy, direct_owner, value=100 * GEN, **cfg):
    warp(direct_vm, iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    direct_vm.sender = direct_owner
    direct_vm.value = value
    rid = contract.open_round(json.dumps(round_config(**cfg)))
    direct_vm.value = 0
    return contract, rid


def _ts(y, m, d=10):
    return int(datetime.datetime(y, m, d, tzinfo=datetime.timezone.utc).timestamp())


# ------------------------------------------------------------------ multi-chain

def test_facts_per_chain_and_union_of_months(direct_vm, direct_deploy, direct_owner, direct_alice):
    sources = [
        {"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api", "snapshot_block": SNAPSHOT},
        {"chain": "base", "explorer_api": BASE_API, "snapshot_block": BASE_SNAPSHOT},
    ]
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, sources=sources, min_tx_count=0)
    aid = file(direct_vm, contract, direct_alice, rid)
    me = contract.get_appeal(aid)["claimant"].lower()

    mock_sources(direct_vm, txs=make_txs(me, ["2024-01", "2024-02"]))                    # funding in 2024-01
    mock_chain(direct_vm, r"base\.blockscout\.com",
               make_txs(me, ["2024-02", "2024-03", "2024-04"], snapshot=BASE_SNAPSHOT, after_snapshot=2))
    mock_judgment(direct_vm, True, "base")
    contract.adjudicate(aid)

    facts = contract.get_appeal(aid)["evidence"]["facts"]
    assert set(facts["chains"]) == {"ethereum", "base"}
    assert facts["chains"]["ethereum"]["active_months"] == 2       # 2024-01, 2024-02
    assert facts["chains"]["base"]["active_months"] == 4           # 2024-01 (funding) + 02 + 03 + 04
    assert facts["chains"]["base"]["tx_count"] == 4                # post-snapshot txs dropped
    assert facts["total"]["tx_count"] == 7
    assert facts["total"]["active_months"] == 4                    # union, not the sum
    assert "governance" not in facts
    assert direct_vm.run_validator() is True


def test_one_chain_blocked_is_transient_for_the_whole_appeal(direct_vm, direct_deploy, direct_owner, direct_alice):
    sources = [
        {"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api", "snapshot_block": SNAPSHOT},
        {"chain": "base", "explorer_api": BASE_API, "snapshot_block": BASE_SNAPSHOT},
    ]
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, sources=sources)
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=[])
    mock_chain(direct_vm, r"base\.blockscout\.com", status=403, body={"error": "blocked"})
    with direct_vm.expect_revert("[TRANSIENT] explorer base returned 403"):
        contract.adjudicate(aid)
    assert contract.get_appeal(aid)["status"] == "FILED"


# ------------------------------------------------------------------ governance

def test_snapshot_votes_before_cutoff_become_governance_facts(direct_vm, direct_deploy, direct_owner, direct_alice):
    cutoff = _ts(2024, 6, 1)
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, governance_time=cutoff, min_tx_count=0)
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=[])
    mock_snapshot(direct_vm, [
        {"created": _ts(2024, 2, 3), "space": {"id": "aavedao.eth"}},
        {"created": _ts(2024, 4, 9), "space": {"id": "ens.eth"}},
        {"created": _ts(2024, 5, 1), "space": {"id": "ens.eth"}},
        {"created": _ts(2024, 7, 1), "space": {"id": "uniswap"}},   # after the cutoff: ignored
    ])
    mock_judgment(direct_vm, True, "base")
    contract.adjudicate(aid)

    gov = contract.get_appeal(aid)["evidence"]["facts"]["governance"]
    assert gov == {"votes": 3, "spaces": 2, "first_vote_date": "2024-02-03", "last_vote_date": "2024-05-01"}


def test_snapshot_outage_is_transient(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, governance_time=_ts(2024, 6, 1))
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=[])
    mock_snapshot(direct_vm, [], status=502)
    with direct_vm.expect_revert("[TRANSIENT] snapshot returned 502"):
        contract.adjudicate(aid)


# ------------------------------------------------------------------ registry mode

def test_registry_mode_takes_no_reserve(direct_vm, direct_deploy, direct_owner):
    warp(direct_vm, iso(T0_TS))
    contract = direct_deploy(CONTRACT)
    warp(direct_vm, iso(T0_TS))
    direct_vm.sender = direct_owner
    direct_vm.value = GEN
    with direct_vm.expect_revert("registry mode takes no reserve"):
        contract.open_round(json.dumps(round_config(mode="registry")))
    direct_vm.value = 0
    rid = contract.open_round(json.dumps(round_config(mode="registry")))
    assert contract.get_round(rid)["mode"] == "registry"
    direct_vm.value = GEN
    with direct_vm.expect_revert("registry rounds take no reserve"):
        contract.fund_round(rid)
    direct_vm.value = 0


def test_registry_claim_returns_only_the_bond(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, value=0, mode="registry")
    aid = file(direct_vm, contract, direct_alice, rid)
    mock_sources(direct_vm, txs=make_txs(contract.get_appeal(aid)["claimant"].lower(), ["2024-01", "2024-02", "2024-03"]))
    mock_judgment(direct_vm, True, "plus")
    contract.adjudicate(aid)
    assert contract.preview_payout(aid) == 0
    warp(direct_vm, iso(CLAIMS_START))
    direct_vm.sender = direct_alice
    contract.claim(aid)
    a = contract.get_appeal(aid)
    assert a["status"] == "CLAIMED" and a["payout"] == 0 and a["award"] == 25 * GEN


# ------------------------------------------------------------------ Merkle sealing

def _ref_leaf(address: str, amount: int) -> bytes:
    """OpenZeppelin StandardMerkleTree leaf, computed with eth_abi + eth_utils (independent of the contract)."""
    return keccak(keccak(abi_encode(["address", "uint256"], [address, amount])))


def _ref_tree(leaves: list[bytes]):
    """Same construction the contract documents: sorted leaves, sorted-pair hashing, odd node carried up.
    Returns (root, proof_for)."""
    levels = [sorted(leaves)]
    while len(levels[-1]) > 1:
        cur, nxt = levels[-1], []
        for i in range(0, len(cur), 2):
            if i + 1 == len(cur):
                nxt.append(cur[i])
            else:
                a, b = sorted((cur[i], cur[i + 1]))
                nxt.append(keccak(a + b))
        levels.append(nxt)

    def proof_for(leaf: bytes) -> list[bytes]:
        proof, idx = [], levels[0].index(leaf)
        for level in levels[:-1]:
            sib = idx ^ 1
            if sib < len(level):
                proof.append(level[sib])
            idx //= 2
        return proof

    return levels[-1][0], proof_for


def _oz_verify(proof: list[bytes], root: bytes, leaf: bytes) -> bool:
    """OpenZeppelin MerkleProof.verify (commutative keccak of sorted pairs)."""
    h = leaf
    for p in proof:
        a, b = sorted((h, p))
        h = keccak(a + b)
    return h == root


def test_seal_round_matches_reference_merkle_and_oz_proofs(direct_vm, direct_deploy, direct_owner,
                                                           direct_alice, direct_bob, direct_charlie, direct_accounts):
    contract, rid = _deploy(direct_vm, direct_deploy, direct_owner, value=0, mode="registry")
    people = [direct_alice, direct_bob, direct_charlie] + list(direct_accounts[3:5])
    tiers = ["plus", "base", "plus", "base", "plus"]
    for who, tier in zip(people, tiers):
        aid = file(direct_vm, contract, who, rid)
        direct_vm.clear_mocks()
        mock_sources(direct_vm, txs=make_txs(contract.get_appeal(aid)["claimant"].lower(), ["2024-01", "2024-02", "2024-03"]))
        mock_judgment(direct_vm, True, tier)
        contract.adjudicate(aid)
    # one rejection: must not be in the tree
    loser = file(direct_vm, contract, direct_accounts[5], rid)
    direct_vm.clear_mocks()
    mock_sources(direct_vm, txs=[])
    contract.adjudicate(loser)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("adjudication window still open"):
        contract.seal_round(rid)
    warp(direct_vm, iso(ADJ_ENDS + 1))
    root_hex = contract.seal_round(rid)
    with direct_vm.expect_revert("round already sealed"):
        contract.seal_round(rid)

    leaves_info = contract.approved_leaves(rid)
    assert len(leaves_info) == 5
    ref_leaves = [_ref_leaf(x["address"], int(x["amount"])) for x in leaves_info]
    ref_root, proof_for = _ref_tree(ref_leaves)
    r = contract.get_round(rid)
    assert root_hex == r["merkle_root"] == "0x" + ref_root.hex()
    assert r["merkle_leaves"] == 5
    for leaf in ref_leaves:
        assert _oz_verify(proof_for(leaf), ref_root, leaf)


def test_seal_empty_round_gives_zero_root(setup, direct_vm):
    contract, rid = setup
    warp(direct_vm, iso(ADJ_ENDS + 1))
    assert contract.seal_round(rid) == "0x" + "00" * 32


# ------------------------------------------------------------------ listing

def test_list_rounds_newest_first(direct_vm, direct_deploy, direct_owner):
    contract, first = _deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.sender = direct_owner
    second = contract.open_round(json.dumps(round_config(title="Second", mode="registry")))
    assert contract.round_count() == 2
    rounds = contract.list_rounds(0, 10)
    assert [r["id"] for r in rounds] == [second, first]
    assert rounds[0]["mode"] == "registry" and rounds[0]["chains"] == ["ethereum"]
    assert contract.list_rounds(1, 10)[0]["id"] == first
