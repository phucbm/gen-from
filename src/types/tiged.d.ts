declare module 'tiged' {
    interface TigedOptions {
        cache?: boolean;
        force?: boolean;
        verbose?: boolean;
        mode?: 'tar' | 'git';
    }

    interface TigedEmitter {
        clone(dest: string): Promise<void>;

        on(event: string, handler: (info: any) => void): void;
    }

    function degit(src: string, options?: TigedOptions): TigedEmitter;

    export = degit;
}