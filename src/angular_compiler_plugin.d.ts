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
    skipCodeGeneration?: boolean;
    hostOverrideFileSystem?: {
        [path: string]: string;
    };
    hostReplacementPaths?: {
        [path: string]: string;
    };
    i18nInFile?: string;
    i18nInFormat?: string;
    i18nOutFile?: string;
    i18nOutFormat?: string;
    locale?: string;
    missingTranslation?: string;
    platform?: PLATFORM;
    exclude?: string | string[];
    include?: string[];
    compilerOptions?: ts.CompilerOptions;
}
export declare enum PLATFORM {
    Browser = 0,
    Server = 1,
}
export declare class AngularCompilerPlugin implements Tapable {
    private _options;
    private _compilerOptions;
    private _angularCompilerOptions;
    private _tsFilenames;
    private _program;
    private _compilerHost;
    private _moduleResolutionCache;
    private _angularCompilerHost;
    private _resourceLoader;
    private _lazyRoutes;
    private _tsConfigPath;
    private _entryModule;
    private _basePath;
    private _transformMap;
    private _platform;
    private _JitMode;
    private _firstRun;
    private _donePromise;
    private _compiler;
    private _compilation;
    private _forkTypeChecker;
    private _typeCheckerProcess;
    private readonly _ngCompilerSupportsNewApi;
    constructor(options: AngularCompilerPluginOptions);
    readonly options: AngularCompilerPluginOptions;
    readonly done: Promise<void>;
    readonly entryModule: {
        path: string;
        className: string;
    };
    static isSupported(): boolean;
    private _setupOptions(options);
    private _getTsProgram();
    private _getChangedTsFiles();
    private _createOrUpdateProgram();
    private _getLazyRoutesFromNgtools();
    private _findLazyRoutesInAst(changedFilePaths);
    private _listLazyRoutesFromProgram();
    private _processLazyRoutes(discoveredLazyRoutes);
    private _createForkedTypeChecker();
    private _updateForkedTypeChecker(changedTsFiles);
    apply(compiler: any): void;
    private _make(compilation, cb);
    private _update();
    writeI18nOutFile(): void;
    getFile(fileName: string): {
        outputText: string;
        sourceMap: string;
    };
    getDependencies(fileName: string): string[];
    private _emit(sourceFiles, customTransformers);
    private _validateLocale(locale);
}
