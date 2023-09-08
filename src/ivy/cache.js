"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceFileCache = void 0;
class SourceFileCache extends Map {
    angularDiagnostics = new Map();
    invalidate(file) {
        const sourceFile = this.get(file);
        if (sourceFile) {
            this.delete(file);
            this.angularDiagnostics.delete(sourceFile);
        }
    }
    updateAngularDiagnostics(sourceFile, diagnostics) {
        if (diagnostics.length > 0) {
            this.angularDiagnostics.set(sourceFile, diagnostics);
        }
        else {
            this.angularDiagnostics.delete(sourceFile);
        }
    }
    getAngularDiagnostics(sourceFile) {
        return this.angularDiagnostics.get(sourceFile);
    }
}
exports.SourceFileCache = SourceFileCache;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS9jYWNoZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7QUFJSCxNQUFhLGVBQWdCLFNBQVEsR0FBMEI7SUFDNUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQWtDLENBQUM7SUFFaEYsVUFBVSxDQUFDLElBQVk7UUFDckIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsQyxJQUFJLFVBQVUsRUFBRTtZQUNkLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEIsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQztTQUM1QztJQUNILENBQUM7SUFFRCx3QkFBd0IsQ0FBQyxVQUF5QixFQUFFLFdBQTRCO1FBQzlFLElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDMUIsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDdEQ7YUFBTTtZQUNMLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7U0FDNUM7SUFDSCxDQUFDO0lBRUQscUJBQXFCLENBQUMsVUFBeUI7UUFDN0MsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ2pELENBQUM7Q0FDRjtBQXRCRCwwQ0FzQkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5cbmV4cG9ydCBjbGFzcyBTb3VyY2VGaWxlQ2FjaGUgZXh0ZW5kcyBNYXA8c3RyaW5nLCB0cy5Tb3VyY2VGaWxlPiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYW5ndWxhckRpYWdub3N0aWNzID0gbmV3IE1hcDx0cy5Tb3VyY2VGaWxlLCB0cy5EaWFnbm9zdGljW10+KCk7XG5cbiAgaW52YWxpZGF0ZShmaWxlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5nZXQoZmlsZSk7XG4gICAgaWYgKHNvdXJjZUZpbGUpIHtcbiAgICAgIHRoaXMuZGVsZXRlKGZpbGUpO1xuICAgICAgdGhpcy5hbmd1bGFyRGlhZ25vc3RpY3MuZGVsZXRlKHNvdXJjZUZpbGUpO1xuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZUFuZ3VsYXJEaWFnbm9zdGljcyhzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlLCBkaWFnbm9zdGljczogdHMuRGlhZ25vc3RpY1tdKTogdm9pZCB7XG4gICAgaWYgKGRpYWdub3N0aWNzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYW5ndWxhckRpYWdub3N0aWNzLnNldChzb3VyY2VGaWxlLCBkaWFnbm9zdGljcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYW5ndWxhckRpYWdub3N0aWNzLmRlbGV0ZShzb3VyY2VGaWxlKTtcbiAgICB9XG4gIH1cblxuICBnZXRBbmd1bGFyRGlhZ25vc3RpY3Moc291cmNlRmlsZTogdHMuU291cmNlRmlsZSk6IHRzLkRpYWdub3N0aWNbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuYW5ndWxhckRpYWdub3N0aWNzLmdldChzb3VyY2VGaWxlKTtcbiAgfVxufVxuIl19