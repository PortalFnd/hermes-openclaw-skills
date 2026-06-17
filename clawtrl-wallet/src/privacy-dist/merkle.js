"use strict";
// @ts-nocheck
/**
 * Merkle tree utilities - Automatic commitment indexing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleMerkleTree = void 0;
exports.addPendingCommitment = addPendingCommitment;
exports.clearPendingCommitments = clearPendingCommitments;
exports.fetchMerkleProofFromSubgraph = fetchMerkleProofFromSubgraph;
exports.fetchMerkleProof = fetchMerkleProof;
const crypto_1 = require("./crypto");
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const subgraph_1 = require("./subgraph");
const logger_1 = require("./logger");
const TREE_DEPTH = 20;
// In-memory cache for Merkle trees (lasts for session)
const treeCache = new Map();
/**
 * Simple Merkle Tree implementation
 */
class SimpleMerkleTree {
    constructor(depth) {
        this.depth = depth;
        this.leaves = [];
        this.zeros = [];
        this.zeros[0] = '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
    async computeZeros() {
        for (let i = 1; i < this.depth; i++) {
            this.zeros[i] = await (0, crypto_1.poseidonHash2)(this.zeros[i - 1], this.zeros[i - 1]);
        }
    }
    insert(commitment) {
        this.leaves.push(commitment.toLowerCase());
    }
    async getRoot() {
        if (this.zeros.length <= 1) {
            await this.computeZeros();
        }
        if (this.leaves.length === 0) {
            return this.zeros[this.depth - 1];
        }
        let currentLevel = [...this.leaves];
        for (let level = 0; level < this.depth; level++) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeros[level];
                const parent = await (0, crypto_1.poseidonHash2)(left, right);
                nextLevel.push(parent);
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
    async getProof(leafIndex) {
        if (leafIndex >= this.leaves.length) {
            throw new Error('Leaf index out of bounds');
        }
        const pathElements = [];
        const pathIndices = [];
        let currentIndex = leafIndex;
        let currentLevel = [...this.leaves];
        for (let level = 0; level < this.depth; level++) {
            const isLeft = currentIndex % 2 === 0;
            const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
            let sibling;
            if (siblingIndex < currentLevel.length) {
                sibling = currentLevel[siblingIndex];
            }
            else {
                sibling = this.zeros[level] || '0x0000000000000000000000000000000000000000000000000000000000000000';
            }
            pathElements.push(sibling);
            pathIndices.push(isLeft ? 0 : 1);
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length
                    ? currentLevel[i + 1]
                    : this.zeros[level] || '0x0000000000000000000000000000000000000000000000000000000000000000';
                const parent = await (0, crypto_1.poseidonHash2)(left, right);
                nextLevel.push(parent);
            }
            currentLevel = nextLevel;
            currentIndex = Math.floor(currentIndex / 2);
        }
        return { pathElements, pathIndices };
    }
}
exports.SimpleMerkleTree = SimpleMerkleTree;
/**
 * Poseidon hash for 2 inputs (for Merkle tree)
 */
async function poseidonHash2Impl(left, right) {
    // Browser: Use window.poseidonHash2 from poseidon-browser.js
    if (typeof window !== 'undefined' && window.poseidonHash2) {
        return window.poseidonHash2(left, right);
    }
    // Node.js: Use circomlibjs
    try {
        const { buildPoseidon } = require('circomlibjs');
        const poseidon = await buildPoseidon();
        const hash = poseidon.F.toString(poseidon([BigInt(left), BigInt(right)]));
        return hash;
    }
    catch (error) {
        throw new Error('Poseidon hash not available. Install circomlibjs or load poseidon-browser.js');
    }
}
// Override the import to use local implementation
const poseidonHash2Local = poseidonHash2Impl;
/**
 * Helper: Fetch event chunks with throttling
 */
async function fetchEventChunks(publicClient, chainConfig, chunks) {
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 500;
    const chunkResults = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        logger_1.logger.debug(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}...`);
        const batchResults = await Promise.all(batch.map(async ({ start, end }) => {
            const [deposits, sponsored] = await Promise.all([
                publicClient.getLogs({
                    address: chainConfig.poolAddress,
                    event: (0, viem_1.parseAbiItem)('event Deposit(bytes32 indexed commitment, uint256 denomination, uint256 leafIndex)'),
                    fromBlock: start,
                    toBlock: end,
                }),
                publicClient.getLogs({
                    address: chainConfig.poolAddress,
                    event: (0, viem_1.parseAbiItem)('event Sponsored(bytes32 indexed nullifierHash, address indexed merchant, uint256 paymentAmount, bytes32 changeCommitment, uint256 changeAmount)'),
                    fromBlock: start,
                    toBlock: end,
                }),
            ]);
            return { deposits, sponsored };
        }));
        chunkResults.push(...batchResults);
        if (i + BATCH_SIZE < chunks.length) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
    }
    // Extract events
    const events = [];
    let totalDeposits = 0;
    let totalSponsored = 0;
    for (const { deposits, sponsored } of chunkResults) {
        totalDeposits += deposits.length;
        totalSponsored += sponsored.filter((log) => log.args.changeAmount && BigInt(log.args.changeAmount) > 0n).length;
        events.push(...deposits.map((log) => ({
            blockNumber: log.blockNumber,
            transactionIndex: log.transactionIndex || 0,
            commitment: log.args.commitment,
        })));
        events.push(...sponsored
            .filter((log) => log.args.changeAmount && BigInt(log.args.changeAmount) > 0n)
            .map((log) => ({
            blockNumber: log.blockNumber,
            transactionIndex: log.transactionIndex || 0,
            commitment: log.args.changeCommitment,
        })));
    }
    logger_1.logger.debug(`Found ${totalDeposits} deposits, ${totalSponsored} sponsored with change`);
    return events;
}
/**
 * Helper: Build tree and get proof
 */
async function buildTreeAndGetProof(commitment, allEvents, currentBlock, cacheKey, chainConfig, root) {
    logger_1.logger.debug(`Building Merkle tree with ${allEvents.length} commitments...`);
    const tree = new SimpleMerkleTree(TREE_DEPTH);
    await tree.computeZeros();
    const commitmentToIndex = new Map();
    for (let i = 0; i < allEvents.length; i++) {
        const { commitment: eventCommitment } = allEvents[i];
        tree.insert(eventCommitment);
        commitmentToIndex.set(eventCommitment.toLowerCase(), i);
    }
    const computedRoot = await tree.getRoot();
    logger_1.logger.debug('Computed root:', computedRoot);
    // Normalize both roots to hex for comparison
    const normalizeRoot = (r) => {
        if (r.startsWith('0x')) {
            return r.toLowerCase();
        }
        // Convert decimal string to hex
        return '0x' + BigInt(r).toString(16).padStart(64, '0');
    };
    const computedRootHex = normalizeRoot(computedRoot);
    const onChainRootHex = normalizeRoot(root);
    logger_1.logger.debug('🔐 Computed root (hex):', computedRootHex);
    logger_1.logger.debug('🔐 On-chain root (hex):', onChainRootHex);
    if (computedRootHex !== onChainRootHex) {
        throw new Error(`Merkle root mismatch! Computed: ${computedRootHex}, On-chain: ${onChainRootHex}`);
    }
    logger_1.logger.debug('✅ Merkle root verified!');
    const commitmentLower = commitment.toLowerCase();
    const leafIndex = commitmentToIndex.get(commitmentLower);
    if (leafIndex === undefined) {
        throw new Error(`Commitment ${commitment} not found in tree. ` +
            `This could mean: 1) Commitment not yet indexed (wait a few seconds), ` +
            `2) Invalid commitment, or 3) Already spent`);
    }
    logger_1.logger.debug(`📍 Found commitment at leaf index: ${leafIndex}`);
    treeCache.set(cacheKey, {
        blockNumber: currentBlock,
        tree,
        commitmentToIndex,
        allEvents,
    });
    logger_1.logger.debug(`💾 Cached tree for future requests`);
    const proof = await tree.getProof(leafIndex);
    return {
        root,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
    };
}
/**
 * Fetch Merkle proof using The Graph subgraph (FAST - <1 second!)
 */
// Global pending commitments that haven't been indexed yet
// Format: { commitment: string, blockNumber: bigint }
let pendingCommitments = [];
/**
 * Add a pending commitment (called after deposit)
 */
function addPendingCommitment(commitment, blockNumber) {
    pendingCommitments.push({ commitment: commitment.toLowerCase(), blockNumber });
    logger_1.logger.debug(`📝 Added pending commitment: ${commitment.substring(0, 18)}...`);
}
/**
 * Clear pending commitments (called when subgraph catches up)
 */
function clearPendingCommitments() {
    pendingCommitments = [];
}
async function fetchMerkleProofFromSubgraph(commitment, chainConfig) {
    logger_1.logger.debug(`\n⚡ Fetching Merkle proof from subgraph for ${chainConfig.chainName}...`);
    // Create subgraph client
    const subgraph = new subgraph_1.SubgraphClient(chainConfig.chainName);
    // Fetch commitments from subgraph (instant!)
    const commitments = await subgraph.getAllCommitments();
    logger_1.logger.debug(`✅ Found ${commitments.length} commitments from subgraph`);
    // Get subgraph's latest block
    const subgraphLatestBlock = commitments.length > 0
        ? BigInt(commitments[commitments.length - 1].blockNumber)
        : 0n;
    logger_1.logger.debug(`📍 Subgraph indexed up to block ${subgraphLatestBlock}`);
    // Get current block
    const chain = chainConfig.chainId === 8453 ? chains_1.base : chains_1.polygon;
    const publicClient = (0, viem_1.createPublicClient)({
        chain,
        transport: (0, viem_1.http)(chainConfig.rpcUrl),
    });
    const currentBlock = await publicClient.getBlockNumber();
    const blocksBehind = currentBlock - subgraphLatestBlock;
    logger_1.logger.debug(`📍 Current block: ${currentBlock} (subgraph is ${blocksBehind} blocks behind)`);
    // If subgraph is behind, fetch recent commits via RPC
    if (blocksBehind > 10n) {
        logger_1.logger.debug(`🔄 Fetching ${blocksBehind} recent blocks via RPC to fill gap...`);
        const fromBlock = subgraphLatestBlock + 1n;
        const CHUNK_SIZE = 9999n;
        const chunks = [];
        for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
            const end = start + CHUNK_SIZE - 1n > currentBlock ? currentBlock : start + CHUNK_SIZE - 1n;
            chunks.push({ start, end });
        }
        const recentEvents = await fetchEventChunks(publicClient, chainConfig, chunks);
        // Add recent commits to our list
        for (const event of recentEvents) {
            commitments.push({
                id: event.commitment,
                leafIndex: '0',
                amount: '0',
                blockNumber: event.blockNumber.toString(),
                blockTimestamp: '0',
                transactionHash: '0x',
                transactionIndex: event.transactionIndex.toString(),
                isSpent: false,
            });
        }
        logger_1.logger.debug(`✅ Added ${recentEvents.length} recent commitments from RPC`);
        logger_1.logger.debug(`✅ Total commitments: ${commitments.length}`);
    }
    // Add any pending commitments that haven't been indexed yet
    if (pendingCommitments.length > 0) {
        logger_1.logger.debug(`📝 Adding ${pendingCommitments.length} pending commitment(s)...`);
        for (const pending of pendingCommitments) {
            // Check if already in the list
            const exists = commitments.some(c => c.id.toLowerCase() === pending.commitment.toLowerCase());
            if (!exists) {
                commitments.push({
                    id: pending.commitment,
                    leafIndex: '0',
                    amount: '0',
                    blockNumber: pending.blockNumber.toString(),
                    blockTimestamp: '0',
                    transactionHash: '0x',
                    transactionIndex: '999999', // High index to put at end of block
                    isSpent: false,
                });
                logger_1.logger.debug(`  ✅ Added pending: ${pending.commitment.substring(0, 18)}...`);
            }
            else {
                logger_1.logger.debug(`  ⏭️ Pending already indexed: ${pending.commitment.substring(0, 18)}...`);
            }
        }
        logger_1.logger.debug(`✅ Total commitments after pending: ${commitments.length}`);
    }
    // Sort commitments chronologically (by block, then tx index)
    commitments.sort((a, b) => {
        const blockDiff = BigInt(a.blockNumber) - BigInt(b.blockNumber);
        if (blockDiff !== 0n) {
            return Number(blockDiff);
        }
        return Number(BigInt(a.transactionIndex) - BigInt(b.transactionIndex));
    });
    logger_1.logger.debug(`🔄 Sorted ${commitments.length} commitments chronologically`);
    // Build tree
    const tree = new SimpleMerkleTree(TREE_DEPTH);
    await tree.computeZeros();
    const commitmentToIndex = new Map();
    for (let i = 0; i < commitments.length; i++) {
        const { id: eventCommitment } = commitments[i];
        tree.insert(eventCommitment);
        commitmentToIndex.set(eventCommitment.toLowerCase(), i);
    }
    // Get on-chain root for verification (reuse publicClient from earlier)
    const POOL_ABI = [
        {
            inputs: [],
            name: 'currentRootIndex',
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [{ name: '', type: 'uint256' }],
            name: 'rootHistory',
            outputs: [{ name: '', type: 'bytes32' }],
            stateMutability: 'view',
            type: 'function',
        },
    ];
    const currentRootIndex = (await publicClient.readContract({
        address: chainConfig.poolAddress,
        abi: POOL_ABI,
        functionName: 'currentRootIndex',
    }));
    // Use ONLY the current root index - don't scan ahead for pre-computed roots
    const root = (await publicClient.readContract({
        address: chainConfig.poolAddress,
        abi: POOL_ABI,
        functionName: 'rootHistory',
        args: [currentRootIndex],
    }));
    logger_1.logger.debug('📍 Using Merkle root:', root, `(index ${currentRootIndex})`);
    // Compute tree root
    const computedRoot = await tree.getRoot();
    // Normalize both roots for comparison
    const normalizeRoot = (r) => {
        if (r.startsWith('0x')) {
            return r.toLowerCase();
        }
        return '0x' + BigInt(r).toString(16).padStart(64, '0');
    };
    const computedRootHex = normalizeRoot(computedRoot);
    const onChainRootHex = normalizeRoot(root);
    logger_1.logger.debug('🔐 Computed root:', computedRootHex);
    logger_1.logger.debug('🔐 On-chain root:', onChainRootHex);
    if (computedRootHex !== onChainRootHex) {
        throw new Error(`Merkle root mismatch! Computed: ${computedRootHex}, On-chain: ${onChainRootHex}`);
    }
    logger_1.logger.debug('✅ Merkle root verified!');
    // Find commitment index
    // Normalize commitment to hex format (subgraph stores as hex)
    const commitmentHex = commitment.startsWith('0x')
        ? commitment.toLowerCase()
        : '0x' + BigInt(commitment).toString(16).padStart(64, '0');
    const leafIndex = commitmentToIndex.get(commitmentHex);
    if (leafIndex === undefined) {
        throw new Error(`Commitment ${commitment} not found in tree. ` +
            `This could mean: 1) Invalid commitment, 2) Already spent, or 3) Not yet indexed by subgraph`);
    }
    logger_1.logger.debug(`📍 Found commitment at leaf index: ${leafIndex}`);
    // Get proof
    const proof = await tree.getProof(leafIndex);
    logger_1.logger.debug('✅ Merkle proof generated from subgraph data!');
    return {
        root,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
    };
}
/**
 * Fetch Merkle proof for a commitment (Legacy RPC method)
 * This works automatically - no user setup required!
 */
async function fetchMerkleProof(commitment, chainConfig) {
    const chain = chainConfig.chainId === 8453 ? chains_1.base : chains_1.polygon;
    const publicClient = (0, viem_1.createPublicClient)({
        chain,
        transport: (0, viem_1.http)(chainConfig.rpcUrl),
    });
    logger_1.logger.debug(`📡 Fetching Merkle proof from ${chainConfig.chainName}...`);
    // Read current root from contract (rootHistory[currentRootIndex])
    const POOL_ABI = [
        {
            inputs: [],
            name: 'currentRootIndex',
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [{ name: '', type: 'uint256' }],
            name: 'rootHistory',
            outputs: [{ name: '', type: 'bytes32' }],
            stateMutability: 'view',
            type: 'function',
        },
    ];
    // Get current root index
    const currentRootIndex = (await publicClient.readContract({
        address: chainConfig.poolAddress,
        abi: POOL_ABI,
        functionName: 'currentRootIndex',
    }));
    // Use ONLY the current root index - don't scan ahead for pre-computed roots
    const root = (await publicClient.readContract({
        address: chainConfig.poolAddress,
        abi: POOL_ABI,
        functionName: 'rootHistory',
        args: [currentRootIndex],
    }));
    logger_1.logger.debug('📍 Using Merkle root:', root, `(index ${currentRootIndex})`);
    // Get current block
    const currentBlock = await publicClient.getBlockNumber();
    // Check cache
    const cacheKey = `${chainConfig.poolAddress.toLowerCase()}-${chainConfig.chainId}`;
    const cached = treeCache.get(cacheKey);
    // Determine starting block
    const deploymentBlock = chainConfig.chainId === 8453 ? 22743200n : 0n; // Base mainnet deployment
    // Use cache if recent (within 100 blocks)
    if (cached && currentBlock - cached.blockNumber < 100n) {
        logger_1.logger.debug(`💾 Using cached tree (${currentBlock - cached.blockNumber} blocks old)`);
        const fromBlock = cached.blockNumber + 1n;
        const allEvents = [...cached.allEvents];
        // Fetch only new blocks since cache
        const CHUNK_SIZE = 9999n;
        const chunks = [];
        for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
            const end = start + CHUNK_SIZE - 1n > currentBlock ? currentBlock : start + CHUNK_SIZE - 1n;
            chunks.push({ start, end });
        }
        if (chunks.length > 0) {
            logger_1.logger.debug(`🔍 Fetching ${chunks.length} new chunks since cache...`);
            const newEvents = await fetchEventChunks(publicClient, chainConfig, chunks);
            allEvents.push(...newEvents);
            // Sort chronologically
            allEvents.sort((a, b) => {
                if (a.blockNumber !== b.blockNumber) {
                    return Number(a.blockNumber - b.blockNumber);
                }
                return a.transactionIndex - b.transactionIndex;
            });
        }
        return await buildTreeAndGetProof(commitment, allEvents, currentBlock, cacheKey, chainConfig, root);
    }
    // No cache - fetch from deployment to present
    const fromBlock = deploymentBlock;
    logger_1.logger.debug(`🔍 Fetching all events from deployment (block ${fromBlock})...`);
    const CHUNK_SIZE = 9999n;
    const chunks = [];
    for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
        const end = start + CHUNK_SIZE - 1n > currentBlock ? currentBlock : start + CHUNK_SIZE - 1n;
        chunks.push({ start, end });
    }
    logger_1.logger.debug(`📦 Fetching ${chunks.length} chunks with throttling...`);
    const allEvents = await fetchEventChunks(publicClient, chainConfig, chunks);
    // Sort chronologically
    allEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
            return Number(a.blockNumber - b.blockNumber);
        }
        return a.transactionIndex - b.transactionIndex;
    });
    return await buildTreeAndGetProof(commitment, allEvents, currentBlock, cacheKey, chainConfig, root);
}
