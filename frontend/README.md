# Recount frontend

A Vite + React app built with genlayer-js 2.0.0 and three.js (react-three-fiber). See the root [README](../README.md) for what Recount does.

```bash
npm install
npm run dev     # needs .env.local with VITE_RECOUNT_ADDRESS (written by ../scripts/deploy_demo.py)
npm run build
```

Code map:
- `src/lib/genlayer.ts`: the client (MetaMask or a temporary account), reads, and fee-estimated writes checked with `isSuccessful`.
- `src/scene/Chamber.tsx`: the 3D recount chamber, driven by the state of the case.
- `src/components/`: the case panel and the stamped verdict.
