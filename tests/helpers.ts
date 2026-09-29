// Test helper: lets the game's synchronous FileSystem read public/data straight from disk.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FileSystem } from '../src/blunted/managers/filesystem';

const dataRoot = join(__dirname, '..', 'public', 'data');

export function installDiskFileSystem(): void {
  const manifest = JSON.parse(readFileSync(join(dataRoot, 'manifest.json'), 'utf-8')) as { files: string[] };
  FileSystem.SetManifest(manifest.files);
  FileSystem.syncReader = (p: string) => {
    const full = join(dataRoot, p);
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : null;
  };
}
