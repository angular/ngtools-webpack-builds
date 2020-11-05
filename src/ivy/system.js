"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebpackSystem = void 0;
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const ts = require("typescript");
function shouldNotWrite() {
    throw new Error('Webpack TypeScript System should not write.');
}
// Webpack's CachedInputFileSystem uses the default directory separator in the paths it uses
// for keys to its cache. If the keys do not match then the file watcher will not purge outdated
// files and cause stale data to be used in the next rebuild. TypeScript always uses a `/` (POSIX)
// directory separator internally which is also supported with Windows system APIs. However,
// if file operations are performed with the non-default directory separator, the Webpack cache
// will contain a key that will not be purged.
function createToSystemPath() {
    if (process.platform === 'win32') {
        const cache = new Map();
        return (path) => {
            let value = cache.get(path);
            if (value === undefined) {
                value = path.replace(/\//g, '\\');
                cache.set(path, value);
            }
            return value;
        };
    }
    // POSIX-like platforms retain the existing directory separator
    return (path) => path;
}
function createWebpackSystem(input, currentDirectory) {
    const toSystemPath = createToSystemPath();
    const system = {
        ...ts.sys,
        readFile(path) {
            let data;
            try {
                data = input.readFileSync(toSystemPath(path));
            }
            catch (_a) {
                return undefined;
            }
            // Strip BOM if present
            let start = 0;
            if (data.length > 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
                start = 3;
            }
            return data.toString('utf8', start);
        },
        getFileSize(path) {
            try {
                return input.statSync(toSystemPath(path)).size;
            }
            catch (_a) {
                return 0;
            }
        },
        fileExists(path) {
            try {
                return input.statSync(toSystemPath(path)).isFile();
            }
            catch (_a) {
                return false;
            }
        },
        directoryExists(path) {
            try {
                return input.statSync(toSystemPath(path)).isDirectory();
            }
            catch (_a) {
                return false;
            }
        },
        getModifiedTime(path) {
            try {
                return input.statSync(toSystemPath(path)).mtime;
            }
            catch (_a) {
                return undefined;
            }
        },
        getCurrentDirectory() {
            return currentDirectory;
        },
        writeFile: shouldNotWrite,
        createDirectory: shouldNotWrite,
        deleteFile: shouldNotWrite,
        setModifiedTime: shouldNotWrite,
    };
    return system;
}
exports.createWebpackSystem = createWebpackSystem;
