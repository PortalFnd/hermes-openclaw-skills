---
name: clawtrl-wallet
description: Multi-chain crypto wallet (Base + Robinhood Chain) with ERC-8128 signed HTTP requests, x402 autonomous payments, optional private (zero-knowledge) x402 payments, ERC-20 token reads, generic contract read/write, ENS resolution, and a persistent transaction log. Gives your agent a full on-chain identity and the ability to read and act on-chain safely.
compatibility: Works with Clawtrl OpenClaw and Hermes agents. Requires Node.js 20+ and curl on the host. The signing proxy runs on 127.0.0.1:8128 and is shared by both runtimes.
metadata: { "openclaw": { "emoji": "💎", "homepage": "https://clawtrl.com/skills", "requires": { "bins": ["curl", "node"] } } }
---

# Clawtrl Wallet

Gives your OpenClaw or Hermes agent a native Ethereum wallet that works on **Base** (default) **and Robinhood Chain** (Arbitrum Orbit L2, chain ID 4663) at the same time. One wallet address, every chain — pass `chain` to any tool to switch networks per call:

- **Crypto Transfers** — Send ETH and USDC on Base (with ENS support and balance precheck)
- **Generic ERC-20 Balances** — Read the balance of any token contract on any supported chain
- **Contract Read/Write** — Call any view function and send any transaction on any supported chain
- **ENS Resolution** — Resolve `name.eth` to addresses (and reverse) using Ethereum mainnet
- **Gas Estimation** — Preview the gas cost of a transaction before sending
- **Transaction Log** — Every transfer, contract write, and x402 payment is appended to a JSONL log for full auditability and budgeting
- **Token Allowance & Revoke** — Check and revoke ERC-20 approvals for security hygiene
- **Wallet Summary & Stats** — One-command overview of balances, spending, approvals, and analytics
- **Contract Events** — Query past event logs from any smart contract on Base
- **Token Prices** — Live USD prices via Chainlink oracles (ETH, USDC, DAI, etc.)
- **Token Swaps** — Uniswap v3 swaps on Robinhood Chain (quote → approve → execute) with verified stock-token resolution and spoofed-token protection
- **Address Book** — Label addresses for human-readable references
- **Spending Caps** — Optional WALLET_DAILY_CAP_USDC env var enforces a hard daily spending limit
- **Private Payments (opt-in)** — Shield USDC into a zero-knowledge note and pay merchants / x402 APIs from a fresh burner wallet so payments are unlinkable to your public wallet. Disabled by default; enable with `CLAWTRL_PRIVACY_ENABLED=true`

## Chains

| Chain | `chain` value | Chain ID | Gas | Notes |
| --- | --- | --- | --- | --- |
| Base | `base` (default) | 8453 | ETH | USDC native; x402 payments live here |
| Base Sepolia | `base-sepolia` | 84532 | ETH | Base testnet |
| Robinhood Chain | `robinhood` | 4663 | ETH | Stock Tokens (TSLA, NVDA, AAPL…), USDG, Uniswap v2/v3/v4 + UniswapX, Morpho |
| Robinhood Chain Testnet | `robinhood-testnet` | 46630 | ETH | Free faucet: testnet ETH + stock tokens (faucet.testnet.chain.robinhood.com) |

Every wallet tool takes an optional trailing `chain` argument (or `WALLET_CHAIN` env var). Default is `base`. Examples:

```
wallet-balance robinhood
contract-read 0x... "symbol() view returns (string)" '[]' robinhood
crypto-send 0x1234... 0.01 eth robinhood-testnet
token-balance 0x... robinhood
WALLET_CHAIN=robinhood erc8128-sign https://api.example.com
```

### Robinhood Chain: stock tokens and jurisdictions

