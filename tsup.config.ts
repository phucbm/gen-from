import {defineConfig} from 'tsup';
import {generateBanner} from "@phucbm/banner";

export default defineConfig({
    entry: ['src/cli.ts'],
    outDir: 'dist',
    format: ['esm'],
    target: 'es2020',
    platform: 'node',
    bundle: true,
    minify: true,
    sourcemap: false,
    dts: false,
    clean: true,
    banner: {
        js: generateBanner()
    }
});