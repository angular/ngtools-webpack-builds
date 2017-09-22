import * as ts from 'typescript';
import { TransformOperation } from './make_transform';
export declare function registerLocaleData(sourceFile: ts.SourceFile, entryModule: {
    path: string;
    className: string;
}, locale: string): TransformOperation[];