Robinhood Chain is an Arbitrum-based L2 built for tokenized real-world assets. Its flagship assets are **Robinhood Stock Tokens** — ERC-20 tokenised debt securities issued by Robinhood Assets (Jersey) Limited that track US stocks and ETFs (TSLA, NVDA, AAPL, 200+ more). They trade 24/7 on Uniswap (the chain's primary public AMM) and can be read/held/transferred like any ERC-20.

**Jurisdiction rules you must respect:** Stock Tokens are offered under Regulation S — they are **not registered under US securities law and may not be sold to US persons**. Offers are also restricted in the UK, Canada, and Switzerland. Compliance is enforced at the token-contract and issuer level (KYB for authorized participants, transfer-rule checks), not by the AMM. Treat stock tokens as **region-restricted assets**: check the user's jurisdiction before trading them on mainnet, and prefer `robinhood-testnet` (faucet stock tokens, no real value) for experimentation. Full list of restricted jurisdictions: https://docs.robinhood.com/rhj

Token launches and standard (non-security) ERC-20s on Robinhood Chain are permissionless — the restrictions above apply to Robinhood-issued Stock Tokens specifically.

## Tools

### wallet-info
Get the agent's wallet address and chain info.
```
wallet-info
```

### wallet-balance
Check ETH and USDC balances. Pass a chain to check another network.
```
wallet-balance [chain]
```
**Examples:**
```
wallet-balance              # Base (default)
wallet-balance robinhood    # Robinhood Chain mainnet
```

### signed-fetch
Make an authenticated HTTP request with ERC-8128 signing + x402 payment handling.
```
signed-fetch <url> [method] [body]
```
**Example:**
```
signed-fetch https://gen.portalfoundation.ai/api/generate-image POST '{"prompt":"a sunset","model":"flux-schnell"}'
```

### crypto-send
Send ETH or USDC to an address. Defaults to Base; pass a chain as the last argument to send on another network.
```
crypto-send <to_address> <amount> [token] [chain]
```
**Examples:**
```
crypto-send 0x1234...abcd 5.00 usdc
crypto-send 0x1234...abcd 0.01 eth robinhood
```

### erc8128-sign
Sign a request and return the ERC-8128 headers (without sending).
```
erc8128-sign <url> [method] [body]
```

### token-balance
Check the balance of any ERC-20 token on any supported chain. Works for Robinhood Stock Tokens too.
```
token-balance <token_contract_address> [chain]
```
**Examples:**
```
token-balance 0x4200000000000000000000000000000000000006   # WETH on Base
token-balance 0x<stock-token-address> robinhood              # Stock Token on Robinhood Chain
```

### tx-status
Check the status of a transaction. Returns `success`, `reverted`, or `pending` with block number and gas used.
```
tx-status <tx_hash> [chain]
```

### contract-read
Call any view or pure function on any smart contract on any supported chain. Use this for Aave health factors, Uniswap pool reads, stock token balances, token allowances, NFT ownership, oracle prices, anything.
```
contract-read <address> <signature> [json_args_array] [chain]
```
**Example:**
```
contract-read 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "balanceOf(address) view returns (uint256)" '["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]'
```

### contract-write
Send a state-changing transaction to any smart contract on any supported chain. Use this for token approvals, Aave deposits, Uniswap swaps (including stock token swaps on Robinhood Chain), DAO votes, NFT mints, anything.
```
contract-write <address> <signature> [json_args_array] [eth_value] [chain]
```
**Example (approve USDC):**
```
contract-write 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "approve(address,uint256)" '["0xSpender", "1000000"]'
```
**Safety:** Run `gas-estimate` first if you are unsure about cost. Run `wallet-balance` to confirm funds.

### ens-resolve
Resolve an ENS name to an address, or an address to an ENS name. Uses Ethereum mainnet.
```
ens-resolve <name_or_address>
```
**Examples:**
```
ens-resolve vitalik.eth
ens-resolve 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```
You can also pass `name.eth` directly to `crypto-send` — it resolves automatically before sending.

### gas-estimate
Estimate the gas cost of a transaction. With no args, shows current gas price for a basic ETH transfer.
```
gas-estimate [to_address] [eth_value] [hex_data] [chain]
```

### wallet-tx-log
Show recent wallet transactions (transfers, contract writes, x402 payments, bridges). Reads from the persistent JSONL log.
```
wallet-tx-log [limit]
```
Default limit: 50. Max: 500.

### token-allowance
Check how much of an ERC-20 token a spender can use from your wallet.
```
token-allowance <token_address> <spender_address>
```

### token-revoke
Revoke an ERC-20 approval by setting the allowance to 0. Critical for security hygiene.
```
token-revoke <token_address> <spender_address>
```

### wallet-summary
Full wallet overview in one command: ETH/USDC balances, today's spending vs daily cap, active token approvals, and the 5 most recent transactions.
```
wallet-summary [chain]
```

### wallet-stats
Spending analytics from the transaction log: total transfers, contract writes, x402 payments, USDC/ETH spent, daily breakdown, and top contracts called.
```
wallet-stats
```

### contract-events
Query past event logs from any smart contract on any supported chain.
```
contract-events <address> <event_signature> [from_block] [to_block] [chain]
```

### token-price
Get the current USD price of a token via Chainlink price feeds. Named feeds (eth, usdc, usdt, weth, dai) resolve on Base mainnet. On other chains, pass a custom feed address (e.g. a Robinhood Chain stock-token feed) and the chain.
```
token-price [token_or_feed_address] [chain]
```

### wallet-label
Label addresses for human-readable references. Labels are stored in a local JSON file.
```
wallet-label set <label> <address>
wallet-label remove <label>
wallet-label resolve <label>
wallet-label
```

### token-swap
Swap tokens via Uniswap v3 on Robinhood Chain — quote → approve → execute in one call. `amount` is the exact input. Prefer `--quote` first to preview the route and output.
```
token-swap <amount> <tokenIn> <tokenOut> [chain] [--quote]
```
Tokens can be symbols (`eth`, `weth`, `usdg`, `tsla`, `nvda`, `aapl`…) or raw `0x` contract addresses. Stock-token symbols are resolved through the verified Robinhood token registry at runtime — symbol-only matches to unverified/spoofed tokens are **refused** (ticker collisions are rampant on this chain: dozens of fake TSLA/USDC tokens exist). `eth`↔`weth` wraps/unwraps directly without the router.

**Examples:**
```
token-swap 10 usdg tsla robinhood --quote    # preview buying $10 of TSLA stock token
token-swap 10 usdg tsla robinhood            # execute
token-swap 0.005 eth nvda robinhood          # buy NVDA with native ETH
token-swap 0.05 tsla usdg robinhood          # sell stock token for USDG
token-swap 0.01 eth weth robinhood           # wrap ETH
```

**Important:** there is **no canonical USDC/USDT on Robinhood Chain** — the dollar token is **USDG** (Robinhood, 6 decimals). `usdc`/`usdt` inputs are refused with a hint, because every token with those tickers on this chain is a spoof. Slippage defaults to 0.5% (`WALLET_SLIPPAGE_BPS` to override, max 50%). Approvals are scoped to the exact swap amount. Raw address inputs trade with a loud `verified: false` warning — confirm the contract before trading size. Stock Tokens are jurisdiction-restricted (Reg S) — see the Chains section.

## Private Payments (opt-in)

The wallet bundles a **vendored, in-tree zero-knowledge payment engine** (a fork of
the px402 / `@prxvt/sdk` engine, MIT — see `src/privacy/NOTICE.md`). It lets your
agent pay merchants and x402 APIs **without linking the payment to your public
wallet address**: USDC is deposited into a privacy pool as an encrypted *note*,
and payments are made from single-use burner wallets backed by a Groth16 ZK proof.

**This is off by default.** To enable, set `CLAWTRL_PRIVACY_ENABLED=true` in the
environment and restart the proxy. Notes are stored encrypted (AES-256-GCM) with a
key derived from the wallet key — never in plaintext, never transmitted.

> **Important caveat:** Only the *code* is vendored into Clawtrl. Private payments
> still settle against the px402 protocol's deployed infrastructure (on-chain
> pool/paymaster contracts, the `circuits.prxvt.com` ZK artifacts, the
> `sdk-api.prxvt.com` bundler, the subgraph, and `attestor.prxvt.com`). Those are
> not forkable without redeploying the entire protocol + trusted setup. Deposits
> enter the px402 shared pool. All of these endpoints/addresses are overridable
> via `CLAWTRL_PRIVACY_*` env vars if Clawtrl deploys its own infrastructure later.

