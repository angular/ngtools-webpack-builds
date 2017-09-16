import * as ts from 'typescript';
import { TransformOperation } from './make_transform';
export declare function exportNgFactory(sourceFile: ts.SourceFile, entryModule: {
    path: string;
    className: string;
}): TransformOperation[];
