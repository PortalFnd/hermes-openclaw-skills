# NOTICE — Clawtrl Private Payments

This directory is a **vendored fork** of the px402 privacy engine, originally
published as `@prxvt/sdk` (https://github.com/PRXVT/sdk), licensed under MIT.
The original MIT license text is preserved in `LICENSE.prxvt`.

Clawtrl maintains this source in-tree (no runtime dependency on the upstream
`@prxvt/sdk` npm package) so the privacy capability ships as part of the
`clawtrl-wallet` skill. Local modifications include Clawtrl branding, a
centralized configuration/factory entry point (`clawtrl.ts`), and integration
with the Clawtrl signing proxy.

## Important: protocol infrastructure is NOT forkable

The *code* is ours, but private payments still settle against the px402
protocol's deployed infrastructure, which Clawtrl does not (and cannot) fork:

- On-chain privacy **pool / paymaster / AA wallet contracts** on Base & Polygon
- The **Groth16 circuit artifacts** hosted at `circuits.prxvt.com`
- The sponsored **ERC-4337 bundler** at `sdk-api.prxvt.com`
- The **subgraph** used to build Merkle proofs
- The cross-chain **attestor** at `attestor.prxvt.com`

These endpoints/addresses live in `utils.ts` and `PrivacySDK.ts` and can be
overridden via `clawtrl.ts` config (env vars) if Clawtrl ever deploys its own
pool + circuits + bundler. Until then, deposits enter the px402 shared pool.