### private-status
Show whether private payments are enabled plus your shielded balance.
```
private-status
```

### private-balance
Show your private (shielded) USDC balance held in encrypted notes.
```
private-balance
```

### private-deposit
Shield USDC: move it from the public wallet into the privacy pool, creating an
encrypted note. Allowed amounts: `0.01`, `0.1`, `1`, `10`, `100`.
```
private-deposit <amount>
```
**Example:**
```
private-deposit 1
```

### private-pay
Make an unlinkable USDC payment from your shielded balance (burner wallet + ZK proof).
```
private-pay <to_address> <amount>
```

### private-fetch
Make an HTTP request that auto-pays any x402 (402 Payment Required) charge
**privately** from your shielded balance.
```
private-fetch <url> [method] [body]
```

## File Structure

```
clawtrl-wallet/
├── SKILL.md                        # This file (skill spec)
├── package.json                    # npm dependencies (viem, x402-fetch, @x402/fetch, @x402/evm)
├── install.sh                      # One-command installer
├── clawtrl-signing.service         # systemd unit file
├── src/
│   └── signing-proxy.js            # Node.js signing proxy server (the actual implementation)
└── bin/
    ├── wallet-info                 # Wallet address + chain
    ├── wallet-balance              # ETH/USDC balances
    ├── signed-fetch                # ERC-8128 signed request + x402 payment
    ├── crypto-send                 # Send ETH/USDC on Base (with ENS + precheck)
    ├── erc8128-sign                # Sign request (returns headers)
    ├── paytoll                     # Call any PayToll x402 API endpoint
    ├── token-balance               # Read any ERC-20 balance
    ├── tx-status                   # Check Base transaction status
    ├── contract-read               # Call any view function
    ├── contract-write              # Send any transaction
    ├── ens-resolve                 # ENS lookups
    ├── gas-estimate                # Preview gas cost
    └── wallet-tx-log               # Recent transactions from the log
    ├── token-allowance             # Check ERC-20 approval amounts
    ├── token-revoke                # Revoke ERC-20 approvals
    ├── wallet-summary              # Full overview: balances, spending, approvals
    ├── wallet-stats                # Spending analytics from tx history
    ├── contract-events             # Query past events from any contract
    ├── token-price                 # USD price via Chainlink oracles
    ├── wallet-label                # Address book for human-readable labels
    ├── token-swap                  # Uniswap v3 swap (quote → approve → execute) on Robinhood Chain
    ├── private-status              # Privacy on/off + shielded balance
    ├── private-balance             # Shielded (private) USDC balance
    ├── private-deposit             # Shield USDC into the privacy pool
    ├── private-pay                 # Unlinkable USDC payment (burner + ZK)
    └── private-fetch               # x402 request paid privately
├── src/
│   ├── privacy/                    # Vendored ZK payment engine (TypeScript source, MIT)
│   └── privacy-dist/               # Prebuilt CommonJS build of the engine
```

