// Standalone renderer test page (render-test.html): builds a match-like scene straight from the engine
// assets, without the gameplay code, and renders it with ThreeRenderer.
//
// URL parameters:
//   quality=low|medium|high   renderer quality (default high)
//   view=tv|close|goal|overview|low   camera (default tv = Match::UpdateIngameCamera "wide cam")
//   tonemap=aces|agx|neutral|original, exposure=1, fog=0.6 (1 = original amount)
//   split=0                   don't split the stadium into 24 m chunks (the match does)
//   anim=0                    no per-frame vertex animation of the player bodies
//   hud=0                     hide the stats overlay
//   pitch=0                   keep the 16x16 placeholder pitch textures
//   sun=x,y,z                 sun direction (default: Match::SetRandomSunParams' "sane default")
//
// window.__renderTest exposes hooks for automated tests (Playwright): ready, setView(), benchmark().

import { Quaternion, Vector3 } from '../blunted/base/math/vector3';
import { FileSystem } from '../blunted/managers/filesystem';
import { ResourceManagerPool } from '../blunted/managers/resourcemanagerpool';
import { ThreeRenderer, type RenderQuality, type ToneMappingMode } from '../blunted/render/threerenderer';
import { Node } from '../blunted/scene/node';
import { Camera } from '../blunted/scene/objects/camera';
import { Geometry } from '../blunted/scene/objects/geometry';
import type { Light } from '../blunted/scene/objects/light';
import type { GeometryData } from '../blunted/scene/resources/geometrydata';
import type { Resource } from '../blunted/scene/resources/resource';
import { Surface } from '../blunted/scene/resources/surface';
import { Scene3D } from '../blunted/scene/scene3d';
import { e_LocalMode, e_ObjectType } from '../blunted/scene/spatial';
import { ObjectLoader } from '../blunted/utils/objectloader';
import { SplitGeometry } from '../game/utils/splitgeometry';
import { GenerateTestPitch } from './testpitch';

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
if (params.get('hud') === '0') hud.classList.add('hidden');

const pi = Math.PI;
const pool = ResourceManagerPool.GetInstance();

interface Body {
  node: Node;
  geom: Geometry;
  hair: Geometry;
  base: Vector3;
  /** hair offset from the body origin (the neck), unrotated */
  hairOffset: Vector3;
  facing: number;
  rest: Float32Array[];
  phase: number;
}

interface TestApi {
  ready: boolean;
  error: string | null;
  frames: number;
  stats: () => unknown;
  setView: (name: string) => void;
  setQuality: (q: RenderQuality) => void;
  setToneMapping: (m: ToneMappingMode) => void;
  setAnimate: (on: boolean) => void;
  benchmark: (frames: number) => Promise<unknown>;
}

const api: TestApi = {
  ready: false,
  error: null,
  frames: 0,
  stats: () => null,
  setView: () => {},
  setQuality: () => {},
  setToneMapping: () => {},
  setAnimate: () => {},
  benchmark: async () => null,
};
(window as unknown as { __renderTest: TestApi }).__renderTest = api;

function Status(text: string): void {
  hud.textContent = text;
}

// ----- scene building helpers

