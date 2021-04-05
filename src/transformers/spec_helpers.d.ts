import * as ts from 'typescript';
export declare function createTypescriptContext(content: string, additionalFiles?: Record<string, string>, useLibs?: boolean, extraCompilerOptions?: ts.CompilerOptions, jsxFile?: boolean): {
    compilerHost: ts.CompilerHost;
    program: ts.Program;
};
export declare function transformTypescript(content: string | undefined, transformers: ts.TransformerFactory<ts.SourceFile>[], program?: ts.Program, compilerHost?: ts.CompilerHost): string | undefined;
