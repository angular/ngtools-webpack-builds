"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ERROR_CODE = 100;
exports.UNKNOWN_ERROR_CODE = 500;
exports.SOURCE = 'angular';
// These imports do not exist on Angular versions lower than 5, so we cannot use a static ES6
// import.
let ngtools2 = {};
try {
    ngtools2 = require('@angular/compiler-cli/ngtools2');
}
catch (e) {
    // Don't throw an error if the private API does not exist.
    // Instead, the `AngularCompilerPlugin.isSupported` method should return false and indicate the
    // plugin cannot be used.
}
exports.createProgram = ngtools2.createProgram;
exports.createCompilerHost = ngtools2.createCompilerHost;
exports.formatDiagnostics = ngtools2.formatDiagnostics;
exports.EmitFlags = ngtools2.EmitFlags;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/ngtools_api2.js.map