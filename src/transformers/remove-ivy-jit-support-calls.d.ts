/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import * as ts from 'typescript';
export declare function removeIvyJitSupportCalls(classMetadata: boolean, ngModuleScope: boolean, debugInfo: boolean, getTypeChecker: () => ts.TypeChecker): ts.TransformerFactory<ts.SourceFile>;
