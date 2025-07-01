import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/cli.ts'],
    outDir: 'dist',
    format: ['esm'],
    target: 'es2020',
    platform: 'node',
    bundle: true,
    minify: false,
    sourcemap: false,
    dts: false,
    clean: true,
    banner: {
        js: '#!/usr/bin/env node'
    }
});