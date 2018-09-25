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
    if (!request.contextInfo.issuer || !request.contextInfo.issuer.match(/\.[jt]sx?$/)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMtcGx1Z2luLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3BhdGhzLXBsdWdpbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFPakMsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BQW1DLEVBQ25DLFFBQThDLEVBQzlDLGVBQW1DLEVBQ25DLElBQXFCLEVBQ3JCLEtBQWdDO0lBRWhDLElBQUksQ0FBQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRTtRQUMxRCxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELDhDQUE4QztJQUM5QyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUU7UUFDbEYsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixPQUFPO0tBQ1I7SUFFRCxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBRS9DLG1DQUFtQztJQUNuQyxJQUFJLGVBQWUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksZUFBZSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRTtRQUN0RSxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELDhCQUE4QjtJQUM5QixJQUFJLGVBQWUsQ0FBQyxVQUFVLENBQUMsZUFBZSxDQUFDLEVBQUU7UUFDL0MsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixPQUFPO0tBQ1I7SUFFRCwrQ0FBK0M7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LENBQUM7UUFFeEIsT0FBTztLQUNSO0lBRUQsaUVBQWlFO0lBQ2pFLElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRTtRQUNwQyxtREFBbUQ7UUFDbkQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ2hGLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxFQUFFO1lBQ3JDLDhEQUE4RDtZQUM5RCxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQztZQUN2RCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLEVBQUU7Z0JBQy9CLE9BQU8sQ0FBQyxPQUFPLEdBQUcsVUFBVSxDQUFDO2FBQzlCO1NBQ0Y7UUFFRCxRQUFRLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhCLE9BQU87S0FDUjtJQUVELE9BQU8sQ0FBQyxPQUFPLEdBQUcsY0FBYyxDQUFDO0lBQ2pDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDMUIsQ0FBQztBQTlKRCw0Q0E4SkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQge1xuICBDYWxsYmFjayxcbiAgTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QsXG59IGZyb20gJy4vd2VicGFjayc7XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVXaXRoUGF0aHMoXG4gIHJlcXVlc3Q6IE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0LFxuICBjYWxsYmFjazogQ2FsbGJhY2s8Tm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3Q+LFxuICBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICBjYWNoZT86IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZSxcbikge1xuICBpZiAoIXJlcXVlc3QgfHwgIXJlcXVlc3QucmVxdWVzdCB8fCAhY29tcGlsZXJPcHRpb25zLnBhdGhzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBPbmx5IHdvcmsgb24gSmF2YXNjcmlwdC9UeXBlU2NyaXB0IGlzc3VlcnMuXG4gIGlmICghcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXIgfHwgIXJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyLm1hdGNoKC9cXC5banRdc3g/JC8pKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBvcmlnaW5hbFJlcXVlc3QgPSByZXF1ZXN0LnJlcXVlc3QudHJpbSgpO1xuXG4gIC8vIFJlbGF0aXZlIHJlcXVlc3RzIGFyZSBub3QgbWFwcGVkXG4gIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aCgnLicpIHx8IG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEFtZCByZXF1ZXN0cyBhcmUgbm90IG1hcHBlZFxuICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgoJyEhd2VicGFjayBhbWQnKSkge1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgYW55IHBhdGggbWFwcGluZyBydWxlcyBhcmUgcmVsZXZhbnRcbiAgY29uc3QgcGF0aE1hcE9wdGlvbnMgPSBbXTtcbiAgZm9yIChjb25zdCBwYXR0ZXJuIGluIGNvbXBpbGVyT3B0aW9ucy5wYXRocykge1xuICAgIC8vIGdldCBwb3RlbnRpYWxzIGFuZCByZW1vdmUgZHVwbGljYXRlczsgSlMgU2V0IG1haW50YWlucyBpbnNlcnRpb24gb3JkZXJcbiAgICBjb25zdCBwb3RlbnRpYWxzID0gQXJyYXkuZnJvbShuZXcgU2V0KGNvbXBpbGVyT3B0aW9ucy5wYXRoc1twYXR0ZXJuXSkpO1xuICAgIGlmIChwb3RlbnRpYWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gbm8gcG90ZW50aWFsIHJlcGxhY2VtZW50cyBzbyBza2lwXG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBjYW4gb25seSBjb250YWluIHplcm8gb3Igb25lXG4gICAgY29uc3Qgc3RhckluZGV4ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gICAgaWYgKHN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgIGlmIChwYXR0ZXJuID09PSBvcmlnaW5hbFJlcXVlc3QpIHtcbiAgICAgICAgcGF0aE1hcE9wdGlvbnMucHVzaCh7XG4gICAgICAgICAgc3RhckluZGV4LFxuICAgICAgICAgIHBhcnRpYWw6ICcnLFxuICAgICAgICAgIHBvdGVudGlhbHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoc3RhckluZGV4ID09PSAwICYmIHBhdHRlcm4ubGVuZ3RoID09PSAxKSB7XG4gICAgICBwYXRoTWFwT3B0aW9ucy5wdXNoKHtcbiAgICAgICAgc3RhckluZGV4LFxuICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3QsXG4gICAgICAgIHBvdGVudGlhbHMsXG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKHN0YXJJbmRleCA9PT0gcGF0dGVybi5sZW5ndGggLSAxKSB7XG4gICAgICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgocGF0dGVybi5zbGljZSgwLCAtMSkpKSB7XG4gICAgICAgIHBhdGhNYXBPcHRpb25zLnB1c2goe1xuICAgICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3Quc2xpY2UocGF0dGVybi5sZW5ndGggLSAxKSxcbiAgICAgICAgICBwb3RlbnRpYWxzLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgW3ByZWZpeCwgc3VmZml4XSA9IHBhdHRlcm4uc3BsaXQoJyonKTtcbiAgICAgIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aChwcmVmaXgpICYmIG9yaWdpbmFsUmVxdWVzdC5lbmRzV2l0aChzdWZmaXgpKSB7XG4gICAgICAgIHBhdGhNYXBPcHRpb25zLnB1c2goe1xuICAgICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3Quc2xpY2UocHJlZml4Lmxlbmd0aCkuc2xpY2UoMCwgLXN1ZmZpeC5sZW5ndGgpLFxuICAgICAgICAgIHBvdGVudGlhbHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChwYXRoTWFwT3B0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGV4YWN0IG1hdGNoZXMgdGFrZSBwcmlvcml0eSB0aGVuIGxhcmdlc3QgcHJlZml4IG1hdGNoXG4gIHBhdGhNYXBPcHRpb25zLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5zdGFySW5kZXggPT09IC0xKSB7XG4gICAgICByZXR1cm4gLTE7XG4gICAgfSBlbHNlIGlmIChiLnN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgIHJldHVybiAxO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYi5zdGFySW5kZXggLSBhLnN0YXJJbmRleDtcbiAgICB9XG4gIH0pO1xuXG4gIGlmIChwYXRoTWFwT3B0aW9uc1swXS5wb3RlbnRpYWxzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG9ubHlQb3RlbnRpYWwgPSBwYXRoTWFwT3B0aW9uc1swXS5wb3RlbnRpYWxzWzBdO1xuICAgIGxldCByZXBsYWNlbWVudDtcbiAgICBjb25zdCBzdGFySW5kZXggPSBvbmx5UG90ZW50aWFsLmluZGV4T2YoJyonKTtcbiAgICBpZiAoc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgcmVwbGFjZW1lbnQgPSBvbmx5UG90ZW50aWFsO1xuICAgIH0gZWxzZSBpZiAoc3RhckluZGV4ID09PSBvbmx5UG90ZW50aWFsLmxlbmd0aCAtIDEpIHtcbiAgICAgIHJlcGxhY2VtZW50ID0gb25seVBvdGVudGlhbC5zbGljZSgwLCAtMSkgKyBwYXRoTWFwT3B0aW9uc1swXS5wYXJ0aWFsO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBbcHJlZml4LCBzdWZmaXhdID0gb25seVBvdGVudGlhbC5zcGxpdCgnKicpO1xuICAgICAgcmVwbGFjZW1lbnQgPSBwcmVmaXggKyBwYXRoTWFwT3B0aW9uc1swXS5wYXJ0aWFsICsgc3VmZml4O1xuICAgIH1cblxuICAgIHJlcXVlc3QucmVxdWVzdCA9IHBhdGgucmVzb2x2ZShjb21waWxlck9wdGlvbnMuYmFzZVVybCB8fCAnJywgcmVwbGFjZW1lbnQpO1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVE9ETzogVGhlIGZvbGxvd2luZyBpcyB1c2VkIHdoZW4gdGhlcmUgaXMgbW9yZSB0aGFuIG9uZSBwb3RlbnRpYWwgYW5kIHdpbGwgbm90IGJlXG4gIC8vICAgICAgIG5lZWRlZCBvbmNlIHRoaXMgaXMgdHVybmVkIGludG8gYSBmdWxsIHdlYnBhY2sgcmVzb2x2ZXIgcGx1Z2luXG5cbiAgY29uc3QgbW9kdWxlUmVzb2x2ZXIgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShcbiAgICBvcmlnaW5hbFJlcXVlc3QsXG4gICAgcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXIsXG4gICAgY29tcGlsZXJPcHRpb25zLFxuICAgIGhvc3QsXG4gICAgY2FjaGUsXG4gICk7XG5cbiAgY29uc3QgbW9kdWxlRmlsZVBhdGggPSBtb2R1bGVSZXNvbHZlci5yZXNvbHZlZE1vZHVsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICYmIG1vZHVsZVJlc29sdmVyLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gcmVzdWx0LCBsZXQgd2VicGFjayB0cnkgdG8gcmVzb2x2ZVxuICBpZiAoIW1vZHVsZUZpbGVQYXRoKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBJZiBUeXBlU2NyaXB0IGdpdmVzIHVzIGEgYC5kLnRzYCwgaXQgaXMgcHJvYmFibHkgYSBub2RlIG1vZHVsZVxuICBpZiAobW9kdWxlRmlsZVBhdGguZW5kc1dpdGgoJy5kLnRzJykpIHtcbiAgICAvLyBJZiBpbiBhIHBhY2thZ2UsIGxldCB3ZWJwYWNrIHJlc29sdmUgdGhlIHBhY2thZ2VcbiAgICBjb25zdCBwYWNrYWdlUm9vdFBhdGggPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKG1vZHVsZUZpbGVQYXRoKSwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGlmICghaG9zdC5maWxlRXhpc3RzKHBhY2thZ2VSb290UGF0aCkpIHtcbiAgICAgIC8vIE90aGVyd2lzZSwgaWYgdGhlcmUgaXMgYSBmaWxlIHdpdGggYSAuanMgZXh0ZW5zaW9uIHVzZSB0aGF0XG4gICAgICBjb25zdCBqc0ZpbGVQYXRoID0gbW9kdWxlRmlsZVBhdGguc2xpY2UoMCwgLTUpICsgJy5qcyc7XG4gICAgICBpZiAoaG9zdC5maWxlRXhpc3RzKGpzRmlsZVBhdGgpKSB7XG4gICAgICAgIHJlcXVlc3QucmVxdWVzdCA9IGpzRmlsZVBhdGg7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICByZXF1ZXN0LnJlcXVlc3QgPSBtb2R1bGVGaWxlUGF0aDtcbiAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG59XG4iXX0=