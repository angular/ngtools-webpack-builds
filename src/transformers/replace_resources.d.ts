/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as ts from 'typescript';
export declare function replaceResources(shouldTransform: (fileName: string) => boolean, getTypeChecker: () => ts.TypeChecker, directTemplateLoading?: boolean): ts.TransformerFactory<ts.SourceFile>;
export declare function createResourceImport(node: ts.Node, loader: string | undefined, resourceImportDeclarations: ts.ImportDeclaration[]): ts.Identifier | null;
export declare function getResourceUrl(node: ts.Node, loader?: string): string | null;
