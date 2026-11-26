import { useMemo, useState } from "react";
import type { Round, Stage, Wallet } from "../lib/genlayer";
import { explain, write } from "../lib/genlayer";
import { leaf, proof, root, verify } from "../lib/merkle";
import { amountText } from "../lib/format";

interface Props {
  round: Round;
  now: number;
  wallet: Wallet | null;
  leaves: { address: `0x${string}`; amount: bigint }[];
  onChanged: () => Promise<void>;
}

/** The verdict registry: seal the round, show the Merkle root, hand out proofs. */
export default function SealPanel({ round, now, wallet, leaves, onChanged }: Props) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sealed = round.merkle_root !== "";
  const canSeal = !sealed && now > round.adjudication_ends;

  const hashed = useMemo(() => leaves.map((l) => leaf(l.address, l.amount)), [leaves]);
  const rebuilt = useMemo(() => (sealed ? root(hashed) : null), [sealed, hashed]);
  const matches = rebuilt !== null && rebuilt.toLowerCase() === round.merkle_root.toLowerCase();

  const mine = useMemo(() => {
    if (!wallet || !sealed) return null;
    const entry = leaves.find((l) => l.address.toLowerCase() === wallet.address.toLowerCase());
    if (!entry) return null;
    const l = leaf(entry.address, entry.amount);
    const p = proof(hashed, l);
    return { amount: entry.amount, leaf: l, proof: p, ok: verify(p, round.merkle_root as `0x${string}`, l) };
  }, [wallet, sealed, leaves, hashed, round.merkle_root]);

  async function seal() {
    if (!wallet) return;
    setError(null);
    try {
      const res = await write(wallet, "seal_round", [round.id], 0n, setStage);
      if (!res.ok) setError(res.error ?? "Sealing failed.");
      await onChanged();
    } catch (e) {
      setError(explain(e));
    } finally {
      setStage(null);
    }
  }

  if (!sealed && !canSeal) {
    return (
      <section aria-labelledby="seal-title">
        <h2 id="seal-title">Verdict registry</h2>
        <p className="muted">
          When decisions close, anyone can seal this round. Sealing stores a Merkle root of every approved wallet and amount,
          in the format OpenZeppelin's MerkleProof checks, so any chain can verify a verdict without trusting this page.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="seal-title">
      <h2 id="seal-title">Verdict registry</h2>
      {!sealed ? (
        <>
          <p className="muted">Decisions are closed. Seal the round to publish the Merkle root of approved wallets.</p>
          <button className="btn btn-primary" disabled={!wallet || stage !== null} onClick={seal}>Seal the round</button>
          {!wallet && <p className="hint">Connect a wallet in the case panel to seal.</p>}
          {stage && <p className="hint">Sealing… {stage}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <dl className="registry">
            <div><dt>Merkle root</dt><dd className="mono-break">{round.merkle_root}</dd></div>
            <div><dt>Approved wallets</dt><dd>{round.merkle_leaves}</dd></div>
            <div><dt>Rebuilt in your browser</dt><dd className={matches ? "ok" : "bad"}>{matches ? "Matches the contract" : "Does not match"}</dd></div>
          </dl>
          {mine && (
            <div className="proof">
              <h3>Your proof</h3>
              <p className="muted">Give this to the project's distributor contract to claim {amountText(mine.amount, round.mode)}. {mine.ok ? "It verifies against the root." : "It does not verify."}</p>
              <textarea readOnly rows={4} value={JSON.stringify({ account: wallet?.address, amount: mine.amount.toString(), proof: mine.proof }, null, 2)} />
            </div>
          )}
          <details>
            <summary>Solidity to verify a claim</summary>
            <pre className="code">{`bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
require(MerkleProof.verify(proof, ${round.merkle_root.slice(0, 10)}…, leaf), "not approved");`}</pre>
          </details>
        </>
      )}
    </section>
  );
}
