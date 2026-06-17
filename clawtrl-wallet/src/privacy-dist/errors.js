"use strict";
/**
 * Privacy SDK Error Types
 * Clear, typed errors for better developer experience
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NullifierSpentError = exports.TransactionError = exports.PaymentRequiredError = exports.NetworkError = exports.BundlerError = exports.ProofGenerationError = exports.MerkleProofError = exports.DecryptionError = exports.InvalidNoteError = exports.InsufficientBalanceError = exports.PrivacySDKError = void 0;
/** Base error class for all SDK errors */
class PrivacySDKError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'PrivacySDKError';
    }
}
exports.PrivacySDKError = PrivacySDKError;
/** Insufficient balance in note */
class InsufficientBalanceError extends PrivacySDKError {
    constructor(required, available) {
        super(`Insufficient balance. Required: ${required} USDC, available: ${available} USDC`, 'INSUFFICIENT_BALANCE');
        this.required = required;
        this.available = available;
        this.name = 'InsufficientBalanceError';
    }
}
exports.InsufficientBalanceError = InsufficientBalanceError;
/** Invalid note format or corrupted note */
class InvalidNoteError extends PrivacySDKError {
    constructor(message = 'Invalid or corrupted note') {
        super(message, 'INVALID_NOTE');
        this.name = 'InvalidNoteError';
    }
}
exports.InvalidNoteError = InvalidNoteError;
/** Note decryption failed (wrong password) */
class DecryptionError extends PrivacySDKError {
    constructor(message = 'Failed to decrypt note. Wrong password?') {
        super(message, 'DECRYPTION_FAILED');
        this.name = 'DecryptionError';
    }
}
exports.DecryptionError = DecryptionError;
/** Merkle proof generation or verification failed */
class MerkleProofError extends PrivacySDKError {
    constructor(message) {
        super(message, 'MERKLE_PROOF_ERROR');
        this.name = 'MerkleProofError';
    }
}
exports.MerkleProofError = MerkleProofError;
/** ZK proof generation failed */
class ProofGenerationError extends PrivacySDKError {
    constructor(message) {
        super(message, 'PROOF_GENERATION_ERROR');
        this.name = 'ProofGenerationError';
    }
}
exports.ProofGenerationError = ProofGenerationError;
/** Bundler API error */
class BundlerError extends PrivacySDKError {
    constructor(message, statusCode, response) {
        super(message, 'BUNDLER_ERROR');
        this.statusCode = statusCode;
        this.response = response;
        this.name = 'BundlerError';
    }
}
exports.BundlerError = BundlerError;
/** Network/RPC error */
class NetworkError extends PrivacySDKError {
    constructor(message, originalError) {
        super(message, 'NETWORK_ERROR');
        this.originalError = originalError;
        this.name = 'NetworkError';
    }
}
exports.NetworkError = NetworkError;
/** x402 payment required but failed */
class PaymentRequiredError extends PrivacySDKError {
    constructor(amount, recipient, network) {
        super(`Payment required: ${amount} USDC to ${recipient} on ${network}`, 'PAYMENT_REQUIRED');
        this.amount = amount;
        this.recipient = recipient;
        this.network = network;
        this.name = 'PaymentRequiredError';
    }
}
exports.PaymentRequiredError = PaymentRequiredError;
/** Transaction failed or reverted */
class TransactionError extends PrivacySDKError {
    constructor(message, txHash, reason) {
        super(message, 'TRANSACTION_ERROR');
        this.txHash = txHash;
        this.reason = reason;
        this.name = 'TransactionError';
    }
}
exports.TransactionError = TransactionError;
/** Nullifier already spent (double-spend attempt) */
class NullifierSpentError extends PrivacySDKError {
    constructor(nullifierHash) {
        super('Note has already been spent', 'NULLIFIER_SPENT');
        this.nullifierHash = nullifierHash;
        this.name = 'NullifierSpentError';
    }
}
exports.NullifierSpentError = NullifierSpentError;
