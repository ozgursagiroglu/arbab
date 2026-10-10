import type { BuildOptions } from "esbuild";

export declare function packageVersion(root: string): string;
export declare function bundleOptions(input: { version: string; outfile: string }): BuildOptions;
