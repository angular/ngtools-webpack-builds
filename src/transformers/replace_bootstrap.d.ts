import * as ts from 'typescript';
import { TransformOperation } from './make_transform';
export declare function replaceBootstrap(sourceFile: ts.SourceFile, entryModule: {
    path: string;
    className: string;
}): TransformOperation[];
