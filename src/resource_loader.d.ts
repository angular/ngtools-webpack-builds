export declare class WebpackResourceLoader {
    private _parentCompilation;
    private _context;
    private _uniqueId;
    private _cache;
    constructor();
    update(parentCompilation: any): void;
    private _compile(filePath);
    private _evaluate(output);
    get(filePath: string): Promise<string>;
}
