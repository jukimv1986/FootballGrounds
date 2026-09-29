// Three.js rendering backend for the ported Blunted2 scene graph. Replaces the C++ OpenGL 3 deferred
// renderer (legacy/src/systems/graphics/**): every frame the engine Node tree (Scene3D) is walked and
// mirrored into a flat THREE.Scene, then rendered with forward shading that reproduces the original
// lighting model (see shaders.ts).
//
// Conventions kept from the engine:
//  - world is Z-UP (x along the pitch, y across, z up); no coordinate conversion anywhere.
//  - an engine Camera looks along its local -Z with local +Y up (Matrix4::ConstructInverse(position,
//    1, rotation) was the view matrix), which is exactly Three's camera convention, so the camera's
//    derived position/rotation become its world matrix unchanged. FOV is vertical, in degrees.
//  - object matrices: derived position / rotation / scale (the C++ renderer ignored scale; it is
//    always 1 in the game).
//  - a directional Light's position encodes the direction towards the sun (Match::SetRandomSunParams
//    puts the sun at normalized direction * 10000); lighting.frag treated it as a point light with a
//    huge radius, so its falloff ((radius - distance) / radius)^2 is applied to the intensity.

import * as THREE from 'three';
import type { Node } from '../scene/node';
import type { Camera } from '../scene/objects/camera';
import type { Geometry } from '../scene/objects/geometry';
import { e_LightType, type Light } from '../scene/objects/light';
import type { GeometryData } from '../scene/resources/geometrydata';
import type { Scene3D } from '../scene/scene3d';
import { e_ObjectType } from '../scene/spatial';
import { DetectQuality, QUALITY_PRESETS, type QualitySettings, type RenderQuality } from './quality';
import { GeometryBuffers } from './rendergeometry';
import { MaterialLibrary, type MaterialEntry } from './rendermaterials';
import { InstallCustomToneMapping, SKY_FRAGMENT, SKY_VERTEX } from './shaders';

export type { RenderQuality } from './quality';

export type ToneMappingMode = 'aces' | 'agx' | 'neutral' | 'original';

export interface ThreeRendererOptions {
  quality?: RenderQuality;
  /** default 'aces' */
  toneMapping?: ToneMappingMode;
  exposure?: number;
  /** fog amount multiplier, 1 = original (max 25% fog) */
  fog?: number;
  /** extra render resolution scale on top of the (quality-capped) device pixel ratio */
  renderScale?: number;
  /** keep the drawing buffer (for canvas.toDataURL / screenshots) */
  preserveDrawingBuffer?: boolean;
}

export interface RenderStats {
  /** draw calls of the last frame, shadow pass included */
  drawCalls: number;
  triangles: number;
  /** CPU time spent in Render() (scene sync + command submission), ms */
  frameTimeMs: number;
  /** part of frameTimeMs spent syncing the engine scene graph, ms */
  syncTimeMs: number;
  /** smoothed interval between Render() calls, ms, and the resulting frame rate */
  frameIntervalMs: number;
  fps: number;
  meshes: number;
  geometries: number;
  materials: number;
  textures: number;
  programs: number;
}

// engine light "brightness" (lighting.frag: `float brightness = 2.0f;`)
const LIGHT_BRIGHTNESS = 2.0;
// ambient.frag: base * vec3(0.9, 1.0, 1.2) * 0.15 (desaturation happens in the shader)
const AMBIENT_TINT = new THREE.Color().setRGB(0.9 * 0.15, 1.0 * 0.15, 1.2 * 0.15, THREE.LinearSRGBColorSpace);
// postprocess.frag: fog / background colour
const FOG_COLOR = new THREE.Color().setRGB(0.85, 0.85, 0.9, THREE.LinearSRGBColorSpace);
// half extents of the area whose shadows are rendered (pitch inside the lines is +-55 x +-36)
const SHADOW_AREA_X = 55 + 14;
const SHADOW_AREA_Y = 36 + 12;
// receivers up to this height (players) must be inside the shadow map
const SHADOW_RECEIVER_HEIGHT = 2.6;
// casters up to this far towards the sun from the receivers (stands, roofs) are rendered into the map
const SHADOW_CASTER_RANGE = 140;
const SHADOW_LIGHT_DISTANCE = 400;