/** HumanoidBase: converts the body to unique vertices + indices (texcoords must be shared too) */
function MakeIndexed(data: GeometryData): void {
  for (const mesh of data.GetTriangleMeshesRef()) {
    const n = mesh.verticesDataSize / 15;
    const block = n * 3;
    const v = mesh.vertices;
    const seen = new Map<string, number>();
    const unique: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const key = `${v[i * 3]},${v[i * 3 + 1]},${v[i * 3 + 2]},${v[2 * block + i * 3]},${v[2 * block + i * 3 + 1]}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = unique.length;
        seen.set(key, index);
        unique.push(i);
      }
      indices.push(index);
    }
    const m = unique.length;
    const out = new Float32Array(m * 15);
    for (let e = 0; e < 5; e++) {
      for (let k = 0; k < m; k++) {
        const src = e * block + unique[k] * 3;
        const dst = e * m * 3 + k * 3;
        out[dst] = v[src];
        out[dst + 1] = v[src + 1];
        out[dst + 2] = v[src + 2];
      }
    }
    mesh.vertices = out;
    mesh.verticesDataSize = m * 15;
    mesh.indices = indices;
  }
}

function ReplaceDiffuse(data: GeometryData, identString: string, surface: Resource<Surface>, specular?: number, shininess?: number): void {
  for (const mesh of data.GetTriangleMeshesRef()) {
    if (mesh.material.diffuseTexture && mesh.material.diffuseTexture.GetIdentString() === identString) {
      mesh.material.diffuseTexture = surface;
      if (specular !== undefined) mesh.material.specular_amount = specular;
      if (shininess !== undefined) mesh.material.shininess = shininess;
    }
  }
}

/** Match::RandomizeAdboards */
function RandomizeAdboards(stadium: Node): void {
  const files = FileSystem.ListFiles('media/textures/adboards').filter((f) => f.endsWith('.png'));
  if (files.length === 0) return;
  const surfaces = files.map((f) => pool.FetchSurface(f));
  let k = 0;
  for (const geom of stadium.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry)) {
    for (const mesh of geom.GetGeometryData().GetResource().GetTriangleMeshesRef()) {
      const tex = mesh.material.diffuseTexture;
      if (tex && tex.GetIdentString().startsWith('ad_placeholder')) {
        mesh.material.diffuseTexture = surfaces[k++ % surfaces.length];
        mesh.material.specular_amount = 0.2;
        mesh.material.shininess = 0.1;
      }
    }
    geom.OnUpdateGeometryData();
  }
}

// ----- cameras (ported from Match::UpdateIngameCamera)

interface CameraSetup {
  orientation: Quaternion;
  nodeOrientation: Quaternion;
  nodePosition: Vector3;
  fov: number;
  near: number;
  far: number;
}

function WideCam(average: Vector3): CameraSetup {
  const cameraUserFOV = 0.4, cameraUserZoom = 0.5, cameraUserHeight = 0.3, cameraUserAngleFactor = 0.0;
  const pitchHalfW = 55;
  const fov = 0.5 + cameraUserFOV * 0.5;
  let zoom = cameraUserZoom;
  let height = cameraUserHeight * 1.5;
  const angleFac = 1.0 - cameraUserAngleFactor * 0.4;
  zoom = (0.6 + zoom * 1.0) * (1.0 / fov);
  height = 4.0 + height * 10;
  const distRot = average.coords[1] / 800.0;
  const orientation = Quaternion.FromAngleAxis(distRot + (0.42 - height * 0.01) * pi, new Vector3(1, 0, 0));
  const nodeOrientation = Quaternion.FromAngleAxis((-average.coords[0] / pitchHalfW) * (1.0 - angleFac) * 0.25 * pi * 1.24, new Vector3(0, 0, 1));
  const nodePosition = average
    .Mul(new Vector3(1.0 * (1.0 - cameraUserAngleFactor * 0.2) * (1.0 - cameraUserZoom * 0.3), 0.9 - cameraUserZoom * 0.3, 0.2))
    .Add(new Vector3(0, -41.4 - cameraUserFOV * 3.7 + Math.pow(height, 1.2) * 0.46, 10.0 + height).Mul(zoom));
  return { orientation, nodeOrientation, nodePosition, fov: fov * 28.0 - nodePosition.coords[1] / 30.0, near: nodePosition.coords[2], far: 200 };
}

/** goal-scorer cam */
function CloseCam(target: Vector3, rot: number): CameraSetup {
  return {
    orientation: Quaternion.FromAngleAxis(0.45 * pi, new Vector3(1, 0, 0)),
    nodeOrientation: Quaternion.FromAngleAxis(rot, new Vector3(0, 0, 1)),
    nodePosition: target.Add(new Vector3(0, -1, 0).GetRotated2D(rot).Mul(15.0)).Add(new Vector3(0, 0, 3)),
    fov: 35,
    near: 1,
    far: 220,
  };
}

function FreeCam(position: Vector3, pitch: number, yaw: number, fov: number, near = 1, far = 260): CameraSetup {
  return {
    orientation: Quaternion.FromAngleAxis(pitch, new Vector3(1, 0, 0)),
    nodeOrientation: Quaternion.FromAngleAxis(yaw, new Vector3(0, 0, 1)),
    nodePosition: position,
    fov,
    near,
    far,
  };
}

// ----- main

async function Main(): Promise<void> {
  Status('loading manifest…');
  await FileSystem.LoadManifest();
  const dirs = ['media/objects/stadiums', 'media/objects/lighting', 'media/objects/balls', 'media/objects/players', 'media/textures'];
  const loadStart = performance.now();
  for (const dir of dirs) {
    await FileSystem.PreloadDirectory(dir, (done, total) => Status(`loading ${dir} ${done}/${total}`));
  }
  const kitFiles = ['databases/default/images_teams/premierleague/arsenal_kit_01.png', 'databases/default/images_teams/premierleague/manchesterunited_kit_02.png'];
  await FileSystem.Preload(kitFiles);
  const loadMs = performance.now() - loadStart;

  Status('building scene…');
  const buildStart = performance.now();
  const scene = new Scene3D('render test');
  const loader = new ObjectLoader();

  // stadium, split into a 24 m grid like Match::Match
  const tmpStadium = loader.LoadObject('media/objects/stadiums/test/test.object');
  RandomizeAdboards(tmpStadium);
  const stadium = new Node('stadium');
  if (params.get('split') === '0') {
    stadium.AddNode(tmpStadium);
  } else {
    for (const geom of tmpStadium.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry)) {
      const chunkNode = SplitGeometry(scene, geom, 24);
      chunkNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
      stadium.AddNode(chunkNode);
    }
    tmpStadium.Exit();
  }
  stadium.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
  scene.AddNode(stadium);

  if (params.get('pitch') !== '0') GenerateTestPitch();

  const goals = loader.LoadObject('media/objects/stadiums/goals.object');
  goals.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
  scene.AddNode(goals);

  // sun (Match::SetRandomSunParams with its "sane default" direction and noon colour)
  const sunNode = loader.LoadObject('media/objects/lighting/generic.object');
  scene.AddNode(sunNode);
  const sunParam = params.get('sun');
  let sunPos = new Vector3(-1.2, 0.4, 1.0);
  if (sunParam) {
    const [x, y, z] = sunParam.split(',').map(Number);
    sunPos = new Vector3(x, y, z);
  }
  sunPos = sunPos.GetNormalized();
  const sun = sunNode.GetObject('sun') as Light;
  sun.SetPosition(sunPos.Mul(10000));
  sun.SetRadius(1000000);
  const noonBias = Math.pow(Math.min(1, Math.max(0, (sunPos.coords[2] - 0.5) / 0.5)), 1.2);
  const sunColor = new Vector3(0.9, 0.8, 1.0).Mul(1.4 * noonBias).Add(new Vector3(1.4, 0.9, 0.7).Mul(1.2 * (1 - noonBias)));
  sun.SetColor(sunColor);

  // kits
  const kits = kitFiles.map((f) => pool.FetchSurface(f));
  const goalieKit = pool.FetchSurface('media/objects/players/textures/goalie_kit.png');
  const refereeKit = pool.FetchSurface('media/objects/players/textures/referee_kit.png');
  // a generated surface (DataTexture path): the away keeper's kit is the goalie kit tinted green
  const tinted = Surface.FromImage(FileSystem.GetImage('media/objects/players/textures/goalie_kit.png')!);
  const px = tinted.EnsurePixels();
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i] * 0.35;
    px[i + 2] = px[i + 2] * 0.45;
  }
  tinted.MarkDirty();
  const greenKeeperKit = pool.RegisterSurface('generated_keeper_kit.png', tinted);

  // players: 4-4-2 vs 4-4-2, plus referee and linesmen
  const formation: [number, number][] = [
    [-50, 0], [-36, -22], [-38, -8], [-38, 8], [-36, 22], [-18, -26], [-20, -8], [-20, 8], [-18, 26], [-5, -6], [-3, 7],
  ];
  const fullbodySource = loader.LoadObject('media/objects/players/fullbody.object');
  const hairStyles = ['short01', 'short02', 'medium01', 'medium02', 'long01', 'bald'];
  const hairColors = ['black', 'brown', 'blonde', 'darkblonde', 'red'];
  const bodies: Body[] = [];
  const AddBody = (x: number, y: number, facing: number, kit: Resource<Surface>, index: number): void => {
    const node = Node.Copy(fullbodySource, '_' + index);
    node.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    node.SetPosition(new Vector3(x, y, 0));
    const geom = node.GetObject('fullbody') as Geometry;
    const data = geom.GetGeometryData().GetResource();
    const skin = pool.FetchSurface(`media/objects/players/textures/skin0${1 + (index % 4)}.png`);
    ReplaceDiffuse(data, 'skin.jpg', skin, 0.002, 0.2);
    ReplaceDiffuse(data, 'kit_template.png', kit);
    MakeIndexed(data);
    geom.OnUpdateGeometryData();
    // hairstyle geometry data is shared between players (as in HumanoidBase), the texture is not
    const hair = new Geometry('hairstyle');
    hair.SetGeometryData(pool.FetchGeometryData(`media/objects/players/hairstyles/${hairStyles[index % hairStyles.length]}.ase`));
    for (const mesh of hair.GetGeometryData().GetResource().GetTriangleMeshesRef()) {
      if (mesh.material.diffuseTexture) {
        mesh.material.diffuseTexture = pool.FetchSurface(`media/objects/players/textures/hair/${hairColors[index % hairColors.length]}.png`);
        mesh.material.specular_amount = 0.01;
        mesh.material.shininess = 0.05;
      }
    }
    hair.OnUpdateGeometryData();
    // the hairstyle's origin is the neck: put it below the top of the head, centred on the head
    let hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity, top = 0;
    for (const mesh of data.GetTriangleMeshesRef()) {
      const v = mesh.vertices;
      for (let k = 0; k < mesh.verticesDataSize / 5; k += 3) {
        if (v[k + 2] < 1.6) continue;
        hx0 = Math.min(hx0, v[k]);
        hx1 = Math.max(hx1, v[k]);
        hy0 = Math.min(hy0, v[k + 1]);
        hy1 = Math.max(hy1, v[k + 1]);
        top = Math.max(top, v[k + 2]);
      }
    }
    const hairOffset = hx0 === Infinity ? new Vector3(0, 0, 1.5) : new Vector3((hx0 + hx1) * 0.5, (hy0 + hy1) * 0.5, top - 0.3);
    node.AddObject(hair);
    scene.AddNode(node);
    const rest = data.GetTriangleMeshesRef().map((m) => new Float32Array(m.vertices));
    bodies.push({ node, geom, hair, base: new Vector3(x, y, 0), hairOffset, facing, rest, phase: index * 0.7 });
  };
  const maxPlayers = Number(params.get('players') ?? 22);
  let index = 0;
  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < formation.length && index < maxPlayers; i++) {
      const [fx, fy] = formation[i];
      const x = team === 0 ? fx : -fx - 1.5;
      const y = team === 0 ? fy : -fy + 1.2;
      const kit = i === 0 ? (team === 0 ? goalieKit : greenKeeperKit) : kits[team];
      AddBody(x, y, team === 0 ? 0.5 * pi : -0.5 * pi, kit, index++);
    }
  }
  if (maxPlayers >= 22) {
    AddBody(4, 10, pi, refereeKit, index++);
    AddBody(-25, -37.5, 0.5 * pi, refereeKit, index++);
    AddBody(25, 37.5, -0.5 * pi, refereeKit, index++);
  }

  // ball (its geometry is in absolute local mode, so the object itself is moved)
  const ballNode = loader.LoadObject('media/objects/balls/generic.object');
  scene.AddNode(ballNode);
  const ball = ballNode.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry)[0];
  ball.SetPosition(new Vector3(-1.2, 0.8, 0.11));

  // camera
  const camera = new Camera('camera');
  camera.Init();
  camera.SetFOV(25);
  const cameraNode = new Node('cameraNode');
  cameraNode.AddObject(camera);
  scene.AddNode(cameraNode);

  let view = params.get('view') ?? 'tv';
  const ApplyCamera = (setup: CameraSetup): void => {
    camera.SetPosition(new Vector3(0, 0, 0));
    camera.SetRotation(setup.orientation);
    cameraNode.SetPosition(setup.nodePosition);
    cameraNode.SetRotation(setup.nodeOrientation);
    camera.SetFOV(setup.fov);
    camera.SetCapping(setup.near, setup.far);
  };
  const UpdateCamera = (t: number): void => {
    const ballPos = ball.GetPosition();
    switch (view) {
      case 'close':
        ApplyCamera(CloseCam(bodies[9].node.GetPosition(), 0.3 + t * 0.05));
        break;
      case 'goal':
        ApplyCamera(FreeCam(new Vector3(-66, -6, 5.5), 0.46 * pi, -0.5 * pi + 0.12, 42));
        break;
      case 'overview':
        ApplyCamera(FreeCam(new Vector3(0, -125, 95), 0.3 * pi, 0, 42, 20, 400));
        break;
      case 'low':
        ApplyCamera(FreeCam(new Vector3(-12, -20, 1.6), 0.5 * pi, -0.3 * pi, 50, 0.3, 260));
        break;
      default:
        ApplyCamera(WideCam(ballPos.Mul(0.4).Add(bodies[9].node.GetPosition().Mul(0.6)).WithCoord(2, 0)));
    }
  };

  const quality = (params.get('quality') as RenderQuality | null) ?? 'high';
  const renderer = new ThreeRenderer(canvas, {
    quality,
    toneMapping: (params.get('tonemap') as ToneMappingMode | null) ?? undefined,
    fog: params.has('fog') ? Number(params.get('fog')) : undefined,
    exposure: params.has('exposure') ? Number(params.get('exposure')) : undefined,
  });
  const buildMs = performance.now() - buildStart;

  // per-frame vertex animation of the bodies (stands in for the humanoid skinning: every body
  // changes its vertices every frame and calls OnUpdateGeometryData(false))
  let animate = params.get('anim') !== '0';
  let animMs = 0;
  const Animate = (t: number): void => {
    const s0 = performance.now();
    for (const body of bodies) {
      const sway = Math.sin(t * 2.1 + body.phase) * 0.25;
      const angle = body.facing + sway;
      const c = Math.cos(angle), s = Math.sin(angle);
      const meshes = body.geom.GetGeometryData().GetResource().GetTriangleMeshesRef();
      for (let m = 0; m < meshes.length; m++) {
        const src = body.rest[m];
        const dst = meshes[m].vertices;
        const block = meshes[m].verticesDataSize / 5;
        for (const e of [0, 1, 3, 4]) {
          const o = e * block;
          for (let i = o; i < o + block; i += 3) {
            const x = src[i], y = src[i + 1];
            dst[i] = x * c - y * s;
            dst[i + 1] = x * s + y * c;
            dst[i + 2] = src[i + 2];
          }
        }
      }
      body.geom.OnUpdateGeometryData(false);
      const run = new Vector3(Math.cos(t * 0.4 + body.phase), Math.sin(t * 0.3 + body.phase), 0).Mul(1.5);
      body.node.SetPosition(body.base.Add(run));
      const hairRotation = Quaternion.FromAngleAxis(angle, new Vector3(0, 0, 1));
      body.hair.SetRotation(hairRotation);
      body.hair.SetPosition(body.hairOffset.GetRotated(hairRotation));
    }
    ball.SetPosition(new Vector3(-1.2 + Math.sin(t * 0.7) * 3, 0.8 + Math.cos(t * 0.5) * 2, 0.11 + Math.abs(Math.sin(t * 1.5)) * 1.5));
    animMs = performance.now() - s0;
  };

  Animate(0);
  const start = performance.now();
  let t = 0;
  let lastHud = 0;
  let benchmarkState: { remaining: number; frames: number; frameMs: number; syncMs: number; animMs: number; start: number; calls: number; tris: number; resolve: (v: unknown) => void } | null = null;
  const Frame = (now: number): void => {
    requestAnimationFrame(Frame);
    t = (now - start) / 1000;
    if (animate) Animate(t);
    UpdateCamera(animate ? t : 0);
    renderer.Render(scene, camera);
    api.frames++;
    const st = renderer.stats;
    if (benchmarkState) {
      const b = benchmarkState;
      b.frames++;
      b.frameMs += st.frameTimeMs;
      b.syncMs += st.syncTimeMs;
      b.animMs += animMs;
      b.calls = st.drawCalls;
      b.tris = st.triangles;
      if (--b.remaining <= 0) {
        benchmarkState = null;
        const wall = performance.now() - b.start;
        b.resolve({
          frames: b.frames,
          avgRenderCpuMs: b.frameMs / b.frames,
          avgSyncMs: b.syncMs / b.frames,
          avgAnimMs: b.animMs / b.frames,
          avgWallFrameMs: wall / b.frames,
          drawCalls: b.calls,
          triangles: b.tris,
        });
      }
    }
    if (now - lastHud > 250) {
      lastHud = now;
      hud.textContent =
        `${renderer.GetQuality()}  ${st.fps.toFixed(1)} fps  (${st.frameIntervalMs.toFixed(1)} ms)\n` +
        `render cpu ${st.frameTimeMs.toFixed(2)} ms  sync ${st.syncTimeMs.toFixed(2)} ms  anim ${animMs.toFixed(2)} ms\n` +
        `draw calls ${st.drawCalls}  triangles ${st.triangles}\n` +
        `meshes ${st.meshes}  geometries ${st.geometries}  materials ${st.materials}  textures ${st.textures}  programs ${st.programs}\n` +
        `load ${loadMs.toFixed(0)} ms  build ${buildMs.toFixed(0)} ms  view ${view}`;
    }
  };

  api.stats = () => ({ ...renderer.stats, loadMs, buildMs, animMs });
  api.setView = (name: string) => {
    view = name;
  };
  api.setQuality = (q: RenderQuality) => renderer.SetQuality(q);
  api.setToneMapping = (m: ToneMappingMode) => renderer.SetToneMapping(m);
  api.setAnimate = (on: boolean) => {
    animate = on;
  };
  api.benchmark = (frames: number) =>
    new Promise((resolve) => {
      benchmarkState = { remaining: frames, frames: 0, frameMs: 0, syncMs: 0, animMs: 0, start: performance.now(), calls: 0, tris: 0, resolve };
    });

  requestAnimationFrame(Frame);
  // report ready after a couple of frames (programs compiled, textures uploaded)
  const waitFrames = (n: number): Promise<void> =>
    new Promise((resolve) => {
      const target = api.frames + n;
      const check = (): void => {
        if (api.frames >= target) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  await waitFrames(3);
  api.ready = true;
}

Main().catch((e: unknown) => {
  console.error(e);
  api.error = String(e instanceof Error ? e.stack ?? e.message : e);
  Status('error: ' + api.error);
});
