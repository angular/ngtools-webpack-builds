"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTypescriptContext = createTypescriptContext;
exports.transformTypescript = transformTypescript;
const path_1 = require("path");
const ts = __importStar(require("typescript"));
// Test transform helpers.
const basefileName = 'test-file.ts';
function createTypescriptContext(content, additionalFiles, useLibs = false, extraCompilerOptions = {}, jsxFile = false) {
    const fileName = basefileName + (jsxFile ? 'x' : '');
    // Set compiler options.
    const compilerOptions = {
        noEmitOnError: useLibs,
        allowJs: true,
        newLine: ts.NewLineKind.LineFeed,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
        skipLibCheck: true,
        sourceMap: false,
        importHelpers: true,
        experimentalDecorators: true,
        types: [],
        ...extraCompilerOptions,
    };
    // Create compiler host.
    const compilerHost = ts.createCompilerHost(compilerOptions, true);
    const baseFileExists = compilerHost.fileExists;
    compilerHost.fileExists = function (compilerFileName) {
        return (compilerFileName === fileName ||
            !!additionalFiles?.[(0, path_1.basename)(compilerFileName)] ||
            baseFileExists(compilerFileName));
    };
    const baseReadFile = compilerHost.readFile;
    compilerHost.readFile = function (compilerFileName) {
        if (compilerFileName === fileName) {
            return content;
        }
        else if (additionalFiles?.[(0, path_1.basename)(compilerFileName)]) {
            return additionalFiles[(0, path_1.basename)(compilerFileName)];
        }
        else {
            return baseReadFile(compilerFileName);
        }
    };
    // Create the TypeScript program.
    const program = ts.createProgram([fileName], compilerOptions, compilerHost);
    return { compilerHost, program };
}
function transformTypescript(content, transformers, program, compilerHost) {
    // Use given context or create a new one.
    if (content !== undefined) {
        const typescriptContext = createTypescriptContext(content);
        if (!program) {
            program = typescriptContext.program;
        }
        if (!compilerHost) {
            compilerHost = typescriptContext.compilerHost;
        }
    }
    else if (!program || !compilerHost) {
        throw new Error('transformTypescript needs either `content` or a `program` and `compilerHost');
    }
    const outputFileName = basefileName.replace(/\.tsx?$/, '.js');
    let outputContent;
    // Emit.
    const { emitSkipped, diagnostics } = program.emit(undefined, (filename, data) => {
        if (filename === outputFileName) {
            outputContent = data;
        }
    }, undefined, undefined, { before: transformers });
    // Throw error with diagnostics if emit wasn't successfull.
    if (emitSkipped) {
        throw new Error(ts.formatDiagnostics(diagnostics, compilerHost));
    }
    // Return the transpiled js.
    return outputContent;
}
