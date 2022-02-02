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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCxtREFBcUM7QUFFckMsNkJBS2U7QUFKYiwrR0FBQSx3QkFBd0IsT0FBQTtBQUN4QiwyR0FBQSxvQkFBb0IsT0FBQTtBQUVwQiwrR0FBQSxPQUFPLE9BQUE7QUFHVDs7R0FFRztBQUNILDJEQUEyRDtBQUMzRCxJQUFpQixHQUFHLENBS25CO0FBTEQsV0FBaUIsR0FBRztJQUNMLDRCQUF3QixHQUFHLFdBQVcsQ0FBQyx3QkFBd0IsQ0FBQztJQUNoRSx3QkFBb0IsR0FBRyxXQUFXLENBQUMsb0JBQW9CLENBQUM7QUFHdkUsQ0FBQyxFQUxnQixHQUFHLEdBQUgsV0FBRyxLQUFILFdBQUcsUUFLbkIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgaXZ5SW50ZXJuYWwgZnJvbSAnLi9pdnknO1xuXG5leHBvcnQge1xuICBBbmd1bGFyV2VicGFja0xvYWRlclBhdGgsXG4gIEFuZ3VsYXJXZWJwYWNrUGx1Z2luLFxuICBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnMsXG4gIGRlZmF1bHQsXG59IGZyb20gJy4vaXZ5JztcblxuLyoqIEBkZXByZWNhdGVkIERlcHJlY2F0ZWQgYXMgb2YgdjEyLCBwbGVhc2UgdXNlIHRoZSBkaXJlY3QgZXhwb3J0c1xuICogKGBBbmd1bGFyV2VicGFja1BsdWdpbmAgaW5zdGVhZCBvZiBgaXZ5LkFuZ3VsYXJXZWJwYWNrUGx1Z2luYClcbiAqL1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1uYW1lc3BhY2VcbmV4cG9ydCBuYW1lc3BhY2UgaXZ5IHtcbiAgZXhwb3J0IGNvbnN0IEFuZ3VsYXJXZWJwYWNrTG9hZGVyUGF0aCA9IGl2eUludGVybmFsLkFuZ3VsYXJXZWJwYWNrTG9hZGVyUGF0aDtcbiAgZXhwb3J0IGNvbnN0IEFuZ3VsYXJXZWJwYWNrUGx1Z2luID0gaXZ5SW50ZXJuYWwuQW5ndWxhcldlYnBhY2tQbHVnaW47XG4gIGV4cG9ydCB0eXBlIEFuZ3VsYXJXZWJwYWNrUGx1Z2luID0gaXZ5SW50ZXJuYWwuQW5ndWxhcldlYnBhY2tQbHVnaW47XG4gIGV4cG9ydCB0eXBlIEFuZ3VsYXJQbHVnaW5PcHRpb25zID0gaXZ5SW50ZXJuYWwuQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zO1xufVxuIl19