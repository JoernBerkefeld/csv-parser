import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Find filesystem dependency resolutions in a parsed npm lockfile.
 * @param {object} lock - Parsed lockfile.
 * @returns {string[]} Paths of invalid resolutions.
 */
export function checkLockfile(lock) {
    const findings = [];
    /**
     * Inspect nested lockfile metadata without relying on its format version.
     * @param {unknown} value - Current metadata node.
     * @param {string} trail - Current metadata path.
     * @returns {void}
     */
    function visit(value, trail) {
        if (!value || typeof value !== 'object') {
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            const location = `${trail}.${key}`;
            if (
                (key === 'link' && entry === true) ||
                (key === 'resolved' &&
                    (typeof entry !== 'string' || !entry.startsWith('https://'))) ||
                (typeof entry === 'string' && /^(?:file:|link:|workspace:)/i.test(entry))
            ) {
                findings.push(location);
            }
            visit(entry, location);
        }
    }
    visit(lock, 'lock');
    return findings;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const findings = checkLockfile(lock);
    if (findings.length > 0) {
        console.error(`Lockfile contains non-registry dependencies: ${findings.join(', ')}`);
        process.exitCode = 1;
    }
}
