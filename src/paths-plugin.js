"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const path = require("path");
const ts = require("typescript");
function resolveWithPaths(request, callback, compilerOptions, host, cache) {
    if (!request || !request.request || !compilerOptions.paths) {
        callback(null, request);
        return;
    }
    // Only work on Javascript/TypeScript issuers.
    if (!request.contextInfo.issuer || !request.contextInfo.issuer.match(/\.[jt]s$/)) {
        callback(null, request);
        return;
    }
    const originalRequest = request.request.trim();
    // Relative requests are not mapped
    if (originalRequest.startsWith('.') || originalRequest.startsWith('/')) {
        callback(null, request);
        return;
    }
    // Amd requests are not mapped
    if (originalRequest.startsWith('!!webpack amd')) {
        callback(null, request);
        return;
    }
    // check if any path mapping rules are relevant
    const pathMapOptions = [];
    for (const pattern in compilerOptions.paths) {
        // get potentials and remove duplicates; JS Set maintains insertion order
        const potentials = Array.from(new Set(compilerOptions.paths[pattern]));
        if (potentials.length === 0) {
            // no potential replacements so skip
            continue;
        }
        // can only contain zero or one
        const starIndex = pattern.indexOf('*');
        if (starIndex === -1) {
            if (pattern === originalRequest) {
                pathMapOptions.push({
                    starIndex,
                    partial: '',
                    potentials,
                });
            }
        }
        else if (starIndex === 0 && pattern.length === 1) {
            pathMapOptions.push({
                starIndex,
                partial: originalRequest,
                potentials,
            });
        }
        else if (starIndex === pattern.length - 1) {
            if (originalRequest.startsWith(pattern.slice(0, -1))) {
                pathMapOptions.push({
                    starIndex,
                    partial: originalRequest.slice(pattern.length - 1),
                    potentials,
                });
            }
        }
        else {
            const [prefix, suffix] = pattern.split('*');
            if (originalRequest.startsWith(prefix) && originalRequest.endsWith(suffix)) {
                pathMapOptions.push({
                    starIndex,
                    partial: originalRequest.slice(prefix.length).slice(0, -suffix.length),
                    potentials,
                });
            }
        }
    }
    if (pathMapOptions.length === 0) {
        callback(null, request);
        return;
    }
    // exact matches take priority then largest prefix match
    pathMapOptions.sort((a, b) => {
        if (a.starIndex === -1) {
            return -1;
        }
        else if (b.starIndex === -1) {
            return 1;
        }
        else {
            return b.starIndex - a.starIndex;
        }
    });
    if (pathMapOptions[0].potentials.length === 1) {
        const onlyPotential = pathMapOptions[0].potentials[0];
        let replacement;
        const starIndex = onlyPotential.indexOf('*');
        if (starIndex === -1) {
            replacement = onlyPotential;
        }
        else if (starIndex === onlyPotential.length - 1) {
            replacement = onlyPotential.slice(0, -1) + pathMapOptions[0].partial;
        }
        else {
            const [prefix, suffix] = onlyPotential.split('*');
            replacement = prefix + pathMapOptions[0].partial + suffix;
        }
        request.request = path.resolve(compilerOptions.baseUrl || '', replacement);
        callback(null, request);
        return;
    }
    // TODO: The following is used when there is more than one potential and will not be
    //       needed once this is turned into a full webpack resolver plugin
    const moduleResolver = ts.resolveModuleName(originalRequest, request.contextInfo.issuer, compilerOptions, host, cache);
    const moduleFilePath = moduleResolver.resolvedModule
        && moduleResolver.resolvedModule.resolvedFileName;
    // If there is no result, let webpack try to resolve
    if (!moduleFilePath) {
        callback(null, request);
        return;
    }
    // If TypeScript gives us a `.d.ts`, it is probably a node module
    if (moduleFilePath.endsWith('.d.ts')) {
        // If in a package, let webpack resolve the package
        const packageRootPath = path.join(path.dirname(moduleFilePath), 'package.json');
        if (!host.fileExists(packageRootPath)) {
            // Otherwise, if there is a file with a .js extension use that
            const jsFilePath = moduleFilePath.slice(0, -5) + '.js';
            if (host.fileExists(jsFilePath)) {
                request.request = jsFilePath;
            }
        }
        callback(null, request);
        return;
    }
    request.request = moduleFilePath;
    callback(null, request);
}
exports.resolveWithPaths = resolveWithPaths;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMtcGx1Z2luLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3BhdGhzLXBsdWdpbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFPakMsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BQW1DLEVBQ25DLFFBQThDLEVBQzlDLGVBQW1DLEVBQ25DLElBQXFCLEVBQ3JCLEtBQWdDO0lBRWhDLElBQUksQ0FBQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRTtRQUMxRCxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELDhDQUE4QztJQUM5QyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUU7UUFDaEYsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixPQUFPO0tBQ1I7SUFFRCxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBRS9DLG1DQUFtQztJQUNuQyxJQUFJLGVBQWUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksZUFBZSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRTtRQUN0RSxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELDhCQUE4QjtJQUM5QixJQUFJLGVBQWUsQ0FBQyxVQUFVLENBQUMsZUFBZSxDQUFDLEVBQUU7UUFDL0MsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixPQUFPO0tBQ1I7SUFFRCwrQ0FBK0M7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LENBQUM7UUFFeEIsT0FBTztLQUNSO0lBRUQsaUVBQWlFO0lBQ2pFLElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRTtRQUNwQyxtREFBbUQ7UUFDbkQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ2hGLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxFQUFFO1lBQ3JDLDhEQUE4RDtZQUM5RCxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQztZQUN2RCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLEVBQUU7Z0JBQy9CLE9BQU8sQ0FBQyxPQUFPLEdBQUcsVUFBVSxDQUFDO2FBQzlCO1NBQ0Y7UUFFRCxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELE9BQU8sQ0FBQyxPQUFPLEdBQUcsY0FBYyxDQUFDO0lBQ2pDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDMUIsQ0FBQztBQTlKRCw0Q0E4SkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQge1xuICBDYWxsYmFjayxcbiAgTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QsXG59IGZyb20gJy4vd2VicGFjayc7XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVXaXRoUGF0aHMoXG4gIHJlcXVlc3Q6IE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0LFxuICBjYWxsYmFjazogQ2FsbGJhY2s8Tm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3Q+LFxuICBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICBjYWNoZT86IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZSxcbikge1xuICBpZiAoIXJlcXVlc3QgfHwgIXJlcXVlc3QucmVxdWVzdCB8fCAhY29tcGlsZXJPcHRpb25zLnBhdGhzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBPbmx5IHdvcmsgb24gSmF2YXNjcmlwdC9UeXBlU2NyaXB0IGlzc3VlcnMuXG4gIGlmICghcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXIgfHwgIXJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyLm1hdGNoKC9cXC5banRdcyQvKSkge1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgb3JpZ2luYWxSZXF1ZXN0ID0gcmVxdWVzdC5yZXF1ZXN0LnRyaW0oKTtcblxuICAvLyBSZWxhdGl2ZSByZXF1ZXN0cyBhcmUgbm90IG1hcHBlZFxuICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgoJy4nKSB8fCBvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBbWQgcmVxdWVzdHMgYXJlIG5vdCBtYXBwZWRcbiAgaWYgKG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKCchIXdlYnBhY2sgYW1kJykpIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIGFueSBwYXRoIG1hcHBpbmcgcnVsZXMgYXJlIHJlbGV2YW50XG4gIGNvbnN0IHBhdGhNYXBPcHRpb25zID0gW107XG4gIGZvciAoY29uc3QgcGF0dGVybiBpbiBjb21waWxlck9wdGlvbnMucGF0aHMpIHtcbiAgICAvLyBnZXQgcG90ZW50aWFscyBhbmQgcmVtb3ZlIGR1cGxpY2F0ZXM7IEpTIFNldCBtYWludGFpbnMgaW5zZXJ0aW9uIG9yZGVyXG4gICAgY29uc3QgcG90ZW50aWFscyA9IEFycmF5LmZyb20obmV3IFNldChjb21waWxlck9wdGlvbnMucGF0aHNbcGF0dGVybl0pKTtcbiAgICBpZiAocG90ZW50aWFscy5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIG5vIHBvdGVudGlhbCByZXBsYWNlbWVudHMgc28gc2tpcFxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gY2FuIG9ubHkgY29udGFpbiB6ZXJvIG9yIG9uZVxuICAgIGNvbnN0IHN0YXJJbmRleCA9IHBhdHRlcm4uaW5kZXhPZignKicpO1xuICAgIGlmIChzdGFySW5kZXggPT09IC0xKSB7XG4gICAgICBpZiAocGF0dGVybiA9PT0gb3JpZ2luYWxSZXF1ZXN0KSB7XG4gICAgICAgIHBhdGhNYXBPcHRpb25zLnB1c2goe1xuICAgICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgICBwYXJ0aWFsOiAnJyxcbiAgICAgICAgICBwb3RlbnRpYWxzLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHN0YXJJbmRleCA9PT0gMCAmJiBwYXR0ZXJuLmxlbmd0aCA9PT0gMSkge1xuICAgICAgcGF0aE1hcE9wdGlvbnMucHVzaCh7XG4gICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgcGFydGlhbDogb3JpZ2luYWxSZXF1ZXN0LFxuICAgICAgICBwb3RlbnRpYWxzLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChzdGFySW5kZXggPT09IHBhdHRlcm4ubGVuZ3RoIC0gMSkge1xuICAgICAgaWYgKG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKHBhdHRlcm4uc2xpY2UoMCwgLTEpKSkge1xuICAgICAgICBwYXRoTWFwT3B0aW9ucy5wdXNoKHtcbiAgICAgICAgICBzdGFySW5kZXgsXG4gICAgICAgICAgcGFydGlhbDogb3JpZ2luYWxSZXF1ZXN0LnNsaWNlKHBhdHRlcm4ubGVuZ3RoIC0gMSksXG4gICAgICAgICAgcG90ZW50aWFscyxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IFtwcmVmaXgsIHN1ZmZpeF0gPSBwYXR0ZXJuLnNwbGl0KCcqJyk7XG4gICAgICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgocHJlZml4KSAmJiBvcmlnaW5hbFJlcXVlc3QuZW5kc1dpdGgoc3VmZml4KSkge1xuICAgICAgICBwYXRoTWFwT3B0aW9ucy5wdXNoKHtcbiAgICAgICAgICBzdGFySW5kZXgsXG4gICAgICAgICAgcGFydGlhbDogb3JpZ2luYWxSZXF1ZXN0LnNsaWNlKHByZWZpeC5sZW5ndGgpLnNsaWNlKDAsIC1zdWZmaXgubGVuZ3RoKSxcbiAgICAgICAgICBwb3RlbnRpYWxzLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAocGF0aE1hcE9wdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBleGFjdCBtYXRjaGVzIHRha2UgcHJpb3JpdHkgdGhlbiBsYXJnZXN0IHByZWZpeCBtYXRjaFxuICBwYXRoTWFwT3B0aW9ucy5zb3J0KChhLCBiKSA9PiB7XG4gICAgaWYgKGEuc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgcmV0dXJuIC0xO1xuICAgIH0gZWxzZSBpZiAoYi5zdGFySW5kZXggPT09IC0xKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGIuc3RhckluZGV4IC0gYS5zdGFySW5kZXg7XG4gICAgfVxuICB9KTtcblxuICBpZiAocGF0aE1hcE9wdGlvbnNbMF0ucG90ZW50aWFscy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBvbmx5UG90ZW50aWFsID0gcGF0aE1hcE9wdGlvbnNbMF0ucG90ZW50aWFsc1swXTtcbiAgICBsZXQgcmVwbGFjZW1lbnQ7XG4gICAgY29uc3Qgc3RhckluZGV4ID0gb25seVBvdGVudGlhbC5pbmRleE9mKCcqJyk7XG4gICAgaWYgKHN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgIHJlcGxhY2VtZW50ID0gb25seVBvdGVudGlhbDtcbiAgICB9IGVsc2UgaWYgKHN0YXJJbmRleCA9PT0gb25seVBvdGVudGlhbC5sZW5ndGggLSAxKSB7XG4gICAgICByZXBsYWNlbWVudCA9IG9ubHlQb3RlbnRpYWwuc2xpY2UoMCwgLTEpICsgcGF0aE1hcE9wdGlvbnNbMF0ucGFydGlhbDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgW3ByZWZpeCwgc3VmZml4XSA9IG9ubHlQb3RlbnRpYWwuc3BsaXQoJyonKTtcbiAgICAgIHJlcGxhY2VtZW50ID0gcHJlZml4ICsgcGF0aE1hcE9wdGlvbnNbMF0ucGFydGlhbCArIHN1ZmZpeDtcbiAgICB9XG5cbiAgICByZXF1ZXN0LnJlcXVlc3QgPSBwYXRoLnJlc29sdmUoY29tcGlsZXJPcHRpb25zLmJhc2VVcmwgfHwgJycsIHJlcGxhY2VtZW50KTtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRPRE86IFRoZSBmb2xsb3dpbmcgaXMgdXNlZCB3aGVuIHRoZXJlIGlzIG1vcmUgdGhhbiBvbmUgcG90ZW50aWFsIGFuZCB3aWxsIG5vdCBiZVxuICAvLyAgICAgICBuZWVkZWQgb25jZSB0aGlzIGlzIHR1cm5lZCBpbnRvIGEgZnVsbCB3ZWJwYWNrIHJlc29sdmVyIHBsdWdpblxuXG4gIGNvbnN0IG1vZHVsZVJlc29sdmVyID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUoXG4gICAgb3JpZ2luYWxSZXF1ZXN0LFxuICAgIHJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyLFxuICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICBob3N0LFxuICAgIGNhY2hlLFxuICApO1xuXG4gIGNvbnN0IG1vZHVsZUZpbGVQYXRoID0gbW9kdWxlUmVzb2x2ZXIucmVzb2x2ZWRNb2R1bGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAmJiBtb2R1bGVSZXNvbHZlci5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lO1xuXG4gIC8vIElmIHRoZXJlIGlzIG5vIHJlc3VsdCwgbGV0IHdlYnBhY2sgdHJ5IHRvIHJlc29sdmVcbiAgaWYgKCFtb2R1bGVGaWxlUGF0aCkge1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gSWYgVHlwZVNjcmlwdCBnaXZlcyB1cyBhIGAuZC50c2AsIGl0IGlzIHByb2JhYmx5IGEgbm9kZSBtb2R1bGVcbiAgaWYgKG1vZHVsZUZpbGVQYXRoLmVuZHNXaXRoKCcuZC50cycpKSB7XG4gICAgLy8gSWYgaW4gYSBwYWNrYWdlLCBsZXQgd2VicGFjayByZXNvbHZlIHRoZSBwYWNrYWdlXG4gICAgY29uc3QgcGFja2FnZVJvb3RQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShtb2R1bGVGaWxlUGF0aCksICdwYWNrYWdlLmpzb24nKTtcbiAgICBpZiAoIWhvc3QuZmlsZUV4aXN0cyhwYWNrYWdlUm9vdFBhdGgpKSB7XG4gICAgICAvLyBPdGhlcndpc2UsIGlmIHRoZXJlIGlzIGEgZmlsZSB3aXRoIGEgLmpzIGV4dGVuc2lvbiB1c2UgdGhhdFxuICAgICAgY29uc3QganNGaWxlUGF0aCA9IG1vZHVsZUZpbGVQYXRoLnNsaWNlKDAsIC01KSArICcuanMnO1xuICAgICAgaWYgKGhvc3QuZmlsZUV4aXN0cyhqc0ZpbGVQYXRoKSkge1xuICAgICAgICByZXF1ZXN0LnJlcXVlc3QgPSBqc0ZpbGVQYXRoO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgcmVxdWVzdC5yZXF1ZXN0ID0gbW9kdWxlRmlsZVBhdGg7XG4gIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xufVxuIl19