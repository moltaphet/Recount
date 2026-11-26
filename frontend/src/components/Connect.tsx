import { useState } from "react";
import type { Wallet } from "../lib/genlayer";
import { connectMetaMask, explain, hasInjectedWallet, openTemporaryAccount } from "../lib/genlayer";

export default function Connect({ onWallet, why }: { onWallet: (w: Wallet) => void; why: string }) {
  const [error, setError] = useState<string | null>(null);
  async function go(kind: "metamask" | "temporary") {
    setError(null);
    try {
      onWallet(kind === "metamask" ? await connectMetaMask() : openTemporaryAccount());
    } catch (e) {
      setError(explain(e));
    }
  }
  return (
    <div className="connect">
      <p>{why}</p>
      <div className="stack">
        <button type="button" className="btn btn-primary" onClick={() => go("metamask")} disabled={!hasInjectedWallet()}>Connect MetaMask</button>
        <button type="button" className="btn" onClick={() => go("temporary")}>Use a temporary account</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
