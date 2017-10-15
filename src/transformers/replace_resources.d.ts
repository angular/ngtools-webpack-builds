import * as ts from 'typescript';
import { ReplaceNodeOperation, TransformOperation } from './make_transform';
export declare function replaceResources(sourceFile: ts.SourceFile): TransformOperation[];
export interface ResourceReplacement {
    resourcePaths: string[];
    replaceNodeOperation: ReplaceNodeOperation;
}
export declare function findResources(sourceFile: ts.SourceFile): ResourceReplacement[];
