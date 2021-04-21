import { Compilation } from 'webpack';
export declare class WebpackResourceLoader {
    private _parentCompilation?;
    private _fileDependencies;
    private _reverseDependencies;
    private fileCache?;
    private inlineCache?;
    private modifiedResources;
    private outputPathCounter;
    constructor(shouldCache: boolean);
    update(parentCompilation: Compilation, changedFiles?: Iterable<string>): void;
    clearParentCompilation(): void;
    getModifiedResourceFiles(): Set<string>;
    getResourceDependencies(filePath: string): never[] | Set<string>;
    getAffectedResources(file: string): never[] | Set<string>;
    setAffectedResources(file: string, resources: Iterable<string>): void;
    private _compile;
    private _evaluate;
    get(filePath: string): Promise<string>;
    process(data: string, mimeType: string): Promise<string>;
}
