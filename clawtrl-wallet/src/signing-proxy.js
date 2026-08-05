import { createServer } from 'node:http';
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, encodeFunctionData, encodePacked, parseAbiItem, isAddress, namehash, defineChain } from 'viem';
import { base, baseSepolia, mainnet, arbitrum, optimism, polygon, bsc, avalanche } from 'viem/chains';

// Robinhood Chain — Arbitrum Orbit L2, ETH gas, EVM-compatible
var robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});
var robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

// Chain registry — select with CLAWTRL_WALLET_CHAIN (or AGENT_WALLET_CHAIN). Default: base.
var CHAIN_REGISTRY = {
  base: { chain: base, rpc: 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  'base-sepolia': { chain: baseSepolia, rpc: 'https://sepolia.base.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  robinhood: { chain: robinhood, rpc: 'https://rpc.mainnet.chain.robinhood.com', usdc: null },
  'robinhood-testnet': { chain: robinhoodTestnet, rpc: 'https://rpc.testnet.chain.robinhood.com', usdc: null },
};

// Polyfill global fetch (required by @x402/fetch, may be missing in some Node builds)
if (typeof globalThis.fetch === 'undefined') {
  try {
    var _undici = await import('undici');
    globalThis.fetch = _undici.fetch;
    globalThis.Headers = _undici.Headers;
    globalThis.Request = _undici.Request;
    globalThis.Response = _undici.Response;
    console.log('Polyfilled global fetch via undici');
  } catch(_e) {
    console.error('WARNING: global fetch not available — x402 payments will not work');
  }
}

// x402 v2 SDK — matches official coinbase/x402 example
var x402Loaded = false;
var x402WrapFetch = null;
var x402ClientInstance = null;
try {
  var fetchMod = await import('@x402/fetch');
  var evmMod = await import('@x402/evm/exact/client');
  x402WrapFetch = fetchMod.wrapFetchWithPayment;
  var X402Client = fetchMod.x402Client;
  x402ClientInstance = new X402Client();
  // Will register signer after account is created (below)
  console.log('@x402/fetch + @x402/evm loaded (v2)');
  x402Loaded = true;
} catch(_e) {
  console.log('x402 v2 SDK not available: ' + _e.message);
  // Try v1 fallback (x402-fetch)
  try {
    var v1mod = await import('x402-fetch');
    x402WrapFetch = v1mod.wrapFetchWithPayment;
    console.log('x402-fetch v1 SDK loaded (fallback)');
    x402Loaded = true;
  } catch(_e2) {
    console.log('x402-fetch v1 also not available: ' + _e2.message);
  }
}

function loadEnv(path) {
  try {
    var content = readFileSync(path, 'utf-8');
    var vars = {};
    content.split('\n').forEach(function(line) {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      var idx = line.indexOf('=');
      if (idx > 0) vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return vars;
  } catch(e) { return {}; }
}

// Try multiple env file locations (root + non-root installs)
var HOME = homedir();
var env = loadEnv('/opt/openclaw/.env');
if (!env.AGENT_WALLET_PRIVATE_KEY) env = loadEnv(HOME + '/.clawtrl/.env');
if (!env.AGENT_WALLET_PRIVATE_KEY) env = loadEnv(HOME + '/.env');
if (!env.AGENT_WALLET_PRIVATE_KEY) env = loadEnv('.env');
var pk = env.AGENT_WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_PRIVATE_KEY || env.CLAWTRL_WALLET_PRIVATE_KEY || process.env.CLAWTRL_WALLET_PRIVATE_KEY;
if (!pk || !pk.startsWith('0x')) {
  console.error('AGENT_WALLET_PRIVATE_KEY not found or invalid');
  console.error('Searched: /opt/openclaw/.env, ~/.clawtrl/.env, ~/.env, .env, $AGENT_WALLET_PRIVATE_KEY');
  process.exit(1);
}

// Default chain — CLAWTRL_WALLET_CHAIN (env file or process env), default: base.
// Every endpoint also accepts an optional "chain" field to use any registered chain.
var DEFAULT_CHAIN_NAME = (env.CLAWTRL_WALLET_CHAIN || process.env.CLAWTRL_WALLET_CHAIN || env.AGENT_WALLET_CHAIN || process.env.AGENT_WALLET_CHAIN || 'base').toLowerCase();
if (!CHAIN_REGISTRY[DEFAULT_CHAIN_NAME]) {
  console.error('Unknown chain "' + DEFAULT_CHAIN_NAME + '". Available: ' + Object.keys(CHAIN_REGISTRY).join(', '));
  process.exit(1);
}
var account = privateKeyToAccount(pk);

// Lazy per-chain client factory — one wallet/public client pair per chain, created on first use
var _chainClients = {};
function getChainCtx(name) {
  var key = (name || DEFAULT_CHAIN_NAME || 'base').toLowerCase();
  var def = CHAIN_REGISTRY[key];
  if (!def) return null;
  if (!_chainClients[key]) {
    var rpc = (key === DEFAULT_CHAIN_NAME && (env.CLAWTRL_WALLET_RPC_URL || process.env.CLAWTRL_WALLET_RPC_URL || env.AGENT_WALLET_RPC_URL || process.env.AGENT_WALLET_RPC_URL)) || def.rpc;
    var usdc = (key === DEFAULT_CHAIN_NAME && (env.CLAWTRL_WALLET_USDC || process.env.CLAWTRL_WALLET_USDC)) || def.usdc;
    _chainClients[key] = {
      name: key,
      chain: def.chain,
      usdc: usdc,
      wallet: createWalletClient({ account: account, chain: def.chain, transport: http(rpc) }),
      public: createPublicClient({ chain: def.chain, transport: http(rpc) }),
    };
  }
  return _chainClients[key];
}
function chainCtxOr400(res, name) {
  var ctx = getChainCtx(name);
  if (!ctx) jsonRes(res, 400, { error: 'Unknown chain "' + name + '"', available: Object.keys(CHAIN_REGISTRY), default: DEFAULT_CHAIN_NAME });
  return ctx;
}
var DEFAULT_CTX = getChainCtx(DEFAULT_CHAIN_NAME);
console.log('Default chain: ' + DEFAULT_CHAIN_NAME + ' (id ' + DEFAULT_CTX.chain.id + '). All endpoints accept "chain": ' + Object.keys(CHAIN_REGISTRY).join(' | '));

// Mainnet client for ENS lookups (ENS lives on Ethereum mainnet)
var mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
});

// Multi-chain client factory for raw tx / approve endpoints (LI.FI bridge flows).
// Keyed by numeric chainId — includes Robinhood Chain so bridge routes can settle there.
var BRIDGE_CHAIN_OBJ = { 1: mainnet, 8453: base, 84532: baseSepolia, 42161: arbitrum, 10: optimism, 137: polygon, 56: bsc, 43114: avalanche, 4663: robinhood, 46630: robinhoodTestnet };
var BRIDGE_CHAIN_RPC = { 1: 'https://eth.llamarpc.com', 8453: 'https://mainnet.base.org', 84532: 'https://sepolia.base.org', 42161: 'https://arb1.arbitrum.io/rpc', 10: 'https://mainnet.optimism.io', 137: 'https://polygon-rpc.com', 56: 'https://bsc-dataseed.binance.org', 43114: 'https://api.avax.network/ext/bc/C/rpc', 4663: 'https://rpc.mainnet.chain.robinhood.com', 46630: 'https://rpc.testnet.chain.robinhood.com' };
function getBridgeClients(chainId) {
  var c = BRIDGE_CHAIN_OBJ[chainId] || base;
  var rpc = BRIDGE_CHAIN_RPC[chainId] || 'https://mainnet.base.org';
  return { wc: createWalletClient({ account: account, chain: c, transport: http(rpc) }), pc: createPublicClient({ chain: c, transport: http(rpc) }) };
}

// ERC-20 minimal ABI
var ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
];

// Transaction log — persists every spend/transfer/bridge/payment to disk
// Hermes uses /root/.hermes/skills/clawtrl-wallet/transactions.jsonl when present.
// Falls back to a shared /opt/clawtrl/wallet-tools/transactions.jsonl on both runtimes.
function getTxLogPath() {
  var candidates = [
    '/root/.hermes/skills/clawtrl-wallet/transactions.jsonl',
    '/opt/clawtrl/wallet-tools/transactions.jsonl',
    HOME + '/.clawtrl/transactions.jsonl',
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var d = dirname(candidates[i]);
      if (!existsSync(d)) {
        // only create the dir if its parent exists (don't force-create /root/.hermes structures)
        if (existsSync(dirname(d))) mkdirSync(d, { recursive: true });
      }
      if (existsSync(dirname(candidates[i]))) return candidates[i];
    } catch (_e) { /* try next */ }
  }
  return HOME + '/.clawtrl-transactions.jsonl';
}
var TX_LOG_PATH = getTxLogPath();

