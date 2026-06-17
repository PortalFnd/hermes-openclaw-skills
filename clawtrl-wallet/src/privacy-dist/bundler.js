"use strict";
// @ts-nocheck
/**
 * Bundler utilities for ERC-4337 UserOperations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodePaymasterData = encodePaymasterData;
exports.getPimlicoGasPrice = getPimlicoGasPrice;
exports.buildPaymentUserOp = buildPaymentUserOp;
exports.submitUserOperation = submitUserOperation;
exports.waitForUserOpConfirmation = waitForUserOpConfirmation;
const viem_1 = require("viem");
/**
 * Encode paymaster data with ZK proof
 * @param attestationData - Optional attestation data for cross-chain payments
 */
function encodePaymasterData(proof, publicSignals, recipient, paymentAmount, changeCommitment, changeAmount, originEid, spentCommitment, attestationData // NEW: Optional attestation data for cross-chain
) {
    // Flatten Groth16 proof to uint256[8]
    const MAX_UINT256 = (1n << 256n) - 1n;
    const toUint256 = (val) => {
        const bigVal = BigInt(val);
        return bigVal > MAX_UINT256 ? bigVal & MAX_UINT256 : bigVal;
    };
    const proofFlat = [
        toUint256(proof.pi_a[0]),
        toUint256(proof.pi_a[1]),
        toUint256(proof.pi_b[0][1]), // Reversed order for pi_b
        toUint256(proof.pi_b[0][0]),
        toUint256(proof.pi_b[1][1]),
        toUint256(proof.pi_b[1][0]),
        toUint256(proof.pi_c[0]),
        toUint256(proof.pi_c[1]),
    ];
    // Convert public signals to BigInt
    const signals = publicSignals.map(s => BigInt(s));
    // Use provided attestation data or empty bytes
    const attestation = attestationData || '0x';
    // Encode: (uint256[8] proof, uint256[5] publicSignals, address merchant,
    //          uint256 paymentAmount, bytes32 changeCommitment, uint256 changeAmount,
    //          uint32 originEid, bytes32 spentCommitment, bytes attestationData)
    const encoded = (0, viem_1.encodeAbiParameters)((0, viem_1.parseAbiParameters)('uint256[8], uint256[5], address, uint256, bytes32, uint256, uint32, bytes32, bytes'), [
        proofFlat,
        signals,
        recipient,
        paymentAmount,
        changeCommitment,
        changeAmount,
        originEid,
        spentCommitment,
        attestation,
    ]);
    return encoded;
}
/**
 * Get gas prices from Pimlico bundler
 */
async function getPimlicoGasPrice(bundlerUrl) {
    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'pimlico_getUserOperationGasPrice',
            params: [],
        }),
    });
    const result = await response.json();
    if (result.error) {
        // Fallback values
        return {
            maxFeePerGas: 1000000000n, // 1 gwei
            maxPriorityFeePerGas: 100000000n, // 0.1 gwei
        };
    }
    return {
        maxFeePerGas: BigInt(result.result.fast.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(result.result.fast.maxPriorityFeePerGas),
    };
}
/**
 * Build UserOperation for payment
 * @param attestationData - Optional attestation data for cross-chain payments
 */
async function buildPaymentUserOp(proof, publicSignals, recipient, paymentAmount, changeCommitment, changeAmount, originEid, spentCommitment, chainConfig, nonce, bundlerUrl, attestationData // NEW: Optional attestation data for cross-chain
) {
    // Encode paymaster data (with optional attestation for cross-chain)
    const paymasterData = encodePaymasterData(proof, publicSignals, recipient, paymentAmount, changeCommitment, changeAmount, originEid, spentCommitment, attestationData // Pass attestation data
    );
    // Get gas prices
    const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPrice(bundlerUrl);
    // Build UserOperation
    const userOp = {
        sender: chainConfig.walletAddress,
        nonce,
        initCode: '0x',
        callData: '0x',
        callGasLimit: 200000n,
        verificationGasLimit: 2000000n, // High for ZK verification
        preVerificationGas: 100000n,
        maxFeePerGas,
        maxPriorityFeePerGas,
        paymasterAndData: (chainConfig.paymasterAddress + paymasterData.slice(2)),
        signature: ('0x' + '00'.repeat(65)), // Dummy signature for AA wallet
    };
    return userOp;
}
/**
 * Submit UserOperation to bundler
 */
async function submitUserOperation(userOp, bundlerUrl, entryPointAddress) {
    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendUserOperation',
            params: [
                {
                    sender: userOp.sender,
                    nonce: '0x' + userOp.nonce.toString(16),
                    initCode: userOp.initCode,
                    callData: userOp.callData,
                    callGasLimit: '0x' + userOp.callGasLimit.toString(16),
                    verificationGasLimit: '0x' + userOp.verificationGasLimit.toString(16),
                    preVerificationGas: '0x' + userOp.preVerificationGas.toString(16),
                    maxFeePerGas: '0x' + userOp.maxFeePerGas.toString(16),
                    maxPriorityFeePerGas: '0x' + userOp.maxPriorityFeePerGas.toString(16),
                    paymasterAndData: userOp.paymasterAndData,
                    signature: userOp.signature,
                },
                entryPointAddress,
            ],
        }),
    });
    const result = await response.json();
    if (result.error) {
        throw new Error(result.error.message || 'Bundler submission failed');
    }
    return result.result; // userOpHash
}
/**
 * Wait for UserOperation confirmation
 */
async function waitForUserOpConfirmation(userOpHash, bundlerUrl, maxAttempts = 30, delayMs = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(bundlerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_getUserOperationReceipt',
                    params: [userOpHash],
                }),
            });
            const result = await response.json();
            if (result.result && result.result.receipt) {
                // Check if UserOp succeeded
                if (result.result.success === false) {
                    throw new Error(`UserOperation failed on-chain. TX: ${result.result.receipt.transactionHash}`);
                }
                return {
                    transactionHash: result.result.receipt.transactionHash,
                    success: true,
                };
            }
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('failed on-chain')) {
                throw error;
            }
        }
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw new Error('Timeout waiting for UserOp confirmation');
}
