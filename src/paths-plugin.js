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
        const pathNoExtension = moduleFilePath.slice(0, -5);
        const pathDirName = path.dirname(moduleFilePath);
        const packageRootPath = path.join(pathDirName, 'package.json');
        const jsFilePath = `${pathNoExtension}.js`;
        if (host.fileExists(pathNoExtension)) {
            // This is mainly for secondary entry points
            // ex: 'node_modules/@angular/core/testing.d.ts' -> 'node_modules/@angular/core/testing'
            request.request = pathNoExtension;
        }
        else {
            const packageJsonContent = host.readFile(packageRootPath);
            let newRequest;
            if (packageJsonContent) {
                try {
                    const packageJson = JSON.parse(packageJsonContent);
                    // Let webpack resolve the correct module format IIF there is a module resolution field
                    // in the package.json. These are all official fields that Angular uses.
                    if (typeof packageJson.main == 'string'
                        || typeof packageJson.browser == 'string'
                        || typeof packageJson.module == 'string'
                        || typeof packageJson.es2015 == 'string'
                        || typeof packageJson.fesm5 == 'string'
                        || typeof packageJson.fesm2015 == 'string') {
                        newRequest = pathDirName;
                    }
                }
                catch (_a) {
                    // Ignore exceptions and let it fall through (ie. if package.json file is invalid).
                }
            }
            if (newRequest === undefined && host.fileExists(jsFilePath)) {
                // Otherwise, if there is a file with a .js extension use that
                newRequest = jsFilePath;
            }
            if (newRequest !== undefined) {
                request.request = newRequest;
            }
        }
        callback(null, request);
        return;
    }
    request.request = moduleFilePath;
    callback(null, request);
}
exports.resolveWithPaths = resolveWithPaths;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMtcGx1Z2luLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3BhdGhzLXBsdWdpbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFPakMsMEJBQ0UsT0FBbUMsRUFDbkMsUUFBOEMsRUFDOUMsZUFBbUMsRUFDbkMsSUFBcUIsRUFDckIsS0FBZ0M7SUFFaEMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDM0QsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixNQUFNLENBQUM7SUFDVCxDQUFDO0lBRUQsOENBQThDO0lBQzlDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2pGLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFeEIsTUFBTSxDQUFDO0lBQ1QsQ0FBQztJQUVELE1BQU0sZUFBZSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7SUFFL0MsbUNBQW1DO0lBQ25DLEVBQUUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksZUFBZSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkUsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixNQUFNLENBQUM7SUFDVCxDQUFDO0lBRUQsOEJBQThCO0lBQzlCLEVBQUUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENB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RDtnQkFDOUQsVUFBVSxHQUFHLFVBQVUsQ0FBQztZQUMxQixDQUFDO1lBRUQsRUFBRSxDQUFDLENBQUMsVUFBVSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUM7Z0JBQzdCLE9BQU8sQ0FBQyxPQUFPLEdBQUcsVUFBVSxDQUFDO1lBQy9CLENBQUM7UUFDSCxDQUFDO1FBRUQsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixNQUFNLENBQUM7SUFDVCxDQUFDO0lBRUQsT0FBTyxDQUFDLE9BQU8sR0FBRyxjQUFjLENBQUM7SUFDakMsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztBQUMxQixDQUFDO0FBOUxELDRDQThMQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7XG4gIENhbGxiYWNrLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcblxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVdpdGhQYXRocyhcbiAgcmVxdWVzdDogTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QsXG4gIGNhbGxiYWNrOiBDYWxsYmFjazxOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdD4sXG4gIGNvbXBpbGVyT3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuICBob3N0OiB0cy5Db21waWxlckhvc3QsXG4gIGNhY2hlPzogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuKSB7XG4gIGlmICghcmVxdWVzdCB8fCAhcmVxdWVzdC5yZXF1ZXN0IHx8ICFjb21waWxlck9wdGlvbnMucGF0aHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIE9ubHkgd29yayBvbiBKYXZhc2NyaXB0L1R5cGVTY3JpcHQgaXNzdWVycy5cbiAgaWYgKCFyZXF1ZXN0LmNvbnRleHRJbmZvLmlzc3VlciB8fCAhcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXIubWF0Y2goL1xcLltqdF1zJC8pKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBvcmlnaW5hbFJlcXVlc3QgPSByZXF1ZXN0LnJlcXVlc3QudHJpbSgpO1xuXG4gIC8vIFJlbGF0aXZlIHJlcXVlc3RzIGFyZSBub3QgbWFwcGVkXG4gIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aCgnLicpIHx8IG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEFtZCByZXF1ZXN0cyBhcmUgbm90IG1hcHBlZFxuICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgoJyEhd2VicGFjayBhbWQnKSkge1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgYW55IHBhdGggbWFwcGluZyBydWxlcyBhcmUgcmVsZXZhbnRcbiAgY29uc3QgcGF0aE1hcE9wdGlvbnMgPSBbXTtcbiAgZm9yIChjb25zdCBwYXR0ZXJuIGluIGNvbXBpbGVyT3B0aW9ucy5wYXRocykge1xuICAgIC8vIGdldCBwb3RlbnRpYWxzIGFuZCByZW1vdmUgZHVwbGljYXRlczsgSlMgU2V0IG1haW50YWlucyBpbnNlcnRpb24gb3JkZXJcbiAgICBjb25zdCBwb3RlbnRpYWxzID0gQXJyYXkuZnJvbShuZXcgU2V0KGNvbXBpbGVyT3B0aW9ucy5wYXRoc1twYXR0ZXJuXSkpO1xuICAgIGlmIChwb3RlbnRpYWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gbm8gcG90ZW50aWFsIHJlcGxhY2VtZW50cyBzbyBza2lwXG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBjYW4gb25seSBjb250YWluIHplcm8gb3Igb25lXG4gICAgY29uc3Qgc3RhckluZGV4ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gICAgaWYgKHN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgIGlmIChwYXR0ZXJuID09PSBvcmlnaW5hbFJlcXVlc3QpIHtcbiAgICAgICAgcGF0aE1hcE9wdGlvbnMucHVzaCh7XG4gICAgICAgICAgc3RhckluZGV4LFxuICAgICAgICAgIHBhcnRpYWw6ICcnLFxuICAgICAgICAgIHBvdGVudGlhbHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoc3RhckluZGV4ID09PSAwICYmIHBhdHRlcm4ubGVuZ3RoID09PSAxKSB7XG4gICAgICBwYXRoTWFwT3B0aW9ucy5wdXNoKHtcbiAgICAgICAgc3RhckluZGV4LFxuICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3QsXG4gICAgICAgIHBvdGVudGlhbHMsXG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKHN0YXJJbmRleCA9PT0gcGF0dGVybi5sZW5ndGggLSAxKSB7XG4gICAgICBpZiAob3JpZ2luYWxSZXF1ZXN0LnN0YXJ0c1dpdGgocGF0dGVybi5zbGljZSgwLCAtMSkpKSB7XG4gICAgICAgIHBhdGhNYXBPcHRpb25zLnB1c2goe1xuICAgICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3Quc2xpY2UocGF0dGVybi5sZW5ndGggLSAxKSxcbiAgICAgICAgICBwb3RlbnRpYWxzLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgW3ByZWZpeCwgc3VmZml4XSA9IHBhdHRlcm4uc3BsaXQoJyonKTtcbiAgICAgIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aChwcmVmaXgpICYmIG9yaWdpbmFsUmVxdWVzdC5lbmRzV2l0aChzdWZmaXgpKSB7XG4gICAgICAgIHBhdGhNYXBPcHRpb25zLnB1c2goe1xuICAgICAgICAgIHN0YXJJbmRleCxcbiAgICAgICAgICBwYXJ0aWFsOiBvcmlnaW5hbFJlcXVlc3Quc2xpY2UocHJlZml4Lmxlbmd0aCkuc2xpY2UoMCwgLXN1ZmZpeC5sZW5ndGgpLFxuICAgICAgICAgIHBvdGVudGlhbHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChwYXRoTWFwT3B0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGV4YWN0IG1hdGNoZXMgdGFrZSBwcmlvcml0eSB0aGVuIGxhcmdlc3QgcHJlZml4IG1hdGNoXG4gIHBhdGhNYXBPcHRpb25zLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5zdGFySW5kZXggPT09IC0xKSB7XG4gICAgICByZXR1cm4gLTE7XG4gICAgfSBlbHNlIGlmIChiLnN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgIHJldHVybiAxO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYi5zdGFySW5kZXggLSBhLnN0YXJJbmRleDtcbiAgICB9XG4gIH0pO1xuXG4gIGlmIChwYXRoTWFwT3B0aW9uc1swXS5wb3RlbnRpYWxzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG9ubHlQb3RlbnRpYWwgPSBwYXRoTWFwT3B0aW9uc1swXS5wb3RlbnRpYWxzWzBdO1xuICAgIGxldCByZXBsYWNlbWVudDtcbiAgICBjb25zdCBzdGFySW5kZXggPSBvbmx5UG90ZW50aWFsLmluZGV4T2YoJyonKTtcbiAgICBpZiAoc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgcmVwbGFjZW1lbnQgPSBvbmx5UG90ZW50aWFsO1xuICAgIH0gZWxzZSBpZiAoc3RhckluZGV4ID09PSBvbmx5UG90ZW50aWFsLmxlbmd0aCAtIDEpIHtcbiAgICAgIHJlcGxhY2VtZW50ID0gb25seVBvdGVudGlhbC5zbGljZSgwLCAtMSkgKyBwYXRoTWFwT3B0aW9uc1swXS5wYXJ0aWFsO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBbcHJlZml4LCBzdWZmaXhdID0gb25seVBvdGVudGlhbC5zcGxpdCgnKicpO1xuICAgICAgcmVwbGFjZW1lbnQgPSBwcmVmaXggKyBwYXRoTWFwT3B0aW9uc1swXS5wYXJ0aWFsICsgc3VmZml4O1xuICAgIH1cblxuICAgIHJlcXVlc3QucmVxdWVzdCA9IHBhdGgucmVzb2x2ZShjb21waWxlck9wdGlvbnMuYmFzZVVybCB8fCAnJywgcmVwbGFjZW1lbnQpO1xuICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVE9ETzogVGhlIGZvbGxvd2luZyBpcyB1c2VkIHdoZW4gdGhlcmUgaXMgbW9yZSB0aGFuIG9uZSBwb3RlbnRpYWwgYW5kIHdpbGwgbm90IGJlXG4gIC8vICAgICAgIG5lZWRlZCBvbmNlIHRoaXMgaXMgdHVybmVkIGludG8gYSBmdWxsIHdlYnBhY2sgcmVzb2x2ZXIgcGx1Z2luXG5cbiAgY29uc3QgbW9kdWxlUmVzb2x2ZXIgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShcbiAgICBvcmlnaW5hbFJlcXVlc3QsXG4gICAgcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXIsXG4gICAgY29tcGlsZXJPcHRpb25zLFxuICAgIGhvc3QsXG4gICAgY2FjaGUsXG4gICk7XG5cbiAgY29uc3QgbW9kdWxlRmlsZVBhdGggPSBtb2R1bGVSZXNvbHZlci5yZXNvbHZlZE1vZHVsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICYmIG1vZHVsZVJlc29sdmVyLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gcmVzdWx0LCBsZXQgd2VicGFjayB0cnkgdG8gcmVzb2x2ZVxuICBpZiAoIW1vZHVsZUZpbGVQYXRoKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBJZiBUeXBlU2NyaXB0IGdpdmVzIHVzIGEgYC5kLnRzYCwgaXQgaXMgcHJvYmFibHkgYSBub2RlIG1vZHVsZVxuICBpZiAobW9kdWxlRmlsZVBhdGguZW5kc1dpdGgoJy5kLnRzJykpIHtcbiAgICBjb25zdCBwYXRoTm9FeHRlbnNpb24gPSBtb2R1bGVGaWxlUGF0aC5zbGljZSgwLCAtNSk7XG4gICAgY29uc3QgcGF0aERpck5hbWUgPSBwYXRoLmRpcm5hbWUobW9kdWxlRmlsZVBhdGgpO1xuICAgIGNvbnN0IHBhY2thZ2VSb290UGF0aCA9IHBhdGguam9pbihwYXRoRGlyTmFtZSwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGNvbnN0IGpzRmlsZVBhdGggPSBgJHtwYXRoTm9FeHRlbnNpb259LmpzYDtcblxuICAgIGlmIChob3N0LmZpbGVFeGlzdHMocGF0aE5vRXh0ZW5zaW9uKSkge1xuICAgICAgLy8gVGhpcyBpcyBtYWlubHkgZm9yIHNlY29uZGFyeSBlbnRyeSBwb2ludHNcbiAgICAgIC8vIGV4OiAnbm9kZV9tb2R1bGVzL0Bhbmd1bGFyL2NvcmUvdGVzdGluZy5kLnRzJyAtPiAnbm9kZV9tb2R1bGVzL0Bhbmd1bGFyL2NvcmUvdGVzdGluZydcbiAgICAgIHJlcXVlc3QucmVxdWVzdCA9IHBhdGhOb0V4dGVuc2lvbjtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcGFja2FnZUpzb25Db250ZW50ID0gaG9zdC5yZWFkRmlsZShwYWNrYWdlUm9vdFBhdGgpO1xuICAgICAgbGV0IG5ld1JlcXVlc3Q6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKHBhY2thZ2VKc29uQ29udGVudCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhY2thZ2VKc29uID0gSlNPTi5wYXJzZShwYWNrYWdlSnNvbkNvbnRlbnQpO1xuXG4gICAgICAgICAgLy8gTGV0IHdlYnBhY2sgcmVzb2x2ZSB0aGUgY29ycmVjdCBtb2R1bGUgZm9ybWF0IElJRiB0aGVyZSBpcyBhIG1vZHVsZSByZXNvbHV0aW9uIGZpZWxkXG4gICAgICAgICAgLy8gaW4gdGhlIHBhY2thZ2UuanNvbi4gVGhlc2UgYXJlIGFsbCBvZmZpY2lhbCBmaWVsZHMgdGhhdCBBbmd1bGFyIHVzZXMuXG4gICAgICAgICAgaWYgKHR5cGVvZiBwYWNrYWdlSnNvbi5tYWluID09ICdzdHJpbmcnXG4gICAgICAgICAgICAgIHx8IHR5cGVvZiBwYWNrYWdlSnNvbi5icm93c2VyID09ICdzdHJpbmcnXG4gICAgICAgICAgICAgIHx8IHR5cGVvZiBwYWNrYWdlSnNvbi5tb2R1bGUgPT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgfHwgdHlwZW9mIHBhY2thZ2VKc29uLmVzMjAxNSA9PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICB8fCB0eXBlb2YgcGFja2FnZUpzb24uZmVzbTUgPT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgfHwgdHlwZW9mIHBhY2thZ2VKc29uLmZlc20yMDE1ID09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBuZXdSZXF1ZXN0ID0gcGF0aERpck5hbWU7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBJZ25vcmUgZXhjZXB0aW9ucyBhbmQgbGV0IGl0IGZhbGwgdGhyb3VnaCAoaWUuIGlmIHBhY2thZ2UuanNvbiBmaWxlIGlzIGludmFsaWQpLlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdSZXF1ZXN0ID09PSB1bmRlZmluZWQgJiYgaG9zdC5maWxlRXhpc3RzKGpzRmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIE90aGVyd2lzZSwgaWYgdGhlcmUgaXMgYSBmaWxlIHdpdGggYSAuanMgZXh0ZW5zaW9uIHVzZSB0aGF0XG4gICAgICAgIG5ld1JlcXVlc3QgPSBqc0ZpbGVQYXRoO1xuICAgICAgfVxuXG4gICAgICBpZiAobmV3UmVxdWVzdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlcXVlc3QucmVxdWVzdCA9IG5ld1JlcXVlc3Q7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG5cbiAgICByZXR1cm47XG4gIH1cblxuICByZXF1ZXN0LnJlcXVlc3QgPSBtb2R1bGVGaWxlUGF0aDtcbiAgY2FsbGJhY2sobnVsbCwgcmVxdWVzdCk7XG59XG4iXX0=