## Transaction Log

Every successful transfer, contract write, and x402 payment is appended to a JSONL log file. Read it with `wallet-tx-log`. Default location resolves in this order:

1. `/root/.hermes/skills/clawtrl-wallet/transactions.jsonl` (Hermes hosts)
2. `/opt/clawtrl/wallet-tools/transactions.jsonl` (OpenClaw hosts)
3. `~/.clawtrl/transactions.jsonl` (non-root installs)

Each line is a JSON object with `timestamp`, `wallet`, `type`, and operation-specific fields. Use this to track spending, debug failed runs, and report budget usage to the user. The log is append-only and the agent should never edit it directly.

## Budget and Safety Guardrails

Unless the user gives a different budget, follow these defaults when acting autonomously:

- Confirm `wallet-balance` before every transaction
- For payments above 0.50 USDC, ask the user first
- For any `contract-write` on an unknown contract, ask the user first
- Run `token-swap ... --quote` before executing any swap, and confirm the route + expected output with the user for anything above dust size
- Never trade raw `0x` addresses that resolve with `verified: false` without explicit user confirmation
- Never approve unlimited (`max uint256`) allowances unless the user explicitly requests it; prefer scoped approvals
- Use `gas-estimate` before any large or unfamiliar transaction
- Read the recent `wallet-tx-log` at the start of a task so you have context on what you have already spent

