"use strict";
/**
 * Helper functions for x402 payment flow
 * Inspired by x402-fetch API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeXPaymentResponse = decodeXPaymentResponse;
exports.encodeXPayment = encodeXPayment;
exports.parsePaymentRequirements = parsePaymentRequirements;
exports.getNoteBalance = getNoteBalance;
exports.hasEnoughBalance = hasEnoughBalance;
exports.formatUSDCAmount = formatUSDCAmount;
exports.parseUSDCAmount = parseUSDCAmount;
exports.withRetry = withRetry;
exports.timeout = timeout;
/**
 * Decode X-Payment-Response header from server
 * @param header - The X-Payment-Response header value
 * @returns Parsed payment response
 *
 * @example
 * const response = await fetchWithPayment(url);
 * const paymentResponse = decodeXPaymentResponse(response.headers.get('x-payment-response'));
 * console.log(paymentResponse.txHash);
 */
function decodeXPaymentResponse(header) {
    if (!header)
        return null;
    try {
        // Try base64 decode first
        try {
            const decoded = atob(header);
            return JSON.parse(decoded);
        }
        catch {
            // If not base64, try direct JSON
            return JSON.parse(header);
        }
    }
    catch {
        return null;
    }
}
/**
 * Encode X-Payment header for request
 * @param payment - Payment data to encode
 * @returns Base64 encoded payment header
 */
function encodeXPayment(payment) {
    return btoa(JSON.stringify(payment));
}
/**
 * Parse 402 response body to get payment requirements
 * @param body - Response body from 402 response
 * @returns Payment requirements
 */
function parsePaymentRequirements(body) {
    return body.accepts || [];
}
/**
 * Get total balance from a note in USDC
 */
function getNoteBalance(note) {
    if (!note || !note.commitments)
        return 0;
    const totalMicro = note.commitments.reduce((sum, c) => sum + c.amount, 0);
    return totalMicro / 1000000;
}
/**
 * Check if note has sufficient balance for a payment
 */
function hasEnoughBalance(note, amountUSDC) {
    return getNoteBalance(note) >= amountUSDC;
}
/**
 * Format USDC amount for display
 */
function formatUSDCAmount(microAmount) {
    const usdc = Number(microAmount) / 1000000;
    return usdc.toFixed(usdc < 0.01 ? 4 : 2);
}
/**
 * Parse USDC amount to micro units
 */
function parseUSDCAmount(usdc) {
    const amount = typeof usdc === 'string' ? parseFloat(usdc) : usdc;
    return BigInt(Math.floor(amount * 1000000));
}
/**
 * Retry helper with exponential backoff
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelay - Base delay in ms (default: 1000)
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}
/**
 * Create a timeout promise
 */
function timeout(promise, ms, message) {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message || `Timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]);
}
