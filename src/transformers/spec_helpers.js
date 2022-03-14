"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformTypescript = exports.createTypescriptContext = void 0;
const path_1 = require("path");
const ts = __importStar(require("typescript"));
// Test transform helpers.
const basefileName = 'test-file.ts';
function createTypescriptContext(content, additionalFiles, useLibs = false, extraCompilerOptions = {}, jsxFile = false) {
    const fileName = basefileName + (jsxFile ? 'x' : '');
    // Set compiler options.
    const compilerOptions = {
        noEmitOnError: useLibs,
        allowJs: true,
        newLine: ts.NewLineKind.LineFeed,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
        skipLibCheck: true,
        sourceMap: false,
        importHelpers: true,
        experimentalDecorators: true,
        types: [],
        ...extraCompilerOptions,
    };
    // Create compiler host.
    const compilerHost = ts.createCompilerHost(compilerOptions, true);
    const baseFileExists = compilerHost.fileExists;
    compilerHost.fileExists = function (compilerFileName) {
        return (compilerFileName === fileName ||
            !!(additionalFiles === null || additionalFiles === void 0 ? void 0 : additionalFiles[(0, path_1.basename)(compilerFileName)]) ||
            baseFileExists(compilerFileName));
    };
    const baseReadFile = compilerHost.readFile;
    compilerHost.readFile = function (compilerFileName) {
        if (compilerFileName === fileName) {
            return content;
        }
        else if (additionalFiles === null || additionalFiles === void 0 ? void 0 : additionalFiles[(0, path_1.basename)(compilerFileName)]) {
            return additionalFiles[(0, path_1.basename)(compilerFileName)];
        }
        else {
            return baseReadFile(compilerFileName);
        }
    };
    // Create the TypeScript program.
    const program = ts.createProgram([fileName], compilerOptions, compilerHost);
    return { compilerHost, program };
}
exports.createTypescriptContext = createTypescriptContext;
function transformTypescript(content, transformers, program, compilerHost) {
    // Use given context or create a new one.
    if (content !== undefined) {
        const typescriptContext = createTypescriptContext(content);
        if (!program) {
            program = typescriptContext.program;
        }
        if (!compilerHost) {
            compilerHost = typescriptContext.compilerHost;
        }
    }
    else if (!program || !compilerHost) {
        throw new Error('transformTypescript needs either `content` or a `program` and `compilerHost');
    }
    const outputFileName = basefileName.replace(/\.tsx?$/, '.js');
    let outputContent;
    // Emit.
    const { emitSkipped, diagnostics } = program.emit(undefined, (filename, data) => {
        if (filename === outputFileName) {
            outputContent = data;
        }
    }, undefined, undefined, { before: transformers });
    // Throw error with diagnostics if emit wasn't successfull.
    if (emitSkipped) {
        throw new Error(ts.formatDiagnostics(diagnostics, compilerHost));
    }
    // Return the transpiled js.
    return outputContent;
}
exports.transformTypescript = transformTypescript;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3BlY19oZWxwZXJzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy90cmFuc2Zvcm1lcnMvc3BlY19oZWxwZXJzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwrQkFBZ0M7QUFDaEMsK0NBQWlDO0FBRWpDLDBCQUEwQjtBQUMxQixNQUFNLFlBQVksR0FBRyxjQUFjLENBQUM7QUFFcEMsU0FBZ0IsdUJBQXVCLENBQ3JDLE9BQWUsRUFDZixlQUF3QyxFQUN4QyxPQUFPLEdBQUcsS0FBSyxFQUNmLHVCQUEyQyxFQUFFLEVBQzdDLE9BQU8sR0FBRyxLQUFLO0lBRWYsTUFBTSxRQUFRLEdBQUcsWUFBWSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3JELHdCQUF3QjtJQUN4QixNQUFNLGVBQWUsR0FBdUI7UUFDMUMsYUFBYSxFQUFFLE9BQU87UUFDdEIsT0FBTyxFQUFFLElBQUk7UUFDYixPQUFPLEVBQUUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxRQUFRO1FBQ2hDLGdCQUFnQixFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNO1FBQ2hELE1BQU0sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE1BQU07UUFDNUIsTUFBTSxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsTUFBTTtRQUM5QixZQUFZLEVBQUUsSUFBSTtRQUNsQixTQUFTLEVBQUUsS0FBSztRQUNoQixhQUFhLEVBQUUsSUFBSTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLEtBQUssRUFBRSxFQUFFO1FBQ1QsR0FBRyxvQkFBb0I7S0FDeEIsQ0FBQztJQUVGLHdCQUF3QjtJQUN4QixNQUFNLFlBQVksR0FBRyxFQUFFLENBQUMsa0JBQWtCLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRWxFLE1BQU0sY0FBYyxHQUFHLFlBQVksQ0FBQyxVQUFVLENBQUM7SUFDL0MsWUFBWSxDQUFDLFVBQVUsR0FBRyxVQUFVLGdCQUF3QjtRQUMxRCxPQUFPLENBQ0wsZ0JBQWdCLEtBQUssUUFBUTtZQUM3QixDQUFDLENBQUMsQ0FBQSxlQUFlLGFBQWYsZUFBZSx1QkFBZixlQUFlLENBQUcsSUFBQSxlQUFRLEVBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFBO1lBQy9DLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUNqQyxDQUFDO0lBQ0osQ0FBQyxDQUFDO0lBRUYsTUFBTSxZQUFZLEdBQUcsWUFBWSxDQUFDLFFBQVEsQ0FBQztJQUMzQyxZQUFZLENBQUMsUUFBUSxHQUFHLFVBQVUsZ0JBQXdCO1FBQ3hELElBQUksZ0JBQWdCLEtBQUssUUFBUSxFQUFFO1lBQ2pDLE9BQU8sT0FBTyxDQUFDO1NBQ2hCO2FBQU0sSUFBSSxlQUFlLGFBQWYsZUFBZSx1QkFBZixlQUFlLENBQUcsSUFBQSxlQUFRLEVBQUMsZ0JBQWdCLENBQUMsQ0FBQyxFQUFFO1lBQ3hELE9BQU8sZUFBZSxDQUFDLElBQUEsZUFBUSxFQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztTQUNwRDthQUFNO1lBQ0wsT0FBTyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztTQUN2QztJQUNILENBQUMsQ0FBQztJQUVGLGlDQUFpQztJQUNqQyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUMsUUFBUSxDQUFDLEVBQUUsZUFBZSxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBRTVFLE9BQU8sRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQW5ERCwwREFtREM7QUFFRCxTQUFnQixtQkFBbUIsQ0FDakMsT0FBMkIsRUFDM0IsWUFBb0QsRUFDcEQsT0FBb0IsRUFDcEIsWUFBOEI7SUFFOUIseUNBQXlDO0lBQ3pDLElBQUksT0FBTyxLQUFLLFNBQVMsRUFBRTtRQUN6QixNQUFNLGlCQUFpQixHQUFHLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzNELElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDWixPQUFPLEdBQUcsaUJBQWlCLENBQUMsT0FBTyxDQUFDO1NBQ3JDO1FBQ0QsSUFBSSxDQUFDLFlBQVksRUFBRTtZQUNqQixZQUFZLEdBQUcsaUJBQWlCLENBQUMsWUFBWSxDQUFDO1NBQy9DO0tBQ0Y7U0FBTSxJQUFJLENBQUMsT0FBTyxJQUFJLENBQUMsWUFBWSxFQUFFO1FBQ3BDLE1BQU0sSUFBSSxLQUFLLENBQUMsNkVBQTZFLENBQUMsQ0FBQztLQUNoRztJQUVELE1BQU0sY0FBYyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQzlELElBQUksYUFBYSxDQUFDO0lBQ2xCLFFBQVE7SUFDUixNQUFNLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQy9DLFNBQVMsRUFDVCxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsRUFBRTtRQUNqQixJQUFJLFFBQVEsS0FBSyxjQUFjLEVBQUU7WUFDL0IsYUFBYSxHQUFHLElBQUksQ0FBQztTQUN0QjtJQUNILENBQUMsRUFDRCxTQUFTLEVBQ1QsU0FBUyxFQUNULEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxDQUN6QixDQUFDO0lBRUYsMkRBQTJEO0lBQzNELElBQUksV0FBVyxFQUFFO1FBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUMsaUJBQWlCLENBQUMsV0FBVyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7S0FDbEU7SUFFRCw0QkFBNEI7SUFDNUIsT0FBTyxhQUFhLENBQUM7QUFDdkIsQ0FBQztBQXpDRCxrREF5Q0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHsgYmFzZW5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuXG4vLyBUZXN0IHRyYW5zZm9ybSBoZWxwZXJzLlxuY29uc3QgYmFzZWZpbGVOYW1lID0gJ3Rlc3QtZmlsZS50cyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUeXBlc2NyaXB0Q29udGV4dChcbiAgY29udGVudDogc3RyaW5nLFxuICBhZGRpdGlvbmFsRmlsZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICB1c2VMaWJzID0gZmFsc2UsXG4gIGV4dHJhQ29tcGlsZXJPcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMgPSB7fSxcbiAganN4RmlsZSA9IGZhbHNlLFxuKSB7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZWZpbGVOYW1lICsgKGpzeEZpbGUgPyAneCcgOiAnJyk7XG4gIC8vIFNldCBjb21waWxlciBvcHRpb25zLlxuICBjb25zdCBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyA9IHtcbiAgICBub0VtaXRPbkVycm9yOiB1c2VMaWJzLFxuICAgIGFsbG93SnM6IHRydWUsXG4gICAgbmV3TGluZTogdHMuTmV3TGluZUtpbmQuTGluZUZlZWQsXG4gICAgbW9kdWxlUmVzb2x1dGlvbjogdHMuTW9kdWxlUmVzb2x1dGlvbktpbmQuTm9kZUpzLFxuICAgIG1vZHVsZTogdHMuTW9kdWxlS2luZC5FUzIwMjAsXG4gICAgdGFyZ2V0OiB0cy5TY3JpcHRUYXJnZXQuRVMyMDIwLFxuICAgIHNraXBMaWJDaGVjazogdHJ1ZSxcbiAgICBzb3VyY2VNYXA6IGZhbHNlLFxuICAgIGltcG9ydEhlbHBlcnM6IHRydWUsXG4gICAgZXhwZXJpbWVudGFsRGVjb3JhdG9yczogdHJ1ZSxcbiAgICB0eXBlczogW10sXG4gICAgLi4uZXh0cmFDb21waWxlck9wdGlvbnMsXG4gIH07XG5cbiAgLy8gQ3JlYXRlIGNvbXBpbGVyIGhvc3QuXG4gIGNvbnN0IGNvbXBpbGVySG9zdCA9IHRzLmNyZWF0ZUNvbXBpbGVySG9zdChjb21waWxlck9wdGlvbnMsIHRydWUpO1xuXG4gIGNvbnN0IGJhc2VGaWxlRXhpc3RzID0gY29tcGlsZXJIb3N0LmZpbGVFeGlzdHM7XG4gIGNvbXBpbGVySG9zdC5maWxlRXhpc3RzID0gZnVuY3Rpb24gKGNvbXBpbGVyRmlsZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoXG4gICAgICBjb21waWxlckZpbGVOYW1lID09PSBmaWxlTmFtZSB8fFxuICAgICAgISFhZGRpdGlvbmFsRmlsZXM/LltiYXNlbmFtZShjb21waWxlckZpbGVOYW1lKV0gfHxcbiAgICAgIGJhc2VGaWxlRXhpc3RzKGNvbXBpbGVyRmlsZU5hbWUpXG4gICAgKTtcbiAgfTtcblxuICBjb25zdCBiYXNlUmVhZEZpbGUgPSBjb21waWxlckhvc3QucmVhZEZpbGU7XG4gIGNvbXBpbGVySG9zdC5yZWFkRmlsZSA9IGZ1bmN0aW9uIChjb21waWxlckZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoY29tcGlsZXJGaWxlTmFtZSA9PT0gZmlsZU5hbWUpIHtcbiAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH0gZWxzZSBpZiAoYWRkaXRpb25hbEZpbGVzPy5bYmFzZW5hbWUoY29tcGlsZXJGaWxlTmFtZSldKSB7XG4gICAgICByZXR1cm4gYWRkaXRpb25hbEZpbGVzW2Jhc2VuYW1lKGNvbXBpbGVyRmlsZU5hbWUpXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGJhc2VSZWFkRmlsZShjb21waWxlckZpbGVOYW1lKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gQ3JlYXRlIHRoZSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gIGNvbnN0IHByb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFtmaWxlTmFtZV0sIGNvbXBpbGVyT3B0aW9ucywgY29tcGlsZXJIb3N0KTtcblxuICByZXR1cm4geyBjb21waWxlckhvc3QsIHByb2dyYW0gfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRyYW5zZm9ybVR5cGVzY3JpcHQoXG4gIGNvbnRlbnQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgdHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSxcbiAgcHJvZ3JhbT86IHRzLlByb2dyYW0sXG4gIGNvbXBpbGVySG9zdD86IHRzLkNvbXBpbGVySG9zdCxcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIFVzZSBnaXZlbiBjb250ZXh0IG9yIGNyZWF0ZSBhIG5ldyBvbmUuXG4gIGlmIChjb250ZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0eXBlc2NyaXB0Q29udGV4dCA9IGNyZWF0ZVR5cGVzY3JpcHRDb250ZXh0KGNvbnRlbnQpO1xuICAgIGlmICghcHJvZ3JhbSkge1xuICAgICAgcHJvZ3JhbSA9IHR5cGVzY3JpcHRDb250ZXh0LnByb2dyYW07XG4gICAgfVxuICAgIGlmICghY29tcGlsZXJIb3N0KSB7XG4gICAgICBjb21waWxlckhvc3QgPSB0eXBlc2NyaXB0Q29udGV4dC5jb21waWxlckhvc3Q7XG4gICAgfVxuICB9IGVsc2UgaWYgKCFwcm9ncmFtIHx8ICFjb21waWxlckhvc3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3RyYW5zZm9ybVR5cGVzY3JpcHQgbmVlZHMgZWl0aGVyIGBjb250ZW50YCBvciBhIGBwcm9ncmFtYCBhbmQgYGNvbXBpbGVySG9zdCcpO1xuICB9XG5cbiAgY29uc3Qgb3V0cHV0RmlsZU5hbWUgPSBiYXNlZmlsZU5hbWUucmVwbGFjZSgvXFwudHN4PyQvLCAnLmpzJyk7XG4gIGxldCBvdXRwdXRDb250ZW50O1xuICAvLyBFbWl0LlxuICBjb25zdCB7IGVtaXRTa2lwcGVkLCBkaWFnbm9zdGljcyB9ID0gcHJvZ3JhbS5lbWl0KFxuICAgIHVuZGVmaW5lZCxcbiAgICAoZmlsZW5hbWUsIGRhdGEpID0+IHtcbiAgICAgIGlmIChmaWxlbmFtZSA9PT0gb3V0cHV0RmlsZU5hbWUpIHtcbiAgICAgICAgb3V0cHV0Q29udGVudCA9IGRhdGE7XG4gICAgICB9XG4gICAgfSxcbiAgICB1bmRlZmluZWQsXG4gICAgdW5kZWZpbmVkLFxuICAgIHsgYmVmb3JlOiB0cmFuc2Zvcm1lcnMgfSxcbiAgKTtcblxuICAvLyBUaHJvdyBlcnJvciB3aXRoIGRpYWdub3N0aWNzIGlmIGVtaXQgd2Fzbid0IHN1Y2Nlc3NmdWxsLlxuICBpZiAoZW1pdFNraXBwZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodHMuZm9ybWF0RGlhZ25vc3RpY3MoZGlhZ25vc3RpY3MsIGNvbXBpbGVySG9zdCkpO1xuICB9XG5cbiAgLy8gUmV0dXJuIHRoZSB0cmFuc3BpbGVkIGpzLlxuICByZXR1cm4gb3V0cHV0Q29udGVudDtcbn1cbiJdfQ==