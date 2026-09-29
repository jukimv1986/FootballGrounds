// Asset access for the port. The C++ engine read files synchronously from disk; the ported game
// code keeps that synchronous style, so everything it needs is fetched up front with
// FileSystem.Preload*(), after which GetText/GetBinary/GetImage are synchronous lookups.
//
// Paths are relative to the data root (public/data), e.g. "media/animations/..." — exactly the
// paths the C++ code used. In Node (tests) a synchronous disk reader can be installed instead.

export type DecodedImage = ImageBitmap | HTMLImageElement;

function normalize(path: string): string {
  let p = path.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.substring(2);
  while (p.startsWith('/')) p = p.substring(1);
  if (p.startsWith('data/')) p = p.substring(5);
  // collapse "a/b/../c"
  const parts: string[] = [];
  for (const part of p.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const BINARY_EXT = /\.(wav|ogg|mp3|sqlite|ttf)$/i;

class FileSystemImpl {
  baseUrl = './data/';
  protected manifest: string[] = [];
  protected manifestSet = new Set<string>();
  protected byFileName = new Map<string, string[]>();
  protected texts = new Map<string, string>();
  protected binaries = new Map<string, ArrayBuffer>();
  protected images = new Map<string, DecodedImage>();
  /** Node/test hook: synchronous reader returning file bytes, or null if missing */
  syncReader: ((path: string) => Uint8Array | null) | null = null;

  Normalize(path: string): string {
    return normalize(path);
  }

  SetManifest(files: string[]): void {
    this.manifest = files.map(normalize);
    this.manifestSet = new Set(this.manifest);
    this.byFileName.clear();
    for (const f of this.manifest) {
      const name = f.substring(f.lastIndexOf('/') + 1).toLowerCase();
      const list = this.byFileName.get(name) ?? [];
      list.push(f);
      this.byFileName.set(name, list);
    }
  }

  async LoadManifest(): Promise<void> {
    const res = await fetch(this.baseUrl + 'manifest.json');
    if (!res.ok) throw new Error(`could not load asset manifest (${res.status})`);
    const json = (await res.json()) as { files: string[] };
    this.SetManifest(json.files);
  }

  Exists(path: string): boolean {
    const p = normalize(path);
    if (this.manifestSet.has(p)) return true;
    if (this.syncReader) return this.syncReader(p) !== null;
    return false;
  }

  /** all manifest files under a directory (recursive), sorted */
  ListFiles(directory: string, recursive = true): string[] {
    let dir = normalize(directory);
    if (dir.length > 0 && !dir.endsWith('/')) dir += '/';
    return this.manifest.filter((f) => f.startsWith(dir) && (recursive || !f.substring(dir.length).includes('/')));
  }

  /** looks up a file by name anywhere in the data tree (for broken absolute references in models) */
  FindByFileName(fileName: string): string | null {
    const list = this.byFileName.get(fileName.substring(fileName.lastIndexOf('/') + 1).toLowerCase());
    return list && list.length > 0 ? list[0] : null;
  }

  /** resolves a path to one that exists: as-is, else by file name */
  Resolve(path: string): string | null {
    const p = normalize(path);
    if (this.manifestSet.has(p) || this.texts.has(p) || this.binaries.has(p) || this.images.has(p)) return p;
    if (this.syncReader && this.syncReader(p) !== null) return p;
    return this.FindByFileName(p);
  }

  async Preload(paths: string[], onProgress?: (done: number, total: number) => void, concurrency = 12): Promise<void> {
    const todo = [...new Set(paths.map(normalize))].filter((p) => !this.IsLoaded(p));
    let done = 0;
    let index = 0;
    const worker = async () => {
      while (index < todo.length) {
        const p = todo[index++];
        await this.LoadOne(p);
        done++;
        onProgress?.(done, todo.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  }

  async PreloadDirectory(directory: string, onProgress?: (done: number, total: number) => void, filter?: (path: string) => boolean): Promise<void> {
    const files = this.ListFiles(directory).filter((f) => (filter ? filter(f) : true));
    await this.Preload(files, onProgress);
  }

  IsLoaded(path: string): boolean {
    const p = normalize(path);
    return this.texts.has(p) || this.binaries.has(p) || this.images.has(p);
  }

  protected async LoadOne(p: string): Promise<void> {
    const url = this.baseUrl + p.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load ${p} (${res.status})`);
    if (IMAGE_EXT.test(p)) {
      const blob = await res.blob();
      if (typeof createImageBitmap !== 'undefined') {
        // unaltered pixels: normal/specular maps and alpha edges must reach the GPU as authored
        this.images.set(p, await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
      } else {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        this.images.set(p, img);
      }
    } else if (BINARY_EXT.test(p)) {
      this.binaries.set(p, await res.arrayBuffer());
    } else {
      this.texts.set(p, await res.text());
    }
  }

  /** registers in-memory file contents (tests, generated data) */
  PutText(path: string, contents: string): void {
    this.texts.set(normalize(path), contents);
  }

  /**
   * Registers a generated image under a path (e.g. career-mode kit textures): Exists(), Resolve(),
   * GetImage() and IsLoaded() see it, so Preload() never tries to download it.
   */
  PutImage(path: string, image: DecodedImage): void {
    const p = normalize(path);
    this.images.set(p, image);
    if (!this.manifestSet.has(p)) {
      this.manifest.push(p);
      this.manifestSet.add(p);
      const name = p.substring(p.lastIndexOf('/') + 1).toLowerCase();
      const list = this.byFileName.get(name) ?? [];
      list.push(p);
      this.byFileName.set(name, list);
    }
  }

  GetText(path: string): string {
    const p = normalize(path);
    const cached = this.texts.get(p);
    if (cached !== undefined) return cached;
    if (this.syncReader) {
      const bytes = this.syncReader(p);
      if (bytes) {
        const text = new TextDecoder('utf-8').decode(bytes);
        this.texts.set(p, text);
        return text;
      }
    }
    throw new Error(`file not preloaded: ${p}`);
  }

  GetBinary(path: string): ArrayBuffer {
    const p = normalize(path);
    const cached = this.binaries.get(p);
    if (cached !== undefined) return cached;
    if (this.syncReader) {
      const bytes = this.syncReader(p);
      if (bytes) {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        this.binaries.set(p, buf);
        return buf;
      }
    }
    throw new Error(`file not preloaded: ${p}`);
  }

  /** decoded image, or null when unavailable (e.g. in Node tests) */
  GetImage(path: string): DecodedImage | null {
    return this.images.get(normalize(path)) ?? null;
  }

  /** frees cached file contents (keeps the manifest) */
  Purge(filter?: (path: string) => boolean): void {
    for (const map of [this.texts, this.binaries, this.images] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (!filter || filter(key)) map.delete(key);
    }
  }
}

export const FileSystem = new FileSystemImpl();

/** C++ file_to_string */
export function file_to_string(filename: string): string {
  return FileSystem.GetText(filename).replace(/\r/g, '');
}

/** C++ file_to_vector: returns the file's lines */
export function file_to_vector(filename: string, destination: string[] = []): string[] {
  for (const line of FileSystem.GetText(filename).split('\n')) destination.push(line.replace(/\r/g, ''));
  if (destination.length > 0 && destination[destination.length - 1] === '') destination.pop();
  return destination;
}
