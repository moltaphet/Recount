// Merkle proofs for sealed registry rounds.
//
// Mirrors contracts/recount.py exactly:
//   leaf  = keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))   (OpenZeppelin StandardMerkleTree)
//   tree  = sorted leaves, sorted-pair hashing, an odd node is carried up unchanged
// so proofs verify with OpenZeppelin MerkleProof.verify(proof, root, leaf).

import { concat, encodeAbiParameters, keccak256, type Hex } from "viem";

export function leaf(address: `0x${string}`, amount: bigint): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, amount])));
}

function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() <= b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

function levels(leaves: Hex[]): Hex[][] {
  const out: Hex[][] = [[...leaves].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1))];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 === cur.length ? cur[i] : hashPair(cur[i], cur[i + 1]));
    out.push(next);
  }
  return out;
}

export function root(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${"00".repeat(32)}`;
  const l = levels(leaves);
  return l[l.length - 1][0];
}

export function proof(leaves: Hex[], target: Hex): Hex[] {
  const l = levels(leaves);
  let idx = l[0].findIndex((x) => x.toLowerCase() === target.toLowerCase());
  if (idx < 0) throw new Error("This address is not in the sealed verdicts.");
  const out: Hex[] = [];
  for (const level of l.slice(0, -1)) {
    const sib = idx ^ 1;
    if (sib < level.length) out.push(level[sib]);
    idx = Math.floor(idx / 2);
  }
  return out;
}

export function verify(p: Hex[], r: Hex, l: Hex): boolean {
  return p.reduce((h, s) => hashPair(h, s), l).toLowerCase() === r.toLowerCase();
}
