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
exports.externalizePath = exports.normalizePath = void 0;
const nodePath = __importStar(require("path"));
const normalizationCache = new Map();
function normalizePath(path) {
    let result = normalizationCache.get(path);
    if (result === undefined) {
        result = nodePath.win32.normalize(path).replace(/\\/g, nodePath.posix.sep);
        normalizationCache.set(path, result);
    }
    return result;
}
exports.normalizePath = normalizePath;
const externalizationCache = new Map();
function externalizeForWindows(path) {
    let result = externalizationCache.get(path);
    if (result === undefined) {
        result = nodePath.win32.normalize(path);
        externalizationCache.set(path, result);
    }
    return result;
}
exports.externalizePath = (() => {
    if (process.platform !== 'win32') {
        return (path) => path;
    }
    return externalizeForWindows;
})();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS9wYXRocy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsK0NBQWlDO0FBRWpDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7QUFFckQsU0FBZ0IsYUFBYSxDQUFDLElBQVk7SUFDeEMsSUFBSSxNQUFNLEdBQUcsa0JBQWtCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRTFDLElBQUksTUFBTSxLQUFLLFNBQVMsRUFBRTtRQUN4QixNQUFNLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzNFLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7S0FDdEM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBVEQsc0NBU0M7QUFFRCxNQUFNLG9CQUFvQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBRXZELFNBQVMscUJBQXFCLENBQUMsSUFBWTtJQUN6QyxJQUFJLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFNUMsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFO1FBQ3hCLE1BQU0sR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN4QyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0tBQ3hDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQztBQUVZLFFBQUEsZUFBZSxHQUFHLENBQUMsR0FBRyxFQUFFO0lBQ25DLElBQUksT0FBTyxDQUFDLFFBQVEsS0FBSyxPQUFPLEVBQUU7UUFDaEMsT0FBTyxDQUFDLElBQVksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDO0tBQy9CO0lBRUQsT0FBTyxxQkFBcUIsQ0FBQztBQUMvQixDQUFDLENBQUMsRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ3BhdGgnO1xuXG5jb25zdCBub3JtYWxpemF0aW9uQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGF0aChwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgcmVzdWx0ID0gbm9ybWFsaXphdGlvbkNhY2hlLmdldChwYXRoKTtcblxuICBpZiAocmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICByZXN1bHQgPSBub2RlUGF0aC53aW4zMi5ub3JtYWxpemUocGF0aCkucmVwbGFjZSgvXFxcXC9nLCBub2RlUGF0aC5wb3NpeC5zZXApO1xuICAgIG5vcm1hbGl6YXRpb25DYWNoZS5zZXQocGF0aCwgcmVzdWx0KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IGV4dGVybmFsaXphdGlvbkNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuZnVuY3Rpb24gZXh0ZXJuYWxpemVGb3JXaW5kb3dzKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCByZXN1bHQgPSBleHRlcm5hbGl6YXRpb25DYWNoZS5nZXQocGF0aCk7XG5cbiAgaWYgKHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmVzdWx0ID0gbm9kZVBhdGgud2luMzIubm9ybWFsaXplKHBhdGgpO1xuICAgIGV4dGVybmFsaXphdGlvbkNhY2hlLnNldChwYXRoLCByZXN1bHQpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGNvbnN0IGV4dGVybmFsaXplUGF0aCA9ICgoKSA9PiB7XG4gIGlmIChwcm9jZXNzLnBsYXRmb3JtICE9PSAnd2luMzInKSB7XG4gICAgcmV0dXJuIChwYXRoOiBzdHJpbmcpID0+IHBhdGg7XG4gIH1cblxuICByZXR1cm4gZXh0ZXJuYWxpemVGb3JXaW5kb3dzO1xufSkoKTtcbiJdfQ==