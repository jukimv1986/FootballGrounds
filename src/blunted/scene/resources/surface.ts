// Port of blunted/scene/resources/surface. The original wrapped an SDL_Surface; here a Surface is
// an RGBA8 pixel buffer that works both in the browser and in Node (tests). `version` is bumped
// on every change so the renderer knows when to re-upload the texture.

export class Surface {
  width = 0;
  height = 0;
  /** RGBA, row-major, top row first */
  data: Uint8ClampedArray = new Uint8ClampedArray(0);
  version = 0;
  /** optional decoded image the renderer may upload directly (avoids a pixel copy) */
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | null = null;
  /** true when `data` has not been filled from `source` yet */
  private pixelsPending = false;

  static Create(width: number, height: number, rgba?: [number, number, number, number]): Surface {
    const s = new Surface();
    s.width = width;
    s.height = height;
    s.data = new Uint8ClampedArray(width * height * 4);
    if (rgba) {
      for (let i = 0; i < width * height; i++) s.data.set(rgba, i * 4);
    }
    return s;
  }

  static FromImage(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Surface {
    const s = new Surface();
    s.width = source.width;
    s.height = source.height;
    s.source = source;
    s.pixelsPending = true;
    return s;
  }

  Clone(): Surface {
    const s = new Surface();
    s.width = this.width;
    s.height = this.height;
    s.source = this.source;
    s.pixelsPending = this.pixelsPending;
    s.data = this.pixelsPending ? this.data : new Uint8ClampedArray(this.data);
    return s;
  }

  /** makes sure `data` holds the pixels (decodes `source` through a canvas when needed) */
  EnsurePixels(): Uint8ClampedArray {
    if (this.pixelsPending && this.source) {
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(this.width, this.height)
          : Object.assign(document.createElement('canvas'), { width: this.width, height: this.height });
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.drawImage(this.source as CanvasImageSource, 0, 0);
      this.data = ctx.getImageData(0, 0, this.width, this.height).data;
      this.pixelsPending = false;
    }
    return this.data;
  }

  /** true while the renderer can use `source` directly */
  HasUntouchedSource(): boolean {
    return this.pixelsPending && this.source !== null;
  }

  GetSize(): { x: number; y: number } {
    return { x: this.width, y: this.height };
  }

  GetPixel(x: number, y: number): [number, number, number, number] {
    const d = this.EnsurePixels();
    const i = (y * this.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  PutPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    const d = this.EnsurePixels();
    const i = (y * this.width + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }

  /** call after writing to `data` directly */
  MarkDirty(): void {
    this.source = null;
    this.pixelsPending = false;
    this.version++;
  }

  SetAlpha(alpha: number): void {
    const d = this.EnsurePixels();
    for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * alpha);
    this.MarkDirty();
  }
}
