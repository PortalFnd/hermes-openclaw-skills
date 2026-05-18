---
name: circle-agents
description: Discover Circle Agents marketplace services and use Clawtrl's existing wallet/x402 tools to pay USDC-enabled APIs safely. Use when a task needs paid APIs, premium data, marketplace discovery, or USDC pay-per-call services.
compatibility: Works with Clawtrl agents that already have wallet-balance and signed-fetch available. This skill does not replace the agent wallet or install Circle custody.
metadata: { "openclaw": { "emoji": "⭕", "homepage": "https://agents.circle.com/services" } }
---
# Circle Agents Marketplace

Use this skill when you need to discover or call paid API services from the Circle Agents marketplace.

This skill is guidance-only. It does not change the wallet stack. Use the existing Clawtrl wallet tools for identity, balance checks, signed requests, and x402-style payments.

## Core URLs

- Marketplace: https://agents.circle.com/services
- Circle Agents home: https://agents.circle.com
- Agent Wallet docs: https://developers.circle.com/agent-stack/agent-wallets
- Nanopayments seller docs: https://developers.circle.com/gateway/nanopayments/quickstarts/seller

## Available Clawtrl Tools

Use these existing tools before and during paid calls:

```bash
wallet-info
wallet-balance
signed-fetch <url> [METHOD] [BODY]
crypto-send <to_address> <amount> [eth|usdc]
erc8128-sign <url> [METHOD] [BODY]
```

Prefer `signed-fetch` for paid or authenticated HTTP APIs. If a service returns HTTP 402 with compatible payment details, the Clawtrl wallet flow can pay and retry.

## Safe Workflow

1. Define the task and what data/service is needed.
2. Search or browse https://agents.circle.com/services for a relevant service.
3. Read the service pricing, accepted network, payment token, and endpoint docs.
4. Run `wallet-info` to confirm the wallet address and chain.
5. Run `wallet-balance` to confirm enough ETH for gas and enough USDC for payment.
6. If the price is unknown, dynamic, or above budget, ask the user before paying.
7. Call the endpoint with `signed-fetch`.
8. Summarize the result and record any payment in memory or a task log.

## Default Spend Guardrails

Unless the user gives a different budget:

- Maximum per paid service call: 0.05 USDC
- Maximum per task/session: 0.50 USDC
- Ask before repeat paid calls that could exceed the task budget
- Ask before bridging, swapping, or using any non-Base payment rail
- Never use `crypto-send` for marketplace API calls unless the service explicitly requires a direct transfer and the user approves it

## Payment Log Template

When a paid Circle service is used, record:

```text
Circle service payment
- Date/time:
- Service name:
- Endpoint/domain:
- Purpose:
- Amount paid or max authorized:
- Network/token:
- Result summary:
```

## Compatibility Notes

Clawtrl's native wallet is Base-first. Some Circle Gateway examples use Arc Testnet or Circle-specific facilitator flows. Before paying, verify the service supports the network and payment flow available to this agent.

If a service requires Circle Agent Wallet custody, Circle CLI setup, or a different network, explain the requirement and ask the user before continuing. Do not attempt to replace or migrate the Clawtrl wallet.

## Good Use Cases

- Pay-per-call premium APIs
- Market data and financial research
- Domain availability or pricing lookups
- Company/person enrichment services
- Social/X research providers
- Agent-to-API tasks too small for subscriptions

## Do Not Use For

- Moving funds without explicit user intent
- Replacing the Clawtrl wallet
- Signing up for custodial services without user approval
- Calls where the price or recipient cannot be verified
- Repeated paid calls without a clear cap
