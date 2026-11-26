import { useState } from "react";
import type { Wallet } from "./lib/genlayer";
import { CONTRACT, EXPLORER, NETWORK } from "./lib/genlayer";
import { short } from "./lib/format";
import { href, useRoute } from "./lib/route";
import Home from "./pages/Home";
import RoundPage from "./pages/RoundPage";
import NewRound from "./pages/NewRound";

export default function App() {
  const route = useRoute();
  // One wallet for the whole app: connect once, use it on any round or to open one.
  const [wallet, setWallet] = useState<Wallet | null>(null);

  return (
    <>
      <header className="top">
        <a className="wordmark" href={href.home}>Recount</a>
        <nav className="nav" aria-label="Main">
          <a href={href.home} aria-current={route.page === "home" ? "page" : undefined}>Rounds</a>
          <a href={href.open} aria-current={route.page === "new" ? "page" : undefined}>Open a round</a>
          <span className="net">{wallet ? short(wallet.address) : `GenLayer ${NETWORK}`}</span>
        </nav>
      </header>

      {route.page === "home" && <Home />}
      {route.page === "round" && <RoundPage key={route.id} id={route.id} wallet={wallet} onWallet={setWallet} />}
      {route.page === "new" && <NewRound wallet={wallet} onWallet={setWallet} />}

      <footer className="foot">
        <p>
          Contract <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{short(CONTRACT ?? "0x")}</a> on
          GenLayer {NETWORK}, GenVM v0.4. Test GEN only. <a href="https://github.com/moltaphet/Recount" target="_blank" rel="noreferrer">Source</a>
        </p>
      </footer>
    </>
  );
}
