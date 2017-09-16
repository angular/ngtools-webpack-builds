import * as ts from 'typescript';
import { Tapable } from './webpack';
/**
 * Option Constants
 */
export interface AngularCompilerPluginOptions {
    sourceMap?: boolean;
    tsConfigPath: string;
    basePath?: string;
    entryModule?: string;
    mainPath?: string;
    typeChecking?: boolean;
    hostOverrideFileSystem?: {
        [path: string]: string;
    };
    hostReplacementPaths?: {
        [path: string]: string;
    };
    i18nFile?: string;
    i18nFormat?: string;
    locale?: string;
    missingTranslation?: string;
    replaceExport?: boolean;
    exclude?: string | string[];
    include?: string[];
    compilerOptions?: ts.CompilerOptions;
}
export declare class AngularCompilerPlugin implements Tapable {
    private _options;
    private _compilerOptions;
    private _angularCompilerOptions;
    private _tsFilenames;
    private _program;
    private _compilerHost;
    private _angularCompilerHost;
    private _lazyRoutes;
    private _tsConfigPath;
    private _entryModule;
    private _basePath;
    private _transformMap;
    private _platform;
    private _firstRun;
    private _donePromise;
    private _compiler;
    private _compilation;
    private _failedCompilation;
    constructor(options: AngularCompilerPluginOptions);
    readonly options: AngularCompilerPluginOptions;
    readonly done: Promise<void>;
    readonly failedCompilation: boolean;
    readonly entryModule: {
        path: string;
        className: string;
    };
    static isSupported(): boolean;
    private _setupOptions(options);
    private _findLazyRoutesInAst(changedFilePaths);
    private _getLazyRoutesFromNgtools();
    private _processLazyRoutes(discoveredLazyRoutes);
    apply(compiler: any): void;
    private _make(compilation, cb);
    private _update();
    getFile(fileName: string): {
        outputText: string;
        sourceMap: string;
    };
    private _emit(program, customTransformers);
}
