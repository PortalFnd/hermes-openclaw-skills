"use strict";
/**
 * Configurable debug logger for Clawtrl Private Payments
 * Controlled via SDK options or environment variable
 * Vendored & maintained by Clawtrl (see NOTICE.md for upstream attribution)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LOG_LEVELS = {
    none: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};
class Logger {
    constructor() {
        this.level = 'none';
        this.prefix = '[ClawtrlPrivacy]';
    }
    configure(options) {
        if (options.level !== undefined) {
            this.level = options.level;
        }
        if (options.prefix !== undefined) {
            this.prefix = options.prefix;
        }
    }
    shouldLog(level) {
        return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
    }
    error(...args) {
        if (this.shouldLog('error')) {
            console.error(this.prefix, ...args);
        }
    }
    warn(...args) {
        if (this.shouldLog('warn')) {
            console.warn(this.prefix, ...args);
        }
    }
    info(...args) {
        if (this.shouldLog('info')) {
            console.log(this.prefix, ...args);
        }
    }
    debug(...args) {
        if (this.shouldLog('debug')) {
            console.log(this.prefix, ...args);
        }
    }
    /** Get current log level */
    getLevel() {
        return this.level;
    }
    /** Check if debug mode is enabled */
    isDebug() {
        return this.level === 'debug';
    }
}
// Singleton instance
exports.logger = new Logger();
// Initialize from environment if available
if (typeof process !== 'undefined' &&
    (process.env?.CLAWTRL_PRIVACY_DEBUG === 'true' || process.env?.PRIVACY_SDK_DEBUG === 'true')) {
    exports.logger.configure({ level: 'debug' });
}
