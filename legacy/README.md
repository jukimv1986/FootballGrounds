# Legacy C++ sources

The original GameplayFootball C++ game (Blunted2 engine, SDL2/OpenGL/OpenAL/Boost), kept for
reference: every file in `../src/game` and `../src/blunted` is a port of a file here with the
same class and method names (see `../docs/PORTING.md`).

The game data moved to `../public/data`. To build the old game anyway (Linux):

```bash
sudo apt-get install git cmake build-essential libgl1-mesa-dev libsdl2-dev libsdl2-image-dev \
  libsdl2-ttf-dev libsdl2-gfx-dev libopenal-dev libboost-all-dev libsqlite3-dev
cd legacy && mkdir -p build && cp -R ../public/data/. build && cd build
cmake .. && make -j$(nproc) && ./gameplayfootball
```
