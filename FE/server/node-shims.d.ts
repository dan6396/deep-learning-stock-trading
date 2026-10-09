declare module "node:fs/promises" {
  export function access(path: string): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function stat(path: string): Promise<{ mtimeMs: number; isFile(): boolean }>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  export function mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  export function readdir(path: string): Promise<string[]>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function writeFile(path: string, data: string, options: { encoding: "utf8"; flag: string }): Promise<void>;
}

declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string } };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:child_process" {
  type ReadableLike = {
    on(event: "data", listener: (chunk: { toString: () => string }) => void): void;
  };

  type ChildProcessLike = {
    kill(signal?: string): boolean;
    stderr: ReadableLike;
    stdout: ReadableLike;
    on(event: "close", listener: (code: number | null) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  };

  export function spawn(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      windowsHide?: boolean;
    },
  ): ChildProcessLike;
}