interface GeometryEntry {
  geom: Geometry;
  mesh: THREE.Mesh;
  buffers: GeometryBuffers | null;
  data: GeometryData | null;
  transformVersion: number;
  geometryVersion: number;
  materialsVersion: number;
  partitionVersion: number;
  /** material per triangle mesh (from the object's material snapshot) */
  materials: MaterialEntry[];
  seen: number;
}

interface LightEntry {
  light: Light;
  type: e_LightType;
  three: THREE.DirectionalLight | THREE.PointLight;
  /** normalized direction towards the light (directional) */
  direction: THREE.Vector3;
  seen: number;
}

export class ThreeRenderer {
  readonly stats: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    frameTimeMs: 0,
    syncTimeMs: 0,
    frameIntervalMs: 16.7,
    fps: 60,
    meshes: 0,
    geometries: 0,
    materials: 0,
    textures: 0,
    programs: 0,
  };

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 1000);
  private readonly fog = new THREE.Fog(FOG_COLOR.clone(), 50, 150);
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly skyUniforms: {
    zenithColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
    groundColor: { value: THREE.Color };
    sunDirection: { value: THREE.Vector3 };
    sunColor: { value: THREE.Color };
  };
  private readonly library: MaterialLibrary;
  private readonly emptyGeometry = new THREE.BufferGeometry();

  private quality: RenderQuality;
  private settings: QualitySettings;
  private readonly antialias: boolean;
  private renderScale: number;
  private fogStrength: number;

  private readonly geometryEntries = new Map<Geometry, GeometryEntry>();
  private readonly lightEntries = new Map<Light, LightEntry>();
  private readonly buffers = new Map<GeometryData, GeometryBuffers>();
  private shadowLight: LightEntry | null = null;
  private frame = 0;
  private lastRenderStart = 0;
  private width = 1;
  private height = 1;

  private readonly onWindowResize = (): void => this.Resize();
  private resizeObserver: ResizeObserver | null = null;

  // scratch objects
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpVec2 = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly lightView = new THREE.Matrix4();
  private readonly frustumCorners = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor(canvas: HTMLCanvasElement, options: ThreeRendererOptions = {}) {
    this.canvas = canvas;
    this.quality = options.quality ?? DetectQuality();
    this.settings = { ...QUALITY_PRESETS[this.quality] };
    this.antialias = this.settings.antialias;
    this.renderScale = options.renderScale ?? 1;
    this.fogStrength = options.fog ?? 1;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(FOG_COLOR, 1);
    this.SetToneMapping(options.toneMapping ?? 'aces', options.exposure ?? 1);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.library = new MaterialLibrary(Math.min(maxAniso, this.settings.anisotropy), this.antialias);

    // everything is positioned by hand; nothing in the scene uses matrixAutoUpdate
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.fog = this.fog;

    this.camera.up.set(0, 0, 1);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;

    // ambient pass replacement: blueish sky, darker from below (poor man's ambient occlusion)
    this.hemisphere = new THREE.HemisphereLight(AMBIENT_TINT.clone().multiplyScalar(1.2), AMBIENT_TINT.clone().multiplyScalar(0.55), 1);
    this.hemisphere.position.set(0, 0, 1);
    this.hemisphere.updateMatrixWorld(true);
    this.scene.add(this.hemisphere);

    this.skyUniforms = {
      zenithColor: { value: new THREE.Color().setRGB(0.3, 0.48, 0.8, THREE.LinearSRGBColorSpace) },
      horizonColor: { value: FOG_COLOR.clone() },
      groundColor: { value: new THREE.Color().setRGB(0.42, 0.44, 0.46, THREE.LinearSRGBColorSpace) },
      sunDirection: { value: new THREE.Vector3(0, 0, 1) },
      sunColor: { value: new THREE.Color(0, 0, 0) },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.matrixAutoUpdate = false;
    this.sky.matrixWorldAutoUpdate = false;
    this.scene.add(this.sky);

    this.Resize();
    if (typeof window !== 'undefined') window.addEventListener('resize', this.onWindowResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.Resize());
      this.resizeObserver.observe(canvas);
    }
  }

  GetRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** the mirrored Three scene (read-only use: overlays, debugging) */
  GetScene(): THREE.Scene {
    return this.scene;
  }

  GetCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  GetQuality(): RenderQuality {
    return this.quality;
  }

  /** switches quality at runtime (MSAA stays as chosen at construction) */
  SetQuality(quality: RenderQuality): void {
    const previous = this.settings;
    this.quality = quality;
    this.settings = { ...QUALITY_PRESETS[quality], antialias: this.antialias };
    this.library.SetAnisotropy(Math.min(this.renderer.capabilities.getMaxAnisotropy(), this.settings.anisotropy));
    if (previous.shadows !== this.settings.shadows) {
      this.renderer.shadowMap.enabled = this.settings.shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    if (this.shadowLight) this.ConfigureShadow(this.shadowLight.three as THREE.DirectionalLight);
    this.Resize();
  }

  SetToneMapping(mode: ToneMappingMode, exposure = this.renderer.toneMappingExposure): void {
    const r = this.renderer;
    switch (mode) {
      case 'agx':
        r.toneMapping = THREE.AgXToneMapping;
        break;
      case 'neutral':
        r.toneMapping = THREE.NeutralToneMapping;
        break;
      case 'original':
        InstallCustomToneMapping();
        r.toneMapping = THREE.CustomToneMapping;
        break;
      default:
        r.toneMapping = THREE.ACESFilmicToneMapping;
    }
    r.toneMappingExposure = exposure;
  }

  /** fog amount multiplier (1 = original) */
  SetFog(strength: number): void {
    this.fogStrength = strength;
  }

  /** render resolution scale (e.g. 0.75 for dynamic resolution on slow devices) */
  SetRenderScale(scale: number): void {
    this.renderScale = Math.max(0.25, Math.min(2, scale));
    this.Resize();
  }

  Resize(): void {
    const canvas = this.canvas;
    const w = Math.max(1, Math.floor(canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : canvas.width)));
    const h = Math.max(1, Math.floor(canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : canvas.height)));
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pixelRatio = Math.min(dpr, this.settings.maxPixelRatio) * this.renderScale;
    if (w === this.width && h === this.height && pixelRatio === this.renderer.getPixelRatio()) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
  }

  /** renders the engine scene as seen by `camera` (null: the first camera found in the scene) */
  Render(scene3D: Scene3D, camera: Camera | null): void {
    const start = performance.now();
    if (this.lastRenderStart > 0) {
      const interval = Math.min(250, start - this.lastRenderStart);
      this.stats.frameIntervalMs += (interval - this.stats.frameIntervalMs) * 0.1;
      this.stats.fps = 1000 / Math.max(0.001, this.stats.frameIntervalMs);
    }
    this.lastRenderStart = start;
    this.frame++;

    const root = scene3D.GetRoot();
    if (!camera) camera = root.GetObjects<Camera>(e_ObjectType.e_ObjectType_Camera)[0] ?? null;

    // sync the scene graph
    this.library.Update();
    this.shadowLight = null;
    this.Walk(root);
    this.RemoveUnseen();
    const synced = performance.now();

    const r = this.renderer;
    r.info.reset();
    if (camera) {
      this.SetupCamera(camera);
      this.SetupEnvironment();
      const shadowLight = this.shadowLight as LightEntry | null; // set by Walk()
      if (shadowLight && shadowLight.three.castShadow) this.FitShadowCamera(shadowLight);
      r.render(this.scene, this.camera);
    } else {
      r.clear();
    }

    const s = this.stats;
    s.drawCalls = r.info.render.calls;
    s.triangles = r.info.render.triangles;
    s.meshes = this.geometryEntries.size;
    s.geometries = this.buffers.size;
    s.materials = this.library.materialCount;
    s.textures = this.library.textureCount;
    s.programs = r.info.programs ? r.info.programs.length : 0;
    s.syncTimeMs = synced - start;
    s.frameTimeMs = performance.now() - start;
  }

  /** drops every Three object created for engine objects (e.g. when a match ends) */
  Clear(): void {
    for (const entry of this.geometryEntries.values()) this.scene.remove(entry.mesh);
    this.geometryEntries.clear();
    for (const buffers of this.buffers.values()) buffers.Dispose();
    this.buffers.clear();
    for (const entry of this.lightEntries.values()) this.RemoveLight(entry);
    this.lightEntries.clear();
    this.shadowLight = null;
    this.library.Clear();
    this.renderer.renderLists.dispose();
  }

  Dispose(): void {
    this.Clear();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.emptyGeometry.dispose();
    this.renderer.dispose();
  }

  // ----- scene graph sync

  private Walk(node: Node): void {
    const objects = node.GetChildObjects();
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const type = object.GetObjectType();
      if (type === e_ObjectType.e_ObjectType_Geometry) this.SyncGeometry(object as Geometry);
      else if (type === e_ObjectType.e_ObjectType_Light) this.SyncLight(object as Light);
    }
    const nodes = node.GetChildNodes();
    for (let i = 0; i < nodes.length; i++) this.Walk(nodes[i]);
  }

  private RemoveUnseen(): void {
    for (const [geom, entry] of this.geometryEntries) {
      if (entry.seen === this.frame) continue;
      this.scene.remove(entry.mesh);
      this.ReleaseBuffers(entry);
      this.geometryEntries.delete(geom);
    }
    for (const [light, entry] of this.lightEntries) {
      if (entry.seen === this.frame) continue;
      this.RemoveLight(entry);
      this.lightEntries.delete(light);
    }
  }

  private SyncGeometry(geom: Geometry): void {
    let entry = this.geometryEntries.get(geom);
    if (!entry) {
      const mesh = new THREE.Mesh(this.emptyGeometry, []);
      mesh.name = geom.GetName();
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      entry = {
        geom,
        mesh,
        buffers: null,
        data: null,
        transformVersion: -1,
        geometryVersion: -1,
        materialsVersion: -1,
        partitionVersion: -1,
        materials: [],
        seen: 0,
      };
      this.geometryEntries.set(geom, entry);
    }
    entry.seen = this.frame;
    const mesh = entry.mesh;

    if (!geom.HasGeometryData()) {
      mesh.visible = false;
      return;
    }

    const data = geom.GetGeometryData().GetResource();
    if (entry.data !== data) {
      this.ReleaseBuffers(entry);
      let buffers = this.buffers.get(data);
      if (!buffers) {
        buffers = new GeometryBuffers(data);
        this.buffers.set(data, buffers);
      }
      buffers.users++;
      entry.buffers = buffers;
      entry.data = data;
      entry.geometryVersion = entry.materialsVersion = entry.partitionVersion = -1;
    }
    const buffers = entry.buffers!;

    const materialsChanged = geom.materialsVersion !== entry.materialsVersion;
    if (materialsChanged || geom.geometryVersion !== entry.geometryVersion || buffers.dataVersion !== data.version) {
      const structureChanged = buffers.StructureChanged();
      if (materialsChanged || structureChanged) {
        this.ResolveMaterials(geom, data, entry);
        const keys = entry.materials.map((m) => m.key);
        const needTangents = entry.materials.some((m) => m.normal !== null);
        if (structureChanged || needTangents !== buffers.hasTangents || !buffers.PartitionMatches(keys)) {
          buffers.Build(keys, needTangents);
        } else if (buffers.lastUploadFrame !== this.frame) {
          buffers.Upload(true, this.frame);
        }
      } else if (buffers.lastUploadFrame !== this.frame) {
        buffers.Upload(false, this.frame);
      }
      entry.geometryVersion = geom.geometryVersion;
      entry.materialsVersion = geom.materialsVersion;
      entry.partitionVersion = -1;
    }

    if (entry.partitionVersion !== buffers.partitionVersion) {
      if (entry.materials.length !== data.GetTriangleMeshesRef().length) this.ResolveMaterials(geom, data, entry);
      mesh.geometry = buffers.geometry;
      const first = buffers.groupFirstMesh;
      const materials: THREE.Material[] = new Array(first.length);
      for (let g = 0; g < first.length; g++) materials[g] = (entry.materials[first[g]] ?? this.library.GetMaterial(null)).material;
      mesh.material = materials;
      entry.partitionVersion = buffers.partitionVersion;
    }

    if (geom.transformVersion !== entry.transformVersion) {
      entry.transformVersion = geom.transformVersion;
      const p = geom.GetDerivedPosition().coords;
      const q = geom.GetDerivedRotation().elements;
      const s = geom.GetDerivedScale().coords;
      this.tmpVec.set(p[0], p[1], p[2]);
      SetQuaternion(this.tmpQuat, q);
      this.tmpScale.set(s[0], s[1], s[2]);
      mesh.matrixWorld.compose(this.tmpVec, this.tmpQuat, this.tmpScale);
      mesh.matrix.copy(mesh.matrixWorld);
    }

    mesh.visible = geom.IsEnabled() && buffers.vertexCount > 0;
    mesh.castShadow = this.settings.shadows && (this.settings.staticShadows || buffers.dynamic || buffers.radius < 10);
  }

  private ResolveMaterials(geom: Geometry, data: GeometryData, entry: GeometryEntry): void {
    const meshes = data.GetTriangleMeshesRef();
    const snapshot = geom.materialsSnapshot;
    const useSnapshot = snapshot !== null && snapshot !== undefined && snapshot.length === meshes.length;
    entry.materials.length = meshes.length;
    for (let i = 0; i < meshes.length; i++) entry.materials[i] = this.library.GetMaterial(useSnapshot ? snapshot[i] : meshes[i].material);
  }

  private ReleaseBuffers(entry: GeometryEntry): void {
    const buffers = entry.buffers;
    if (!buffers) return;
    entry.buffers = null;
    entry.data = null;
    entry.mesh.geometry = this.emptyGeometry;
    buffers.users--;
    if (buffers.users <= 0) {
      buffers.Dispose();
      this.buffers.delete(buffers.data);
    }
  }

  private SyncLight(light: Light): void {
    let entry = this.lightEntries.get(light);
    if (entry && entry.type !== light.GetType()) {
      this.RemoveLight(entry);
      this.lightEntries.delete(light);
      entry = undefined;
    }
    if (!entry) {
      const type = light.GetType();
      let three: THREE.DirectionalLight | THREE.PointLight;
      if (type === e_LightType.e_LightType_Directional) {
        const dl = new THREE.DirectionalLight(0xffffff, LIGHT_BRIGHTNESS);
        dl.shadow.camera.up.set(0, 0, 1);
        this.ConfigureShadow(dl);
        three = dl;
      } else {
        three = new THREE.PointLight(0xffffff, LIGHT_BRIGHTNESS, 0, 0);
      }
      three.name = light.GetName();
      three.matrixAutoUpdate = false;
      three.matrixWorldAutoUpdate = false;
      this.scene.add(three);
      entry = { light, type, three, direction: new THREE.Vector3(0, 0, 1), seen: 0 };
      this.lightEntries.set(light, entry);
    }
    entry.seen = this.frame;

    const three = entry.three;
    three.visible = light.IsEnabled();
    const c = light.GetColor().coords;
    three.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
    const p = light.GetDerivedPosition().coords;
    const distance = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    const radius = light.GetRadius();

    if (three instanceof THREE.DirectionalLight) {
      if (distance > 1e-6) entry.direction.set(p[0] / distance, p[1] / distance, p[2] / distance);
      else entry.direction.set(0, 0, 1);
      // lighting.frag falloff, seen from the pitch centre
      let falloff = radius > 0 ? Math.max(0, radius - distance) / radius : 1;
      falloff *= falloff;
      three.intensity = LIGHT_BRIGHTNESS * falloff;
      three.position.copy(entry.direction).multiplyScalar(SHADOW_LIGHT_DISTANCE);
      three.matrix.makeTranslation(three.position);
      three.matrixWorld.copy(three.matrix);
      three.target.position.set(0, 0, 0);
      three.target.updateMatrixWorld(true);
      const wantShadow = light.GetShadow() && this.settings.shadows && three.visible && this.shadowLight === null;
      three.castShadow = wantShadow;
      if (wantShadow) this.shadowLight = entry;
    } else {
      three.position.set(p[0], p[1], p[2]);
      three.matrix.makeTranslation(three.position);
      three.matrixWorld.copy(three.matrix);
      three.distance = radius > 0 ? radius : 0;
      three.decay = 0;
      three.intensity = LIGHT_BRIGHTNESS;
      three.castShadow = false;
    }
  }

  private RemoveLight(entry: LightEntry): void {
    this.scene.remove(entry.three);
    entry.three.dispose();
    if (this.shadowLight === entry) this.shadowLight = null;
  }

  private ConfigureShadow(light: THREE.DirectionalLight): void {
    const shadow = light.shadow;
    const size = this.settings.shadowMapSize;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    }
    shadow.radius = this.settings.shadowRadius;
    // lighting.frag: shaded = 0.25 + 0.75 * lit
    shadow.intensity = 0.75;
  }

  // ----- camera, environment, shadows

  private SetupCamera(camera: Camera): void {
    const cam = this.camera;
    const p = camera.GetDerivedPosition().coords;
    const q = camera.GetDerivedRotation().elements;
    cam.position.set(p[0], p[1], p[2]);
    SetQuaternion(cam.quaternion, q);
    cam.scale.set(1, 1, 1);
    cam.matrix.compose(cam.position, cam.quaternion, cam.scale);
    cam.matrixWorld.copy(cam.matrix);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    const { nearCap, farCap } = camera.GetCapping();
    const near = nearCap > 0 ? nearCap : 0.1;
    const far = farCap > near ? farCap : near * 1000;
    const aspect = this.width / this.height;
    const fov = camera.GetFOV();
    if (cam.fov !== fov || cam.near !== near || cam.far !== far || cam.aspect !== aspect) {
      cam.fov = fov;
      cam.near = near;
      cam.far = far;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  private SetupEnvironment(): void {
    const cam = this.camera;

    // postprocess.frag fog: clamp(depth * 0.01 * (1 - fogScale) - 0.16 * fogScale, 0, 0.25)
    const fovNorm = Math.min(1, Math.max(0, (cam.fov - 20) / (100 - 20)));
    const fogScale = 0.8 - fovNorm * 0.6;
    this.fog.near = (16 * fogScale) / (1 - fogScale);
    this.fog.far = (0.25 + 0.16 * fogScale) / (0.01 * (1 - fogScale));
    this.library.fogMax.value = 0.25 * this.fogStrength;

    // sky dome around the camera, inside the clipping range
    const radius = (cam.near + cam.far) * 0.5;
    this.tmpScale.set(radius, radius, radius);
    this.tmpQuat.identity();
    this.sky.matrixWorld.compose(cam.position, this.tmpQuat, this.tmpScale);
    const sun = this.shadowLight ?? this.FirstDirectionalLight();
    if (sun) {
      this.skyUniforms.sunDirection.value.copy(sun.direction);
      this.skyUniforms.sunColor.value.copy(sun.three.color).multiplyScalar(sun.three.visible ? 0.5 : 0);
    } else {
      this.skyUniforms.sunColor.value.setRGB(0, 0, 0);
    }
  }

  private FirstDirectionalLight(): LightEntry | null {
    for (const entry of this.lightEntries.values()) if (entry.type === e_LightType.e_LightType_Directional && entry.three.visible) return entry;
    return null;
  }

  /**
   * Fits the sun's orthographic shadow camera around the part of the playing area the camera sees.
   * The original used a fixed 150 x 150 m box around the camera; fitting gives much denser texels for
   * the usual TV camera. The light's view matrix is constant (the sun only moves when re-randomized)
   * and the bounds are snapped to texels and quantized in size, so shadows don't shimmer.
   */
  private FitShadowCamera(entry: LightEntry): void {
    const light = entry.three as THREE.DirectionalLight;
    const cam = this.camera;
    const shadowCam = light.shadow.camera;

    // 1. intersection of the view frustum with the receiver slab 0 <= z <= SHADOW_RECEIVER_HEIGHT
    const corners = this.frustumCorners;
    for (let i = 0; i < 8; i++) {
      corners[i].set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).unproject(cam);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    for (let i = 0; i < 8; i++) {
      const c = corners[i];
      if (c.z >= 0 && c.z <= SHADOW_RECEIVER_HEIGHT) add(c.x, c.y);
      // the 3 edges from this corner towards corners with a higher index
      for (let bit = 1; bit < 8; bit <<= 1) {
        if (i & bit) continue;
        const d = corners[i | bit];
        for (let h = 0; h <= 1; h++) {
          const z = h * SHADOW_RECEIVER_HEIGHT;
          if ((c.z - z) * (d.z - z) > 0 || c.z === d.z) continue;
          const t = (c.z - z) / (c.z - d.z);
          add(c.x + (d.x - c.x) * t, c.y + (d.y - c.y) * t);
        }
      }
    }
    if (minX === Infinity) {
      minX = -SHADOW_AREA_X;
      maxX = SHADOW_AREA_X;
      minY = -SHADOW_AREA_Y;
      maxY = SHADOW_AREA_Y;
    }
    minX = Math.max(minX, -SHADOW_AREA_X);
    maxX = Math.min(maxX, SHADOW_AREA_X);
    minY = Math.max(minY, -SHADOW_AREA_Y);
    maxY = Math.min(maxY, SHADOW_AREA_Y);
    if (minX > maxX || minY > maxY) {
      // looking away from the pitch: keep a small map around the pitch centre
      minX = maxX = Math.min(SHADOW_AREA_X, Math.max(-SHADOW_AREA_X, cam.position.x));
      minY = maxY = Math.min(SHADOW_AREA_Y, Math.max(-SHADOW_AREA_Y, cam.position.y));
    }

    // 2. into light view space (same basis Three derives: lookAt from the light towards the origin)
    const eye = this.tmpVec.copy(light.position);
    const up = shadowCam.up;
    if (Math.abs(entry.direction.z) > 0.999) up.set(1, 0, 0);
    else up.set(0, 0, 1);
    this.tmpMatrix.lookAt(eye, this.tmpVec2.set(0, 0, 0), up);
    this.tmpMatrix.setPosition(eye);
    this.lightView.copy(this.tmpMatrix).invert();
    let lminX = Infinity, lminY = Infinity, lmaxX = -Infinity, lmaxY = -Infinity, dmin = Infinity, dmax = -Infinity;
    const v = this.tmpVec2;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? maxX : minX, i & 2 ? maxY : minY, i & 4 ? SHADOW_RECEIVER_HEIGHT : 0).applyMatrix4(this.lightView);
      if (v.x < lminX) lminX = v.x;
      if (v.x > lmaxX) lmaxX = v.x;
      if (v.y < lminY) lminY = v.y;
      if (v.y > lmaxY) lmaxY = v.y;
      if (-v.z < dmin) dmin = -v.z;
      if (-v.z > dmax) dmax = -v.z;
    }

    // 3. square, size-quantized, texel-snapped bounds
    const mapSize = light.shadow.mapSize.x;
    let size = Math.max(lmaxX - lminX, lmaxY - lminY) + 3;
    size = Math.max(10, Math.ceil(size / 5) * 5);
    const texel = size / mapSize;
    const cx = Math.round((lminX + lmaxX) * 0.5 / texel) * texel;
    const cy = Math.round((lminY + lmaxY) * 0.5 / texel) * texel;
    const near = Math.max(1, dmin - SHADOW_CASTER_RANGE);
    const far = dmax + 5;
    if (shadowCam.left !== cx - size * 0.5 || shadowCam.bottom !== cy - size * 0.5 || shadowCam.right !== cx + size * 0.5 || shadowCam.near !== near || shadowCam.far !== far) {
      shadowCam.left = cx - size * 0.5;
      shadowCam.right = cx + size * 0.5;
      shadowCam.bottom = cy - size * 0.5;
      shadowCam.top = cy + size * 0.5;
      shadowCam.near = near;
      shadowCam.far = far;
      shadowCam.updateProjectionMatrix();
    }
    // biases in world units: ~1 texel along the normal, a few cm in depth
    light.shadow.normalBias = texel * 1.0;
    light.shadow.bias = -0.03 / (far - near);
  }
}

function SetQuaternion(target: THREE.Quaternion, e: readonly number[]): void {
  const lengthSq = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3];
  if (lengthSq < 1e-12) {
    target.identity();
    return;
  }
  const f = Math.abs(lengthSq - 1) < 1e-6 ? 1 : 1 / Math.sqrt(lengthSq);
  target.set(e[0] * f, e[1] * f, e[2] * f, e[3] * f);
}
