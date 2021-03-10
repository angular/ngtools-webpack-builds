/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
/// <reference types="node" />
import { logging, virtualFs } from '@angular-devkit/core';
import { CompilerOptions } from '@angular/compiler-cli';
import * as fs from 'fs';
import * as ts from 'typescript';
export declare enum PLATFORM {
    Browser = 0,
    Server = 1
}
/**
 * Option Constants
 */
export interface AngularCompilerPluginOptions {
    sourceMap?: boolean;
    tsConfigPath: string;
    basePath?: string;
    entryModule?: string;
    mainPath?: string;
    skipCodeGeneration?: boolean;
    hostReplacementPaths?: {
        [path: string]: string;
    } | ((path: string) => string);
    forkTypeChecker?: boolean;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    i18nInFile?: string;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    i18nInFormat?: string;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    i18nOutFile?: string;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    i18nOutFormat?: string;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    locale?: string;
    /** @deprecated since version 9 - When using Ivy this option has no effect as i18n is no longer part of the TypeScript compilation. */
    missingTranslation?: string;
    platform?: PLATFORM;
    nameLazyFiles?: boolean;
    logger?: logging.Logger;
    directTemplateLoading?: boolean;
    emitClassMetadata?: boolean;
    emitNgModuleScope?: boolean;
    compilerOptions?: CompilerOptions;
    host?: virtualFs.Host<fs.Stats>;
    platformTransformers?: ts.TransformerFactory<ts.SourceFile>[];
    /**
     * Suppress Zone.js incompatibility warning when using ES2017+.
     * Zone.js does not support native async/await in ES2017+.
     * These blocks are not intercepted by zone.js and will not triggering change detection.
     * @see https://github.com/angular/zone.js/pull/1140
    */
    suppressZoneJsIncompatibilityWarning?: boolean;
}