## Dealing with Errors

- **`signing proxy not running`** — The proxy on `127.0.0.1:8128` is down. On systemd hosts: `systemctl restart clawtrl-signing`. The proxy reads the key from `/opt/openclaw/.env`.
- **`Insufficient ETH balance` / `No ETH for gas on Base`** — Fund the wallet with a small amount of ETH. USDC transfers still need ETH for gas.
- **`ENS name did not resolve`** — The name has no address record on Ethereum mainnet. Double-check spelling or use the raw address.
- **`Transaction not found on Base`** — The tx hash has not propagated yet, or it was on a different chain. Wait a few seconds and retry `tx-status`.
- **Transaction reverted** — `tx-status` returns `reverted`. Use `contract-read` to inspect contract state and find the reason (insufficient allowance, slippage, paused, etc.).

## Install

### Option 1: One-liner (recommended)
```bash
curl -sSL https://raw.githubusercontent.com/PortalFnd/hermes-openclaw-skills/main/clawtrl-wallet/install.sh | sudo bash
```

### Option 2: Clone and install
```bash
git clone https://github.com/PortalFnd/hermes-openclaw-skills.git
cd openclaw-skills/clawtrl-wallet
sudo ./install.sh
```

### Option 3: Pre-installed (Clawtrl hosted agents)
If you deploy via [clawtrl.com](https://clawtrl.com), the wallet skill is pre-installed automatically.

## Configuration

Set your wallet private key in `/opt/openclaw/.env`:
```
AGENT_WALLET_PRIVATE_KEY=0x...
```
On Clawtrl-hosted agents, this is done automatically during deployment.

### Chain selection

The wallet is multi-chain out of the box: every tool accepts a trailing `chain` argument (or `WALLET_CHAIN` env var) — see the **Chains** table above. The *default* chain (used when no `chain` is passed) is **base**; change it with:
```
CLAWTRL_WALLET_CHAIN=robinhood        # base | base-sepolia | robinhood | robinhood-testnet
```
The same private key/address works on every EVM chain — no new wallet needed. Optional overrides:
```
CLAWTRL_WALLET_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/<key>   # recommended for production (public RPC is rate-limited)
CLAWTRL_WALLET_USDC=0x...                                                  # set a USDC/stablecoin address on chains without a default
```
Robinhood Chain uses ETH for gas and hosts Robinhood Stock Tokens (tokenized equities), USDG, and the Uniswap/Morpho DeFi stack. Explorer: https://robinhoodchain.blockscout.com

Optional: set a hard daily spending cap in USDC:
```
WALLET_DAILY_CAP_USDC=50
```
When set, the proxy will reject any USDC transfer or contract write that would push today's total spending over the cap. Check current spending with `wallet-summary` or `wallet-stats`. (Private deposits count toward this cap.)

Optional: enable private (zero-knowledge) payments:
```
CLAWTRL_PRIVACY_ENABLED=true
CLAWTRL_PRIVACY_CHAIN=base        # or polygon
```
Advanced overrides (only if running your own px402 infrastructure):
`CLAWTRL_PRIVACY_RPC_URL`, `CLAWTRL_PRIVACY_BUNDLER_URL`, `CLAWTRL_PRIVACY_BUNDLER_API_KEY`, `CLAWTRL_PRIVACY_ATTESTOR_URL`, `CLAWTRL_PRIVACY_CIRCUIT_WASM`, `CLAWTRL_PRIVACY_CIRCUIT_ZKEY`.

Then fund the wallet with ETH (for gas) and USDC (for payments) on your selected chain. On Robinhood Chain, bridge ETH via the canonical Arbitrum bridge.

## How It Works

The skill runs a lightweight signing proxy on `localhost:8128` that:
- Holds the wallet private key securely (localhost-only, never exposed)
- Signs ERC-8128 requests on demand (chain ID included in the signature)
- Handles x402 payment flows (v1 EIP-3009 + v2 Permit2)
- Sends USDC/ETH transfers and contract calls on any registered chain (Base, Robinhood Chain, testnets)

All shell tools are thin `curl` wrappers that call this proxy.

### Architecture
```
Agent → shell tool (curl) → signing proxy (:8128) → Base / Robinhood Chain / x402 service
```

## Companion Crypto Skills

These ecosystem guides pair well with the Clawtrl wallet:

- **ETHSkills** — Ethereum production reference for gas, wallets, L2s, standards, security, testing, frontend UX, indexing, and contract addresses. No API keys required. Start at `https://ethskills.com/SKILL.md` and fetch task-specific guides as needed.
- **OpenZeppelin Skills** — Security-first contract development guidance. No API keys required. Hardhat projects need `@openzeppelin/contracts` (and optionally `@openzeppelin/contracts-upgradeable`); Foundry projects should pin release tags via `forge install`. Optional MCP helpers are available at `https://mcp.openzeppelin.com/`.
- **Binance Skills Hub** — Guidance for Binance market data, trading, wallet tracking, and account operations. Public market data can work without auth, but trading and account workflows require a Binance API key and secret. Prefer testnet or demo keys first.
- **Uniswap AI** — Guidance for Uniswap swaps, liquidity, Universal Router, Permit2, hooks, and viem-based EVM integrations. Trading API mode requires a Uniswap API key and `x-universal-router-version: 2.0`; SDK mode needs `viem` plus Uniswap packages; onchain swaps need funded wallet balances and token approvals.
- **Fluid Protocol** — Guidance for Fluid lending and vault workflows on Base and Ethereum. No API key required. Use `viem` with a Base or Ethereum RPC endpoint; lending flows need wallet funds and approvals, while vault flows need collateral, gas, and active health monitoring.

Use these guides for planning and implementation details. Use the wallet tools here when you need to sign, pay, approve, or move funds from the agent's Base wallet.

## Dependencies

- **viem** — Ethereum wallet, signing, contract interaction
- **x402-fetch** — x402 v1 protocol (EIP-3009 transferWithAuthorization)
- **@x402/fetch + @x402/evm** — x402 v2 protocol (Permit2, loaded dynamically)
- **snarkjs + circomlibjs** — Groth16 proof generation + Poseidon hashing for private payments (loaded lazily, only when privacy is enabled)
- **graphql + graphql-request** — subgraph queries for Merkle proofs (private payments)

## Requirements

- **Node.js 20+** (for the signing proxy)
- **curl** (for the shell tools)
- **ETH on Base** (for gas fees, ~$0.001 per tx)
- **USDC on Base** (for x402 payments and transfers)

## Links

- [Clawtrl Skills](https://clawtrl.com/skills)
- [x402 Protocol](https://docs.x402.org)
- [ERC-8128 Standard](https://erc8128.org)
- [Base Chain](https://base.org)
- [Robinhood Chain Docs](https://docs.robinhood.com/chain)
