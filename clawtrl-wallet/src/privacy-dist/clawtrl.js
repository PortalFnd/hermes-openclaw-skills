"use strict";
// @ts-nocheck
/**
 * Clawtrl entry point for Private Payments.
 *
 * Centralizes configuration for the vendored privacy engine so the rest of
 * Clawtrl talks to one factory instead of `new PrivacySDK(...)` directly.
 * All px402 protocol infrastructure (pool contracts, circuits, bundler,
 * attestor) is overridable via environment variables — see NOTICE.md.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_DEPOSIT_AMOUNTS = void 0;
exports.clawtrlPrivacyConfig = clawtrlPrivacyConfig;
exports.createPrivacySDK = createPrivacySDK;
const PrivacySDK_1 = require("./PrivacySDK");
const logger_1 = require("./logger");
/** Build SDK config from Clawtrl env overrides (all optional). */
function clawtrlPrivacyConfig(chain = 'base') {
    const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
    const cfg = { chain };
    if (env.CLAWTRL_PRIVACY_RPC_URL)
        cfg.rpcUrl = env.CLAWTRL_PRIVACY_RPC_URL;
    if (env.CLAWTRL_PRIVACY_BUNDLER_URL)
        cfg.bundlerUrl = env.CLAWTRL_PRIVACY_BUNDLER_URL;
    if (env.CLAWTRL_PRIVACY_BUNDLER_API_KEY)
        cfg.bundlerApiKey = env.CLAWTRL_PRIVACY_BUNDLER_API_KEY;
    if (env.CLAWTRL_PRIVACY_ATTESTOR_URL)
        cfg.attestorUrl = env.CLAWTRL_PRIVACY_ATTESTOR_URL;
    if (env.CLAWTRL_PRIVACY_CIRCUIT_WASM)
        cfg.circuitWasmPath = env.CLAWTRL_PRIVACY_CIRCUIT_WASM;
    if (env.CLAWTRL_PRIVACY_CIRCUIT_ZKEY)
        cfg.circuitZkeyPath = env.CLAWTRL_PRIVACY_CIRCUIT_ZKEY;
    return cfg;
}
/** Allowed fixed deposit denominations (mirrors PrivacySDK.ALLOWED_AMOUNTS). */
exports.ALLOWED_DEPOSIT_AMOUNTS = [0.01, 0.1, 1, 10, 100];
/** Create a configured Clawtrl PrivacySDK instance. */
function createPrivacySDK(chain = 'base') {
    const cfg = clawtrlPrivacyConfig(chain);
    logger_1.logger.debug('Creating Clawtrl PrivacySDK', { chain: cfg.chain, bundlerUrl: cfg.bundlerUrl, attestorUrl: cfg.attestorUrl });
    return new PrivacySDK_1.PrivacySDK(cfg);
}
// Re-export the full vendored surface so callers can `import ... from './privacy/clawtrl'`.
__exportStar(require("./index"), exports);
