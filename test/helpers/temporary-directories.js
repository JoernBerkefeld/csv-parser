import assert from 'node:assert/strict';
import path from 'node:path';

/**
 * Validate temporary placement before creating synthetic fixtures.
 * @param {string} platform - Runtime platform.
 * @param {object} directories - Environment overrides and actual Node temporary directory.
 * @returns {void} Throws if any directory is unsafe.
 */
export function validateTemporaryDirectories(platform, directories) {
    const isWindows = platform === 'win32';
    const paths = isWindows ? path.win32 : path.posix;
    const expected = isWindows ? String.raw`f:\temp` : '/tmp';
    for (const [name, value] of Object.entries(directories)) {
        if (!value && name !== 'NODE' && (!isWindows || name !== 'TEMP')) continue;
        assert.ok(value && paths.isAbsolute(value), `${name} must be absolute`);
        const normalized = paths.normalize(value).replace(/[\\/]+$/, '');
        assert.equal(isWindows ? normalized.toLowerCase() : normalized, expected, name);
    }
}
