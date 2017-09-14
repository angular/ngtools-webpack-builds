import * as ts from 'typescript';
import { TransformOperation } from './make_transform';
export declare function removeImport(sourceFile: ts.SourceFile, removedIdentifiers: ts.Identifier[]): TransformOperation[];
