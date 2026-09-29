// Engine Material / Surface -> Three.js materials and textures, shared between meshes.
// Mirrors LoadMaterials() in legacy/src/systems/graphics/objects/graphics_geometry.cpp: diffuse maps are
// sRGB, normal/specular/illumination maps linear, all textures repeat with trilinear + anisotropic
// filtering, and every material alpha-tests at 0.12 (simple.frag: `if (base.a < 0.12) discard;`).
// There was no alpha blending and no double-sided rendering in the original (deferred, back-face culled).

import * as THREE from 'three';
import { CreateMaterial, type Material } from '../scene/resources/geometrydata';
import type { Resource } from '../scene/resources/resource';
import type { Surface } from '../scene/resources/surface';
import { PatchPhongShader } from './shaders';

const ALPHA_TEST = 0.12;

type TexImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

let nextTextureId = 1;

export class TextureEntry {
  readonly id = nextTextureId++;
  surface: Surface;
  version = -1;
  texture: THREE.Texture;
  hasAlpha = false;
  /** materials referencing this texture */
  readonly users = new Set<MaterialEntry>();

  constructor(
    readonly resource: Resource<Surface>,
    readonly srgb: boolean,
    private anisotropy: number,
  ) {
    this.surface = resource.resource;
    this.texture = new THREE.Texture();
    this.Refresh();
  }

  /** true when the texture had to be recreated (materials must pick up the new object) */
  Refresh(): boolean {
    const surface = this.resource.resource;
    const sameSurface = surface === this.surface;
    this.surface = surface;
    this.version = surface.version;
    const alpha = DetectAlpha(surface, this.resource.GetIdentString());
    const alphaChanged = alpha !== this.hasAlpha;
    this.hasAlpha = alpha;

    // in-place update of a data texture with unchanged dimensions
    const tex = this.texture;
    if (sameSurface && tex instanceof THREE.DataTexture && !surface.HasUntouchedSource()) {
      const img = tex.image as { data: Uint8Array; width: number; height: number };
      if (img.width === surface.width && img.height === surface.height && surface.data.length === surface.width * surface.height * 4) {
        img.data = new Uint8Array(surface.data.buffer, surface.data.byteOffset, surface.data.byteLength);
        tex.needsUpdate = true;
        return alphaChanged;
      }
    }

    const old = this.texture;
    this.texture = CreateTexture(surface, this.srgb, this.anisotropy);
    old.dispose();
    return true;
  }

  SetAnisotropy(anisotropy: number): void {
    this.anisotropy = anisotropy;
    if (this.texture.anisotropy !== anisotropy) {
      this.texture.anisotropy = anisotropy;
      this.texture.needsUpdate = true;
    }
  }

  Dispose(): void {
    this.texture.dispose();
    this.users.clear();
  }
}

function CreateTexture(surface: Surface, srgb: boolean, anisotropy: number): THREE.Texture {
  let tex: THREE.Texture;
  if (surface.HasUntouchedSource()) {
    tex = new THREE.Texture(surface.source as TexImage);
  } else {
    let width = surface.width;
    let height = surface.height;
    let data: Uint8Array;
    if (width > 0 && height > 0 && surface.data.length >= width * height * 4) {
      data = new Uint8Array(surface.data.buffer, surface.data.byteOffset, width * height * 4);
    } else {
      width = height = 1;
      data = new Uint8Array([255, 255, 255, 255]);
    }
    tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  }
  // Surface rows are top row first, as SDL surfaces were; the ASE loader already negated v, so like
  // the original we upload unflipped and rely on repeat wrapping
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let alphaCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

/** whether a surface has (partially) transparent pixels, i.e. needs alpha testing */
function DetectAlpha(surface: Surface, identString: string): boolean {
  if (surface.HasUntouchedSource()) {
    if (/\.(jpe?g|bmp)$/i.test(identString)) return false;
    const w = Math.max(1, Math.min(256, surface.width));
    const h = Math.max(1, Math.min(256, surface.height));
    try {
      if (!alphaCanvas) alphaCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
      alphaCanvas.width = w;
      alphaCanvas.height = h;
      const ctx = alphaCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return true;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(surface.source as CanvasImageSource, 0, 0, w, h);
      return HasTransparentPixels(ctx.getImageData(0, 0, w, h).data);
    } catch {
      return true;
    }
  }
  return HasTransparentPixels(surface.data);
}

function HasTransparentPixels(d: ArrayLike<number>): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

export class MaterialEntry {
  readonly material: THREE.MeshPhongMaterial;
  private readonly uSelfIllumination: { value: number };
  private readonly uIlluminationMap: { value: THREE.Texture | null };

  constructor(
    readonly key: string,
    readonly diffuse: TextureEntry | null,
    readonly normal: TextureEntry | null,
    readonly specular: TextureEntry | null,
    readonly illumination: TextureEntry | null,
    source: Material,
    library: MaterialLibrary,
  ) {
    const mat = new THREE.MeshPhongMaterial({ color: 0xffffff });
    mat.name = diffuse ? diffuse.resource.GetIdentString() : 'untextured';
    // simple.frag: spec = specular map (red) * specular_amount; lighting.frag: pow(.., shininess * 128), light colour
    // without the diffuse "brightness 2.0" (which is folded into the light intensity, hence * 0.5)
    const amount = Math.max(0, source.specular_amount) * 0.5;
    mat.specular.setRGB(amount, amount, amount, THREE.LinearSRGBColorSpace);
    mat.shininess = Math.max(1, source.shininess * 128);
    mat.fog = true;
    this.uSelfIllumination = { value: source.self_illumination.coords[0] };
    this.uIlluminationMap = { value: null };
    const hasIllumMap = illumination !== null;
    if (hasIllumMap) mat.defines = { FB_ILLUMINATION_MAP: '' };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.fbSelfIllumination = this.uSelfIllumination;
      shader.uniforms.fbFogMax = library.fogMax;
      if (hasIllumMap) shader.uniforms.fbIlluminationMap = this.uIlluminationMap;
      PatchPhongShader(shader);
    };
    mat.customProgramCacheKey = () => (hasIllumMap ? 'fb-phong-illum' : 'fb-phong');
    this.material = mat;
    for (const t of [diffuse, normal, specular, illumination]) t?.users.add(this);
    this.ApplyTextures(library.alphaToCoverage);
  }

  /** (re)assigns the texture objects and alpha settings; call after a texture was recreated */
  ApplyTextures(alphaToCoverage: boolean): void {
    const mat = this.material;
    mat.map = this.diffuse ? this.diffuse.texture : null;
    mat.normalMap = this.normal ? this.normal.texture : null;
    mat.specularMap = this.specular ? this.specular.texture : null;
    this.uIlluminationMap.value = this.illumination ? this.illumination.texture : null;
    const alpha = this.diffuse !== null && this.diffuse.hasAlpha;
    const alphaTest = alpha ? ALPHA_TEST : 0;
    const a2c = alpha && alphaToCoverage;
    if (mat.alphaTest !== alphaTest || mat.alphaToCoverage !== a2c) {
      mat.alphaTest = alphaTest;
      mat.alphaToCoverage = a2c;
      mat.needsUpdate = true;
    }
  }

  Dispose(): void {
    this.material.dispose();
  }
}

