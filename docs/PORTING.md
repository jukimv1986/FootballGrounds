# Porting guide: GameplayFootball C++ → TypeScript

The original C++ code lives in `legacy/src/`. The TypeScript port lives in `src/`. This guide
defines the conventions every ported module must follow, so modules ported independently fit
together without renaming.

## 1. Where things go

| C++ (legacy/src/…)                         | TypeScript (src/…)                          |
|--------------------------------------------|---------------------------------------------|
| `base/`, `scene/`, `types/`, `managers/`, `loaders/`, `utils/xmlloader`, `utils/objectloader` (Blunted2 engine) | `blunted/…` — **already ported**, do not re-port |
| `gamedefines.{hpp,cpp}`                    | `game/gamedefines.ts` — **already ported**   |
| `main.{hpp,cpp}` (GetScene3D(), GetConfiguration(), …) | `game/globals.ts` — **already ported** |
| `hid/ihidevice.hpp`                        | `game/hid/ihidevice.ts` — **already ported** |
| `managers/usereventmanager` (+ SDLK_ keys) | `game/hid/usereventmanager.ts` — **already ported** |
| `menu/menutask` (the parts the match uses) | `game/menu/menutask.ts` — **already ported** |
| `utils/gui2/*` (Gui2Caption, Gui2Image, …) | `game/ui/gui2.ts` — **already ported** (DOM overlay) |
| `utils/database` (SQLite)                  | `game/data/database.ts` — **already ported** (in-memory JSON) |
| `utils.{hpp,cpp}` (football utils)         | `game/footballutils.ts` (renamed: avoids clashing with the `utils/` dir) |
| everything else, e.g. `onthepitch/ball.cpp` + `ball.hpp` | same path, one `.ts` per `.cpp/.hpp` pair: `game/onthepitch/ball.ts` |

File names stay lowercase exactly as in C++ (`teamAIcontroller.ts`, `AIfunctions.ts`,
`humanoid_utils.ts`). One class per file as in C++. Header-only structs/enums go in the `.ts` of
their header.

## 2. Names

**Keep every C++ identifier unchanged**: class names, method names (PascalCase: `GetPosition`),
member names (`spatialState`, `buf_nameCaptionShowCondition`), free function names, enum names
and enumerator names. This is what lets modules ported in parallel call each other, and it keeps
the port diffable against `legacy/`.

- Enums: `enum e_Velocity { e_Velocity_Idle, … }` → `export enum e_Velocity { e_Velocity_Idle, … }`,
  used fully qualified: `e_Velocity.e_Velocity_Idle`.
- `Object` (blunted) is called `BaseObject` in TS (clashes with the JS global).
- Access modifiers as in C++ (`public`/`protected`/`private`). If another class needs something
  C++ reached through `friend`, make it public and add `// PORT: public (was friend)`.
- Overloaded C++ methods: merge into one TS method with optional/union parameters when possible.
  Only if impossible, add a suffix describing the variant and note it with `// PORT:`.
- Default arguments stay default arguments.

## 3. Values, references and copies (read this twice)

### Vector3 / Quaternion are immutable
`src/blunted/base/math/vector3.ts` — `coords`/`elements` are readonly tuples and there are no
mutating methods. The compiler rejects in-place mutation, so convert every mutation to rebinding:

