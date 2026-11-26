"""Deploy Recount v2 to studionet and open two demo rounds (registry + payout) for the frontend.

Usage:  ~/.venvs/genlayer/bin/python scripts/deploy_demo.py [studionet|studio-dev]

- Creates a throwaway project key (studionet test GEN only) and stores it in
  `.env` (git-ignored) as RECOUNT_DEMO_PROJECT_KEY, so the round can be
  managed (close_round) later. Reuses the key if `.env` already has one.
- Every deploy/write carries estimated fees (Consensus v0.6) and is checked
  with `is_successful` (status ACCEPTED/FINALIZED + FINISHED_WITH_RETURN).
- Writes the contract address to frontend/.env.local as VITE_RECOUNT_ADDRESS.
"""

import json
import pathlib

from genlayer_py import create_account, create_client
import sys

from genlayer_py.chains import studio_devnet, studionet
from genlayer_py.transactions import is_successful

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = 10**18
FEE_KEYS = ("distribution", "messageAllocations", "feeValue")
EXCLUSION = "https://raw.githubusercontent.com/moltaphet/Recount/main/fixtures/exclusion.json?a={address}"


def fees(est) -> dict:
    return {k: est[k] for k in FEE_KEYS if k in est}


def load_or_create_key() -> str:
    env = ROOT / ".env"
    lines = env.read_text().splitlines() if env.exists() else []
    for line in lines:
        if line.startswith("RECOUNT_DEMO_PROJECT_KEY="):
            return line.split("=", 1)[1].strip()
    acct = create_account()
    key = acct.key.hex()
    key = key if key.startswith("0x") else "0x" + key
    lines.append(f"RECOUNT_DEMO_PROJECT_KEY={key}")
    env.write_text("\n".join(lines) + "\n")
    return key


def succeeded(receipt) -> bool:
    # SDK helper: status ACCEPTED/FINALIZED and execution FINISHED_WITH_RETURN.
    return is_successful(receipt)


def main() -> None:
    acct = create_account(load_or_create_key())
    network = sys.argv[1] if len(sys.argv) > 1 else "studionet"
    chain = {"studionet": studionet, "studio-dev": studio_devnet}[network]
    client = create_client(chain=chain, account=acct)
    client.fund_account(acct.address, 60 * GEN)

    code = (ROOT / "contracts" / "recount.py").read_text()
    tx = client.deploy_contract(account=acct, code=code, args=[], fees=fees(client.estimate_transaction_fees()))
    receipt = client.wait_for_transaction_receipt(transaction_hash=tx)
    assert succeeded(receipt), f"deploy failed: {receipt}"
    address = receipt["data"]["contract_address"]
    print("contract", address)

    now = client.read_contract(address=address, function_name="get_time", args=[], account=acct)
    common = {
        "exclusion_url": EXCLUSION,
        "max_txs": 500,
        "min_tx_count": 1,
        "min_active_months": 0,
        "filing_bond": str(GEN // 10),
        "filing_ends": now + 14 * 86400,
        "adjudication_ends": now + 16 * 86400,
        "claim_delay": 3600,
        "claims_duration": 7 * 86400,
    }
    rounds = [
        # Registry round: the project pays its own token on its own chain from the sealed Merkle root.
        ({**common,
          "title": "Onchain builders, season 1",
          "mode": "registry",
          "criteria": [
              {"id": "builder", "text": "Was active on Ethereum or Base in at least 4 different months before the snapshot."},
              {"id": "voter", "text": "Voted in DAO governance on Snapshot at least 3 times before the cutoff."},
          ],
          "tiers": [
              {"id": "base", "amount": str(500 * GEN), "description": "Meets one rule."},
              {"id": "plus", "amount": str(1500 * GEN), "description": "Meets both rules."},
          ],
          "sources": [
              {"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api", "snapshot_block": 21_000_000},
              {"chain": "base", "explorer_api": "https://base.blockscout.com/api", "snapshot_block": 23_000_000},
          ],
          "governance_time": 1_733_000_000,
          }, 0),
        # Payout round: a GEN reserve on GenLayer, claimed after decisions close.
        ({**common,
          "title": "Ethereum early users, season 1",
          "mode": "payout",
          "criteria": [
              {"id": "active", "text": "Was active on Ethereum mainnet in at least 3 different months before the snapshot."},
              {"id": "organic", "text": "Wallet was funded organically, not by the same source as a farming cluster, "
                                        "and shows varied counterparties."},
          ],
          "tiers": [
              {"id": "base", "amount": str(GEN), "description": "Meets one criterion."},
              {"id": "plus", "amount": str(5 * GEN // 2),
               "description": "Meets both criteria with activity spread over 6 or more months."},
          ],
          "sources": [{"chain": "ethereum", "explorer_api": "https://eth.blockscout.com/api", "snapshot_block": 20_000_000}],
          }, 50 * GEN),
    ]
    for cfg, reserve in rounds:
        args = [json.dumps(cfg)]
        est = client.estimate_transaction_fees_for_write(address=address, function_name="open_round",
                                                         account=acct, args=args, value=reserve)
        tx = client.write_contract(account=acct, address=address, function_name="open_round", args=args,
                                   value=reserve, fees=fees(est))
        receipt = client.wait_for_transaction_receipt(transaction_hash=tx)
        assert succeeded(receipt), f"open_round failed: {receipt}"
        print("opened", cfg["mode"], "round:", cfg["title"])

    (ROOT / "frontend" / ".env.local").write_text(f"VITE_RECOUNT_ADDRESS={address}\nVITE_RECOUNT_NETWORK={network}\n")
    print("wrote frontend/.env.local")


if __name__ == "__main__":
    main()
