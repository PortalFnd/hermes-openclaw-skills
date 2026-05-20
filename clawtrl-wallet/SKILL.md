---
name: clawtrl-wallet
description: Crypto wallet on Base (Ethereum L2) with ERC-8128 signed HTTP requests, x402 autonomous payments, ERC-20 token reads, generic contract read/write, ENS resolution, and a persistent transaction log. Gives your agent a full on-chain identity and the ability to read and act across Base safely.
compatibility: Works with Clawtrl OpenClaw and Hermes agents. Requires Node.js 20+ and curl on the host. The signing proxy runs on 127.0.0.1:8128 and is shared by both runtimes.
metadata: { "openclaw": { "emoji": "💎", "homepage": "https://clawtrl.com/skills", "requires": { "bins": ["curl", "node"] } } }
---

# Clawtrl Wallet

Gives your OpenClaw or Hermes agent a native Ethereum wallet on **Base** (Ethereum L2) with:

- **Wallet Management** — Check ETH/USDC balances, view address, verify chain identity
- **ERC-8128 Authenticated Requests** — Sign outgoing HTTP requests with your wallet for cryptographic proof of identity
- **x402 Autonomous Payments** — Auto-pay when APIs return HTTP 402 (supports v1 + v2)
- **Crypto Transfers** — Send ETH and USDC to any address on Base (with ENS support and balance precheck)
- **Signed HTTP Client** — All-in-one tool: sign requests + handle payments automatically
- **Generic ERC-20 Balances** — Read the balance of any token contract on Base
- **Contract Read/Write** — Call any view function and send any transaction on any Base smart contract
- **ENS Resolution** — Resolve `name.eth` to addresses (and reverse) using Ethereum mainnet
- **Gas Estimation** — Preview the gas cost of a transaction before sending
- **Transaction Log** — Every transfer, contract write, and x402 payment is appended to a JSONL log for full auditability and budgeting
- **Token Allowance & Revoke** — Check and revoke ERC-20 approvals for security hygiene
- **Wallet Summary & Stats** — One-command overview of balances, spending, approvals, and analytics
- **Contract Events** — Query past event logs from any smart contract on Base
- **Token Prices** — Live USD prices via Chainlink oracles (ETH, USDC, DAI, etc.)
- **Address Book** — Label addresses for human-readable references
- **Spending Caps** — Optional WALLET_DAILY_CAP_USDC env var enforces a hard daily spending limit

## Tools

### wallet-info
Get the agent's wallet address and chain info.
```
wallet-info
```

### wallet-balance
Check ETH and USDC balances on Base.
```
wallet-balance
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
Send ETH or USDC to an address on Base.
```
crypto-send <to_address> <amount> [token]
```
**Example:**
```
crypto-send 0x1234...abcd 5.00 usdc
```

### erc8128-sign
Sign a request and return the ERC-8128 headers (without sending).
```
erc8128-sign <url> [method] [body]
```

### token-balance
Check the balance of any ERC-20 token on Base.
```
token-balance <token_contract_address>
```
**Example:**
```
token-balance 0x4200000000000000000000000000000000000006   # WETH on Base
```

### tx-status
Check the status of a transaction on Base. Returns `success`, `reverted`, or `pending` with block number and gas used.
```
tx-status <tx_hash>
```

### contract-read
Call any view or pure function on any smart contract on Base. Use this for Aave health factors, Uniswap pool reads, token allowances, NFT ownership, oracle prices, anything.
```
contract-read <address> <signature> [json_args_array]
```
**Example:**
```
contract-read 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "balanceOf(address) view returns (uint256)" '["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]'
```

### contract-write
Send a state-changing transaction to any smart contract. Use this for token approvals, Aave deposits, Uniswap swaps, DAO votes, NFT mints, anything.
```
contract-write <address> <signature> [json_args_array] [eth_value]
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
Estimate the gas cost of a transaction on Base. With no args, shows current gas price for a basic ETH transfer.
```
gas-estimate [to_address] [eth_value] [hex_data]
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
wallet-summary
```

### wallet-stats
Spending analytics from the transaction log: total transfers, contract writes, x402 payments, USDC/ETH spent, daily breakdown, and top contracts called.
```
wallet-stats
```

### contract-events
Query past event logs from any smart contract on Base.
```
contract-events <address> <event_signature> [from_block] [to_block]
```

### token-price
Get the current USD price of a token via Chainlink price feeds on Base. Supports eth, usdc, usdt, weth, dai, or a custom feed address.
```
token-price [token]
```

### wallet-label
Label addresses for human-readable references. Labels are stored in a local JSON file.
```
wallet-label set <label> <address>
wallet-label remove <label>
wallet-label resolve <label>
wallet-label
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
    └── wallet-label                # Address book for human-readable labels
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
curl -sSL https://raw.githubusercontent.com/PortalFnd/openclaw-skills/main/clawtrl-wallet/install.sh | sudo bash
```

### Option 2: Clone and install
```bash
git clone https://github.com/PortalFnd/openclaw-skills.git
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

Optional: set a hard daily spending cap in USDC:
```
WALLET_DAILY_CAP_USDC=50
```
When set, the proxy will reject any USDC transfer or contract write that would push today's total spending over the cap. Check current spending with `wallet-summary` or `wallet-stats`.

Then fund the wallet with ETH (for gas) and USDC (for payments) on Base.

## How It Works

The skill runs a lightweight signing proxy on `localhost:8128` that:
- Holds the wallet private key securely (localhost-only, never exposed)
- Signs ERC-8128 requests on demand
- Handles x402 payment flows (v1 EIP-3009 + v2 Permit2)
- Sends USDC/ETH transfers on Base

All 5 shell tools are thin `curl` wrappers that call this proxy.

### Architecture
```
Agent → shell tool (curl) → signing proxy (:8128) → Base chain / x402 service
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