| C++                                   | TS                                              |
|---------------------------------------|-------------------------------------------------|
| `a + b`, `a - b`, `a * s`, `a * v`, `a / s`, `-a` | `a.Add(b)`, `a.Sub(b)`, `a.Mul(s)`, `a.Mul(v)`, `a.Div(s)`, `a.Neg()` |
| `v += w; v -= w; v *= s; v /= s`      | `v = v.Add(w)` etc.                             |
| `a == b`, `a != b`, `a < b`           | `a.Equals(b)`, `a.NotEquals(b)`, `a.LessThan(b)`|
| `v.coords[2] = 0;`                    | `v = v.WithCoord(2, 0);` (or `v = v.Get2D()`)   |
| `v.coords[0] += x;`                   | `v = v.WithCoord(0, v.coords[0] + x);`          |
| `v.Set(x, y, z)` / `v = 0` / `Vector3 v(0)` | `v = new Vector3(x, y, z)` / `v = new Vector3(0)` |
| `v.Normalize()` / `v.Normalize(ifNull)` | `v = v.GetNormalized()` / `v = v.GetNormalized(ifNull)` |
| `v.NormalizeTo(l)` / `v.NormalizeMax(l)` | `v = v.GetNormalizedTo(l)` / `v = v.GetNormalizedMax(l)` |
| `v.Rotate2D(a)` / `v.Rotate(q)`       | `v = v.GetRotated2D(a)` / `v = v.GetRotated(q)` |
| `v.Extrapolate(dir, t)`               | `v = v.GetExtrapolated(dir, t)`                 |
| `Vector3 v = quat;`                   | `Vector3.FromQuaternion(quat)`                  |
| `quat * vec` / `quat * quat2` / `quat * 0.5f` | `quat.MulVec(vec)` / `quat.Mul(quat2)` / `quat.Scale(0.5)` |
| `Quaternion q; q.SetAngleAxis(a, axis);` | `let q = Quaternion.FromAngleAxis(a, axis);` |
| `q.SetAngles(x, y, z)` / `q.GetAngles(x, y, z)` | `Quaternion.FromAngles(x, y, z)` / `const {X, Y, Z} = q.GetAngles()` |
| `q.GetAngleAxis(angle, axis)`         | `const { angle, axis } = q.GetAngleAxis()`      |
| `Quaternion q = vec;`                 | `Quaternion.FromVector(vec)`                    |
| `q.MakeSameNeighborhood(src)`         | `q = q.GetSameNeighborhood(src).quat` (`.dot` is the returned value) |
| `QUATERNION_IDENTITY`                 | `Quaternion.IDENTITY`                           |

Sharing Vector3/Quaternion instances is always safe.

### Structs and classes copied by value
C++ copies structs on assignment, when passing by value and when pushing into containers; TS
shares references. Wherever the C++ code copies a struct/class object **and either copy may be
modified afterwards**, clone it. Give ported structs a `Clone()` method (see `PlayerCommand`,
`PlayerImage`, `FormationEntry` in `gamedefines.ts`). Typical traps:
`PlayerImage img = mentalImage->GetPlayerImage(id); img.position = …` (must clone),
`anim = *currentAnim` style copies, `std::vector<Struct> copy = original;` (map clone).

### Out-parameters (non-const references / pointers written by the callee)
- Primitive, Vector3 or Quaternion out-params: return them. If the C++ function returns `void`
  and has exactly one out-param, return that value. Otherwise return an object whose keys are the
  **C++ parameter names**, plus `result` for the original return value:
  `bool Foo(int a, float &b, Vector3 &c)` → `Foo(a: number): { result: boolean; b: number; c: Vector3 }`.
- Containers passed by non-const reference to be filled (`std::vector<Player*> &players`):
  keep the parameter and push into it (arrays are references in TS). Also fine to return it.
- Structs passed by non-const reference to be modified: pass the object and mutate its fields.

### Pointers and smart pointers
`T*`, `boost::intrusive_ptr<T>`, `boost::shared_ptr<T>` → `T` (or `T | null` if it can be null).
`0`/`NULL` → `null`. `delete x` → drop (or call `x.Exit()` if the C++ destructor did work).
`static_pointer_cast<Geometry>(node->GetObject("x"))` → `node.GetObject('x') as Geometry`.

## 4. Standard library & boost

| C++                          | TS |
|------------------------------|----|
| `std::vector`, `std::list`, `std::deque` | `Array` (`.at(i)`→`[i]`, `.size()`→`.length`, `push_back`→`push`, `erase`→`splice`) |
| `std::map<K, V>`             | `Map<K, V>`. Iteration order matters in C++ (sorted by key): sort keys when iterating if the order affects behaviour. `std::map<Vector3, …>` → `Map<string, …>` keyed with `v.Key()` (or `Float32Key` for Float32Array data) |
| `std::sort(b, e, less)` / `list.sort(less)` | `arr.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0))` |
| `boost::circular_buffer<T>`  | `CircularBuffer<T>` (`blunted/base/circularbuffer.ts`) |
| `boost::signals2`, mutexes, `Lockable<T>`, threads | gone: single-threaded. `Lockable<T> x` → plain field; `x.GetData()`/`x->` → the field |
| `assert(x)`                  | `assert(x)` from `blunted/base/assert.ts` |
| `printf` debugging           | drop, or `console.debug` behind `Verbose()` |
| `fabs sqrt pow sin cos atan2 floor ceil std::min std::max` | `Math.*` |
| `round(x)`                   | `cround(x)` (bluntmath) — C rounds halves away from zero |
| `(int)x`, int division       | `Math.trunc(x)`, `Math.trunc(a / b)` — watch integer division of ints! |
| `x % y` on ints              | `%` (same sign semantics as C) |
| float literals `0.5f`        | `0.5` |
| `unsigned long time_ms`      | `number` |
| `std::string` ops            | JS strings; `int_to_str`, `real_to_str`, `tokenize`, `atof`, `atoi` in `blunted/base/utils.ts` |

