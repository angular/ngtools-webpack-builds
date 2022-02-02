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
exports.default = exports.angularWebpackLoader = void 0;
const path = __importStar(require("path"));
const symbol_1 = require("./symbol");
const JS_FILE_REGEXP = /\.[cm]?js$/;
function angularWebpackLoader(content, map) {
    const callback = this.async();
    if (!callback) {
        throw new Error('Invalid webpack version');
    }
    const fileEmitter = this[symbol_1.AngularPluginSymbol];
    if (!fileEmitter || typeof fileEmitter !== 'object') {
        if (JS_FILE_REGEXP.test(this.resourcePath)) {
            // Passthrough for JS files when no plugin is used
            this.callback(undefined, content, map);
            return;
        }
        callback(new Error('The Angular Webpack loader requires the AngularWebpackPlugin.'));
        return;
    }
    fileEmitter
        .emit(this.resourcePath)
        .then((result) => {
        if (!result) {
            if (JS_FILE_REGEXP.test(this.resourcePath)) {
                // Return original content for JS files if not compiled by TypeScript ("allowJs")
                this.callback(undefined, content, map);
            }
            else {
                // File is not part of the compilation
                const message = `${this.resourcePath} is missing from the TypeScript compilation. ` +
                    `Please make sure it is in your tsconfig via the 'files' or 'include' property.`;
                callback(new Error(message));
            }
            return;
        }
        result.dependencies.forEach((dependency) => this.addDependency(dependency));
        let resultContent = result.content || '';
        let resultMap;
        if (result.map) {
            resultContent = resultContent.replace(/^\/\/# sourceMappingURL=[^\r\n]*/gm, '');
            resultMap = JSON.parse(result.map);
            resultMap.sources = resultMap.sources.map((source) => path.join(path.dirname(this.resourcePath), source));
        }
        callback(undefined, resultContent, resultMap);
    })
        .catch((err) => {
        // The below is needed to hide stacktraces from users.
        const message = err instanceof Error ? err.message : err;
        callback(new Error(message));
    });
}
exports.angularWebpackLoader = angularWebpackLoader;
exports.default = angularWebpackLoader;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvbG9hZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwyQ0FBNkI7QUFFN0IscUNBQXNFO0FBRXRFLE1BQU0sY0FBYyxHQUFHLFlBQVksQ0FBQztBQUVwQyxTQUFnQixvQkFBb0IsQ0FBK0IsT0FBZSxFQUFFLEdBQVc7SUFDN0YsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQzlCLElBQUksQ0FBQyxRQUFRLEVBQUU7UUFDYixNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUM7S0FDNUM7SUFFRCxNQUFNLFdBQVcsR0FDZixJQUNELENBQUMsNEJBQW1CLENBQUMsQ0FBQztJQUN2QixJQUFJLENBQUMsV0FBVyxJQUFJLE9BQU8sV0FBVyxLQUFLLFFBQVEsRUFBRTtRQUNuRCxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFFO1lBQzFDLGtEQUFrRDtZQUNsRCxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFdkMsT0FBTztTQUNSO1FBRUQsUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLCtEQUErRCxDQUFDLENBQUMsQ0FBQztRQUVyRixPQUFPO0tBQ1I7SUFFRCxXQUFXO1NBQ1IsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUM7U0FDdkIsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7UUFDZixJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ1gsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRTtnQkFDMUMsaUZBQWlGO2dCQUNqRixJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUM7YUFDeEM7aUJBQU07Z0JBQ0wsc0NBQXNDO2dCQUN0QyxNQUFNLE9BQU8sR0FDWCxHQUFHLElBQUksQ0FBQyxZQUFZLCtDQUErQztvQkFDbkUsZ0ZBQWdGLENBQUM7Z0JBQ25GLFFBQVEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO2FBQzlCO1lBRUQsT0FBTztTQUNSO1FBRUQsTUFBTSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztRQUU1RSxJQUFJLGFBQWEsR0FBRyxNQUFNLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQztRQUN6QyxJQUFJLFNBQVMsQ0FBQztRQUNkLElBQUksTUFBTSxDQUFDLEdBQUcsRUFBRTtZQUNkLGFBQWEsR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDLG9DQUFvQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2hGLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNuQyxTQUFTLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBYyxFQUFFLEVBQUUsQ0FDM0QsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FDbkQsQ0FBQztTQUNIO1FBRUQsUUFBUSxDQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDaEQsQ0FBQyxDQUFDO1NBQ0QsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7UUFDYixzREFBc0Q7UUFDdEQsTUFBTSxPQUFPLEdBQUcsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO1FBQ3pELFFBQVEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQy9CLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQTNERCxvREEyREM7QUFFZ0MsdUNBQU8iLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB0eXBlIHsgTG9hZGVyQ29udGV4dCB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgQW5ndWxhclBsdWdpblN5bWJvbCwgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uIH0gZnJvbSAnLi9zeW1ib2wnO1xuXG5jb25zdCBKU19GSUxFX1JFR0VYUCA9IC9cXC5bY21dP2pzJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBhbmd1bGFyV2VicGFja0xvYWRlcih0aGlzOiBMb2FkZXJDb250ZXh0PHVua25vd24+LCBjb250ZW50OiBzdHJpbmcsIG1hcDogc3RyaW5nKSB7XG4gIGNvbnN0IGNhbGxiYWNrID0gdGhpcy5hc3luYygpO1xuICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHdlYnBhY2sgdmVyc2lvbicpO1xuICB9XG5cbiAgY29uc3QgZmlsZUVtaXR0ZXIgPSAoXG4gICAgdGhpcyBhcyBMb2FkZXJDb250ZXh0PHVua25vd24+ICYgeyBbQW5ndWxhclBsdWdpblN5bWJvbF0/OiBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfVxuICApW0FuZ3VsYXJQbHVnaW5TeW1ib2xdO1xuICBpZiAoIWZpbGVFbWl0dGVyIHx8IHR5cGVvZiBmaWxlRW1pdHRlciAhPT0gJ29iamVjdCcpIHtcbiAgICBpZiAoSlNfRklMRV9SRUdFWFAudGVzdCh0aGlzLnJlc291cmNlUGF0aCkpIHtcbiAgICAgIC8vIFBhc3N0aHJvdWdoIGZvciBKUyBmaWxlcyB3aGVuIG5vIHBsdWdpbiBpcyB1c2VkXG4gICAgICB0aGlzLmNhbGxiYWNrKHVuZGVmaW5lZCwgY29udGVudCwgbWFwKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNhbGxiYWNrKG5ldyBFcnJvcignVGhlIEFuZ3VsYXIgV2VicGFjayBsb2FkZXIgcmVxdWlyZXMgdGhlIEFuZ3VsYXJXZWJwYWNrUGx1Z2luLicpKTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIGZpbGVFbWl0dGVyXG4gICAgLmVtaXQodGhpcy5yZXNvdXJjZVBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgaWYgKEpTX0ZJTEVfUkVHRVhQLnRlc3QodGhpcy5yZXNvdXJjZVBhdGgpKSB7XG4gICAgICAgICAgLy8gUmV0dXJuIG9yaWdpbmFsIGNvbnRlbnQgZm9yIEpTIGZpbGVzIGlmIG5vdCBjb21waWxlZCBieSBUeXBlU2NyaXB0IChcImFsbG93SnNcIilcbiAgICAgICAgICB0aGlzLmNhbGxiYWNrKHVuZGVmaW5lZCwgY29udGVudCwgbWFwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGaWxlIGlzIG5vdCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvblxuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPVxuICAgICAgICAgICAgYCR7dGhpcy5yZXNvdXJjZVBhdGh9IGlzIG1pc3NpbmcgZnJvbSB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbi4gYCArXG4gICAgICAgICAgICBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcbiAgICAgICAgICBjYWxsYmFjayhuZXcgRXJyb3IobWVzc2FnZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICByZXN1bHQuZGVwZW5kZW5jaWVzLmZvckVhY2goKGRlcGVuZGVuY3kpID0+IHRoaXMuYWRkRGVwZW5kZW5jeShkZXBlbmRlbmN5KSk7XG5cbiAgICAgIGxldCByZXN1bHRDb250ZW50ID0gcmVzdWx0LmNvbnRlbnQgfHwgJyc7XG4gICAgICBsZXQgcmVzdWx0TWFwO1xuICAgICAgaWYgKHJlc3VsdC5tYXApIHtcbiAgICAgICAgcmVzdWx0Q29udGVudCA9IHJlc3VsdENvbnRlbnQucmVwbGFjZSgvXlxcL1xcLyMgc291cmNlTWFwcGluZ1VSTD1bXlxcclxcbl0qL2dtLCAnJyk7XG4gICAgICAgIHJlc3VsdE1hcCA9IEpTT04ucGFyc2UocmVzdWx0Lm1hcCk7XG4gICAgICAgIHJlc3VsdE1hcC5zb3VyY2VzID0gcmVzdWx0TWFwLnNvdXJjZXMubWFwKChzb3VyY2U6IHN0cmluZykgPT5cbiAgICAgICAgICBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHRoaXMucmVzb3VyY2VQYXRoKSwgc291cmNlKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHRDb250ZW50LCByZXN1bHRNYXApO1xuICAgIH0pXG4gICAgLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIC8vIFRoZSBiZWxvdyBpcyBuZWVkZWQgdG8gaGlkZSBzdGFja3RyYWNlcyBmcm9tIHVzZXJzLlxuICAgICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBlcnI7XG4gICAgICBjYWxsYmFjayhuZXcgRXJyb3IobWVzc2FnZSkpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgeyBhbmd1bGFyV2VicGFja0xvYWRlciBhcyBkZWZhdWx0IH07XG4iXX0=