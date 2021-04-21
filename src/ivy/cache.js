"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceFileCache = void 0;
class SourceFileCache extends Map {
    constructor() {
        super(...arguments);
        this.angularDiagnostics = new Map();
    }
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