## 5. Engine services

- Math helpers (`clamp`, `NormalizedClamp`, `random`, `fastrandom`, `curve`, `ModulateIntoRange`,
  `signSide`, `pi`, `radian`): `blunted/base/math/bluntmath.ts`.
- Globals: `GetScene3D()`, `GetConfiguration()`, `GetMenuTask()`, `GetDB()`, `GetControllers()`,
  `IsReleaseVersion()`, `Verbose()`, `SuperDebug()`, `GetDebugMode()`, `e_DebugMode`, debug pilons,
  `EnvironmentManager.GetInstance().GetTime_ms()`, `GetScheduler().GetTaskSequenceInfo('game')`,
  `PredictFrameTimeToGo_ms()`: `game/globals.ts`.
- `ObjectFactory::GetInstance().CreateObject(name, e_ObjectType_Camera)` → `new Camera(name)`
  (likewise `Geometry`, `Light`, `Sound`). `scene3D->CreateSystemObjects(obj)` → delete the call.
  `obj->Poke(e_SystemType_Audio)` on a Sound → `sound.Poke()` (starts playback).
- Resources: `ResourceManagerPool.GetInstance().FetchSurface(file)`, `.FetchGeometryData(file)`,
  `.FetchGeometryDataCopy(file, newName)`, `.FetchSoundBuffer(file)`, `.RegisterSurface(name, s)`.
- `ObjectLoader loader; loader.LoadObject(GetScene3D(), file)` → `new ObjectLoader().LoadObject(file)`.
- Scene graph: `Node`, `Geometry`, `Camera`, `Light`, `Sound` keep the C++ API
  (`AddNode`, `GetNode`, `GetNodes(out, recurse)`, `AddObject`, `GetObject(name)`,
  `GetObjects<T>(type, out, recurse)`, `SetPosition`, `GetDerivedPosition`, `SetLocalMode`, …).
  `Node(const Node &src, postfix, scene3D)` copy constructor → `Node.Copy(src, postfix)`.
  After editing a geometry's vertex arrays call `geometry.OnUpdateGeometryData(false)`.
- Geometry data: `MaterializedTriangleMesh.vertices` is a `Float32Array` with 5 blocks
  (positions, normals, texcoords, tangents, bitangents) of `verticesDataSize / 5` floats each,
  exactly as in C++. `GetTriangleMeshElementCount()` returns 5.
- Surfaces (textures): `Surface` in `blunted/scene/resources/surface.ts` (RGBA pixel buffer).
  Call `surface.MarkDirty()` after writing `surface.data`.
- Files: `FileSystem.GetText(path)`, `FileSystem.ListFiles(dir)` (replaces DirectoryParser),
  `file_to_string`, `file_to_vector` in `blunted/managers/filesystem.ts`. Paths are relative to
  the data root, as in C++ (`media/animations/…`). Everything is preloaded before a match starts,
  so these calls are synchronous.
- Keyboard: `UserEventManager.GetInstance().GetKeyboardState(SDLK_F1)` (`game/hid/usereventmanager.ts`).
- In-game GUI: `Gui2Caption`, `Gui2Image`, `Gui2WindowManager` (`game/ui/gui2.ts`), reached through
  `GetMenuTask().GetWindowManager()` like the original.
- SQL queries → `GetDB()` methods (`GetTeam(id)`, `GetPlayer(id)`, `GetTeamPlayerIDs(teamID, national)`).

## 6. Style

- Header comment on every ported file:
  `// Port of <legacy path>. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).`
- Keep the original comments that explain behaviour; drop commented-out dead code.
- Mark every intentional deviation from the C++ behaviour with a `// PORT:` comment.
- Use `import type` for imports only used as types. Classes form cycles (Match ↔ Team ↔ Player);
  runtime imports are fine as long as nothing *at module top level* uses the imported value
  (base classes in `extends` must not import their subclasses).
- `strict` TypeScript. Avoid `any`; `!` non-null assertions are fine where C++ assumed non-null.
- Performance matters in the per-frame hot paths (animation selection, AI): hoist loop-invariant
  vector math, avoid creating closures per iteration, but correctness first.
