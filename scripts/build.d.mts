import type { BuildOptions, Plugin } from "esbuild";

export declare function packageVersion(root: string): string;
export declare const UI_BUNDLE_FILTER: RegExp;
export declare function uiScriptPlugin(): Plugin;
export declare function bundleOptions(input: { version: string; outfile: string }): BuildOptions & { plugins: Plugin[] };
