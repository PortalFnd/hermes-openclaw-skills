// @ts-nocheck
/**
 * Clawtrl entry point for Private Payments.
 *
 * Centralizes configuration for the vendored privacy engine so the rest of
 * Clawtrl talks to one factory instead of `new PrivacySDK(...)` directly.
 * All px402 protocol infrastructure (pool contracts, circuits, bundler,
 * attestor) is overridable via environment variables — see NOTICE.md.
 */

import { PrivacySDK } from './PrivacySDK';
import type { PrivacySDKConfig } from './types';
import { logger } from './logger';

export type PrivacyChain = 'base' | 'polygon';

/** Build SDK config from Clawtrl env overrides (all optional). */
export function clawtrlPrivacyConfig(chain: PrivacyChain = 'base'): PrivacySDKConfig {
  const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
  const cfg: PrivacySDKConfig = { chain };

  if (env.CLAWTRL_PRIVACY_RPC_URL) cfg.rpcUrl = env.CLAWTRL_PRIVACY_RPC_URL;
  if (env.CLAWTRL_PRIVACY_BUNDLER_URL) cfg.bundlerUrl = env.CLAWTRL_PRIVACY_BUNDLER_URL;
  if (env.CLAWTRL_PRIVACY_BUNDLER_API_KEY) cfg.bundlerApiKey = env.CLAWTRL_PRIVACY_BUNDLER_API_KEY;
  if (env.CLAWTRL_PRIVACY_ATTESTOR_URL) cfg.attestorUrl = env.CLAWTRL_PRIVACY_ATTESTOR_URL;
  if (env.CLAWTRL_PRIVACY_CIRCUIT_WASM) cfg.circuitWasmPath = env.CLAWTRL_PRIVACY_CIRCUIT_WASM;
  if (env.CLAWTRL_PRIVACY_CIRCUIT_ZKEY) cfg.circuitZkeyPath = env.CLAWTRL_PRIVACY_CIRCUIT_ZKEY;

  return cfg;
}

/** Allowed fixed deposit denominations (mirrors PrivacySDK.ALLOWED_AMOUNTS). */
export const ALLOWED_DEPOSIT_AMOUNTS: number[] = [0.01, 0.1, 1, 10, 100];

/** Create a configured Clawtrl PrivacySDK instance. */
export function createPrivacySDK(chain: PrivacyChain = 'base'): PrivacySDK {
  const cfg = clawtrlPrivacyConfig(chain);
  logger.debug('Creating Clawtrl PrivacySDK', { chain: cfg.chain, bundlerUrl: cfg.bundlerUrl, attestorUrl: cfg.attestorUrl });
  return new PrivacySDK(cfg);
}

// Re-export the full vendored surface so callers can `import ... from './privacy/clawtrl'`.
export * from './index';
