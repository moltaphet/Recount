// Hash routes, so the app works on a static host (GitHub Pages) with no rewrites.
//   #/            home: rounds ledger
//   #/round/12    one round
//   #/new         open a round

import { useEffect, useState } from "react";

export type Route = { page: "home" } | { page: "round"; id: number } | { page: "new" };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const m = path.match(/^\/round\/(\d+)$/);
  if (m) return { page: "round", id: Number(m[1]) };
  if (path === "/new") return { page: "new" };
  return { page: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parse(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = {
  home: "#/",
  round: (id: number) => `#/round/${id}`,
  open: "#/new",
};
