"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileEmitterCollection = exports.FileEmitterRegistration = exports.AngularPluginSymbol = void 0;
exports.AngularPluginSymbol = Symbol.for('@ngtools/webpack[angular-compiler]');
class FileEmitterRegistration {
    #fileEmitter;
    update(emitter) {
        this.#fileEmitter = emitter;
    }
    emit(file) {
        if (!this.#fileEmitter) {
            throw new Error('Emit attempted before Angular Webpack plugin initialization.');
        }
        return this.#fileEmitter(file);
    }
}
exports.FileEmitterRegistration = FileEmitterRegistration;
class FileEmitterCollection {
    #registrations = [];
    register() {
        const registration = new FileEmitterRegistration();
        this.#registrations.push(registration);
        return registration;
    }
    async emit(file) {
        if (this.#registrations.length === 1) {
            return this.#registrations[0].emit(file);
        }
        for (const registration of this.#registrations) {
            const result = await registration.emit(file);
            if (result) {
                return result;
            }
        }
    }
}
exports.FileEmitterCollection = FileEmitterCollection;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3ltYm9sLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvc3ltYm9sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7OztBQUVVLFFBQUEsbUJBQW1CLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO0FBV3BGLE1BQWEsdUJBQXVCO0lBQ2xDLFlBQVksQ0FBZTtJQUUzQixNQUFNLENBQUMsT0FBb0I7UUFDekIsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUM7SUFDOUIsQ0FBQztJQUVELElBQUksQ0FBQyxJQUFZO1FBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDdEIsTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1NBQ2pGO1FBRUQsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pDLENBQUM7Q0FDRjtBQWRELDBEQWNDO0FBRUQsTUFBYSxxQkFBcUI7SUFDaEMsY0FBYyxHQUE4QixFQUFFLENBQUM7SUFFL0MsUUFBUTtRQUNOLE1BQU0sWUFBWSxHQUFHLElBQUksdUJBQXVCLEVBQUUsQ0FBQztRQUNuRCxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUV2QyxPQUFPLFlBQVksQ0FBQztJQUN0QixDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFZO1FBQ3JCLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1lBQ3BDLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDMUM7UUFFRCxLQUFLLE1BQU0sWUFBWSxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUU7WUFDOUMsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzdDLElBQUksTUFBTSxFQUFFO2dCQUNWLE9BQU8sTUFBTSxDQUFDO2FBQ2Y7U0FDRjtJQUNILENBQUM7Q0FDRjtBQXRCRCxzREFzQkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuZXhwb3J0IGNvbnN0IEFuZ3VsYXJQbHVnaW5TeW1ib2wgPSBTeW1ib2wuZm9yKCdAbmd0b29scy93ZWJwYWNrW2FuZ3VsYXItY29tcGlsZXJdJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW1pdEZpbGVSZXN1bHQge1xuICBjb250ZW50Pzogc3RyaW5nO1xuICBtYXA/OiBzdHJpbmc7XG4gIGRlcGVuZGVuY2llczogcmVhZG9ubHkgc3RyaW5nW107XG4gIGhhc2g/OiBVaW50OEFycmF5O1xufVxuXG5leHBvcnQgdHlwZSBGaWxlRW1pdHRlciA9IChmaWxlOiBzdHJpbmcpID0+IFByb21pc2U8RW1pdEZpbGVSZXN1bHQgfCB1bmRlZmluZWQ+O1xuXG5leHBvcnQgY2xhc3MgRmlsZUVtaXR0ZXJSZWdpc3RyYXRpb24ge1xuICAjZmlsZUVtaXR0ZXI/OiBGaWxlRW1pdHRlcjtcblxuICB1cGRhdGUoZW1pdHRlcjogRmlsZUVtaXR0ZXIpOiB2b2lkIHtcbiAgICB0aGlzLiNmaWxlRW1pdHRlciA9IGVtaXR0ZXI7XG4gIH1cblxuICBlbWl0KGZpbGU6IHN0cmluZyk6IFByb21pc2U8RW1pdEZpbGVSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIXRoaXMuI2ZpbGVFbWl0dGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VtaXQgYXR0ZW1wdGVkIGJlZm9yZSBBbmd1bGFyIFdlYnBhY2sgcGx1Z2luIGluaXRpYWxpemF0aW9uLicpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLiNmaWxlRW1pdHRlcihmaWxlKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uIHtcbiAgI3JlZ2lzdHJhdGlvbnM6IEZpbGVFbWl0dGVyUmVnaXN0cmF0aW9uW10gPSBbXTtcblxuICByZWdpc3RlcigpOiBGaWxlRW1pdHRlclJlZ2lzdHJhdGlvbiB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gbmV3IEZpbGVFbWl0dGVyUmVnaXN0cmF0aW9uKCk7XG4gICAgdGhpcy4jcmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbik7XG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uO1xuICB9XG5cbiAgYXN5bmMgZW1pdChmaWxlOiBzdHJpbmcpOiBQcm9taXNlPEVtaXRGaWxlUmVzdWx0IHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKHRoaXMuI3JlZ2lzdHJhdGlvbnMubGVuZ3RoID09PSAxKSB7XG4gICAgICByZXR1cm4gdGhpcy4jcmVnaXN0cmF0aW9uc1swXS5lbWl0KGZpbGUpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHRoaXMuI3JlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5lbWl0KGZpbGUpO1xuICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19