/** caches Three textures per Resource<Surface> and Three materials per unique engine material */
export class MaterialLibrary {
  private readonly colorTextures = new Map<Resource<Surface>, TextureEntry>();
  private readonly dataTextures = new Map<Resource<Surface>, TextureEntry>();
  private readonly materials = new Map<string, MaterialEntry>();
  private readonly defaultMaterialSource: Material;
  /** shared by all materials: max fog amount (postprocess.frag caps it at 0.25) */
  readonly fogMax = { value: 0.25 };
  anisotropy: number;
  alphaToCoverage: boolean;

  constructor(anisotropy: number, alphaToCoverage: boolean) {
    this.anisotropy = anisotropy;
    this.alphaToCoverage = alphaToCoverage;
    // PORT: a material without diffuse texture rendered black in the original (texture 0); white here
    this.defaultMaterialSource = { ...CreateMaterial(), shininess: 0.1 };
  }

  get textureCount(): number {
    return this.colorTextures.size + this.dataTextures.size;
  }

  get materialCount(): number {
    return this.materials.size;
  }

  GetTexture(resource: Resource<Surface> | null, srgb: boolean): TextureEntry | null {
    if (!resource) return null;
    const map = srgb ? this.colorTextures : this.dataTextures;
    let entry = map.get(resource);
    if (!entry) {
      entry = new TextureEntry(resource, srgb, this.anisotropy);
      map.set(resource, entry);
    }
    return entry;
  }

  GetMaterial(source: Material | null): MaterialEntry {
    const m = source ?? this.defaultMaterialSource;
    const diffuse = this.GetTexture(m.diffuseTexture, true);
    const normal = this.GetTexture(m.normalTexture, false);
    const specular = this.GetTexture(m.specularTexture, false);
    const illumination = this.GetTexture(m.illuminationTexture, false);
    const selfIllum = m.self_illumination ? m.self_illumination.coords[0] : 0;
    const key = `${diffuse?.id ?? 0}|${normal?.id ?? 0}|${specular?.id ?? 0}|${illumination?.id ?? 0}|${m.shininess}|${m.specular_amount}|${selfIllum}`;
    let entry = this.materials.get(key);
    if (!entry) {
      entry = new MaterialEntry(key, diffuse, normal, specular, illumination, m, this);
      this.materials.set(key, entry);
    }
    return entry;
  }

  /** per frame: re-uploads surfaces whose pixels (version) or identity changed */
  Update(): void {
    this.UpdateMap(this.colorTextures);
    this.UpdateMap(this.dataTextures);
  }

  private UpdateMap(map: Map<Resource<Surface>, TextureEntry>): void {
    for (const entry of map.values()) {
      const surface = entry.resource.resource;
      if (surface === entry.surface && surface.version === entry.version) continue;
      if (entry.Refresh()) for (const user of entry.users) user.ApplyTextures(this.alphaToCoverage);
    }
  }

  SetAnisotropy(anisotropy: number): void {
    this.anisotropy = anisotropy;
    for (const entry of this.colorTextures.values()) entry.SetAnisotropy(anisotropy);
    for (const entry of this.dataTextures.values()) entry.SetAnisotropy(anisotropy);
  }

  Clear(): void {
    for (const entry of this.materials.values()) entry.Dispose();
    for (const entry of this.colorTextures.values()) entry.Dispose();
    for (const entry of this.dataTextures.values()) entry.Dispose();
    this.materials.clear();
    this.colorTextures.clear();
    this.dataTextures.clear();
  }
}
