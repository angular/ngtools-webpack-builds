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
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ivy = exports.default = exports.AngularWebpackPlugin = exports.AngularWebpackLoaderPath = void 0;
const ivyInternal = __importStar(require("./ivy"));
var ivy_1 = require("./ivy");
Object.defineProperty(exports, "AngularWebpackLoaderPath", { enumerable: true, get: function () { return ivy_1.AngularWebpackLoaderPath; } });
Object.defineProperty(exports, "AngularWebpackPlugin", { enumerable: true, get: function () { return ivy_1.AngularWebpackPlugin; } });
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(ivy_1).default; } });
/** @deprecated Deprecated as of v12, please use the direct exports
 * (`AngularWebpackPlugin` instead of `ivy.AngularWebpackPlugin`)
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
var ivy;
(function (ivy) {
    ivy.AngularWebpackLoaderPath = ivyInternal.AngularWebpackLoaderPath;
    ivy.AngularWebpackPlugin = ivyInternal.AngularWebpackPlugin;
})(ivy = exports.ivy || (exports.ivy = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsbURBQXFDO0FBRXJDLDZCQUtlO0FBSmIsK0dBQUEsd0JBQXdCLE9BQUE7QUFDeEIsMkdBQUEsb0JBQW9CLE9BQUE7QUFFcEIsK0dBQUEsT0FBTyxPQUFBO0FBR1Q7O0dBRUc7QUFDSCwyREFBMkQ7QUFDM0QsSUFBaUIsR0FBRyxDQUtuQjtBQUxELFdBQWlCLEdBQUc7SUFDTCw0QkFBd0IsR0FBRyxXQUFXLENBQUMsd0JBQXdCLENBQUM7SUFDaEUsd0JBQW9CLEdBQUcsV0FBVyxDQUFDLG9CQUFvQixDQUFDO0FBR3ZFLENBQUMsRUFMZ0IsR0FBRyxHQUFILFdBQUcsS0FBSCxXQUFHLFFBS25CIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIGl2eUludGVybmFsIGZyb20gJy4vaXZ5JztcblxuZXhwb3J0IHtcbiAgQW5ndWxhcldlYnBhY2tMb2FkZXJQYXRoLFxuICBBbmd1bGFyV2VicGFja1BsdWdpbixcbiAgQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zLFxuICBkZWZhdWx0LFxufSBmcm9tICcuL2l2eSc7XG5cbi8qKiBAZGVwcmVjYXRlZCBEZXByZWNhdGVkIGFzIG9mIHYxMiwgcGxlYXNlIHVzZSB0aGUgZGlyZWN0IGV4cG9ydHNcbiAqIChgQW5ndWxhcldlYnBhY2tQbHVnaW5gIGluc3RlYWQgb2YgYGl2eS5Bbmd1bGFyV2VicGFja1BsdWdpbmApXG4gKi9cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbmFtZXNwYWNlXG5leHBvcnQgbmFtZXNwYWNlIGl2eSB7XG4gIGV4cG9ydCBjb25zdCBBbmd1bGFyV2VicGFja0xvYWRlclBhdGggPSBpdnlJbnRlcm5hbC5Bbmd1bGFyV2VicGFja0xvYWRlclBhdGg7XG4gIGV4cG9ydCBjb25zdCBBbmd1bGFyV2VicGFja1BsdWdpbiA9IGl2eUludGVybmFsLkFuZ3VsYXJXZWJwYWNrUGx1Z2luO1xuICBleHBvcnQgdHlwZSBBbmd1bGFyV2VicGFja1BsdWdpbiA9IGl2eUludGVybmFsLkFuZ3VsYXJXZWJwYWNrUGx1Z2luO1xuICBleHBvcnQgdHlwZSBBbmd1bGFyUGx1Z2luT3B0aW9ucyA9IGl2eUludGVybmFsLkFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucztcbn1cbiJdfQ==