import { createServer } from 'node:http';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, encodeFunctionData, parseAbiItem, isAddress, namehash } from 'viem';
import { base, mainnet } from 'viem/chains';

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

var USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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
var pk = env.AGENT_WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_PRIVATE_KEY;
if (!pk || !pk.startsWith('0x')) {
  console.error('AGENT_WALLET_PRIVATE_KEY not found or invalid');
  console.error('Searched: /opt/openclaw/.env, ~/.clawtrl/.env, ~/.env, .env, $AGENT_WALLET_PRIVATE_KEY');
  process.exit(1);
}

var account = privateKeyToAccount(pk);

var walletClient = createWalletClient({
  account: account,
  chain: base,
  transport: http('https://mainnet.base.org'),
});
var publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

// Mainnet client for ENS lookups (ENS lives on Ethereum mainnet)
var mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
});

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

// Read raw balance helpers (used by precheck + balance endpoints)
async function getEthBalanceWei() {
  return await publicClient.getBalance({ address: account.address });
}
async function getUsdcBalanceRaw() {
  return await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
}
async function getTokenBalanceRaw(tokenAddress) {
  return await publicClient.readContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
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
      console.log('x402 v2 payment fetch ready (scheme: exact, network: base)');
    } else {
      // v1 fallback: wrapFetchWithPayment(fetch, walletClient)
      x402Fetch = x402WrapFetch(globalThis.fetch, walletClient);
      console.log('x402 v1 payment fetch ready');
    }
  } catch(e) {
    console.log('Failed to init x402 fetch: ' + e.message);
  }
}

