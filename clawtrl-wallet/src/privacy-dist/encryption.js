"use strict";
// @ts-nocheck
/**
 * Note Encryption Utilities
 * AES-256-GCM encryption for secure note storage
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptNote = encryptNote;
exports.decryptNote = decryptNote;
exports.isEncryptedNote = isEncryptedNote;
const errors_1 = require("./errors");
/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
    return crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/**
 * Encrypt a note with a password
 * @param note - The note to encrypt
 * @param password - Password for encryption
 * @returns Encrypted note as base64 string
 *
 * @example
 * const encrypted = await encryptNote(myNote, 'my-secret-password');
 * // Store `encrypted` safely - it's a single base64 string
 */
async function encryptNote(note, password) {
    if (!note || !note.version || !note.commitments) {
        throw new errors_1.InvalidNoteError('Invalid note structure');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(note));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    // GCM includes auth tag in the ciphertext (last 16 bytes)
    const encrypted = {
        version: 1,
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...iv)),
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
        tag: '', // Tag is included in ciphertext for GCM
    };
    return btoa(JSON.stringify(encrypted));
}
/**
 * Decrypt an encrypted note
 * @param encryptedString - Base64 encrypted note string
 * @param password - Password for decryption
 * @returns Decrypted note
 *
 * @example
 * const note = await decryptNote(encryptedString, 'my-secret-password');
 */
async function decryptNote(encryptedString, password) {
    try {
        const encrypted = JSON.parse(atob(encryptedString));
        if (encrypted.version !== 1) {
            throw new errors_1.DecryptionError('Unsupported encryption version');
        }
        const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
        const key = await deriveKey(password, salt);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        const decoder = new TextDecoder();
        const note = JSON.parse(decoder.decode(plaintext));
        // Validate note structure
        if (!note.version || !note.commitments || !Array.isArray(note.commitments)) {
            throw new errors_1.InvalidNoteError('Decrypted data is not a valid note');
        }
        return note;
    }
    catch (error) {
        if (error instanceof errors_1.DecryptionError || error instanceof errors_1.InvalidNoteError) {
            throw error;
        }
        throw new errors_1.DecryptionError('Failed to decrypt note. Wrong password?');
    }
}
/**
 * Check if a string is an encrypted note
 */
function isEncryptedNote(str) {
    try {
        const decoded = JSON.parse(atob(str));
        return decoded.version && decoded.salt && decoded.iv && decoded.ciphertext;
    }
    catch {
        return false;
    }
}
