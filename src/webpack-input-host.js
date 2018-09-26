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
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
// Host is used instead of ReadonlyHost due to most decorators only supporting Hosts
class WebpackInputHost {
    constructor(inputFileSystem) {
        this.inputFileSystem = inputFileSystem;
    }
    get capabilities() {
        return { synchronous: true };
    }
    write(_path, _content) {
        return rxjs_1.throwError(new Error('Not supported.'));
    }
    delete(_path) {
        return rxjs_1.throwError(new Error('Not supported.'));
    }
    rename(_from, _to) {
        return rxjs_1.throwError(new Error('Not supported.'));
    }
    read(path) {
        return new rxjs_1.Observable(obs => {
            // TODO: remove this try+catch when issue https://github.com/ReactiveX/rxjs/issues/3740 is
            // fixed.
            try {
                const data = this.inputFileSystem.readFileSync(core_1.getSystemPath(path));
                obs.next(new Uint8Array(data).buffer);
                obs.complete();
            }
            catch (e) {
                obs.error(e);
            }
        });
    }
    list(path) {
        return new rxjs_1.Observable(obs => {
            // TODO: remove this try+catch when issue https://github.com/ReactiveX/rxjs/issues/3740 is
            // fixed.
            try {
                const names = this.inputFileSystem.readdirSync(core_1.getSystemPath(path));
                obs.next(names.map(name => core_1.fragment(name)));
                obs.complete();
            }
            catch (err) {
                obs.error(err);
            }
        });
    }
    exists(path) {
        return this.stat(path).pipe(operators_1.map(stats => stats != null));
    }
    isDirectory(path) {
        return this.stat(path).pipe(operators_1.map(stats => stats != null && stats.isDirectory()));
    }
    isFile(path) {
        return this.stat(path).pipe(operators_1.map(stats => stats != null && stats.isFile()));
    }
    stat(path) {
        return new rxjs_1.Observable(obs => {
            try {
                const stats = this.inputFileSystem.statSync(core_1.getSystemPath(path));
                obs.next(stats);
                obs.complete();
            }
            catch (e) {
                if (e.code === 'ENOENT') {
                    obs.next(null);
                    obs.complete();
                }
                else {
                    obs.error(e);
                }
            }
        });
    }
    watch(_path, _options) {
        return null;
    }
}
exports.WebpackInputHost = WebpackInputHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2VicGFjay1pbnB1dC1ob3N0LmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3dlYnBhY2staW5wdXQtaG9zdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUE4RjtBQUU5RiwrQkFBOEM7QUFDOUMsOENBQXFDO0FBR3JDLG9GQUFvRjtBQUNwRixNQUFhLGdCQUFnQjtJQUUzQixZQUE0QixlQUFnQztRQUFoQyxvQkFBZSxHQUFmLGVBQWUsQ0FBaUI7SUFBSSxDQUFDO0lBRWpFLElBQUksWUFBWTtRQUNkLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDL0IsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFXLEVBQUUsUUFBa0M7UUFDbkQsT0FBTyxpQkFBVSxDQUFDLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQVc7UUFDaEIsT0FBTyxpQkFBVSxDQUFDLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQVcsRUFBRSxHQUFTO1FBQzNCLE9BQU8saUJBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7SUFDakQsQ0FBQztJQUVELElBQUksQ0FBQyxJQUFVO1FBQ2IsT0FBTyxJQUFJLGlCQUFVLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDMUIsMEZBQTBGO1lBQzFGLFNBQVM7WUFDVCxJQUFJO2dCQUNGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLG9CQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDcEUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFxQixDQUFDLENBQUM7Z0JBQ3JELEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQzthQUNoQjtZQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNWLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7YUFDZDtRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELElBQUksQ0FBQyxJQUFVO1FBQ2IsT0FBTyxJQUFJLGlCQUFVLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDMUIsMEZBQTBGO1lBQzFGLFNBQVM7WUFDVCxJQUFJO2dCQUNGLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsV0FBVyxDQUFDLG9CQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDcEUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsZUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDNUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO2FBQ2hCO1lBQUMsT0FBTyxHQUFHLEVBQUU7Z0JBQ1osR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUNoQjtRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE1BQU0sQ0FBQyxJQUFVO1FBQ2YsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsV0FBVyxDQUFDLElBQVU7UUFDcEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUksSUFBSSxJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDbEYsQ0FBQztJQUVELE1BQU0sQ0FBQyxJQUFVO1FBQ2YsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUksSUFBSSxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDN0UsQ0FBQztJQUVELElBQUksQ0FBQyxJQUFVO1FBQ2IsT0FBTyxJQUFJLGlCQUFVLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDMUIsSUFBSTtnQkFDRixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxvQkFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBQ2pFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ2hCLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQzthQUNoQjtZQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNWLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxRQUFRLEVBQUU7b0JBQ3ZCLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2YsR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO2lCQUNoQjtxQkFBTTtvQkFDTCxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO2lCQUNkO2FBQ0Y7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBVyxFQUFFLFFBQXFDO1FBQ3RELE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztDQUNGO0FBaEZELDRDQWdGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7IFBhdGgsIFBhdGhGcmFnbWVudCwgZnJhZ21lbnQsIGdldFN5c3RlbVBhdGgsIHZpcnR1YWxGcyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IFN0YXRzIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJsZSwgdGhyb3dFcnJvciB9IGZyb20gJ3J4anMnO1xuaW1wb3J0IHsgbWFwIH0gZnJvbSAncnhqcy9vcGVyYXRvcnMnO1xuaW1wb3J0IHsgSW5wdXRGaWxlU3lzdGVtIH0gZnJvbSAnLi93ZWJwYWNrJztcblxuLy8gSG9zdCBpcyB1c2VkIGluc3RlYWQgb2YgUmVhZG9ubHlIb3N0IGR1ZSB0byBtb3N0IGRlY29yYXRvcnMgb25seSBzdXBwb3J0aW5nIEhvc3RzXG5leHBvcnQgY2xhc3MgV2VicGFja0lucHV0SG9zdCBpbXBsZW1lbnRzIHZpcnR1YWxGcy5Ib3N0PFN0YXRzPiB7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGlucHV0RmlsZVN5c3RlbTogSW5wdXRGaWxlU3lzdGVtKSB7IH1cblxuICBnZXQgY2FwYWJpbGl0aWVzKCk6IHZpcnR1YWxGcy5Ib3N0Q2FwYWJpbGl0aWVzIHtcbiAgICByZXR1cm4geyBzeW5jaHJvbm91czogdHJ1ZSB9O1xuICB9XG5cbiAgd3JpdGUoX3BhdGg6IFBhdGgsIF9jb250ZW50OiB2aXJ0dWFsRnMuRmlsZUJ1ZmZlckxpa2UpIHtcbiAgICByZXR1cm4gdGhyb3dFcnJvcihuZXcgRXJyb3IoJ05vdCBzdXBwb3J0ZWQuJykpO1xuICB9XG5cbiAgZGVsZXRlKF9wYXRoOiBQYXRoKSB7XG4gICAgcmV0dXJuIHRocm93RXJyb3IobmV3IEVycm9yKCdOb3Qgc3VwcG9ydGVkLicpKTtcbiAgfVxuXG4gIHJlbmFtZShfZnJvbTogUGF0aCwgX3RvOiBQYXRoKSB7XG4gICAgcmV0dXJuIHRocm93RXJyb3IobmV3IEVycm9yKCdOb3Qgc3VwcG9ydGVkLicpKTtcbiAgfVxuXG4gIHJlYWQocGF0aDogUGF0aCk6IE9ic2VydmFibGU8dmlydHVhbEZzLkZpbGVCdWZmZXI+IHtcbiAgICByZXR1cm4gbmV3IE9ic2VydmFibGUob2JzID0+IHtcbiAgICAgIC8vIFRPRE86IHJlbW92ZSB0aGlzIHRyeStjYXRjaCB3aGVuIGlzc3VlIGh0dHBzOi8vZ2l0aHViLmNvbS9SZWFjdGl2ZVgvcnhqcy9pc3N1ZXMvMzc0MCBpc1xuICAgICAgLy8gZml4ZWQuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5pbnB1dEZpbGVTeXN0ZW0ucmVhZEZpbGVTeW5jKGdldFN5c3RlbVBhdGgocGF0aCkpO1xuICAgICAgICBvYnMubmV4dChuZXcgVWludDhBcnJheShkYXRhKS5idWZmZXIgYXMgQXJyYXlCdWZmZXIpO1xuICAgICAgICBvYnMuY29tcGxldGUoKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgb2JzLmVycm9yKGUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgbGlzdChwYXRoOiBQYXRoKTogT2JzZXJ2YWJsZTxQYXRoRnJhZ21lbnRbXT4ge1xuICAgIHJldHVybiBuZXcgT2JzZXJ2YWJsZShvYnMgPT4ge1xuICAgICAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgdHJ5K2NhdGNoIHdoZW4gaXNzdWUgaHR0cHM6Ly9naXRodWIuY29tL1JlYWN0aXZlWC9yeGpzL2lzc3Vlcy8zNzQwIGlzXG4gICAgICAvLyBmaXhlZC5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG5hbWVzID0gdGhpcy5pbnB1dEZpbGVTeXN0ZW0ucmVhZGRpclN5bmMoZ2V0U3lzdGVtUGF0aChwYXRoKSk7XG4gICAgICAgIG9icy5uZXh0KG5hbWVzLm1hcChuYW1lID0+IGZyYWdtZW50KG5hbWUpKSk7XG4gICAgICAgIG9icy5jb21wbGV0ZSgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIG9icy5lcnJvcihlcnIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgZXhpc3RzKHBhdGg6IFBhdGgpOiBPYnNlcnZhYmxlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5zdGF0KHBhdGgpLnBpcGUobWFwKHN0YXRzID0+IHN0YXRzICE9IG51bGwpKTtcbiAgfVxuXG4gIGlzRGlyZWN0b3J5KHBhdGg6IFBhdGgpOiBPYnNlcnZhYmxlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5zdGF0KHBhdGgpLnBpcGUobWFwKHN0YXRzID0+IHN0YXRzICE9IG51bGwgJiYgc3RhdHMuaXNEaXJlY3RvcnkoKSkpO1xuICB9XG5cbiAgaXNGaWxlKHBhdGg6IFBhdGgpOiBPYnNlcnZhYmxlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5zdGF0KHBhdGgpLnBpcGUobWFwKHN0YXRzID0+IHN0YXRzICE9IG51bGwgJiYgc3RhdHMuaXNGaWxlKCkpKTtcbiAgfVxuXG4gIHN0YXQocGF0aDogUGF0aCk6IE9ic2VydmFibGU8U3RhdHMgfCBudWxsPiB7XG4gICAgcmV0dXJuIG5ldyBPYnNlcnZhYmxlKG9icyA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGF0cyA9IHRoaXMuaW5wdXRGaWxlU3lzdGVtLnN0YXRTeW5jKGdldFN5c3RlbVBhdGgocGF0aCkpO1xuICAgICAgICBvYnMubmV4dChzdGF0cyk7XG4gICAgICAgIG9icy5jb21wbGV0ZSgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBpZiAoZS5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgICAgIG9icy5uZXh0KG51bGwpO1xuICAgICAgICAgIG9icy5jb21wbGV0ZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG9icy5lcnJvcihlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgd2F0Y2goX3BhdGg6IFBhdGgsIF9vcHRpb25zPzogdmlydHVhbEZzLkhvc3RXYXRjaE9wdGlvbnMpOiBudWxsIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIl19