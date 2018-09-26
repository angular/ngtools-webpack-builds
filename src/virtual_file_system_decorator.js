"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const core_1 = require("@angular-devkit/core");
exports.NodeWatchFileSystem = require('webpack/lib/node/NodeWatchFileSystem');
// NOTE: @types/webpack InputFileSystem is missing some methods
class VirtualFileSystemDecorator {
    constructor(_inputFileSystem, _webpackCompilerHost) {
        this._inputFileSystem = _inputFileSystem;
        this._webpackCompilerHost = _webpackCompilerHost;
    }
    _readFileSync(path) {
        if (this._webpackCompilerHost.fileExists(path)) {
            return this._webpackCompilerHost.readFileBuffer(path) || null;
        }
        return null;
    }
    _statSync(path) {
        if (this._webpackCompilerHost.fileExists(path)) {
            return this._webpackCompilerHost.stat(path);
        }
        return null;
    }
    getVirtualFilesPaths() {
        return this._webpackCompilerHost.getNgFactoryPaths();
    }
    stat(path, callback) {
        const result = this._statSync(path);
        if (result) {
            // tslint:disable-next-line:no-any
            callback(null, result);
        }
        else {
            this._inputFileSystem.stat(path, callback);
        }
    }
    readdir(path, callback) {
        // tslint:disable-next-line:no-any
        this._inputFileSystem.readdir(path, callback);
    }
    readFile(path, callback) {
        const result = this._readFileSync(path);
        if (result) {
            // tslint:disable-next-line:no-any
            callback(null, result);
        }
        else {
            this._inputFileSystem.readFile(path, callback);
        }
    }
    readJson(path, callback) {
        // tslint:disable-next-line:no-any
        this._inputFileSystem.readJson(path, callback);
    }
    readlink(path, callback) {
        this._inputFileSystem.readlink(path, callback);
    }
    statSync(path) {
        const result = this._statSync(path);
        return result || this._inputFileSystem.statSync(path);
    }
    readdirSync(path) {
        // tslint:disable-next-line:no-any
        return this._inputFileSystem.readdirSync(path);
    }
    readFileSync(path) {
        const result = this._readFileSync(path);
        return result || this._inputFileSystem.readFileSync(path);
    }
    readJsonSync(path) {
        // tslint:disable-next-line:no-any
        return this._inputFileSystem.readJsonSync(path);
    }
    readlinkSync(path) {
        return this._inputFileSystem.readlinkSync(path);
    }
    purge(changes) {
        if (typeof changes === 'string') {
            this._webpackCompilerHost.invalidate(changes);
        }
        else if (Array.isArray(changes)) {
            changes.forEach((fileName) => this._webpackCompilerHost.invalidate(fileName));
        }
        if (this._inputFileSystem.purge) {
            // tslint:disable-next-line:no-any
            this._inputFileSystem.purge(changes);
        }
    }
}
exports.VirtualFileSystemDecorator = VirtualFileSystemDecorator;
class VirtualWatchFileSystemDecorator extends exports.NodeWatchFileSystem {
    constructor(_virtualInputFileSystem, _replacements) {
        super(_virtualInputFileSystem);
        this._virtualInputFileSystem = _virtualInputFileSystem;
        this._replacements = _replacements;
    }
    watch(files, dirs, missing, startTime, options, callback, // tslint:disable-line:no-any
    callbackUndelayed) {
        const reverseReplacements = new Map();
        const reverseTimestamps = (map) => {
            for (const entry of Array.from(map.entries())) {
                const original = reverseReplacements.get(entry[0]);
                if (original) {
                    map.set(original, entry[1]);
                    map.delete(entry[0]);
                }
            }
            return map;
        };
        const newCallbackUndelayed = (filename, timestamp) => {
            const original = reverseReplacements.get(filename);
            if (original) {
                this._virtualInputFileSystem.purge(original);
                callbackUndelayed(original, timestamp);
            }
            else {
                callbackUndelayed(filename, timestamp);
            }
        };
        const newCallback = (err, filesModified, contextModified, missingModified, fileTimestamps, contextTimestamps) => {
            // Update fileTimestamps with timestamps from virtual files.
            const virtualFilesStats = this._virtualInputFileSystem.getVirtualFilesPaths()
                .map((fileName) => ({
                path: fileName,
                mtime: +this._virtualInputFileSystem.statSync(fileName).mtime,
            }));
            virtualFilesStats.forEach(stats => fileTimestamps.set(stats.path, +stats.mtime));
            callback(err, filesModified.map(value => reverseReplacements.get(value) || value), contextModified.map(value => reverseReplacements.get(value) || value), missingModified.map(value => reverseReplacements.get(value) || value), reverseTimestamps(fileTimestamps), reverseTimestamps(contextTimestamps));
        };
        const mapReplacements = (original) => {
            if (!this._replacements) {
                return original;
            }
            const replacements = this._replacements;
            return original.map(file => {
                if (typeof replacements === 'function') {
                    const replacement = core_1.getSystemPath(replacements(core_1.normalize(file)));
                    if (replacement !== file) {
                        reverseReplacements.set(replacement, file);
                    }
                    return replacement;
                }
                else {
                    const replacement = replacements.get(core_1.normalize(file));
                    if (replacement) {
                        const fullReplacement = core_1.getSystemPath(replacement);
                        reverseReplacements.set(fullReplacement, file);
                        return fullReplacement;
                    }
                    else {
                        return file;
                    }
                }
            });
        };
        const watcher = super.watch(mapReplacements(files), mapReplacements(dirs), mapReplacements(missing), startTime, options, newCallback, newCallbackUndelayed);
        return {
            close: () => watcher.close(),
            pause: () => watcher.pause(),
            getFileTimestamps: () => reverseTimestamps(watcher.getFileTimestamps()),
            getContextTimestamps: () => reverseTimestamps(watcher.getContextTimestamps()),
        };
    }
}
exports.VirtualWatchFileSystemDecorator = VirtualWatchFileSystemDecorator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3IuanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FBc0U7QUFNekQsUUFBQSxtQkFBbUIsR0FBaUMsT0FBTyxDQUN0RSxzQ0FBc0MsQ0FBQyxDQUFDO0FBRTFDLCtEQUErRDtBQUMvRCxNQUFhLDBCQUEwQjtJQUNyQyxZQUNVLGdCQUFpQyxFQUNqQyxvQkFBeUM7UUFEekMscUJBQWdCLEdBQWhCLGdCQUFnQixDQUFpQjtRQUNqQyx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQXFCO0lBQy9DLENBQUM7SUFFRyxhQUFhLENBQUMsSUFBWTtRQUNoQyxJQUFJLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDOUMsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQztTQUMvRDtRQUVELE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVPLFNBQVMsQ0FBQyxJQUFZO1FBQzVCLElBQUksSUFBSSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUM5QyxPQUFPLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDN0M7UUFFRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUN2RCxDQUFDO0lBRUQsSUFBSSxDQUFDLElBQVksRUFBRSxRQUE0QztRQUM3RCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxD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LENBQ3JCLENBQUM7UUFFRixPQUFPO1lBQ0wsS0FBSyxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUU7WUFDNUIsS0FBSyxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUU7WUFDNUIsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDdkUsb0JBQW9CLEVBQUUsR0FBRyxFQUFFLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLENBQUM7U0FDOUUsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTlHRCwwRUE4R0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQgeyBQYXRoLCBnZXRTeXN0ZW1QYXRoLCBub3JtYWxpemUgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBTdGF0cyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IElucHV0RmlsZVN5c3RlbSB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyBDYWxsYmFjaywgTm9kZVdhdGNoRmlsZVN5c3RlbUludGVyZmFjZSB9IGZyb20gJy4vd2VicGFjayc7XG5cbmV4cG9ydCBjb25zdCBOb2RlV2F0Y2hGaWxlU3lzdGVtOiBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlID0gcmVxdWlyZShcbiAgJ3dlYnBhY2svbGliL25vZGUvTm9kZVdhdGNoRmlsZVN5c3RlbScpO1xuXG4vLyBOT1RFOiBAdHlwZXMvd2VicGFjayBJbnB1dEZpbGVTeXN0ZW0gaXMgbWlzc2luZyBzb21lIG1ldGhvZHNcbmV4cG9ydCBjbGFzcyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvciBpbXBsZW1lbnRzIElucHV0RmlsZVN5c3RlbSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgX2lucHV0RmlsZVN5c3RlbTogSW5wdXRGaWxlU3lzdGVtLFxuICAgIHByaXZhdGUgX3dlYnBhY2tDb21waWxlckhvc3Q6IFdlYnBhY2tDb21waWxlckhvc3QsXG4gICkgeyB9XG5cbiAgcHJpdmF0ZSBfcmVhZEZpbGVTeW5jKHBhdGg6IHN0cmluZyk6IEJ1ZmZlciB8IG51bGwge1xuICAgIGlmICh0aGlzLl93ZWJwYWNrQ29tcGlsZXJIb3N0LmZpbGVFeGlzdHMocGF0aCkpIHtcbiAgICAgIHJldHVybiB0aGlzLl93ZWJwYWNrQ29tcGlsZXJIb3N0LnJlYWRGaWxlQnVmZmVyKHBhdGgpIHx8IG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIF9zdGF0U3luYyhwYXRoOiBzdHJpbmcpOiBTdGF0cyB8IG51bGwge1xuICAgIGlmICh0aGlzLl93ZWJwYWNrQ29tcGlsZXJIb3N0LmZpbGVFeGlzdHMocGF0aCkpIHtcbiAgICAgIHJldHVybiB0aGlzLl93ZWJwYWNrQ29tcGlsZXJIb3N0LnN0YXQocGF0aCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRWaXJ0dWFsRmlsZXNQYXRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fd2VicGFja0NvbXBpbGVySG9zdC5nZXROZ0ZhY3RvcnlQYXRocygpO1xuICB9XG5cbiAgc3RhdChwYXRoOiBzdHJpbmcsIGNhbGxiYWNrOiAoZXJyOiBFcnJvciwgc3RhdHM6IFN0YXRzKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fc3RhdFN5bmMocGF0aCk7XG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgY2FsbGJhY2sobnVsbCBhcyBhbnksIHJlc3VsdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2lucHV0RmlsZVN5c3RlbS5zdGF0KHBhdGgsIGNhbGxiYWNrKTtcbiAgICB9XG4gIH1cblxuICByZWFkZGlyKHBhdGg6IHN0cmluZywgY2FsbGJhY2s6IENhbGxiYWNrPHN0cmluZ1tdPik6IHZvaWQge1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAodGhpcy5faW5wdXRGaWxlU3lzdGVtIGFzIGFueSkucmVhZGRpcihwYXRoLCBjYWxsYmFjayk7XG4gIH1cblxuICByZWFkRmlsZShwYXRoOiBzdHJpbmcsIGNhbGxiYWNrOiAoZXJyOiBFcnJvciwgY29udGVudHM6IEJ1ZmZlcikgPT4gdm9pZCk6IHZvaWQge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX3JlYWRGaWxlU3luYyhwYXRoKTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICBjYWxsYmFjayhudWxsIGFzIGFueSwgcmVzdWx0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faW5wdXRGaWxlU3lzdGVtLnJlYWRGaWxlKHBhdGgsIGNhbGxiYWNrKTtcbiAgICB9XG4gIH1cblxuICByZWFkSnNvbihwYXRoOiBzdHJpbmcsIGNhbGxiYWNrOiBDYWxsYmFjazx7fT4pOiB2b2lkIHtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgKHRoaXMuX2lucHV0RmlsZVN5c3RlbSBhcyBhbnkpLnJlYWRKc29uKHBhdGgsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHJlYWRsaW5rKHBhdGg6IHN0cmluZywgY2FsbGJhY2s6IChlcnI6IEVycm9yLCBsaW5rU3RyaW5nOiBzdHJpbmcpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLl9pbnB1dEZpbGVTeXN0ZW0ucmVhZGxpbmsocGF0aCwgY2FsbGJhY2spO1xuICB9XG5cbiAgc3RhdFN5bmMocGF0aDogc3RyaW5nKTogU3RhdHMge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX3N0YXRTeW5jKHBhdGgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdCB8fCB0aGlzLl9pbnB1dEZpbGVTeXN0ZW0uc3RhdFN5bmMocGF0aCk7XG4gIH1cblxuICByZWFkZGlyU3luYyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIHJldHVybiAodGhpcy5faW5wdXRGaWxlU3lzdGVtIGFzIGFueSkucmVhZGRpclN5bmMocGF0aCk7XG4gIH1cblxuICByZWFkRmlsZVN5bmMocGF0aDogc3RyaW5nKTogQnVmZmVyIHtcbiAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9yZWFkRmlsZVN5bmMocGF0aCk7XG5cbiAgICByZXR1cm4gcmVzdWx0IHx8IHRoaXMuX2lucHV0RmlsZVN5c3RlbS5yZWFkRmlsZVN5bmMocGF0aCk7XG4gIH1cblxuICByZWFkSnNvblN5bmMocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgcmV0dXJuICh0aGlzLl9pbnB1dEZpbGVTeXN0ZW0gYXMgYW55KS5yZWFkSnNvblN5bmMocGF0aCk7XG4gIH1cblxuICByZWFkbGlua1N5bmMocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5faW5wdXRGaWxlU3lzdGVtLnJlYWRsaW5rU3luYyhwYXRoKTtcbiAgfVxuXG4gIHB1cmdlKGNoYW5nZXM/OiBzdHJpbmdbXSB8IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICh0eXBlb2YgY2hhbmdlcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRoaXMuX3dlYnBhY2tDb21waWxlckhvc3QuaW52YWxpZGF0ZShjaGFuZ2VzKTtcbiAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlcykpIHtcbiAgICAgIGNoYW5nZXMuZm9yRWFjaCgoZmlsZU5hbWU6IHN0cmluZykgPT4gdGhpcy5fd2VicGFja0NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKGZpbGVOYW1lKSk7XG4gICAgfVxuICAgIGlmICh0aGlzLl9pbnB1dEZpbGVTeXN0ZW0ucHVyZ2UpIHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICh0aGlzLl9pbnB1dEZpbGVTeXN0ZW0gYXMgYW55KS5wdXJnZShjaGFuZ2VzKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IgZXh0ZW5kcyBOb2RlV2F0Y2hGaWxlU3lzdGVtIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBfdmlydHVhbElucHV0RmlsZVN5c3RlbTogVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG4gICAgcHJpdmF0ZSBfcmVwbGFjZW1lbnRzPzogTWFwPFBhdGgsIFBhdGg+IHwgKChwYXRoOiBQYXRoKSA9PiBQYXRoKSxcbiAgKSB7XG4gICAgc3VwZXIoX3ZpcnR1YWxJbnB1dEZpbGVTeXN0ZW0pO1xuICB9XG5cbiAgd2F0Y2goXG4gICAgZmlsZXM6IHN0cmluZ1tdLFxuICAgIGRpcnM6IHN0cmluZ1tdLFxuICAgIG1pc3Npbmc6IHN0cmluZ1tdLFxuICAgIHN0YXJ0VGltZTogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICAgIG9wdGlvbnM6IHt9LFxuICAgIGNhbGxiYWNrOiBhbnksICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgIGNhbGxiYWNrVW5kZWxheWVkOiAoZmlsZW5hbWU6IHN0cmluZywgdGltZXN0YW1wOiBudW1iZXIpID0+IHZvaWQsXG4gICkge1xuICAgIGNvbnN0IHJldmVyc2VSZXBsYWNlbWVudHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICAgIGNvbnN0IHJldmVyc2VUaW1lc3RhbXBzID0gKG1hcDogTWFwPHN0cmluZywgbnVtYmVyPikgPT4ge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBBcnJheS5mcm9tKG1hcC5lbnRyaWVzKCkpKSB7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsID0gcmV2ZXJzZVJlcGxhY2VtZW50cy5nZXQoZW50cnlbMF0pO1xuICAgICAgICBpZiAob3JpZ2luYWwpIHtcbiAgICAgICAgICBtYXAuc2V0KG9yaWdpbmFsLCBlbnRyeVsxXSk7XG4gICAgICAgICAgbWFwLmRlbGV0ZShlbnRyeVswXSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG1hcDtcbiAgICB9O1xuXG4gICAgY29uc3QgbmV3Q2FsbGJhY2tVbmRlbGF5ZWQgPSAoZmlsZW5hbWU6IHN0cmluZywgdGltZXN0YW1wOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsID0gcmV2ZXJzZVJlcGxhY2VtZW50cy5nZXQoZmlsZW5hbWUpO1xuICAgICAgaWYgKG9yaWdpbmFsKSB7XG4gICAgICAgIHRoaXMuX3ZpcnR1YWxJbnB1dEZpbGVTeXN0ZW0ucHVyZ2Uob3JpZ2luYWwpO1xuICAgICAgICBjYWxsYmFja1VuZGVsYXllZChvcmlnaW5hbCwgdGltZXN0YW1wKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrVW5kZWxheWVkKGZpbGVuYW1lLCB0aW1lc3RhbXApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCBuZXdDYWxsYmFjayA9IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgZmlsZXNNb2RpZmllZDogc3RyaW5nW10sXG4gICAgICBjb250ZXh0TW9kaWZpZWQ6IHN0cmluZ1tdLFxuICAgICAgbWlzc2luZ01vZGlmaWVkOiBzdHJpbmdbXSxcbiAgICAgIGZpbGVUaW1lc3RhbXBzOiBNYXA8c3RyaW5nLCBudW1iZXI+LFxuICAgICAgY29udGV4dFRpbWVzdGFtcHM6IE1hcDxzdHJpbmcsIG51bWJlcj4sXG4gICAgKSA9PiB7XG4gICAgICAvLyBVcGRhdGUgZmlsZVRpbWVzdGFtcHMgd2l0aCB0aW1lc3RhbXBzIGZyb20gdmlydHVhbCBmaWxlcy5cbiAgICAgIGNvbnN0IHZpcnR1YWxGaWxlc1N0YXRzID0gdGhpcy5fdmlydHVhbElucHV0RmlsZVN5c3RlbS5nZXRWaXJ0dWFsRmlsZXNQYXRocygpXG4gICAgICAgIC5tYXAoKGZpbGVOYW1lKSA9PiAoe1xuICAgICAgICAgIHBhdGg6IGZpbGVOYW1lLFxuICAgICAgICAgIG10aW1lOiArdGhpcy5fdmlydHVhbElucHV0RmlsZVN5c3RlbS5zdGF0U3luYyhmaWxlTmFtZSkubXRpbWUsXG4gICAgICAgIH0pKTtcbiAgICAgIHZpcnR1YWxGaWxlc1N0YXRzLmZvckVhY2goc3RhdHMgPT4gZmlsZVRpbWVzdGFtcHMuc2V0KHN0YXRzLnBhdGgsICtzdGF0cy5tdGltZSkpO1xuICAgICAgY2FsbGJhY2soXG4gICAgICAgIGVycixcbiAgICAgICAgZmlsZXNNb2RpZmllZC5tYXAodmFsdWUgPT4gcmV2ZXJzZVJlcGxhY2VtZW50cy5nZXQodmFsdWUpIHx8IHZhbHVlKSxcbiAgICAgICAgY29udGV4dE1vZGlmaWVkLm1hcCh2YWx1ZSA9PiByZXZlcnNlUmVwbGFjZW1lbnRzLmdldCh2YWx1ZSkgfHwgdmFsdWUpLFxuICAgICAgICBtaXNzaW5nTW9kaWZpZWQubWFwKHZhbHVlID0+IHJldmVyc2VSZXBsYWNlbWVudHMuZ2V0KHZhbHVlKSB8fCB2YWx1ZSksXG4gICAgICAgIHJldmVyc2VUaW1lc3RhbXBzKGZpbGVUaW1lc3RhbXBzKSxcbiAgICAgICAgcmV2ZXJzZVRpbWVzdGFtcHMoY29udGV4dFRpbWVzdGFtcHMpLFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgY29uc3QgbWFwUmVwbGFjZW1lbnRzID0gKG9yaWdpbmFsOiBzdHJpbmdbXSk6IHN0cmluZ1tdID0+IHtcbiAgICAgIGlmICghdGhpcy5fcmVwbGFjZW1lbnRzKSB7XG4gICAgICAgIHJldHVybiBvcmlnaW5hbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlcGxhY2VtZW50cyA9IHRoaXMuX3JlcGxhY2VtZW50cztcblxuICAgICAgcmV0dXJuIG9yaWdpbmFsLm1hcChmaWxlID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXBsYWNlbWVudHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zdCByZXBsYWNlbWVudCA9IGdldFN5c3RlbVBhdGgocmVwbGFjZW1lbnRzKG5vcm1hbGl6ZShmaWxlKSkpO1xuICAgICAgICAgIGlmIChyZXBsYWNlbWVudCAhPT0gZmlsZSkge1xuICAgICAgICAgICAgcmV2ZXJzZVJlcGxhY2VtZW50cy5zZXQocmVwbGFjZW1lbnQsIGZpbGUpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiByZXBsYWNlbWVudDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCByZXBsYWNlbWVudCA9IHJlcGxhY2VtZW50cy5nZXQobm9ybWFsaXplKGZpbGUpKTtcbiAgICAgICAgICBpZiAocmVwbGFjZW1lbnQpIHtcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxSZXBsYWNlbWVudCA9IGdldFN5c3RlbVBhdGgocmVwbGFjZW1lbnQpO1xuICAgICAgICAgICAgcmV2ZXJzZVJlcGxhY2VtZW50cy5zZXQoZnVsbFJlcGxhY2VtZW50LCBmaWxlKTtcblxuICAgICAgICAgICAgcmV0dXJuIGZ1bGxSZXBsYWNlbWVudDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGZpbGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgY29uc3Qgd2F0Y2hlciA9IHN1cGVyLndhdGNoKFxuICAgICAgbWFwUmVwbGFjZW1lbnRzKGZpbGVzKSxcbiAgICAgIG1hcFJlcGxhY2VtZW50cyhkaXJzKSxcbiAgICAgIG1hcFJlcGxhY2VtZW50cyhtaXNzaW5nKSxcbiAgICAgIHN0YXJ0VGltZSxcbiAgICAgIG9wdGlvbnMsXG4gICAgICBuZXdDYWxsYmFjayxcbiAgICAgIG5ld0NhbGxiYWNrVW5kZWxheWVkLFxuICAgICk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgY2xvc2U6ICgpID0+IHdhdGNoZXIuY2xvc2UoKSxcbiAgICAgIHBhdXNlOiAoKSA9PiB3YXRjaGVyLnBhdXNlKCksXG4gICAgICBnZXRGaWxlVGltZXN0YW1wczogKCkgPT4gcmV2ZXJzZVRpbWVzdGFtcHMod2F0Y2hlci5nZXRGaWxlVGltZXN0YW1wcygpKSxcbiAgICAgIGdldENvbnRleHRUaW1lc3RhbXBzOiAoKSA9PiByZXZlcnNlVGltZXN0YW1wcyh3YXRjaGVyLmdldENvbnRleHRUaW1lc3RhbXBzKCkpLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==