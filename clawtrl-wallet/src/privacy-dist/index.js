"use strict";
/**
 * Clawtrl Private Payments — vendored fork of the px402 privacy engine
 * (originally @prxvt/sdk, MIT). Maintained in-tree by Clawtrl; see NOTICE.md.
 *
 * Provides private x402 payments using zero-knowledge proofs so an agent can
 * pay for APIs without linking payments to its public wallet.
 *
 * @example
 * ```typescript
 * import {
 *   PrivacySDK,
 *   encryptNote,
 *   decryptNote,
 *   decodeXPaymentResponse,
 *   getNoteBalance
 * } from '@prxvt/sdk';
 *
 * // Initialize SDK
 * const sdk = new PrivacySDK({ chain: 'base' });
 *
 * // Deposit USDC to create a note
 * const note = await sdk.depositFast(10, privateKey);
 *
 * // Encrypt note for storage
 * const encrypted = await encryptNote(note, 'password');
 *
 * // Use wrapFetch for automatic x402 payments
 * sdk.setNote(note);
 * const fetchWithPay = sdk.wrapFetch(fetch);
 * const response = await fetchWithPay('https://api.example.com/paid');
 *
 * // Decode payment response
 * const paymentResponse = decodeXPaymentResponse(response.headers.get('x-payment-response'));
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.formatUSDC = exports.parseUSDC = exports.validateNote = exports.calculateNoteBalance = exports.getBundlerUrl = exports.getChainConfig = exports.getAttestationForPayment = exports.encodeAttestationData = exports.requestNullifierAttestation = exports.getChainName = exports.getChainEid = exports.isCrossChain = exports.getUpdatedNote = exports.wrapFetchWithPrivacy = exports.timeout = exports.withRetry = exports.parseUSDCAmount = exports.formatUSDCAmount = exports.hasEnoughBalance = exports.getNoteBalance = exports.parsePaymentRequirements = exports.encodeXPayment = exports.decodeXPaymentResponse = exports.NullifierSpentError = exports.TransactionError = exports.PaymentRequiredError = exports.NetworkError = exports.BundlerError = exports.ProofGenerationError = exports.MerkleProofError = exports.DecryptionError = exports.InvalidNoteError = exports.InsufficientBalanceError = exports.PrivacySDKError = exports.isEncryptedNote = exports.decryptNote = exports.encryptNote = exports.PrivacySDK = void 0;
// Main SDK
var PrivacySDK_1 = require("./PrivacySDK");
Object.defineProperty(exports, "PrivacySDK", { enumerable: true, get: function () { return PrivacySDK_1.PrivacySDK; } });
// Encryption utilities
var encryption_1 = require("./encryption");
Object.defineProperty(exports, "encryptNote", { enumerable: true, get: function () { return encryption_1.encryptNote; } });
Object.defineProperty(exports, "decryptNote", { enumerable: true, get: function () { return encryption_1.decryptNote; } });
Object.defineProperty(exports, "isEncryptedNote", { enumerable: true, get: function () { return encryption_1.isEncryptedNote; } });
// Error types
var errors_1 = require("./errors");
Object.defineProperty(exports, "PrivacySDKError", { enumerable: true, get: function () { return errors_1.PrivacySDKError; } });
Object.defineProperty(exports, "InsufficientBalanceError", { enumerable: true, get: function () { return errors_1.InsufficientBalanceError; } });
Object.defineProperty(exports, "InvalidNoteError", { enumerable: true, get: function () { return errors_1.InvalidNoteError; } });
Object.defineProperty(exports, "DecryptionError", { enumerable: true, get: function () { return errors_1.DecryptionError; } });
Object.defineProperty(exports, "MerkleProofError", { enumerable: true, get: function () { return errors_1.MerkleProofError; } });
Object.defineProperty(exports, "ProofGenerationError", { enumerable: true, get: function () { return errors_1.ProofGenerationError; } });
Object.defineProperty(exports, "BundlerError", { enumerable: true, get: function () { return errors_1.BundlerError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return errors_1.NetworkError; } });
Object.defineProperty(exports, "PaymentRequiredError", { enumerable: true, get: function () { return errors_1.PaymentRequiredError; } });
Object.defineProperty(exports, "TransactionError", { enumerable: true, get: function () { return errors_1.TransactionError; } });
Object.defineProperty(exports, "NullifierSpentError", { enumerable: true, get: function () { return errors_1.NullifierSpentError; } });
// Helper functions
var helpers_1 = require("./helpers");
Object.defineProperty(exports, "decodeXPaymentResponse", { enumerable: true, get: function () { return helpers_1.decodeXPaymentResponse; } });
Object.defineProperty(exports, "encodeXPayment", { enumerable: true, get: function () { return helpers_1.encodeXPayment; } });
Object.defineProperty(exports, "parsePaymentRequirements", { enumerable: true, get: function () { return helpers_1.parsePaymentRequirements; } });
Object.defineProperty(exports, "getNoteBalance", { enumerable: true, get: function () { return helpers_1.getNoteBalance; } });
Object.defineProperty(exports, "hasEnoughBalance", { enumerable: true, get: function () { return helpers_1.hasEnoughBalance; } });
Object.defineProperty(exports, "formatUSDCAmount", { enumerable: true, get: function () { return helpers_1.formatUSDCAmount; } });
Object.defineProperty(exports, "parseUSDCAmount", { enumerable: true, get: function () { return helpers_1.parseUSDCAmount; } });
Object.defineProperty(exports, "withRetry", { enumerable: true, get: function () { return helpers_1.withRetry; } });
Object.defineProperty(exports, "timeout", { enumerable: true, get: function () { return helpers_1.timeout; } });
// Re-export x402 utilities (legacy)
var x402_1 = require("./x402");
Object.defineProperty(exports, "wrapFetchWithPrivacy", { enumerable: true, get: function () { return x402_1.wrapFetchWithPrivacy; } });
Object.defineProperty(exports, "getUpdatedNote", { enumerable: true, get: function () { return x402_1.getUpdatedNote; } });
// Cross-chain attestor utilities
var attestor_1 = require("./attestor");
Object.defineProperty(exports, "isCrossChain", { enumerable: true, get: function () { return attestor_1.isCrossChain; } });
Object.defineProperty(exports, "getChainEid", { enumerable: true, get: function () { return attestor_1.getChainEid; } });
Object.defineProperty(exports, "getChainName", { enumerable: true, get: function () { return attestor_1.getChainName; } });
Object.defineProperty(exports, "requestNullifierAttestation", { enumerable: true, get: function () { return attestor_1.requestNullifierAttestation; } });
Object.defineProperty(exports, "encodeAttestationData", { enumerable: true, get: function () { return attestor_1.encodeAttestationData; } });
Object.defineProperty(exports, "getAttestationForPayment", { enumerable: true, get: function () { return attestor_1.getAttestationForPayment; } });
// Utility functions
var utils_1 = require("./utils");
Object.defineProperty(exports, "getChainConfig", { enumerable: true, get: function () { return utils_1.getChainConfig; } });
Object.defineProperty(exports, "getBundlerUrl", { enumerable: true, get: function () { return utils_1.getBundlerUrl; } });
Object.defineProperty(exports, "calculateNoteBalance", { enumerable: true, get: function () { return utils_1.calculateNoteBalance; } });
Object.defineProperty(exports, "validateNote", { enumerable: true, get: function () { return utils_1.validateNote; } });
Object.defineProperty(exports, "parseUSDC", { enumerable: true, get: function () { return utils_1.parseUSDC; } });
Object.defineProperty(exports, "formatUSDC", { enumerable: true, get: function () { return utils_1.formatUSDC; } });
// Logger for debug configuration
var logger_1 = require("./logger");
Object.defineProperty(exports, "logger", { enumerable: true, get: function () { return logger_1.logger; } });
