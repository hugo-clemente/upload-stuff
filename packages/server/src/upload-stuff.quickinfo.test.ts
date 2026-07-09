import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

// Regression test for a TypeScript quick-info stack overflow (RangeError:
// "Maximum call stack size exceeded" via isAnySymbolAccessible ↔
// getContainersOfSymbol) that fires when an exported generic type alias
// references a NON-exported symbol through a typeof instantiation expression
// (`ReturnType<typeof buildServerUtils<TFields>>`) and the alias is hovered
// from another module. Twoslash hovers every identifier, so this crashed the
// whole docs build. The fix keeps every symbol referenced by the public
// `UploadStuff` type exported (see `ServerUtils`).
describe("UploadStuff quick info", () => {
  it("serializes the imported UploadStuff type without blowing the stack", () => {
    const virtualFileName = path.join(__dirname, "__quickinfo_probe__.ts");
    const virtualContent = `import type { UploadStuff } from "./upload-stuff";\ndeclare const u: UploadStuff;\nexport type P = typeof u;\n`;

    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    };

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [virtualFileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: (fileName) => {
        if (fileName === virtualFileName) {
          return ts.ScriptSnapshot.fromString(virtualContent);
        }
        const content = ts.sys.readFile(fileName);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => __dirname,
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) => fileName === virtualFileName || ts.sys.fileExists(fileName),
      readFile: (fileName) =>
        fileName === virtualFileName ? virtualContent : ts.sys.readFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    try {
      // Hover the `UploadStuff` identifier in the import clause — exactly what
      // Twoslash does for every identifier on the docs pages.
      const hoverPosition = virtualContent.indexOf("UploadStuff");
      const quickInfo = service.getQuickInfoAtPosition(virtualFileName, hoverPosition);
      expect(quickInfo).toBeDefined();

      // And hover the annotated const, which forces full alias expansion.
      const constPosition = virtualContent.indexOf("u:");
      expect(() => service.getQuickInfoAtPosition(virtualFileName, constPosition)).not.toThrow();
    } finally {
      service.dispose();
    }
  });
});
