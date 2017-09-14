import * as ts from 'typescript';
import { TransformOperation } from './make_transform';
export declare function insertImport(sourceFile: ts.SourceFile, symbolName: string, modulePath: string): TransformOperation[];