function logTx(entry) {
  try {
    var record = Object.assign({ timestamp: new Date().toISOString(), wallet: account.address }, entry);
    appendFileSync(TX_LOG_PATH, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('Failed to write tx log:', e.message);
  }
}

// Address book — label addresses for human-readable references
var ADDRESS_BOOK_PATH = (function() {
  var candidates = [
    '/root/.hermes/skills/clawtrl-wallet/address-book.json',
    '/opt/clawtrl/wallet-tools/address-book.json',
    HOME + '/.clawtrl/address-book.json',
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { if (existsSync(dirname(candidates[i]))) return candidates[i]; } catch (_e) {}
  }
  return HOME + '/.clawtrl-address-book.json';
})();
function loadAddressBook() {
  try { if (existsSync(ADDRESS_BOOK_PATH)) return JSON.parse(readFileSync(ADDRESS_BOOK_PATH, 'utf-8')); } catch (_e) {}
  return {};
}
function saveAddressBook(book) {
  try { writeFileSync(ADDRESS_BOOK_PATH, JSON.stringify(book, null, 2)); } catch (_e) {}
}

// Spending cap — enforce WALLET_DAILY_CAP_USDC if set
var DAILY_CAP_USDC = parseFloat(env.WALLET_DAILY_CAP_USDC || process.env.WALLET_DAILY_CAP_USDC || '0');
function getTodaySpentUsdc() {
  try {
    if (!existsSync(TX_LOG_PATH)) return 0;
    var raw = readFileSync(TX_LOG_PATH, 'utf-8').trim();
    if (!raw) return 0;
    var lines = raw.split('\n');
    var today = new Date().toISOString().slice(0, 10);
    var total = 0;
    for (var i = lines.length - 1; i >= 0; i--) {
      try {
        var entry = JSON.parse(lines[i]);
        if (!entry.timestamp || entry.timestamp.slice(0, 10) !== today) continue;
        if (entry.usdcValue) { total += Number(entry.usdcValue); continue; }
        // Estimate USDC value from known fields
        if (entry.token === 'usdc' && entry.amount) { total += Number(entry.amount); continue; }
        if (entry.type === 'x402-payment' && entry.usdcAmount) { total += Number(entry.usdcAmount); }
      } catch (_e) {}
    }
    return total;
  } catch (_e) { return 0; }
}
function checkSpendingCap(usdcAmount) {
  if (!DAILY_CAP_USDC || DAILY_CAP_USDC <= 0) return null;
  var spent = getTodaySpentUsdc();
  if (spent + Number(usdcAmount) > DAILY_CAP_USDC) {
    return { error: 'Daily spending cap exceeded', cap: DAILY_CAP_USDC, spent: spent.toFixed(2), requested: String(usdcAmount), remaining: (DAILY_CAP_USDC - spent).toFixed(2) };
  }
  return null;
}

// Read raw balance helpers (used by precheck + balance endpoints)
async function getEthBalanceWei(ctx) {
  return await ctx.public.getBalance({ address: account.address });
}
async function getUsdcBalanceRaw(ctx) {
  if (!ctx.usdc) return 0n;
  return await ctx.public.readContract({
    address: ctx.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
}
async function getTokenBalanceRaw(ctx, tokenAddress) {
  return await ctx.public.readContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Uniswap v3 swaps (Robinhood Chain).
// Router/quoter/factory/WETH/USDG addresses are from the official Uniswap v3
// Robinhood Chain deployment docs, cross-checked on-chain (router.factory(),
// router.WETH9(), pool token0/token1). Stock-token symbols are resolved at
// runtime via the Blockscout explorer and MUST carry Robinhood verification
// signals (official "Robinhood Token" name, robinhood CDN icon, or explorer
// admin verification). Ticker collisions and spoofed pools are common on
// this chain — never resolve a token by liquidity or by symbol alone.
// ─────────────────────────────────────────────────────────────────────────
var UNISWAP_V3 = {
  robinhood: {
    factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    router: '0xcaf681a66d020601342297493863e78c959e5cb2',
    quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
    weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    explorerSearch: 'https://robinhoodchain.blockscout.com/api/v2/search?q=',
    explorerTx: 'https://robinhoodchain.blockscout.com/tx/',
  },
};
var UNI_FEE_TIERS = [100, 500, 3000, 10000];
var UNI_MULTIHOP_TIERS = [100, 500, 3000];

var QUOTER_V2_ABI = [
  { name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96AfterList', type: 'uint160[]' }, { name: 'initializedTicksCrossedList', type: 'uint32[]' }, { name: 'gasEstimate', type: 'uint256' }] },
  { name: 'quoteExactInput', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96AfterList', type: 'uint160[]' }, { name: 'initializedTicksCrossedList', type: 'uint32[]' }, { name: 'gasEstimate', type: 'uint256' }] },
];
var SWAP_ROUTER_ABI = [
  { name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
    outputs: [{ name: 'amountOut', type: 'uint256' }] },
  { name: 'exactInput', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }] }],
    outputs: [{ name: 'amountOut', type: 'uint256' }] },
  { name: 'multicall', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }], outputs: [{ name: 'results', type: 'bytes[]' }] },
  { name: 'unwrapWETH9', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'amountMinimum', type: 'uint256' }, { name: 'recipient', type: 'address' }], outputs: [] },
];
var WETH_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
];
var ERC20_SPEND_ABI = [
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
];

// Token symbol -> contract resolution (cached; negative results cached briefly)
var _tokenResolveCache = {};
var TOKEN_CACHE_TTL_MS = 60 * 60 * 1000;
var TOKEN_NEG_CACHE_TTL_MS = 60 * 1000;

