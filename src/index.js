"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const semver_1 = require("semver");
// Test if typescript is available. This is a hack. We should be using peerDependencies instead
// but can't until we split global and local packages.
// See https://github.com/angular/angular-cli/issues/8107#issuecomment-338185872
try {
    const version = require('typescript').version;
    if (!semver_1.gte(version, '2.4.2')) {
        throw new Error();
    }
}
catch (e) {
    throw new Error('Could not find local "typescript" package.'
        + 'The "@ngtools/webpack" package requires a local "typescript@^2.4.2" package to be installed.'
        + e);
}
__export(require("./angular_compiler_plugin"));
__export(require("./extract_i18n_plugin"));
var loader_1 = require("./loader");
exports.default = loader_1.ngcLoader;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQTs7Ozs7O0dBTUc7QUFDSCxtQ0FBNkI7QUFFN0IsK0ZBQStGO0FBQy9GLHNEQUFzRDtBQUN0RCxnRkFBZ0Y7QUFDaEYsSUFBSSxDQUFDO0lBQ0gsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDLE9BQU8sQ0FBQztJQUM5QyxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQUcsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzNCLE1BQU0sSUFBSSxLQUFLLEVBQUUsQ0FBQztJQUNwQixDQUFDO0FBQ0gsQ0FBQztBQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDWCxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QztVQUN4RCw4RkFBOEY7VUFDOUYsQ0FBQyxDQUFDLENBQUM7QUFDVCxDQUFDO0FBRUQsK0NBQTBDO0FBQzFDLDJDQUFzQztBQUN0QyxtQ0FBZ0Q7QUFBdkMsMkJBQUEsU0FBUyxDQUFXIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHsgZ3RlIH0gZnJvbSAnc2VtdmVyJztcblxuLy8gVGVzdCBpZiB0eXBlc2NyaXB0IGlzIGF2YWlsYWJsZS4gVGhpcyBpcyBhIGhhY2suIFdlIHNob3VsZCBiZSB1c2luZyBwZWVyRGVwZW5kZW5jaWVzIGluc3RlYWRcbi8vIGJ1dCBjYW4ndCB1bnRpbCB3ZSBzcGxpdCBnbG9iYWwgYW5kIGxvY2FsIHBhY2thZ2VzLlxuLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy84MTA3I2lzc3VlY29tbWVudC0zMzgxODU4NzJcbnRyeSB7XG4gIGNvbnN0IHZlcnNpb24gPSByZXF1aXJlKCd0eXBlc2NyaXB0JykudmVyc2lvbjtcbiAgaWYgKCFndGUodmVyc2lvbiwgJzIuNC4yJykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoKTtcbiAgfVxufSBjYXRjaCAoZSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBmaW5kIGxvY2FsIFwidHlwZXNjcmlwdFwiIHBhY2thZ2UuJ1xuICAgICsgJ1RoZSBcIkBuZ3Rvb2xzL3dlYnBhY2tcIiBwYWNrYWdlIHJlcXVpcmVzIGEgbG9jYWwgXCJ0eXBlc2NyaXB0QF4yLjQuMlwiIHBhY2thZ2UgdG8gYmUgaW5zdGFsbGVkLidcbiAgICArIGUpO1xufVxuXG5leHBvcnQgKiBmcm9tICcuL2FuZ3VsYXJfY29tcGlsZXJfcGx1Z2luJztcbmV4cG9ydCAqIGZyb20gJy4vZXh0cmFjdF9pMThuX3BsdWdpbic7XG5leHBvcnQgeyBuZ2NMb2FkZXIgYXMgZGVmYXVsdCB9IGZyb20gJy4vbG9hZGVyJztcbiJdfQ==