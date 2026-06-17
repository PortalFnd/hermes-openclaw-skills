"use strict";
// @ts-nocheck
/**
 * Cryptographic utilities for privacy SDK
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomFieldElement = randomFieldElement;
exports.poseidonHash3 = poseidonHash3;
exports.poseidonHash = poseidonHash;
exports.poseidonHash2 = poseidonHash2;
exports.generateProof = generateProof;
exports.generateBurnerWallet = generateBurnerWallet;
/**
 * Generate random field element for secret or nullifier
 */
function randomFieldElement() {
    const bytes = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
        window.crypto.getRandomValues(bytes);
    }
    else {
        // Node.js
        const crypto = require('crypto');
        crypto.randomFillSync(bytes);
    }
    let hex = '0x';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    // Modulo BN254 field size to ensure valid field element
    const BN254_FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    return BigInt(hex) % BN254_FIELD_SIZE;
}
/**
 * Poseidon hash (3 inputs) - for commitments
 * Requires circomlibjs or poseidon-browser.js to be available
 */
async function poseidonHash3(a, b, c) {
    // Try browser first (window.poseidonHash3 from poseidon-browser.js)
    if (typeof window !== 'undefined' && window.poseidonHash3) {
        return window.poseidonHash3(a, b, c);
    }
    // Try Node.js (circomlibjs)
    try {
        const { buildPoseidon } = require('circomlibjs');
        const poseidon = await buildPoseidon();
        const hash = poseidon.F.toString(poseidon([BigInt(a), BigInt(b), BigInt(c)]));
        return hash;
    }
    catch (error) {
        throw new Error('Poseidon hash not available. ' +
            'Browser: Load poseidon-browser.js. ' +
            'Node.js: Install circomlibjs');
    }
}
/**
 * Poseidon hash (1 input) - for nullifier hash
 */
async function poseidonHash(value) {
    // Try browser first
    if (typeof window !== 'undefined' && window.poseidonHash) {
        return window.poseidonHash(value);
    }
    // Try Node.js
    try {
        const { buildPoseidon } = require('circomlibjs');
        const poseidon = await buildPoseidon();
        const hash = poseidon.F.toString(poseidon([BigInt(value)]));
        return hash;
    }
    catch (error) {
        throw new Error('Poseidon hash not available');
    }
}
/**
 * Poseidon hash (2 inputs) - for Merkle tree
 */
async function poseidonHash2(left, right) {
    // Try browser first
    if (typeof window !== 'undefined' && window.poseidonHash2) {
        return window.poseidonHash2(left, right);
    }
    // Try Node.js
    try {
        const { buildPoseidon } = require('circomlibjs');
        const poseidon = await buildPoseidon();
        const hash = poseidon.F.toString(poseidon([BigInt(left), BigInt(right)]));
        return hash;
    }
    catch (error) {
        throw new Error('Poseidon hash not available');
    }
}
/**
 * Convert value to circuit input format
 */
function toCircuitInput(value) {
    if (typeof value === 'string' && value.startsWith('0x')) {
        return BigInt(value).toString();
    }
    return value.toString();
}
/**
 * Generate ZK proof using snarkjs
 */
async function generateProof(inputs, wasmPath, zkeyPath) {
    // Prepare circuit inputs
    const circuitInputs = {
        nullifier: toCircuitInput(inputs.nullifier),
        secret: toCircuitInput(inputs.secret),
        denomination: toCircuitInput(inputs.amount),
        newSecret: toCircuitInput(inputs.newSecret),
        newNullifier: toCircuitInput(inputs.newNullifier),
        pathElements: inputs.merkleProof.pathElements.map(el => toCircuitInput(el)),
        pathIndices: inputs.merkleProof.pathIndices,
        root: toCircuitInput(inputs.merkleProof.root),
        paymentAmount: toCircuitInput(inputs.paymentAmount),
        changeAmount: toCircuitInput(inputs.changeAmount),
    };
    // Helper to load circuit file (handles both URLs and local paths)
    const loadCircuitFile = async (path) => {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            // Fetch from URL
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to fetch circuit: ${path}`);
            }
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);
        }
        // Local file path - let snarkjs handle it
        return path;
    };
    // Check if paths are URLs that need fetching
    const isUrl = (p) => p.startsWith('http://') || p.startsWith('https://');
    const needsFetch = isUrl(wasmPath) || isUrl(zkeyPath);
    // Try browser snarkjs first
    if (typeof window !== 'undefined' && window.snarkjs) {
        let wasm = wasmPath;
        let zkey = zkeyPath;
        // In Node.js with global.window (test setup), we need to fetch URLs
        if (needsFetch && typeof fetch !== 'undefined') {
            const wasmData = await loadCircuitFile(wasmPath);
            const zkeyData = await loadCircuitFile(zkeyPath);
            // If we fetched, use the data directly
            if (wasmData instanceof Uint8Array) {
                wasm = wasmData;
            }
            if (zkeyData instanceof Uint8Array) {
                zkey = zkeyData;
            }
        }
        const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(circuitInputs, wasm, zkey);
        return { proof, publicSignals };
    }
    // Try Node.js snarkjs
    try {
        const snarkjs = require('snarkjs');
        let wasm = wasmPath;
        let zkey = zkeyPath;
        // Fetch URLs in Node.js
        if (needsFetch) {
            wasm = await loadCircuitFile(wasmPath);
            zkey = await loadCircuitFile(zkeyPath);
        }
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasm, zkey);
        return { proof, publicSignals };
    }
    catch (error) {
        throw new Error('snarkjs not available. Install with: npm install snarkjs');
    }
}
/**
 * Generate burner wallet (ephemeral EOA)
 */
function generateBurnerWallet() {
    // Generate random private key
    const privateKeyBigInt = randomFieldElement();
    const privateKey = '0x' + privateKeyBigInt.toString(16).padStart(64, '0');
    // For simplicity, we'll let viem derive the address when needed
    // The SDK will create the wallet client from this private key
    return {
        privateKey,
        address: '', // Will be computed by viem
    };
}
