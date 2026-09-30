// Port of blunted/managers/resourcemanagerpool + resourcemanager<T>.
// Resources are cached by FILE NAME (not path), exactly like the original engine.
//
// C++ -> TS:
//   ResourceManagerPool::GetInstance().GetManager<Surface>(e_ResourceType_Surface)->Fetch(f)
//     -> ResourceManagerPool.GetInstance().FetchSurface(f)
//   ...GetManager<GeometryData>(...)->Fetch(f)           -> FetchGeometryData(f)
//   ...GetManager<GeometryData>(...)->FetchCopy(f, name) -> FetchGeometryDataCopy(f, name)
//   ...GetManager<SoundBuffer>(...)->Fetch(f)            -> FetchSoundBuffer(f)

import { Log, e_Warning } from '../base/log';
import { get_file_name } from '../base/utils';
import { ASELoader } from '../loaders/aseloader';
import { GeometryData } from '../scene/resources/geometrydata';
import { Resource } from '../scene/resources/resource';
import { SoundBuffer } from '../scene/resources/soundbuffer';
import { Surface } from '../scene/resources/surface';
import { FileSystem } from './filesystem';

export class ResourceManagerPool {
  private static instance: ResourceManagerPool | null = null;

  static GetInstance(): ResourceManagerPool {
    if (!ResourceManagerPool.instance) ResourceManagerPool.instance = new ResourceManagerPool();
    return ResourceManagerPool.instance;
  }

  protected surfaces = new Map<string, Resource<Surface>>();
  protected geometries = new Map<string, Resource<GeometryData>>();
  protected sounds = new Map<string, Resource<SoundBuffer>>();
  protected aseLoader = new ASELoader((f) => this.FetchSurface(f));

  /** image file -> Surface. Missing files resolve by file name, else a white placeholder. */
  FetchSurface(filename: string, load = true, useExisting = true): Resource<Surface> {
    const key = get_file_name(filename);
    if (useExisting) {
      const found = this.surfaces.get(key);
      if (found) return found;
    }
    let surface: Surface;
    if (!load) {
      surface = Surface.Create(1, 1, [255, 255, 255, 255]);
    } else {
      const path = FileSystem.Resolve(filename);
      const image = path ? FileSystem.GetImage(path) : null;
      if (image) {
        surface = Surface.FromImage(image);
      } else {
        if (!path) Log(e_Warning, 'ResourceManager<Surface>', 'Fetch', `image not found: ${filename}`);
        surface = Surface.Create(1, 1, [255, 255, 255, 255]);
      }
    }
    const resource = new Resource(key, surface);
    this.surfaces.set(key, resource);
    return resource;
  }

  /** registers a generated surface under a name (replaces an existing one) */
  RegisterSurface(name: string, surface: Surface): Resource<Surface> {
    const key = get_file_name(name);
    const existing = this.surfaces.get(key);
    if (existing) {
      existing.resource = surface;
      return existing;
    }
    const resource = new Resource(key, surface);
    this.surfaces.set(key, resource);
    return resource;
  }

  /** .ase file -> GeometryData */
  FetchGeometryData(filename: string, load = true, useExisting = true): Resource<GeometryData> {
    const key = get_file_name(filename);
    if (useExisting) {
      const found = this.geometries.get(key);
      if (found) return found;
    }
    const data = new GeometryData();
    if (load) {
      const path = FileSystem.Resolve(filename);
      if (path) this.aseLoader.Load(FileSystem.GetText(path), data);
      else Log(e_Warning, 'ResourceManager<GeometryData>', 'Fetch', `model not found: ${filename}`);
    }
    const resource = new Resource(key, data);
    this.geometries.set(key, resource);
    return resource;
  }

  /** deep copy of a geometry resource under a new name (returns the existing one if the name is taken) */
  FetchGeometryDataCopy(filename: string, newName: string): Resource<GeometryData> {
    const existing = this.geometries.get(newName);
    if (existing) return existing;
    const source = this.FetchGeometryData(filename);
    const resource = new Resource(newName, source.GetResource().Clone());
    this.geometries.set(newName, resource);
    return resource;
  }

  FetchSoundBuffer(filename: string): Resource<SoundBuffer> {
    const key = get_file_name(filename);
    const found = this.sounds.get(key);
    if (found) return found;
    const buffer = new SoundBuffer();
    buffer.filename = filename;
    const path = FileSystem.Resolve(filename);
    if (path) {
      try {
        buffer.bytes = FileSystem.GetBinary(path);
      } catch {
        Log(e_Warning, 'ResourceManager<SoundBuffer>', 'Fetch', `sound not preloaded: ${filename}`);
      }
    }
    const resource = new Resource(key, buffer);
    this.sounds.set(key, resource);
    return resource;
  }

  /** drops cached geometry copies/surfaces whose name matches (e.g. per-match player copies) */
  Purge(filter?: (name: string) => boolean): void {
    for (const map of [this.surfaces, this.geometries, this.sounds] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (!filter || filter(key)) map.delete(key);
    }
  }
}
