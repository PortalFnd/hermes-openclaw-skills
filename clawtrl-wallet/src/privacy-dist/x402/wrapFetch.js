"use strict";
// @ts-nocheck
/**
 * Wrap fetch with privacy payments (x402 compatible)
 * Mimics x402-fetch API pattern
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapFetchWithPrivacy = wrapFetchWithPrivacy;
exports.getUpdatedNote = getUpdatedNote;
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
/**
 * Wrap fetch with automatic privacy payments
 * Usage: const privateFetch = wrapFetchWithPrivacy(fetch, sdk, note);
 */
function wrapFetchWithPrivacy(fetchFn, sdk, initialNote) {
    let currentNote = initialNote;
    return async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        // Step 1: Try request without payment
        const initialResponse = await fetchFn(url, {
            ...init,
            headers: {
                ...init?.headers,
                Accept: 'application/json',
            },
        });
        // If not 402, return response
        if (initialResponse.status !== 402) {
            return initialResponse;
        }
        // Step 2: Get payment requirements
        const paymentDetails = await initialResponse.json();
        const acceptedScheme = paymentDetails.accepts?.[0];
        if (!acceptedScheme) {
            throw new Error('No payment scheme found in 402 response');
        }
        // Extract payment amount (convert from micro units)
        const amountMicro = BigInt(acceptedScheme.amount || 0);
        const amountUSDC = Number(amountMicro) / 1000000;
        // Step 3: Make private payment to get burner wallet
        console.log(`💳 x402 payment required: ${amountUSDC} USDC`);
        console.log('🔐 Making private payment...');
        const paymentResult = await sdk.makePayment(currentNote, acceptedScheme.to, // recipient
        amountUSDC);
        // Update current note
        currentNote = paymentResult.note;
        // Step 4: Create burner wallet client for signing
        const chain = (acceptedScheme.network || 'base') === 'polygon' ? chains_1.polygon : chains_1.base;
        const burnerAccount = (0, accounts_1.privateKeyToAccount)(paymentResult.burnerPrivateKey);
        const burnerWallet = (0, viem_1.createWalletClient)({
            account: burnerAccount,
            chain,
            transport: (0, viem_1.http)(),
        });
        console.log('🔥 Using burner wallet:', burnerAccount.address);
        // Step 5: Create EIP-3009 authorization
        const now = Math.floor(Date.now() / 1000);
        const validAfter = BigInt(now - 60);
        const validBefore = BigInt(now + 3600);
        const nonce = (0, viem_1.keccak256)((0, viem_1.encodeAbiParameters)((0, viem_1.parseAbiParameters)('address, address, uint256, uint256'), [
            burnerAccount.address,
            acceptedScheme.to,
            amountMicro,
            BigInt(now),
        ]));
        // Determine USDC contract details
        const usdcAddress = chain.id === 137
            ? '0x3c499c542cef5E3811e1192ce70d8cC03d5c3359' // Polygon USDC
            : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC
        const domain = {
            name: 'USDC',
            version: '2',
            chainId: chain.id,
            verifyingContract: usdcAddress,
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
        const message = {
            from: burnerAccount.address,
            to: acceptedScheme.to,
            value: amountMicro,
            validAfter,
            validBefore,
            nonce,
        };
        const signature = await burnerWallet.signTypedData({
            domain,
            types,
            primaryType: 'TransferWithAuthorization',
            message,
        });
        // Step 6: Create payment payload
        const paymentPayload = {
            x402Version: 1,
            scheme: acceptedScheme.scheme || 'exact',
            network: acceptedScheme.network || 'base',
            payload: {
                signature,
                authorization: {
                    from: burnerAccount.address,
                    to: acceptedScheme.to,
                    value: amountMicro.toString(),
                    validAfter: validAfter.toString(),
                    validBefore: validBefore.toString(),
                    nonce,
                },
            },
        };
        const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
        // Step 7: Retry request with payment
        console.log('📡 Sending payment to merchant...');
        const paidResponse = await fetchFn(url, {
            ...init,
            method: init?.method || 'GET',
            headers: {
                ...init?.headers,
                'X-PAYMENT': paymentHeader,
                'X-Payment-Protocol': acceptedScheme.scheme || 'exact',
                'Content-Type': 'application/json',
            },
        });
        console.log(`✅ Payment successful! Status: ${paidResponse.status}`);
        return paidResponse;
    };
}
/**
 * Get updated note after using wrapped fetch
 * Call this after making payments to get the latest note state
 */
function getUpdatedNote(sdk) {
    return sdk.getUpdatedNote();
}