async function resolveSwapToken(ctx, rawInput) {
  var cfg = UNISWAP_V3[ctx.name];
  if (!cfg) return { error: 'Swaps are not configured on ' + ctx.name, supported: Object.keys(UNISWAP_V3) };
  var input = String(rawInput || '').trim();
  if (!input) return { error: 'token symbol or address required' };
  var lower = input.toLowerCase();
  if (lower === 'eth') return { address: cfg.weth, symbol: 'ETH', decimals: 18, native: true, verified: true };
  if (lower === 'weth') return { address: cfg.weth, symbol: 'WETH', decimals: 18, verified: true };
  if (lower === 'usdg') return { address: cfg.usdg, symbol: 'USDG', decimals: 6, verified: true };
  if (lower === 'usdc' || lower === 'usdt') return {
    error: 'There is no canonical ' + input.toUpperCase() + ' on Robinhood Chain — every token with that ticker here is unverified/spoofed.',
    hint: 'The dollar token on this chain is USDG (Robinhood, 6 decimals). Use "usdg".',
  };
  if (isAddress(input)) {
    var sym = ''; var dec = 18;
    try { sym = String(await ctx.public.readContract({ address: input, abi: ERC20_ABI, functionName: 'symbol' })); } catch (_e) {}
    try { dec = Number(await ctx.public.readContract({ address: input, abi: ERC20_ABI, functionName: 'decimals' })); } catch (_e) {}
    return { address: input.toLowerCase(), symbol: sym || input, decimals: dec, verified: false,
      warning: 'Raw address input — NOT verified as an official Robinhood token. Ticker collisions are common on Robinhood Chain; confirm this contract before trading size.' };
  }
  var cacheKey = ctx.name + ':' + lower;
  var hit = _tokenResolveCache[cacheKey];
  var now = Date.now();
  if (hit && (now - hit.t) < (hit.token ? TOKEN_CACHE_TTL_MS : TOKEN_NEG_CACHE_TTL_MS)) {
    if (hit.token) return hit.token;
    return { error: 'No verified Robinhood token found for symbol "' + input + '" (cached miss — retry in a minute or pass a 0x address)' };
  }
  var candidates = [];
  try {
    var resp = await globalThis.fetch(cfg.explorerSearch + encodeURIComponent(input), { signal: AbortSignal.timeout(8000) });
    var data = await resp.json();
    var items = (data && data.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type !== 'token') continue;
      if (String(it.symbol || '').toUpperCase() !== input.toUpperCase()) continue;
      var verified = false;
      if (it.icon_url && String(it.icon_url).indexOf('cdn.robinhood.com') > -1) verified = true;
      if (/robinhood token/i.test(String(it.name || ''))) verified = true;
      if (it.is_verified_via_admin_panel === true) verified = true;
      candidates.push({ address: String(it.address_hash || '').toLowerCase(), name: it.name, symbol: it.symbol, verified: verified });
    }
  } catch (e) {
    return { error: 'Token registry lookup failed: ' + e.message };
  }
  var pick = null;
  for (var j = 0; j < candidates.length; j++) { if (candidates[j].verified) { pick = candidates[j]; break; } }
  if (!pick) {
    _tokenResolveCache[cacheKey] = { t: now, token: null };
    return {
      error: 'No VERIFIED Robinhood token found for symbol "' + input + '".',
      hint: 'Ticker collisions are common on this chain and symbol-only matches are refused. If you know the exact contract, pass it as a 0x address instead.',
      candidates: candidates.map(function(c) { return { address: c.address, name: c.name, symbol: c.symbol }; }).slice(0, 5),
    };
  }
  var dec2 = 18; var sym2 = pick.symbol;
  try { dec2 = Number(await ctx.public.readContract({ address: pick.address, abi: ERC20_ABI, functionName: 'decimals' })); } catch (_e) {}
  try { sym2 = String(await ctx.public.readContract({ address: pick.address, abi: ERC20_ABI, functionName: 'symbol' })); } catch (_e) {}
  var token = { address: pick.address, symbol: sym2, name: pick.name, decimals: dec2, verified: true, verifiedVia: 'blockscout-robinhood-signals' };
  _tokenResolveCache[cacheKey] = { t: now, token: token };
  return token;
}

