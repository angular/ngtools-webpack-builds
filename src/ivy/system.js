"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebpackSystem = void 0;
const ts = __importStar(require("typescript"));
const paths_1 = require("./paths");
function shouldNotWrite() {
    throw new Error('Webpack TypeScript System should not write.');
}
function createWebpackSystem(input, currentDirectory) {
    // Webpack's CachedInputFileSystem uses the default directory separator in the paths it uses
    // for keys to its cache. If the keys do not match then the file watcher will not purge outdated
    // files and cause stale data to be used in the next rebuild. TypeScript always uses a `/` (POSIX)
    // directory separator internally which is also supported with Windows system APIs. However,
    // if file operations are performed with the non-default directory separator, the Webpack cache
    // will contain a key that will not be purged. `externalizePath` ensures the paths are as expected.
    const system = {
        ...ts.sys,
        readFile(path) {
            let data;
            try {
                data = input.readFileSync((0, paths_1.externalizePath)(path));
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
                return input.statSync((0, paths_1.externalizePath)(path)).size;
            }
            catch (_a) {
                return 0;
            }
        },
        fileExists(path) {
            try {
                return input.statSync((0, paths_1.externalizePath)(path)).isFile();
            }
            catch (_a) {
                return false;
            }
        },
        directoryExists(path) {
            try {
                return input.statSync((0, paths_1.externalizePath)(path)).isDirectory();
            }
            catch (_a) {
                return false;
            }
        },
        getModifiedTime(path) {
            try {
                return input.statSync((0, paths_1.externalizePath)(path)).mtime;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3lzdGVtLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvc3lzdGVtLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwrQ0FBaUM7QUFFakMsbUNBQTBDO0FBUTFDLFNBQVMsY0FBYztJQUNyQixNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxDQUFDLENBQUM7QUFDakUsQ0FBQztBQUVELFNBQWdCLG1CQUFtQixDQUNqQyxLQUEwQixFQUMxQixnQkFBd0I7SUFFeEIsNEZBQTRGO0lBQzVGLGdHQUFnRztJQUNoRyxrR0FBa0c7SUFDbEcsNEZBQTRGO0lBQzVGLCtGQUErRjtJQUMvRixtR0FBbUc7SUFDbkcsTUFBTSxNQUFNLEdBQWM7UUFDeEIsR0FBRyxFQUFFLENBQUMsR0FBRztRQUNULFFBQVEsQ0FBQyxJQUFZO1lBQ25CLElBQUksSUFBSSxDQUFDO1lBQ1QsSUFBSTtnQkFDRixJQUFJLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFBLHVCQUFlLEVBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQzthQUNsRDtZQUFDLFdBQU07Z0JBQ04sT0FBTyxTQUFTLENBQUM7YUFDbEI7WUFFRCx1QkFBdUI7WUFDdkIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO1lBQ2QsSUFBSSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDL0UsS0FBSyxHQUFHLENBQUMsQ0FBQzthQUNYO1lBRUQsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN0QyxDQUFDO1FBQ0QsV0FBVyxDQUFDLElBQVk7WUFDdEIsSUFBSTtnQkFDRixPQUFPLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBQSx1QkFBZSxFQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO2FBQ25EO1lBQUMsV0FBTTtnQkFDTixPQUFPLENBQUMsQ0FBQzthQUNWO1FBQ0gsQ0FBQztRQUNELFVBQVUsQ0FBQyxJQUFZO1lBQ3JCLElBQUk7Z0JBQ0YsT0FBTyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUEsdUJBQWUsRUFBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ3ZEO1lBQUMsV0FBTTtnQkFDTixPQUFPLEtBQUssQ0FBQzthQUNkO1FBQ0gsQ0FBQztRQUNELGVBQWUsQ0FBQyxJQUFZO1lBQzFCLElBQUk7Z0JBQ0YsT0FBTyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUEsdUJBQWUsRUFBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO2FBQzVEO1lBQUMsV0FBTTtnQkFDTixPQUFPLEtBQUssQ0FBQzthQUNkO1FBQ0gsQ0FBQztRQUNELGVBQWUsQ0FBQyxJQUFZO1lBQzFCLElBQUk7Z0JBQ0YsT0FBTyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUEsdUJBQWUsRUFBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQzthQUNwRDtZQUFDLFdBQU07Z0JBQ04sT0FBTyxTQUFTLENBQUM7YUFDbEI7UUFDSCxDQUFDO1FBQ0QsbUJBQW1CO1lBQ2pCLE9BQU8sZ0JBQWdCLENBQUM7UUFDMUIsQ0FBQztRQUNELFNBQVMsRUFBRSxjQUFjO1FBQ3pCLGVBQWUsRUFBRSxjQUFjO1FBQy9CLFVBQVUsRUFBRSxjQUFjO1FBQzFCLGVBQWUsRUFBRSxjQUFjO0tBQ2hDLENBQUM7SUFFRixPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBbEVELGtEQWtFQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IENvbXBpbGVyIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBleHRlcm5hbGl6ZVBhdGggfSBmcm9tICcuL3BhdGhzJztcblxuZXhwb3J0IHR5cGUgSW5wdXRGaWxlU3lzdGVtID0gQ29tcGlsZXJbJ2lucHV0RmlsZVN5c3RlbSddO1xuZXhwb3J0IGludGVyZmFjZSBJbnB1dEZpbGVTeXN0ZW1TeW5jIGV4dGVuZHMgSW5wdXRGaWxlU3lzdGVtIHtcbiAgcmVhZEZpbGVTeW5jKHBhdGg6IHN0cmluZyk6IEJ1ZmZlcjtcbiAgc3RhdFN5bmMocGF0aDogc3RyaW5nKTogeyBzaXplOiBudW1iZXI7IG10aW1lOiBEYXRlOyBpc0RpcmVjdG9yeSgpOiBib29sZWFuOyBpc0ZpbGUoKTogYm9vbGVhbiB9O1xufVxuXG5mdW5jdGlvbiBzaG91bGROb3RXcml0ZSgpOiBuZXZlciB7XG4gIHRocm93IG5ldyBFcnJvcignV2VicGFjayBUeXBlU2NyaXB0IFN5c3RlbSBzaG91bGQgbm90IHdyaXRlLicpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlV2VicGFja1N5c3RlbShcbiAgaW5wdXQ6IElucHV0RmlsZVN5c3RlbVN5bmMsXG4gIGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZyxcbik6IHRzLlN5c3RlbSB7XG4gIC8vIFdlYnBhY2sncyBDYWNoZWRJbnB1dEZpbGVTeXN0ZW0gdXNlcyB0aGUgZGVmYXVsdCBkaXJlY3Rvcnkgc2VwYXJhdG9yIGluIHRoZSBwYXRocyBpdCB1c2VzXG4gIC8vIGZvciBrZXlzIHRvIGl0cyBjYWNoZS4gSWYgdGhlIGtleXMgZG8gbm90IG1hdGNoIHRoZW4gdGhlIGZpbGUgd2F0Y2hlciB3aWxsIG5vdCBwdXJnZSBvdXRkYXRlZFxuICAvLyBmaWxlcyBhbmQgY2F1c2Ugc3RhbGUgZGF0YSB0byBiZSB1c2VkIGluIHRoZSBuZXh0IHJlYnVpbGQuIFR5cGVTY3JpcHQgYWx3YXlzIHVzZXMgYSBgL2AgKFBPU0lYKVxuICAvLyBkaXJlY3Rvcnkgc2VwYXJhdG9yIGludGVybmFsbHkgd2hpY2ggaXMgYWxzbyBzdXBwb3J0ZWQgd2l0aCBXaW5kb3dzIHN5c3RlbSBBUElzLiBIb3dldmVyLFxuICAvLyBpZiBmaWxlIG9wZXJhdGlvbnMgYXJlIHBlcmZvcm1lZCB3aXRoIHRoZSBub24tZGVmYXVsdCBkaXJlY3Rvcnkgc2VwYXJhdG9yLCB0aGUgV2VicGFjayBjYWNoZVxuICAvLyB3aWxsIGNvbnRhaW4gYSBrZXkgdGhhdCB3aWxsIG5vdCBiZSBwdXJnZWQuIGBleHRlcm5hbGl6ZVBhdGhgIGVuc3VyZXMgdGhlIHBhdGhzIGFyZSBhcyBleHBlY3RlZC5cbiAgY29uc3Qgc3lzdGVtOiB0cy5TeXN0ZW0gPSB7XG4gICAgLi4udHMuc3lzLFxuICAgIHJlYWRGaWxlKHBhdGg6IHN0cmluZykge1xuICAgICAgbGV0IGRhdGE7XG4gICAgICB0cnkge1xuICAgICAgICBkYXRhID0gaW5wdXQucmVhZEZpbGVTeW5jKGV4dGVybmFsaXplUGF0aChwYXRoKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgLy8gU3RyaXAgQk9NIGlmIHByZXNlbnRcbiAgICAgIGxldCBzdGFydCA9IDA7XG4gICAgICBpZiAoZGF0YS5sZW5ndGggPiAzICYmIGRhdGFbMF0gPT09IDB4ZWYgJiYgZGF0YVsxXSA9PT0gMHhiYiAmJiBkYXRhWzJdID09PSAweGJmKSB7XG4gICAgICAgIHN0YXJ0ID0gMztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGEudG9TdHJpbmcoJ3V0ZjgnLCBzdGFydCk7XG4gICAgfSxcbiAgICBnZXRGaWxlU2l6ZShwYXRoOiBzdHJpbmcpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBpbnB1dC5zdGF0U3luYyhleHRlcm5hbGl6ZVBhdGgocGF0aCkpLnNpemU7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgfSxcbiAgICBmaWxlRXhpc3RzKHBhdGg6IHN0cmluZykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGlucHV0LnN0YXRTeW5jKGV4dGVybmFsaXplUGF0aChwYXRoKSkuaXNGaWxlKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sXG4gICAgZGlyZWN0b3J5RXhpc3RzKHBhdGg6IHN0cmluZykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGlucHV0LnN0YXRTeW5jKGV4dGVybmFsaXplUGF0aChwYXRoKSkuaXNEaXJlY3RvcnkoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSxcbiAgICBnZXRNb2RpZmllZFRpbWUocGF0aDogc3RyaW5nKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gaW5wdXQuc3RhdFN5bmMoZXh0ZXJuYWxpemVQYXRoKHBhdGgpKS5tdGltZTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH0sXG4gICAgZ2V0Q3VycmVudERpcmVjdG9yeSgpIHtcbiAgICAgIHJldHVybiBjdXJyZW50RGlyZWN0b3J5O1xuICAgIH0sXG4gICAgd3JpdGVGaWxlOiBzaG91bGROb3RXcml0ZSxcbiAgICBjcmVhdGVEaXJlY3Rvcnk6IHNob3VsZE5vdFdyaXRlLFxuICAgIGRlbGV0ZUZpbGU6IHNob3VsZE5vdFdyaXRlLFxuICAgIHNldE1vZGlmaWVkVGltZTogc2hvdWxkTm90V3JpdGUsXG4gIH07XG5cbiAgcmV0dXJuIHN5c3RlbTtcbn1cbiJdfQ==