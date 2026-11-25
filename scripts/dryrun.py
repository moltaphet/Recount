"""Build a gen_call deploy-simulation payload (write-contract skill).

Usage: python scripts/dryrun.py contracts/recount.py '[]' | curl -s <rpc> -H 'content-type: application/json' -d @-
Sends no transaction and costs no fees.
"""
import json
import sys

from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.contracts.utils import make_calldata_object

code = open(sys.argv[1], "rb").read()
args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
ctor = calldata.encode(make_calldata_object(method=None, args=args, kwargs=None))
print(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "gen_call", "params": [{
    "type": "deploy",
    "from": "0x" + "00" * 19 + "01",
    "to": "0x" + "00" * 20,
    "data": serialize([code, ctor, b"\x00"]),
}]}))
