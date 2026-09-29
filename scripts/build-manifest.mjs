// Generates public/data/manifest.json: a list of every asset file under public/data.
// The original engine enumerated directories at runtime (DirectoryParser); browsers
// cannot, so the game reads this manifest instead.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../public/data', import.meta.url).pathname;
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(relative(root, full).split(sep).join('/'));
  }
}
walk(root);
const out = files.filter((f) => f !== 'manifest.json');
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ files: out }, null, 0) + '\n');
console.log(`manifest: ${out.length} files`);