// Best-route quote: single hop across all fee tiers, then two-hop via USDG / WETH.
async function quoteBestRoute(ctx, cfg, tokenInAddr, tokenOutAddr, amountIn) {
  var best = null;
  for (var i = 0; i < UNI_FEE_TIERS.length; i++) {
    var fee = UNI_FEE_TIERS[i];
    try {
      var q = await ctx.public.readContract({
        address: cfg.quoter, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: tokenInAddr, tokenOut: tokenOutAddr, amountIn: amountIn, fee: fee, sqrtPriceLimitX96: 0n }],
      });
      var amountOut = q.amountOut !== undefined ? q.amountOut : q[0];
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { amountOut: amountOut, kind: 'single', fee: fee, gasEstimate: (q.gasEstimate !== undefined ? q.gasEstimate : q[3]) };
      }
    } catch (_e) { /* no pool at this tier */ }
  }
  if (best) return best;
  var mids = [cfg.usdg, cfg.weth];
  for (var m = 0; m < mids.length; m++) {
    var mid = mids[m];
    if (mid === tokenInAddr.toLowerCase() || mid === tokenOutAddr.toLowerCase()) continue;
    for (var f1 = 0; f1 < UNI_MULTIHOP_TIERS.length; f1++) {
      for (var f2 = 0; f2 < UNI_MULTIHOP_TIERS.length; f2++) {
        try {
          var path = encodePacked(
            ['address', 'uint24', 'address', 'uint24', 'address'],
            [tokenInAddr, UNI_MULTIHOP_TIERS[f1], mid, UNI_MULTIHOP_TIERS[f2], tokenOutAddr]
          );
          var q2 = await ctx.public.readContract({
            address: cfg.quoter, abi: QUOTER_V2_ABI, functionName: 'quoteExactInput',
            args: [path, amountIn],
          });
          var out2 = q2.amountOut !== undefined ? q2.amountOut : q2[0];
          if (out2 > 0n && (!best || out2 > best.amountOut)) {
            best = { amountOut: out2, kind: 'multi', path: path, fees: [UNI_MULTIHOP_TIERS[f1], UNI_MULTIHOP_TIERS[f2]], via: mid, gasEstimate: (q2.gasEstimate !== undefined ? q2.gasEstimate : q2[3]) };
          }
        } catch (_e2) { /* no route via this mid/tier combo */ }
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────
// Clawtrl Private Payments (vendored px402 ZK engine — see src/privacy/NOTICE.md)
// Opt-in: only active when CLAWTRL_PRIVACY_ENABLED=true. Notes are stored
// encrypted (AES-256-GCM) with a key derived from the agent wallet key.
// ─────────────────────────────────────────────────────────────────────────
var PRIVACY_ENABLED = (env.CLAWTRL_PRIVACY_ENABLED || process.env.CLAWTRL_PRIVACY_ENABLED || '') === 'true';
var PRIVACY_CHAIN = (env.CLAWTRL_PRIVACY_CHAIN || process.env.CLAWTRL_PRIVACY_CHAIN || 'base').toLowerCase();
var _privacyMod = null;
async function loadPrivacy() {
  if (_privacyMod) return _privacyMod;
  // Compiled CommonJS vendored engine lives next to this file in ../privacy-dist
  var url = new URL('./privacy-dist/clawtrl.js', import.meta.url);
  _privacyMod = await import(url.href);
  return _privacyMod;
}
// Deterministic note-encryption password derived from the wallet key (never stored).
var PRIVACY_NOTE_PASSWORD = createHash('sha256').update('clawtrl-privacy-note:' + pk).digest('hex');
function getPrivacyNotePath() {
  var candidates = [
    '/root/.hermes/skills/clawtrl-wallet/privacy-note.enc',
    '/opt/clawtrl/wallet-tools/privacy-note.enc',
    HOME + '/.clawtrl/privacy-note.enc',
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { if (existsSync(dirname(candidates[i]))) return candidates[i]; } catch (_e) {}
  }
  return HOME + '/.clawtrl-privacy-note.enc';
}
var PRIVACY_NOTE_PATH = getPrivacyNotePath();
async function loadPrivacyNote() {
  try {
    if (!existsSync(PRIVACY_NOTE_PATH)) return null;
    var enc = readFileSync(PRIVACY_NOTE_PATH, 'utf-8').trim();
    if (!enc) return null;
    var mod = await loadPrivacy();
    return await mod.decryptNote(enc, PRIVACY_NOTE_PASSWORD);
  } catch (e) {
    console.error('Failed to load privacy note:', e.message);
    return null;
  }
}
async function savePrivacyNote(note) {
  var mod = await loadPrivacy();
  var enc = await mod.encryptNote(note, PRIVACY_NOTE_PASSWORD);
  writeFileSync(PRIVACY_NOTE_PATH, enc, { mode: 0o600 });
}
// Merge a freshly-deposited note's commitments into the stored note (UTXO accumulate).
function mergeNotes(existing, fresh) {
  if (!existing || !existing.commitments || existing.commitments.length === 0) return fresh;
  return { version: fresh.version || existing.version || '2.0', commitments: existing.commitments.concat(fresh.commitments) };
}

// Initialize x402 payment-wrapped fetch
var x402Fetch = null;
if (x402Loaded && x402WrapFetch) {
  try {
    if (x402ClientInstance) {
      // v2: register EVM signer on x402Client, then wrap fetch
      var evmMod = await import('@x402/evm/exact/client');
      evmMod.registerExactEvmScheme(x402ClientInstance, { signer: account });
      x402Fetch = x402WrapFetch(globalThis.fetch, x402ClientInstance);
      console.log('x402 v2 payment fetch ready (scheme: exact, default chain: ' + DEFAULT_CHAIN_NAME + ')');
    } else {
      // v1 fallback: wrapFetchWithPayment(fetch, walletClient)
      x402Fetch = x402WrapFetch(globalThis.fetch, DEFAULT_CTX.wallet);
      console.log('x402 v1 payment fetch ready');
    }
  } catch(e) {
    console.log('Failed to init x402 fetch: ' + e.message);
  }
}

// ERC-8128: sign an HTTP request with the agent wallet
async function erc8128Sign(url, method, body, chainId) {
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var bodyStr = body || '';
  var bodyHash = createHash('sha256').update(bodyStr).digest('hex');
  var cid = String(chainId || DEFAULT_CTX.chain.id);
  var message = [method.toUpperCase(), url, bodyHash, timestamp, cid].join('\n');
  var signature = await account.signMessage({ message: message });
  return {
    'X-ERC8128-Address': account.address,
    'X-ERC8128-Signature': signature,
    'X-ERC8128-Timestamp': timestamp,
    'X-ERC8128-Chain-Id': cid,
  };
}

function readBody(req) {
  return new Promise(function(resolve) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
  });
}

function jsonRes(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    return jsonRes(res, 200, { status: 'ok', address: account.address, chain: DEFAULT_CHAIN_NAME, chainId: DEFAULT_CTX.chain.id, chains: Object.keys(CHAIN_REGISTRY), swapChains: Object.keys(UNISWAP_V3), privacy: PRIVACY_ENABLED });
  }

  if (req.url === '/identity') {
    return jsonRes(res, 200, { address: account.address, chain: DEFAULT_CHAIN_NAME, chainId: DEFAULT_CTX.chain.id, chains: Object.keys(CHAIN_REGISTRY) });
  }

  if (req.url === '/balance' || req.url.indexOf('/balance?') === 0) {
    try {
      var bqs = req.url.indexOf('?') > -1 ? req.url.split('?')[1] : '';
      var bqm = /chain=([a-z0-9-]+)/.exec(bqs);
      var bctx = chainCtxOr400(res, bqm ? bqm[1] : null);
      if (!bctx) return;
      var ethBal = await bctx.public.getBalance({ address: account.address });
      var usdcBal = 0n;
      if (bctx.usdc) {
        usdcBal = await bctx.public.readContract({
          address: bctx.usdc, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
          functionName: 'balanceOf', args: [account.address],
        });
      }
      var formatEther = function(wei) { return (Number(wei) / 1e18).toFixed(8); };
      var formatUsdc = function(raw) { return (Number(raw) / 1e6).toFixed(2); };
      return jsonRes(res, 200, { address: account.address, chain: bctx.name, eth: formatEther(ethBal), usdc: formatUsdc(usdcBal) });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/transfer' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.to || !body.amount) return jsonRes(res, 400, { error: 'to and amount required' });
      var tctx = chainCtxOr400(res, body.chain);
      if (!tctx) return;

      // Resolve ENS if recipient looks like a name
      var toAddr = body.to;
      if (typeof toAddr === 'string' && toAddr.indexOf('.') > 0 && !isAddress(toAddr)) {
        try {
          var resolved = await mainnetClient.getEnsAddress({ name: toAddr });
          if (!resolved) return jsonRes(res, 400, { error: 'ENS name did not resolve', name: toAddr });
          toAddr = resolved;
        } catch (e) { return jsonRes(res, 400, { error: 'ENS resolution failed: ' + e.message }); }
      }
      if (!isAddress(toAddr)) return jsonRes(res, 400, { error: 'Invalid recipient address', to: body.to });

      var token = (body.token || 'eth').toLowerCase();
      var txHash;
      if (token === 'usdc' && !tctx.usdc) return jsonRes(res, 400, { error: 'USDC is not configured on ' + tctx.name + '. Set CLAWTRL_WALLET_USDC to enable.' });
      // Spending cap check
      if (token === 'usdc') {
        var capErr = checkSpendingCap(body.amount);
        if (capErr) return jsonRes(res, 403, capErr);
      }
      // Balance precheck (reject early if insufficient)
      var ethBal = await getEthBalanceWei(tctx);
      if (token === 'usdc') {
        var amt = parseUnits(String(body.amount), 6);
        var usdcBal = await getUsdcBalanceRaw(tctx);
        if (usdcBal < amt) {
          return jsonRes(res, 400, { error: 'Insufficient USDC balance', have: formatUnits(usdcBal, 6), need: String(body.amount) });
        }
        if (ethBal === 0n) {
          return jsonRes(res, 400, { error: 'No ETH for gas on ' + tctx.chain.name + '. Fund the wallet with a small amount of ETH first.' });
        }
        var data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [toAddr, amt] });
        txHash = await tctx.wallet.sendTransaction({ to: tctx.usdc, data: data });
      } else {
        var weiAmount = BigInt(Math.floor(Number(body.amount) * 1e18));
        if (ethBal < weiAmount) {
          return jsonRes(res, 400, { error: 'Insufficient ETH balance', have: (Number(ethBal) / 1e18).toFixed(8), need: String(body.amount) });
        }
        txHash = await tctx.wallet.sendTransaction({ to: toAddr, value: weiAmount });
      }
      logTx({ type: 'transfer', chain: tctx.name, token: token, amount: body.amount, to: toAddr, originalTo: body.to, hash: txHash, status: 'submitted', usdcValue: token === 'usdc' ? body.amount : undefined });
      try {
        await tctx.public.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
        logTx({ type: 'transfer', chain: tctx.name, token: token, amount: body.amount, to: toAddr, hash: txHash, status: 'confirmed' });
      } catch (_e) {
        // Timed out waiting — still return the hash; user can check tx-status
      }
      return jsonRes(res, 200, { success: true, hash: txHash, chain: tctx.name, token: token, amount: body.amount, to: toAddr, resolved: toAddr !== body.to });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/token-balance' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.token || !isAddress(body.token)) return jsonRes(res, 400, { error: 'token (ERC-20 contract address) required' });
      var tbctx = chainCtxOr400(res, body.chain);
      if (!tbctx) return;
      var raw = await getTokenBalanceRaw(tbctx, body.token);
      var decimals = 18; var symbol = '';
      try { decimals = Number(await tbctx.public.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'decimals' })); } catch (_e) {}
      try { symbol = String(await tbctx.public.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'symbol' })); } catch (_e) {}
      return jsonRes(res, 200, {
        token: body.token, symbol: symbol, decimals: decimals,
        balance: formatUnits(raw, decimals), raw: raw.toString(),
        address: account.address, chain: tbctx.name,
      });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/tx-status' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.hash) return jsonRes(res, 400, { error: 'hash required' });
      var txctx = chainCtxOr400(res, body.chain);
      if (!txctx) return;
      try {
        var receipt = await txctx.public.getTransactionReceipt({ hash: body.hash });
        return jsonRes(res, 200, {
          hash: body.hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(), from: receipt.from, to: receipt.to, chain: txctx.name,
        });
      } catch (_e) {
        // Not mined yet — check tx
        try {
          var tx = await txctx.public.getTransaction({ hash: body.hash });
          return jsonRes(res, 200, { hash: body.hash, status: 'pending', from: tx.from, to: tx.to, value: tx.value.toString(), chain: txctx.name });
        } catch (_e2) {
          return jsonRes(res, 404, { error: 'Transaction not found on ' + txctx.chain.name, hash: body.hash });
        }
      }
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/contract-read' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.address || !isAddress(body.address)) return jsonRes(res, 400, { error: 'address required' });
      if (!body.signature) return jsonRes(res, 400, { error: 'signature required (e.g. "function balanceOf(address) view returns (uint256)")' });
      var crctx = chainCtxOr400(res, body.chain);
      if (!crctx) return;
      var sig = body.signature.trim();
      if (sig.indexOf('function ') !== 0) sig = 'function ' + sig;
      var abi = [parseAbiItem(sig)];
      var fnName = abi[0].name;
      var args = body.args || [];
      var result = await crctx.public.readContract({ address: body.address, abi: abi, functionName: fnName, args: args });
      // Serialize BigInts
      var serialized = JSON.parse(JSON.stringify(result, function(_k, v) { return typeof v === 'bigint' ? v.toString() : v; }));
      return jsonRes(res, 200, { address: body.address, function: fnName, args: args, result: serialized, chain: crctx.name });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/contract-write' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.address || !isAddress(body.address)) return jsonRes(res, 400, { error: 'address required' });
      if (!body.signature) return jsonRes(res, 400, { error: 'signature required (e.g. "function approve(address,uint256)")' });
      var sig2 = body.signature.trim();
      if (sig2.indexOf('function ') !== 0) sig2 = 'function ' + sig2;
      var abi2 = [parseAbiItem(sig2)];
      var fnName2 = abi2[0].name;
      var args2 = body.args || [];
      var cwctx = chainCtxOr400(res, body.chain);
      if (!cwctx) return;
      var value = body.value ? BigInt(Math.floor(Number(body.value) * 1e18)) : 0n;
      var ethBal2 = await getEthBalanceWei(cwctx);
      if (ethBal2 < value) return jsonRes(res, 400, { error: 'Insufficient ETH for value + gas', have: formatUnits(ethBal2, 18) });
      var data2 = encodeFunctionData({ abi: abi2, functionName: fnName2, args: args2 });
      var txHash2 = await cwctx.wallet.sendTransaction({ to: body.address, data: data2, value: value });
      logTx({ type: 'contract-write', chain: cwctx.name, address: body.address, function: fnName2, args: args2, value: body.value || '0', hash: txHash2, status: 'submitted' });
      return jsonRes(res, 200, { success: true, hash: txHash2, address: body.address, function: fnName2, chain: cwctx.name });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/ens' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.name && !body.address) return jsonRes(res, 400, { error: 'name or address required' });
      if (body.name) {
        var addr = await mainnetClient.getEnsAddress({ name: body.name });
        return jsonRes(res, 200, { name: body.name, address: addr });
      }
      var name = await mainnetClient.getEnsName({ address: body.address });
      return jsonRes(res, 200, { address: body.address, name: name });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/gas-estimate' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var gctx = chainCtxOr400(res, body.chain);
      if (!gctx) return;
      var gasPrice = await gctx.public.getGasPrice();
      var estGas = 21000n;
      if (body.address || body.data) {
        try {
          estGas = await gctx.public.estimateGas({
            account: account.address,
            to: body.address || body.to,
            data: body.data,
            value: body.value ? BigInt(Math.floor(Number(body.value) * 1e18)) : undefined,
          });
        } catch (_e) { /* fall back to default */ }
      }
      var totalWei = gasPrice * estGas;
      var ethCost = Number(totalWei) / 1e18;
      return jsonRes(res, 200, {
        gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(4),
        estimatedGas: estGas.toString(),
        estimatedCostEth: ethCost.toFixed(8),
        chain: gctx.name,
      });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/tx-log' || req.url.indexOf('/tx-log?') === 0) {
    try {
      var limit = 50;
      if (req.url.indexOf('?') > -1) {
        var qs = req.url.split('?')[1];
        var m = /limit=(\d+)/.exec(qs);
        if (m) limit = Math.min(500, parseInt(m[1], 10));
      }
      if (!existsSync(TX_LOG_PATH)) return jsonRes(res, 200, { entries: [], path: TX_LOG_PATH });
      var raw = readFileSync(TX_LOG_PATH, 'utf-8').trim();
      var lines = raw.length ? raw.split('\n') : [];
      var recent = lines.slice(-limit).map(function(l) { try { return JSON.parse(l); } catch (_e) { return { raw: l }; } });
      return jsonRes(res, 200, { entries: recent, total: lines.length, path: TX_LOG_PATH });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/sign' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var sctx = chainCtxOr400(res, body.chain);
      if (!sctx) return;
      var hdrs = await erc8128Sign(body.url, body.method || 'GET', body.body || '', sctx.chain.id);
      return jsonRes(res, 200, { headers: hdrs });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/fetch' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var method = body.method || 'GET';
      var fctx = chainCtxOr400(res, body.chain);
      if (!fctx) return;
      var headers = Object.assign({}, body.headers || {});
      // Add ERC-8128 signature headers
      var sigHeaders = await erc8128Sign(body.url, method, body.body || '', fctx.chain.id);
      Object.assign(headers, sigHeaders);
      var init = { method: method, headers: headers };
      if (body.body) init.body = body.body;

      var response;
      if (x402Fetch) {
        // x402 payment — auto-handles 402 responses
        console.log('fetch via x402: ' + method + ' ' + body.url);
        response = await x402Fetch(body.url, init);
      } else if (typeof globalThis.fetch === 'function') {
        // Fallback: plain fetch (no x402 payment handling)
        console.log('fetch (no x402): ' + method + ' ' + body.url);
        response = await globalThis.fetch(body.url, init);
      } else {
        return jsonRes(res, 500, { error: 'No fetch implementation available. Ensure Node 18+ is installed.' });
      }

      var respBody = await response.text();
      var respHdrs = {};
      response.headers.forEach(function(v, k) { respHdrs[k] = v; });
      // If the response carries an x402 payment proof header, the SDK paid for us — log it
      if (respHdrs['x-payment-response'] || respHdrs['x-payment-proof']) {
        logTx({ type: 'x402-payment', url: body.url, method: method, proof: respHdrs['x-payment-response'] || respHdrs['x-payment-proof'], status: 'paid' });
      }
      return jsonRes(res, 200, { status: response.status, headers: respHdrs, body: respBody });
    } catch(e) {
      console.error('/fetch error:', e.message);
      return jsonRes(res, 500, { error: e.message });
    }
  }

  if (req.url === '/token-allowance' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.token || !isAddress(body.token)) return jsonRes(res, 400, { error: 'token (ERC-20 contract address) required' });
      if (!body.spender || !isAddress(body.spender)) return jsonRes(res, 400, { error: 'spender address required' });
      var actx = chainCtxOr400(res, body.chain);
      if (!actx) return;
      var allowanceAbi = [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }];
      var raw = await actx.public.readContract({ address: body.token, abi: allowanceAbi, functionName: 'allowance', args: [account.address, body.spender] });
      var decimals = 18; var symbol = '';
      try { decimals = Number(await actx.public.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'decimals' })); } catch (_e) {}
      try { symbol = String(await actx.public.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'symbol' })); } catch (_e) {}
      return jsonRes(res, 200, { token: body.token, symbol: symbol, spender: body.spender, allowance: formatUnits(raw, decimals), raw: raw.toString(), owner: account.address });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/token-revoke' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.token || !isAddress(body.token)) return jsonRes(res, 400, { error: 'token (ERC-20 contract address) required' });
      if (!body.spender || !isAddress(body.spender)) return jsonRes(res, 400, { error: 'spender address required' });
      var rctx = chainCtxOr400(res, body.chain);
      if (!rctx) return;
      var revokeAbi = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }];
      var data = encodeFunctionData({ abi: revokeAbi, functionName: 'approve', args: [body.spender, 0n] });
      var txHash = await rctx.wallet.sendTransaction({ to: body.token, data: data });
      logTx({ type: 'token-revoke', chain: rctx.name, token: body.token, spender: body.spender, hash: txHash, status: 'submitted' });
      return jsonRes(res, 200, { success: true, hash: txHash, token: body.token, spender: body.spender, chain: rctx.name });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/wallet-summary' || req.url.indexOf('/wallet-summary?') === 0) {
    try {
      var wqs = req.url.indexOf('?') > -1 ? req.url.split('?')[1] : '';
      var wqm = /chain=([a-z0-9-]+)/.exec(wqs);
      var wctx = chainCtxOr400(res, wqm ? wqm[1] : null);
      if (!wctx) return;
      var ethBal = await getEthBalanceWei(wctx);
      var usdcBal = await getUsdcBalanceRaw(wctx);
      var todaySpent = getTodaySpentUsdc();
      // Recent 5 transactions
      var recent = [];
      try {
        if (existsSync(TX_LOG_PATH)) {
          var raw = readFileSync(TX_LOG_PATH, 'utf-8').trim();
          var lines = raw ? raw.split('\n') : [];
          recent = lines.slice(-5).map(function(l) { try { return JSON.parse(l); } catch (_e) { return { raw: l }; } });
        }
      } catch (_e) {}
      // Active approvals (check USDC + any known tokens)
      var approvals = [];
      try {
        var allowanceAbi = [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }];
        // Check USDC approvals from recent contract-write txs
        var seenSpenders = {};
        if (existsSync(TX_LOG_PATH)) {
          var raw2 = readFileSync(TX_LOG_PATH, 'utf-8').trim();
          var lines2 = raw2 ? raw2.split('\n') : [];
          for (var i = lines2.length - 1; i >= 0 && Object.keys(seenSpenders).length < 10; i--) {
            try {
              var e = JSON.parse(lines2[i]);
              if (e.type === 'contract-write' && e.function === 'approve' && e.address && e.args && e.args[0]) {
                var spender = e.args[0];
                if (!seenSpenders[spender]) {
                  seenSpenders[spender] = true;
                  try {
                    var allowance = await wctx.public.readContract({ address: e.address, abi: allowanceAbi, functionName: 'allowance', args: [account.address, spender] });
                    if (allowance > 0n) approvals.push({ token: e.address, spender: spender, allowance: allowance.toString() });
                  } catch (_e2) {}
                }
              }
            } catch (_e3) {}
          }
        }
      } catch (_e) {}
      return jsonRes(res, 200, {
        address: account.address, chain: wctx.name, chainId: wctx.chain.id,
        balances: { eth: formatUnits(ethBal, 18), usdc: formatUnits(usdcBal, 6) },
        spending: { todaySpentUsdc: todaySpent.toFixed(2), dailyCap: DAILY_CAP_USDC || null },
        approvals: approvals,
        recentTransactions: recent,
      });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/wallet-stats') {
    try {
      var stats = { totalTransfers: 0, totalContractWrites: 0, totalX402Payments: 0, totalUsdcSpent: 0, totalEthSpent: 0, byDay: {}, topContracts: {} };
      if (existsSync(TX_LOG_PATH)) {
        var raw = readFileSync(TX_LOG_PATH, 'utf-8').trim();
        var lines = raw ? raw.split('\n') : [];
        for (var i = 0; i < lines.length; i++) {
          try {
            var e = JSON.parse(lines[i]);
            var day = e.timestamp ? e.timestamp.slice(0, 10) : 'unknown';
            if (!stats.byDay[day]) stats.byDay[day] = { transfers: 0, contractWrites: 0, x402Payments: 0, usdcSpent: 0 };
            if (e.type === 'transfer') {
              stats.totalTransfers++;
              stats.byDay[day].transfers++;
              if (e.token === 'usdc' && e.amount) { var v = Number(e.amount); stats.totalUsdcSpent += v; stats.byDay[day].usdcSpent += v; }
              if (e.token === 'eth' && e.amount) stats.totalEthSpent += Number(e.amount);
            } else if (e.type === 'contract-write') {
              stats.totalContractWrites++;
              stats.byDay[day].contractWrites++;
              if (e.address) { stats.topContracts[e.address] = (stats.topContracts[e.address] || 0) + 1; }
            } else if (e.type === 'x402-payment') {
              stats.totalX402Payments++;
              stats.byDay[day].x402Payments++;
            }
          } catch (_e) {}
        }
      }
      return jsonRes(res, 200, {
        totals: { transfers: stats.totalTransfers, contractWrites: stats.totalContractWrites, x402Payments: stats.totalX402Payments, usdcSpent: stats.totalUsdcSpent.toFixed(2), ethSpent: stats.totalEthSpent.toFixed(8) },
        byDay: stats.byDay,
        topContracts: stats.topContracts,
        logPath: TX_LOG_PATH,
      });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/contract-events' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.address || !isAddress(body.address)) return jsonRes(res, 400, { error: 'address required' });
      if (!body.event) return jsonRes(res, 400, { error: 'event signature required (e.g. "event Transfer(address indexed from, address indexed to, uint256 value)")' });
      var ectx = chainCtxOr400(res, body.chain);
      if (!ectx) return;
      var evtSig = body.event.trim();
      if (evtSig.indexOf('event ') !== 0) evtSig = 'event ' + evtSig;
      var fromBlock = body.fromBlock ? BigInt(body.fromBlock) : 0n;
      var toBlock = body.toBlock ? BigInt(body.toBlock) : await ectx.public.getBlockNumber();
      var evtAbi = [parseAbiItem(evtSig)];
      var logs = await ectx.public.getLogs({
        address: body.address,
        event: evtAbi[0],
        fromBlock: fromBlock,
        toBlock: toBlock,
        args: body.filter || {},
      });
      var serialized = logs.map(function(l) {
        return {
          address: l.address,
          blockNumber: l.blockNumber.toString(),
          transactionHash: l.transactionHash,
          args: JSON.parse(JSON.stringify(l.args, function(_k, v) { return typeof v === 'bigint' ? v.toString() : v; })),
        };
      });
      return jsonRes(res, 200, { address: body.address, event: evtSig, count: serialized.length, logs: serialized.slice(0, 100) });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/token-price' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var pctx = chainCtxOr400(res, body.chain);
      if (!pctx) return;
      // Known Chainlink price feeds on Base mainnet (lowercase — viem rejects bad checksums)
      var FEEDS = {
        'eth': '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70',
        'usdc': '0x7e860098f58bbfc8648a4311b374b1d669a2bc6b',
        'usdt': '0xf19d560eb8d2adf07bd6d13ed03e1d11215721f9',
        'weth': '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70',
        'dai': '0x591e79239a7d679378ec8c847e5038150364c78f',
      };
      var feedAddr = body.feed || FEEDS[(body.token || 'eth').toLowerCase()];
      if (!feedAddr) return jsonRes(res, 400, { error: 'Unknown token. Provide a Chainlink feed address or use: eth, usdc, usdt, weth, dai' });
      if (!body.feed && pctx.name !== 'base') {
        return jsonRes(res, 400, { error: 'Named feeds are configured for Base mainnet only. On ' + pctx.name + ', pass an explicit Chainlink feed address via "feed". Robinhood Chain stock-token feeds: https://docs.robinhood.com/chain' });
      }
      var feedAbi = [parseAbiItem('function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)')];
      var data = await pctx.public.readContract({ address: feedAddr, abi: feedAbi, functionName: 'latestRoundData' });
      var answer = data.answer !== undefined ? data.answer : data[1];
      var updatedAt = data.updatedAt !== undefined ? data.updatedAt : data[3];
      var price = Number(answer) / 1e8;
      return jsonRes(res, 200, { token: body.token || 'eth', price: price, decimals: 8, feed: feedAddr, chain: pctx.name, updatedAt: String(updatedAt) });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  // Uniswap v3 swap: quote -> approve -> execute. Exact-input only.
  // body: { tokenIn, tokenOut, amount, chain?, slippageBps?, quoteOnly? }
  if (req.url === '/swap' && req.method === 'POST') {
    try {
      var swbody = JSON.parse(await readBody(req));
      if (!swbody.tokenIn || !swbody.tokenOut || !swbody.amount) {
        return jsonRes(res, 400, { error: 'tokenIn, tokenOut and amount required', example: { tokenIn: 'usdg', tokenOut: 'tsla', amount: '10', chain: 'robinhood' } });
      }
      var swctx = chainCtxOr400(res, swbody.chain);
      if (!swctx) return;
      var swcfg = UNISWAP_V3[swctx.name];
      if (!swcfg) return jsonRes(res, 400, { error: 'Swaps are not configured on ' + swctx.name, supported: Object.keys(UNISWAP_V3) });
      var tin = await resolveSwapToken(swctx, swbody.tokenIn);
      if (tin.error) return jsonRes(res, 400, tin);
      var tout = await resolveSwapToken(swctx, swbody.tokenOut);
      if (tout.error) return jsonRes(res, 400, tout);
      var slippageBps = swbody.slippageBps !== undefined ? Number(swbody.slippageBps) : 50;
      if (!(slippageBps >= 1 && slippageBps <= 5000)) return jsonRes(res, 400, { error: 'slippageBps must be between 1 and 5000 (default 50 = 0.5%)' });
      var amountIn;
      try { amountIn = parseUnits(String(swbody.amount), tin.decimals); } catch (_e) { return jsonRes(res, 400, { error: 'Invalid amount "' + swbody.amount + '" for ' + tin.decimals + '-decimal token' }); }
      if (amountIn <= 0n) return jsonRes(res, 400, { error: 'amount must be positive' });
      var warnings = [];
      if (tin.warning) warnings.push(tin.warning);
      if (tout.warning) warnings.push(tout.warning);

      // WETH wrap/unwrap shortcuts (eth <-> weth need no router)
      var wantsWrap = tin.native && String(swbody.tokenOut).toLowerCase() === 'weth';
      var wantsUnwrap = String(swbody.tokenIn).toLowerCase() === 'weth' && tout.native;
      if (wantsWrap || wantsUnwrap) {
        if (swbody.quoteOnly) {
          return jsonRes(res, 200, { quoteOnly: true, chain: swctx.name, kind: wantsWrap ? 'wrap' : 'unwrap',
            tokenIn: { symbol: tin.symbol, amount: String(swbody.amount) }, tokenOut: { symbol: tout.symbol, expectedOut: String(swbody.amount) }, warnings: warnings });
        }
        var wHash;
        if (wantsWrap) {
          var wEthBal = await getEthBalanceWei(swctx);
          if (wEthBal < amountIn) return jsonRes(res, 400, { error: 'Insufficient ETH balance', have: formatUnits(wEthBal, 18), need: String(swbody.amount) });
          wHash = await swctx.wallet.sendTransaction({ to: swcfg.weth, data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }), value: amountIn });
        } else {
          var wBal = await getTokenBalanceRaw(swctx, swcfg.weth);
          if (wBal < amountIn) return jsonRes(res, 400, { error: 'Insufficient WETH balance', have: formatUnits(wBal, 18), need: String(swbody.amount) });
          wHash = await swctx.wallet.sendTransaction({ to: swcfg.weth, data: encodeFunctionData({ abi: WETH_ABI, functionName: 'withdraw', args: [amountIn] }) });
        }
        logTx({ type: wantsWrap ? 'wrap' : 'unwrap', chain: swctx.name, amount: String(swbody.amount), hash: wHash, status: 'submitted' });
        var wReceipt = await swctx.public.waitForTransactionReceipt({ hash: wHash, timeout: 60000 });
        return jsonRes(res, 200, { success: wReceipt.status === 'success', hash: wHash, status: wReceipt.status, kind: wantsWrap ? 'wrap' : 'unwrap',
          tokenIn: { symbol: tin.symbol, amount: String(swbody.amount) }, tokenOut: { symbol: tout.symbol, amount: String(swbody.amount) },
          explorer: swcfg.explorerTx + wHash, warnings: warnings });
      }

      if (tin.address === tout.address) return jsonRes(res, 400, { error: 'tokenIn and tokenOut resolve to the same token', address: tin.address });

      var quote = await quoteBestRoute(swctx, swcfg, tin.address, tout.address, amountIn);
      if (!quote) return jsonRes(res, 400, { error: 'No Uniswap v3 route found', tokenIn: tin.symbol, tokenOut: tout.symbol, hint: 'The pair may have no liquidity on the official v3 deployment. Try quoting the reverse direction or a smaller amount.' });
      var minOut = quote.amountOut * BigInt(10000 - slippageBps) / 10000n;
      var viaSymbol = quote.kind === 'multi' ? (quote.via === swcfg.usdg ? 'USDG' : 'WETH') : null;
      var quoteOut = {
        chain: swctx.name, router: swcfg.router,
        tokenIn: { symbol: tin.symbol, address: tin.address, amount: String(swbody.amount), decimals: tin.decimals, verified: !!tin.verified },
        tokenOut: { symbol: tout.symbol, address: tout.address, expectedOut: formatUnits(quote.amountOut, tout.decimals), decimals: tout.decimals, verified: !!tout.verified },
        route: viaSymbol ? [tin.symbol, viaSymbol, tout.symbol] : [tin.symbol, tout.symbol],
        fees: quote.kind === 'single' ? [quote.fee] : quote.fees,
        slippageBps: slippageBps, minOut: formatUnits(minOut, tout.decimals),
        gasEstimate: quote.gasEstimate !== undefined ? String(quote.gasEstimate) : undefined,
        warnings: warnings,
      };
      if (swbody.quoteOnly) return jsonRes(res, 200, Object.assign({ quoteOnly: true }, quoteOut));

      // Balance precheck + router approval (ERC-20 input only)
      if (tin.native) {
        var ethBalSw = await getEthBalanceWei(swctx);
        if (ethBalSw < amountIn) return jsonRes(res, 400, { error: 'Insufficient ETH balance (need amount + gas)', have: formatUnits(ethBalSw, 18), need: String(swbody.amount) });
      } else {
        var balIn = await getTokenBalanceRaw(swctx, tin.address);
        if (balIn < amountIn) return jsonRes(res, 400, { error: 'Insufficient ' + tin.symbol + ' balance', have: formatUnits(balIn, tin.decimals), need: String(swbody.amount) });
        var curAllowance = await swctx.public.readContract({ address: tin.address, abi: ERC20_SPEND_ABI, functionName: 'allowance', args: [account.address, swcfg.router] });
        if (curAllowance < amountIn) {
          var approveHash = await swctx.wallet.sendTransaction({ to: tin.address, data: encodeFunctionData({ abi: ERC20_SPEND_ABI, functionName: 'approve', args: [swcfg.router, amountIn] }) });
          logTx({ type: 'approve', chain: swctx.name, token: tin.address, spender: swcfg.router, amount: String(swbody.amount), hash: approveHash, status: 'submitted' });
          var appReceipt = await swctx.public.waitForTransactionReceipt({ hash: approveHash, timeout: 30000 });
          if (appReceipt.status !== 'success') return jsonRes(res, 500, { error: 'Router approval transaction failed', approvalHash: approveHash });
          quoteOut.approvalHash = approveHash;
        }
      }

      // Execute (native-out goes through multicall + unwrapWETH9)
      var outBefore = tout.native ? await getEthBalanceWei(swctx) : await getTokenBalanceRaw(swctx, tout.address);
      var swapRecipient = tout.native ? swcfg.router : account.address;
      var swapCall;
      if (quote.kind === 'single') {
        swapCall = encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'exactInputSingle', args: [{
          tokenIn: tin.address, tokenOut: tout.address, fee: quote.fee, recipient: swapRecipient,
          amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
        }] });
      } else {
        swapCall = encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'exactInput', args: [{
          path: quote.path, recipient: swapRecipient, amountIn: amountIn, amountOutMinimum: minOut,
        }] });
      }
      var swapData = swapCall;
      if (tout.native) {
        var unwrapCall = encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'unwrapWETH9', args: [minOut, account.address] });
        swapData = encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'multicall', args: [[swapCall, unwrapCall]] });
      }
      var swapHash = await swctx.wallet.sendTransaction({ to: swcfg.router, data: swapData, value: tin.native ? amountIn : 0n });
      logTx({ type: 'swap', chain: swctx.name, tokenIn: tin.symbol, tokenOut: tout.symbol, amountIn: String(swbody.amount), expectedOut: quoteOut.tokenOut.expectedOut, hash: swapHash, status: 'submitted' });
      var swReceipt = await swctx.public.waitForTransactionReceipt({ hash: swapHash, timeout: 60000 });
      var outAfter = tout.native ? await getEthBalanceWei(swctx) : await getTokenBalanceRaw(swctx, tout.address);
      var actualOut = outAfter > outBefore ? outAfter - outBefore : 0n;
      logTx({ type: 'swap', chain: swctx.name, tokenIn: tin.symbol, tokenOut: tout.symbol, amountIn: String(swbody.amount), actualOut: formatUnits(actualOut, tout.decimals), hash: swapHash, status: swReceipt.status });
      return jsonRes(res, 200, Object.assign({
        success: swReceipt.status === 'success', hash: swapHash, status: swReceipt.status,
        actualOut: formatUnits(actualOut, tout.decimals), gasUsed: swReceipt.gasUsed.toString(),
        explorer: swcfg.explorerTx + swapHash,
      }, quoteOut));
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/address-book' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var book = loadAddressBook();
      if (body.action === 'set' && body.label && body.address) {
        if (!isAddress(body.address)) return jsonRes(res, 400, { error: 'Invalid address' });
        book[body.label.toLowerCase()] = body.address;
        saveAddressBook(book);
        return jsonRes(res, 200, { action: 'set', label: body.label, address: body.address });
      }
      if (body.action === 'remove' && body.label) {
        delete book[body.label.toLowerCase()];
        saveAddressBook(book);
        return jsonRes(res, 200, { action: 'remove', label: body.label });
      }
      if (body.action === 'resolve' && body.label) {
        var addr = book[body.label.toLowerCase()];
        return jsonRes(res, 200, { label: body.label, address: addr || null, found: !!addr });
      }
      // Default: list all
      return jsonRes(res, 200, { labels: book, count: Object.keys(book).length });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  // Send a raw transaction (for LI.FI bridge/swap transactionRequests)
  if (req.url === '/send-raw-tx' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.to) return jsonRes(res, 400, { error: 'to address required' });
      var clients = getBridgeClients(body.chainId || 8453);
      var txParams = { to: body.to, account: account };
      if (body.data) txParams.data = body.data;
      if (body.value) txParams.value = BigInt(body.value);
      if (body.gasLimit) txParams.gas = BigInt(body.gasLimit);
      var txHash = await clients.wc.sendTransaction(txParams);
      logTx({ type: 'raw-tx', chainId: body.chainId || 8453, to: body.to, hash: txHash, status: 'submitted' });
      var receipt = await clients.pc.waitForTransactionReceipt({ hash: txHash, timeout: 60000 });
      return jsonRes(res, 200, { success: true, hash: txHash, status: receipt.status });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  // Approve ERC20 token spending (for LI.FI allowance)
  if (req.url === '/approve-token' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.token || !body.spender) return jsonRes(res, 400, { error: 'token and spender required' });
      var clients = getBridgeClients(body.chainId || 8453);
      var amt = body.amount ? BigInt(body.amount) : BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      var data = encodeFunctionData({
        abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }],
        functionName: 'approve', args: [body.spender, amt],
      });
      var txHash = await clients.wc.sendTransaction({ to: body.token, data: data });
      logTx({ type: 'approve', chainId: body.chainId || 8453, token: body.token, spender: body.spender, hash: txHash, status: 'submitted' });
      var receipt = await clients.pc.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
      return jsonRes(res, 200, { success: true, hash: txHash, status: receipt.status });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  // ── Clawtrl Private Payments (px402 ZK) ────────────────────────────────
  if (req.url && req.url.indexOf('/privacy/') === 0) {
    if (!PRIVACY_ENABLED) {
      return jsonRes(res, 403, {
        error: 'Private payments are disabled',
        hint: 'Set CLAWTRL_PRIVACY_ENABLED=true in the environment to opt in.',
        note: 'Deposits enter the px402 shared privacy pool; see clawtrl-wallet privacy docs.',
      });
    }

    if (req.url === '/privacy/status' && req.method === 'GET') {
      try {
        var mod = await loadPrivacy();
        var note = await loadPrivacyNote();
        var bal = note ? mod.getNoteBalance(note) : 0;
        return jsonRes(res, 200, {
          enabled: true, chain: PRIVACY_CHAIN,
          hasNote: !!note, balance: bal.toFixed(6),
          commitments: note ? note.commitments.length : 0,
          allowedDepositAmounts: mod.ALLOWED_DEPOSIT_AMOUNTS,
        });
      } catch (e) { return jsonRes(res, 500, { error: e.message }); }
    }

    if (req.url === '/privacy/balance' && req.method === 'GET') {
      try {
        var mod = await loadPrivacy();
        var note = await loadPrivacyNote();
        if (!note) return jsonRes(res, 200, { balance: '0.000000', hasNote: false });
        return jsonRes(res, 200, { balance: mod.getNoteBalance(note).toFixed(6), hasNote: true, commitments: note.commitments.length });
      } catch (e) { return jsonRes(res, 500, { error: e.message }); }
    }

    if (req.url === '/privacy/deposit' && req.method === 'POST') {
      try {
        var body = JSON.parse(await readBody(req));
        var amount = Number(body.amount);
        var mod = await loadPrivacy();
        if (mod.ALLOWED_DEPOSIT_AMOUNTS.indexOf(amount) < 0) {
          return jsonRes(res, 400, { error: 'Invalid deposit amount', allowed: mod.ALLOWED_DEPOSIT_AMOUNTS });
        }
        var capErr = checkSpendingCap(amount);
        if (capErr) return jsonRes(res, 403, capErr);
        // ERC-3009 gasless deposit into the pool (single signed tx).
        var sdk = mod.createPrivacySDK(PRIVACY_CHAIN);
        var fresh = await sdk.depositFast(amount, pk);
        var merged = mergeNotes(await loadPrivacyNote(), fresh);
        await savePrivacyNote(merged);
        logTx({ type: 'privacy-deposit', token: 'usdc', amount: String(amount), usdcValue: amount, chain: PRIVACY_CHAIN, status: 'confirmed' });
        return jsonRes(res, 200, { success: true, deposited: amount, balance: mod.getNoteBalance(merged).toFixed(6), chain: PRIVACY_CHAIN });
      } catch (e) { return jsonRes(res, 500, { error: e.message }); }
    }

    if (req.url === '/privacy/pay' && req.method === 'POST') {
      try {
        var body = JSON.parse(await readBody(req));
        if (!body.to || !isAddress(body.to)) return jsonRes(res, 400, { error: 'valid "to" address required' });
        var amount = Number(body.amount);
        if (!amount || amount <= 0) return jsonRes(res, 400, { error: 'positive "amount" (USDC) required' });
        var mod = await loadPrivacy();
        var note = await loadPrivacyNote();
        if (!note) return jsonRes(res, 400, { error: 'No private balance. Deposit first with private-deposit.' });
        if (!mod.hasEnoughBalance(note, amount)) {
          return jsonRes(res, 400, { error: 'Insufficient private balance', have: mod.getNoteBalance(note).toFixed(6), need: String(amount) });
        }
        var sdk = mod.createPrivacySDK(PRIVACY_CHAIN);
        sdk.setNote(note);
        var result = await sdk.makePayment(note, body.to, amount);
        await savePrivacyNote(result.note);
        logTx({ type: 'privacy-payment', token: 'usdc', amount: String(amount), usdcValue: amount, to: body.to, hash: result.txHash, chain: PRIVACY_CHAIN, status: 'confirmed' });
        return jsonRes(res, 200, { success: true, txHash: result.txHash, to: body.to, amount: amount, balance: mod.getNoteBalance(result.note).toFixed(6) });
      } catch (e) { return jsonRes(res, 500, { error: e.message }); }
    }

    if (req.url === '/privacy/fetch' && req.method === 'POST') {
      try {
        var body = JSON.parse(await readBody(req));
        if (!body.url) return jsonRes(res, 400, { error: 'url required' });
        var mod = await loadPrivacy();
        var note = await loadPrivacyNote();
        if (!note) return jsonRes(res, 400, { error: 'No private balance. Deposit first with private-deposit.' });
        var sdk = mod.createPrivacySDK(PRIVACY_CHAIN);
        sdk.setNote(note);
        var privateFetch = sdk.wrapFetch(globalThis.fetch);
        var init = { method: body.method || 'GET', headers: body.headers || {} };
        if (body.body) { init.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body); init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json'; }
        var resp = await privateFetch(body.url, init);
        var text = await resp.text();
        var updated = sdk.getUpdatedNote();
        if (updated) await savePrivacyNote(updated);
        logTx({ type: 'privacy-fetch', url: body.url, status: resp.status, chain: PRIVACY_CHAIN });
        var out; try { out = JSON.parse(text); } catch (_e) { out = text; }
        return jsonRes(res, 200, { status: resp.status, ok: resp.ok, data: out, balance: updated ? mod.getNoteBalance(updated).toFixed(6) : undefined });
      } catch (e) { return jsonRes(res, 500, { error: e.message }); }
    }

    return jsonRes(res, 404, { error: 'unknown privacy endpoint', endpoints: ['/privacy/status', '/privacy/balance', '/privacy/deposit', '/privacy/pay', '/privacy/fetch'] });
  }

  jsonRes(res, 404, { error: 'not found' });
}

createServer(handler).listen(8128, '127.0.0.1', function() {
  console.log('Clawtrl signing proxy on 127.0.0.1:8128 | wallet: ' + account.address);
});