// ERC-8128: sign an HTTP request with the agent wallet
async function erc8128Sign(url, method, body) {
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var bodyStr = body || '';
  var bodyHash = createHash('sha256').update(bodyStr).digest('hex');
  var message = [method.toUpperCase(), url, bodyHash, timestamp, '8453'].join('\n');
  var signature = await account.signMessage({ message: message });
  return {
    'X-ERC8128-Address': account.address,
    'X-ERC8128-Signature': signature,
    'X-ERC8128-Timestamp': timestamp,
    'X-ERC8128-Chain-Id': '8453',
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
    return jsonRes(res, 200, { status: 'ok', address: account.address, chain: 'base', chainId: 8453 });
  }

  if (req.url === '/identity') {
    return jsonRes(res, 200, { address: account.address, chain: 'base', chainId: 8453 });
  }

  if (req.url === '/balance') {
    try {
      var ethBal = await publicClient.getBalance({ address: account.address });
      var usdcBal = await publicClient.readContract({
        address: USDC, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
        functionName: 'balanceOf', args: [account.address],
      });
      var formatEther = function(wei) { return (Number(wei) / 1e18).toFixed(8); };
      var formatUsdc = function(raw) { return (Number(raw) / 1e6).toFixed(2); };
      return jsonRes(res, 200, { address: account.address, chain: 'base', eth: formatEther(ethBal), usdc: formatUsdc(usdcBal) });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/transfer' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.to || !body.amount) return jsonRes(res, 400, { error: 'to and amount required' });

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
      // Balance precheck (reject early if insufficient)
      var ethBal = await getEthBalanceWei();
      if (token === 'usdc') {
        var amt = parseUnits(String(body.amount), 6);
        var usdcBal = await getUsdcBalanceRaw();
        if (usdcBal < amt) {
          return jsonRes(res, 400, { error: 'Insufficient USDC balance', have: formatUnits(usdcBal, 6), need: String(body.amount) });
        }
        if (ethBal === 0n) {
          return jsonRes(res, 400, { error: 'No ETH for gas on Base. Fund the wallet with a small amount of ETH first.' });
        }
        var data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [toAddr, amt] });
        txHash = await walletClient.sendTransaction({ to: USDC, data: data });
      } else {
        var weiAmount = BigInt(Math.floor(Number(body.amount) * 1e18));
        if (ethBal < weiAmount) {
          return jsonRes(res, 400, { error: 'Insufficient ETH balance', have: (Number(ethBal) / 1e18).toFixed(8), need: String(body.amount) });
        }
        txHash = await walletClient.sendTransaction({ to: toAddr, value: weiAmount });
      }
      logTx({ type: 'transfer', token: token, amount: body.amount, to: toAddr, originalTo: body.to, hash: txHash, status: 'submitted' });
      try {
        await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
        logTx({ type: 'transfer', token: token, amount: body.amount, to: toAddr, hash: txHash, status: 'confirmed' });
      } catch (_e) {
        // Timed out waiting — still return the hash; user can check tx-status
      }
      return jsonRes(res, 200, { success: true, hash: txHash, token: token, amount: body.amount, to: toAddr, resolved: toAddr !== body.to });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/token-balance' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.token || !isAddress(body.token)) return jsonRes(res, 400, { error: 'token (ERC-20 contract address) required' });
      var raw = await getTokenBalanceRaw(body.token);
      var decimals = 18; var symbol = '';
      try { decimals = Number(await publicClient.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'decimals' })); } catch (_e) {}
      try { symbol = String(await publicClient.readContract({ address: body.token, abi: ERC20_ABI, functionName: 'symbol' })); } catch (_e) {}
      return jsonRes(res, 200, {
        token: body.token, symbol: symbol, decimals: decimals,
        balance: formatUnits(raw, decimals), raw: raw.toString(),
        address: account.address, chain: 'base',
      });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/tx-status' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.hash) return jsonRes(res, 400, { error: 'hash required' });
      try {
        var receipt = await publicClient.getTransactionReceipt({ hash: body.hash });
        return jsonRes(res, 200, {
          hash: body.hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(), from: receipt.from, to: receipt.to,
        });
      } catch (_e) {
        // Not mined yet — check tx
        try {
          var tx = await publicClient.getTransaction({ hash: body.hash });
          return jsonRes(res, 200, { hash: body.hash, status: 'pending', from: tx.from, to: tx.to, value: tx.value.toString() });
        } catch (_e2) {
          return jsonRes(res, 404, { error: 'Transaction not found on Base', hash: body.hash });
        }
      }
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/contract-read' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      if (!body.address || !isAddress(body.address)) return jsonRes(res, 400, { error: 'address required' });
      if (!body.signature) return jsonRes(res, 400, { error: 'signature required (e.g. "function balanceOf(address) view returns (uint256)")' });
      var sig = body.signature.trim();
      if (sig.indexOf('function ') !== 0) sig = 'function ' + sig;
      var abi = [parseAbiItem(sig)];
      var fnName = abi[0].name;
      var args = body.args || [];
      var result = await publicClient.readContract({ address: body.address, abi: abi, functionName: fnName, args: args });
      // Serialize BigInts
      var serialized = JSON.parse(JSON.stringify(result, function(_k, v) { return typeof v === 'bigint' ? v.toString() : v; }));
      return jsonRes(res, 200, { address: body.address, function: fnName, args: args, result: serialized });
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
      var value = body.value ? BigInt(Math.floor(Number(body.value) * 1e18)) : 0n;
      var ethBal2 = await getEthBalanceWei();
      if (ethBal2 < value) return jsonRes(res, 400, { error: 'Insufficient ETH for value + gas', have: formatUnits(ethBal2, 18) });
      var data2 = encodeFunctionData({ abi: abi2, functionName: fnName2, args: args2 });
      var txHash2 = await walletClient.sendTransaction({ to: body.address, data: data2, value: value });
      logTx({ type: 'contract-write', address: body.address, function: fnName2, args: args2, value: body.value || '0', hash: txHash2, status: 'submitted' });
      return jsonRes(res, 200, { success: true, hash: txHash2, address: body.address, function: fnName2 });
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
      var gasPrice = await publicClient.getGasPrice();
      var estGas = 21000n;
      if (body.address || body.data) {
        try {
          estGas = await publicClient.estimateGas({
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
        chain: 'base',
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
      var hdrs = await erc8128Sign(body.url, body.method || 'GET', body.body || '');
      return jsonRes(res, 200, { headers: hdrs });
    } catch(e) { return jsonRes(res, 500, { error: e.message }); }
  }

  if (req.url === '/fetch' && req.method === 'POST') {
    try {
      var body = JSON.parse(await readBody(req));
      var method = body.method || 'GET';
      var headers = Object.assign({}, body.headers || {});
      // Add ERC-8128 signature headers
      var sigHeaders = await erc8128Sign(body.url, method, body.body || '');
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

  jsonRes(res, 404, { error: 'not found' });
}

createServer(handler).listen(8128, '127.0.0.1', function() {
  console.log('Clawtrl signing proxy on 127.0.0.1:8128 | wallet: ' + account.address);
});
