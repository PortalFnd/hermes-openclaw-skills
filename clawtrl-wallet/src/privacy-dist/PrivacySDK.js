"use strict";
// @ts-nocheck
/**
 * Privacy SDK - Core class for private x402 payments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacySDK = void 0;
const logger_1 = require("./logger");
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const crypto_1 = require("./crypto");
const bundler_1 = require("./bundler");
const utils_1 = require("./utils");
const merkle_1 = require("./merkle");
const attestor_1 = require("./attestor");
/**
 * Main Privacy SDK class
 */
class PrivacySDK {
    constructor(config = {}) {
        this.config = config;
        this.chainConfig = (0, utils_1.getChainConfig)(config.chain || 'base');
        // Override RPC URL if provided
        if (config.rpcUrl) {
            this.chainConfig = { ...this.chainConfig, rpcUrl: config.rpcUrl };
        }
        // Get bundler URL (priority: bundlerUrl > bundlerApiKey > prxvt proxy)
        this.bundlerUrl = (0, utils_1.getBundlerUrl)(this.chainConfig.chainId, {
            bundlerUrl: config.bundlerUrl,
            bundlerApiKey: config.bundlerApiKey,
        });
        // Default circuit paths - hosted on Cloudflare R2 CDN
        this.wasmPath = config.circuitWasmPath || 'https://circuits.prxvt.com/circuit_V16.wasm';
        this.zkeyPath = config.circuitZkeyPath || 'https://circuits.prxvt.com/circuit_V16.zkey';
        // Cross-chain attestor URL (default: https://attestor.prxvt.com)
        this.attestorUrl = config.attestorUrl;
    }
    /**
     * Connect wallet client (for browser/UI integration)
     */
    async connect(walletClient) {
        this.walletClient = walletClient;
    }
    /**
     * Validate deposit amount
     */
    validateDepositAmount(amount) {
        if (!PrivacySDK.ALLOWED_AMOUNTS.includes(amount)) {
            throw new Error(`Invalid deposit amount: ${amount} USDC. ` +
                `Allowed amounts are: ${PrivacySDK.ALLOWED_AMOUNTS.join(', ')} USDC`);
        }
    }
    /**
     * Deposit USDC to create a private note
     * @param amount - Amount in USDC. Must be one of: 0.01, 0.1, 1, 10, 100
     * @param privateKey - Optional private key (if not using connect())
     */
    async deposit(amount, privateKey) {
        // Validate fixed deposit amount
        this.validateDepositAmount(amount);
        let walletClient = this.walletClient;
        // If private key provided, create wallet client from it
        if (privateKey) {
            const chain = this.chainConfig.chainId === 8453 ? chains_1.base : chains_1.polygon;
            const account = (0, accounts_1.privateKeyToAccount)(privateKey);
            walletClient = (0, viem_1.createWalletClient)({
                account,
                chain,
                transport: (0, viem_1.http)(this.chainConfig.rpcUrl),
            });
        }
        if (!walletClient) {
            throw new Error('No wallet connected. Provide privateKey or call connect() first.');
        }
        const address = walletClient.account?.address;
        if (!address) {
            throw new Error('No account found in wallet client');
        }
        // Generate secret and nullifier
        const secret = (0, crypto_1.randomFieldElement)();
        const nullifier = (0, crypto_1.randomFieldElement)();
        // Calculate net amount after fees
        const grossAmountMicro = (0, utils_1.parseUSDC)(amount);
        // TODO: Fetch fee from contract
        const feeBps = 100n; // 1%
        const feeThreshold = 10000000n; // 10 USDC
        let feeAmount = 0n;
        if (grossAmountMicro > feeThreshold) {
            feeAmount = (grossAmountMicro * feeBps) / 10000n;
        }
        const netAmountMicro = grossAmountMicro - feeAmount;
        // Generate commitment
        const commitment = await (0, crypto_1.poseidonHash3)(secret, nullifier, netAmountMicro);
        // Create public client
        const chain = this.chainConfig.chainId === 8453 ? chains_1.base : chains_1.polygon;
        const publicClient = (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)(this.chainConfig.rpcUrl),
        });
        // Check USDC balance
        const USDC_ABI = [
            {
                inputs: [{ name: 'account', type: 'address' }],
                name: 'balanceOf',
                outputs: [{ name: '', type: 'uint256' }],
                stateMutability: 'view',
                type: 'function',
            },
            {
                inputs: [
                    { name: 'spender', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                ],
                name: 'approve',
                outputs: [{ name: '', type: 'bool' }],
                stateMutability: 'nonpayable',
                type: 'function',
            },
            {
                inputs: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                ],
                name: 'allowance',
                outputs: [{ name: '', type: 'uint256' }],
                stateMutability: 'view',
                type: 'function',
            },
        ];
        const balance = (await publicClient.readContract({
            address: this.chainConfig.usdcAddress,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [address],
        }));
        if (balance < grossAmountMicro) {
            throw new Error(`Insufficient USDC balance. Have ${(0, utils_1.formatUSDC)(balance)} USDC, need ${(0, utils_1.formatUSDC)(grossAmountMicro)} USDC`);
        }
        // Check allowance
        const allowance = (await publicClient.readContract({
            address: this.chainConfig.usdcAddress,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [address, this.chainConfig.poolAddress],
        }));
        // Approve if needed
        if (allowance < grossAmountMicro) {
            const approveTx = await walletClient.writeContract({
                address: this.chainConfig.usdcAddress,
                abi: USDC_ABI,
                functionName: 'approve',
                args: [this.chainConfig.poolAddress, grossAmountMicro],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }
        // Deposit to pool
        const POOL_ABI = [
            {
                inputs: [
                    { name: 'commitment', type: 'bytes32' },
                    { name: 'denomination', type: 'uint256' },
                ],
                name: 'deposit',
                outputs: [],
                stateMutability: 'payable',
                type: 'function',
            },
        ];
        // Convert commitment to bytes32 hex format
        const commitmentHex = ('0x' + BigInt(commitment).toString(16).padStart(64, '0'));
        const depositTx = await walletClient.writeContract({
            address: this.chainConfig.poolAddress,
            abi: POOL_ABI,
            functionName: 'deposit',
            args: [commitmentHex, grossAmountMicro],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
        // Register pending commitment for immediate use (no need to wait for subgraph)
        (0, merkle_1.addPendingCommitment)(commitmentHex, receipt.blockNumber);
        logger_1.logger.debug(`✅ Deposit confirmed in block ${receipt.blockNumber}`);
        // Create note
        const note = {
            version: '2.0',
            commitments: [
                {
                    secret: secret.toString(),
                    nullifier: nullifier.toString(),
                    amount: Number(netAmountMicro),
                    depositChain: this.chainConfig.chainName,
                },
            ],
        };
        this.currentNote = note;
        return note;
    }
    /**
     * Fast deposit using ERC-3009 receiveWithAuthorization (no approve TX needed!)
     * This is ~50% faster than regular deposit (10s vs 20s)
     * @param amount - Amount in USDC. Must be one of: 0.01, 0.1, 1, 10, 100
     * @param privateKey - Private key for signing
     */
    async depositFast(amount, privateKey) {
        // Validate fixed deposit amount
        this.validateDepositAmount(amount);
        const chain = this.chainConfig.chainId === 8453 ? chains_1.base : chains_1.polygon;
        const account = (0, accounts_1.privateKeyToAccount)(privateKey);
        const walletClient = (0, viem_1.createWalletClient)({
            account,
            chain,
            transport: (0, viem_1.http)(this.chainConfig.rpcUrl),
        });
        const publicClient = (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)(this.chainConfig.rpcUrl),
        });
        const address = account.address;
        // Generate secret and nullifier
        const secret = (0, crypto_1.randomFieldElement)();
        const nullifier = (0, crypto_1.randomFieldElement)();
        // Calculate amounts
        const grossAmountMicro = (0, utils_1.parseUSDC)(amount);
        // Fee calculation (same as regular deposit)
        const feeBps = 100n; // 1%
        const feeThreshold = 10000000n; // 10 USDC
        let feeAmount = 0n;
        if (grossAmountMicro > feeThreshold) {
            feeAmount = (grossAmountMicro * feeBps) / 10000n;
        }
        const netAmountMicro = grossAmountMicro - feeAmount;
        // Generate commitment
        const commitment = await (0, crypto_1.poseidonHash3)(secret, nullifier, netAmountMicro);
        const commitmentHex = ('0x' + BigInt(commitment).toString(16).padStart(64, '0'));
        // Check USDC balance
        const USDC_ABI = [
            {
                inputs: [{ name: 'account', type: 'address' }],
                name: 'balanceOf',
                outputs: [{ name: '', type: 'uint256' }],
                stateMutability: 'view',
                type: 'function',
            },
        ];
        const balance = (await publicClient.readContract({
            address: this.chainConfig.usdcAddress,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [address],
        }));
        if (balance < grossAmountMicro) {
            throw new Error(`Insufficient USDC balance. Have ${(0, utils_1.formatUSDC)(balance)} USDC, need ${(0, utils_1.formatUSDC)(grossAmountMicro)} USDC`);
        }
        // Sign ERC-3009 receiveWithAuthorization (off-chain, instant!)
        logger_1.logger.debug(`📝 Signing ERC-3009 authorization...`);
        const validAfter = 0n;
        const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
        const authNonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
        // EIP-712 domain for USDC receiveWithAuthorization
        const domain = {
            name: 'USD Coin',
            version: '2',
            chainId: this.chainConfig.chainId,
            verifyingContract: this.chainConfig.usdcAddress,
        };
        const types = {
            ReceiveWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
            ],
        };
        const authMessage = {
            from: address,
            to: this.chainConfig.poolAddress,
            value: grossAmountMicro,
            validAfter,
            validBefore,
            nonce: authNonce,
        };
        // Sign the authorization (instant, off-chain)
        const signature = await account.signTypedData({
            domain,
            types,
            primaryType: 'ReceiveWithAuthorization',
            message: authMessage,
        });
        // Parse signature into v, r, s
        const sigBytes = signature.slice(2);
        const r = `0x${sigBytes.slice(0, 64)}`;
        const s = `0x${sigBytes.slice(64, 128)}`;
        const v = parseInt(sigBytes.slice(128, 130), 16);
        logger_1.logger.debug(`✅ Authorization signed`);
        // Call depositWithAuthorization (single TX!)
        const POOL_ABI = [
            {
                inputs: [
                    { name: 'commitment', type: 'bytes32' },
                    { name: 'denomination', type: 'uint256' },
                    { name: 'validAfter', type: 'uint256' },
                    { name: 'validBefore', type: 'uint256' },
                    { name: 'nonce', type: 'bytes32' },
                    { name: 'v', type: 'uint8' },
                    { name: 'r', type: 'bytes32' },
                    { name: 's', type: 'bytes32' },
                ],
                name: 'depositWithAuthorization',
                outputs: [],
                stateMutability: 'payable',
                type: 'function',
            },
        ];
        logger_1.logger.debug(`📤 Submitting depositWithAuthorization...`);
        const depositTx = await walletClient.writeContract({
            address: this.chainConfig.poolAddress,
            abi: POOL_ABI,
            functionName: 'depositWithAuthorization',
            args: [commitmentHex, grossAmountMicro, validAfter, validBefore, authNonce, v, r, s],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
        // Register pending commitment for immediate use
        (0, merkle_1.addPendingCommitment)(commitmentHex, receipt.blockNumber);
        logger_1.logger.debug(`✅ Fast deposit confirmed in block ${receipt.blockNumber}`);
        // Create note
        const note = {
            version: '2.0',
            commitments: [
                {
                    secret: secret.toString(),
                    nullifier: nullifier.toString(),
                    amount: Number(netAmountMicro),
                    depositChain: this.chainConfig.chainName,
                },
            ],
        };
        this.currentNote = note;
        return note;
    }
    /**
     * Get balance from note
     */
    async getBalance(note) {
        (0, utils_1.validateNote)(note);
        return (0, utils_1.calculateNoteBalance)(note);
    }
    /**
     * Make a private payment (internal - used by x402 wrappers)
     */
    async makePayment(note, recipient, amount) {
        (0, utils_1.validateNote)(note);
        // Get first commitment
        const commitment = note.commitments[0];
        if (!commitment) {
            throw new Error('No commitments in note');
        }
        const availableBalance = commitment.amount / 1000000;
        if (amount > availableBalance) {
            throw new Error(`Insufficient balance. Available: ${availableBalance} USDC`);
        }
        // Calculate amounts
        const paymentAmountMicro = (0, utils_1.parseUSDC)(amount);
        const changeAmountMicro = BigInt(commitment.amount) - paymentAmountMicro;
        // Generate commitment hash
        const commitmentHash = await (0, crypto_1.poseidonHash3)(commitment.secret, commitment.nullifier, BigInt(commitment.amount));
        // Check if cross-chain payment (deposit chain != payment chain)
        // Do this BEFORE fetching Merkle proof to use correct chain
        const depositChain = commitment.depositChain || this.chainConfig.chainName;
        const paymentChain = this.chainConfig.chainName;
        const crossChain = (0, attestor_1.isCrossChain)(depositChain, paymentChain);
        // For cross-chain, fetch Merkle proof from ORIGIN chain (where deposit exists)
        const merkleChainConfig = crossChain
            ? (0, utils_1.getChainConfig)(depositChain)
            : this.chainConfig;
        if (crossChain) {
            logger_1.logger.debug(`🔀 Cross-chain payment: ${depositChain} → ${paymentChain}`);
            logger_1.logger.debug(`⚡ Fetching Merkle proof from origin chain (${depositChain})...`);
        }
        // Fetch Merkle proof from the correct chain's subgraph
        const merkleProof = await (0, merkle_1.fetchMerkleProofFromSubgraph)(commitmentHash, merkleChainConfig);
        // Generate change commitment
        const newSecret = (0, crypto_1.randomFieldElement)();
        const newNullifier = (0, crypto_1.randomFieldElement)();
        const changeCommitment = await (0, crypto_1.poseidonHash3)(newSecret, newNullifier, changeAmountMicro);
        // Generate burner wallet
        const burner = (0, crypto_1.generateBurnerWallet)();
        const burnerAccount = (0, accounts_1.privateKeyToAccount)(burner.privateKey);
        // Generate ZK proof
        const { proof, publicSignals } = await (0, crypto_1.generateProof)({
            secret: commitment.secret,
            nullifier: commitment.nullifier,
            amount: commitment.amount.toString(),
            newSecret: newSecret.toString(),
            newNullifier: newNullifier.toString(),
            merkleProof,
            paymentAmount: paymentAmountMicro.toString(),
            changeAmount: changeAmountMicro.toString(),
            recipient: burnerAccount.address, // Withdraw to burner
        }, this.wasmPath, this.zkeyPath);
        // Get nonce
        const nonce = await (0, utils_1.getNonce)(this.chainConfig);
        // Convert commitments to hex format for encoding
        const changeCommitmentHex = '0x' + BigInt(changeCommitment).toString(16).padStart(64, '0');
        const commitmentHashHex = '0x' + BigInt(commitmentHash).toString(16).padStart(64, '0');
        // Cross-chain attestation (already detected cross-chain status above)
        let originEid = 0;
        let attestationData;
        if (crossChain) {
            // Calculate nullifier hash for attestation request
            const nullifierHash = publicSignals[1]; // nullifierHash is the SECOND public signal (index 1)
            logger_1.logger.debug(`🔐 Requesting cross-chain attestation...`);
            // Get attestation from attestor service
            const attestation = await (0, attestor_1.getAttestationForPayment)(this.attestorUrl, depositChain, paymentChain, nullifierHash);
            if (!attestation) {
                throw new Error('Cross-chain payment requires attestation but failed to get one');
            }
            originEid = attestation.originEid;
            attestationData = attestation.attestationData;
            logger_1.logger.debug(`✅ Got attestation (originEid: ${originEid})`);
        }
        // Build UserOperation (with optional attestation data for cross-chain)
        const userOp = await (0, bundler_1.buildPaymentUserOp)(proof, publicSignals, burnerAccount.address, paymentAmountMicro, changeCommitmentHex, changeAmountMicro, originEid, commitmentHashHex, this.chainConfig, nonce, this.bundlerUrl, attestationData // Pass attestation data for cross-chain
        );
        // Submit UserOperation
        const userOpHash = await (0, bundler_1.submitUserOperation)(userOp, this.bundlerUrl, this.chainConfig.entryPointAddress);
        // Wait for confirmation
        const receipt = await (0, bundler_1.waitForUserOpConfirmation)(userOpHash, this.bundlerUrl);
        // Update note (remove spent commitment, add change)
        const updatedCommitments = [];
        if (changeAmountMicro > 0n) {
            updatedCommitments.push({
                secret: newSecret.toString(),
                nullifier: newNullifier.toString(),
                amount: Number(changeAmountMicro),
                depositChain: this.chainConfig.chainName,
            });
        }
        const updatedNote = {
            version: '2.0',
            commitments: updatedCommitments,
        };
        this.currentNote = updatedNote;
        return {
            note: updatedNote,
            txHash: receipt.transactionHash,
            nullifierHash: publicSignals[0],
            burnerAddress: burnerAccount.address,
            burnerPrivateKey: burner.privateKey,
        };
    }
    /**
     * Get current note (updated after payments)
     */
    getUpdatedNote() {
        return this.currentNote;
    }
    /**
     * Set current note (for loading saved notes)
     */
    setNote(note) {
        (0, utils_1.validateNote)(note);
        this.currentNote = note;
    }
    /**
     * Wrap fetch with automatic x402 payment handling
     * Usage:
     *   sdk.setNote(myNote);
     *   const fetchWithPay = sdk.wrapFetch(fetch);
     *   const response = await fetchWithPay('https://api.example.com/paid');
     *   const updatedNote = sdk.getUpdatedNote(); // Save this!
     */
    wrapFetch(baseFetch) {
        const sdk = this;
        return async function fetchWithPayment(input, init) {
            // Make initial request
            const response = await baseFetch(input, init);
            // If not 402, return as-is
            if (response.status !== 402) {
                return response;
            }
            // Parse x402 payment requirements from response body
            const responseBody = await response.json();
            if (!responseBody.accepts || responseBody.accepts.length === 0) {
                throw new Error('402 response missing payment accepts array');
            }
            // Find a crypto payment option (prefer base, then any)
            const cryptoOption = responseBody.accepts.find((a) => a.network === sdk.chainConfig.chainName) || responseBody.accepts.find((a) => a.scheme === 'exact' || a.channel?.includes('crypto'));
            if (!cryptoOption) {
                throw new Error('No compatible payment option found in 402 response');
            }
            // Parse payment details from x402 format
            const paymentDetails = {
                // Amount in micro USDC (e.g., "10000" = 0.01 USDC)
                price: (parseInt(cryptoOption.maxAmountRequired || cryptoOption.amount) / 1000000).toString(),
                address: cryptoOption.payTo,
                network: cryptoOption.network,
                asset: cryptoOption.asset,
            };
            logger_1.logger.debug(`📋 x402: Payment required - ${paymentDetails.price} USDC to ${paymentDetails.address}`);
            // Validate we have a note
            if (!sdk.currentNote || sdk.currentNote.commitments.length === 0) {
                throw new Error('No note available for payment. Call setNote() first.');
            }
            // Convert price to number (handle both string and number)
            const priceUSDC = typeof paymentDetails.price === 'string'
                ? parseFloat(paymentDetails.price)
                : paymentDetails.price;
            if (isNaN(priceUSDC) || priceUSDC <= 0) {
                throw new Error(`Invalid payment price: ${paymentDetails.price}`);
            }
            // Check balance
            const balance = (0, utils_1.calculateNoteBalance)(sdk.currentNote);
            if (priceUSDC > balance) {
                throw new Error(`Insufficient balance. Need ${priceUSDC} USDC, have ${balance} USDC`);
            }
            // Step 1: ZK payment from note → burner wallet
            // makePayment creates a burner internally and returns its private key
            logger_1.logger.debug(`💳 x402: Withdrawing ${priceUSDC} USDC to burner wallet`);
            const paymentResult = await sdk.makePayment(sdk.currentNote, '', // recipient is ignored - makePayment creates its own burner
            priceUSDC);
            // Use the burner that makePayment created (has the USDC!)
            const burnerAccount = (0, accounts_1.privateKeyToAccount)(paymentResult.burnerPrivateKey);
            logger_1.logger.debug(`✅ x402: Withdrew to burner ${burnerAccount.address}. TX: ${paymentResult.txHash}`);
            // Step 3: Sign EIP-3009 transferWithAuthorization (gasless!)
            logger_1.logger.debug(`📝 x402: Signing transfer authorization for ${priceUSDC} USDC to ${paymentDetails.address}`);
            const amountMicro = BigInt(Math.floor(priceUSDC * 1000000));
            const validAfter = 0n; // Valid immediately
            const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
            const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
            // EIP-3009 transferWithAuthorization domain and types
            const domain = {
                name: 'USD Coin', // USDC contract name
                version: '2',
                chainId: sdk.chainConfig.chainId,
                verifyingContract: sdk.chainConfig.usdcAddress,
            };
            const types = {
                TransferWithAuthorization: [
                    { name: 'from', type: 'address' },
                    { name: 'to', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'validAfter', type: 'uint256' },
                    { name: 'validBefore', type: 'uint256' },
                    { name: 'nonce', type: 'bytes32' },
                ],
            };
            const authMessage = {
                from: burnerAccount.address,
                to: paymentDetails.address,
                value: amountMicro,
                validAfter,
                validBefore,
                nonce,
            };
            // Sign the EIP-712 typed data
            const authSignature = await burnerAccount.signTypedData({
                domain,
                types,
                primaryType: 'TransferWithAuthorization',
                message: authMessage,
            });
            logger_1.logger.debug(`✅ x402: Authorization signed`);
            // Step 4: Build payment proof with authorization
            const paymentProof = {
                // ZK withdrawal proof
                withdrawTxHash: paymentResult.txHash,
                nullifierHash: paymentResult.nullifierHash,
                // EIP-3009 authorization (server submits this to get paid)
                authorization: {
                    from: burnerAccount.address,
                    to: paymentDetails.address,
                    value: amountMicro.toString(),
                    validAfter: validAfter.toString(),
                    validBefore: validBefore.toString(),
                    nonce,
                    signature: authSignature,
                },
                // Metadata
                network: sdk.chainConfig.chainName,
                chainId: sdk.chainConfig.chainId,
                usdcAddress: sdk.chainConfig.usdcAddress,
                amount: priceUSDC,
                timestamp: Date.now(),
            };
            // Sign the entire proof for integrity
            const proofMessage = JSON.stringify(paymentProof);
            const proofSignature = await burnerAccount.signMessage({ message: proofMessage });
            // Step 5: Retry request with x402 payment header
            // x402 expects the payment authorization in X-PAYMENT header (base64 encoded)
            const x402Payment = {
                x402Version: 1,
                scheme: 'exact',
                network: sdk.chainConfig.chainName,
                payload: {
                    signature: paymentProof.authorization.signature,
                    authorization: {
                        from: paymentProof.authorization.from,
                        to: paymentProof.authorization.to,
                        value: paymentProof.authorization.value,
                        validAfter: paymentProof.authorization.validAfter,
                        validBefore: paymentProof.authorization.validBefore,
                        nonce: paymentProof.authorization.nonce,
                    },
                },
            };
            // Base64 encode the payment header (x402 standard)
            const x402PaymentBase64 = btoa(JSON.stringify(x402Payment));
            const retryInit = {
                ...init,
                headers: {
                    ...init?.headers,
                    'X-PAYMENT': x402PaymentBase64,
                    // Also include full proof for servers that want more info
                    'X-Payment-Proof': JSON.stringify({
                        ...paymentProof,
                        signature: proofSignature,
                    }),
                },
            };
            return baseFetch(input, retryInit);
        };
    }
}
exports.PrivacySDK = PrivacySDK;
/** Allowed deposit amounts in USDC */
PrivacySDK.ALLOWED_AMOUNTS = [0.01, 0.1, 1, 10, 100];
