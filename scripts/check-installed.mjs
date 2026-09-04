import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Read-only: never replace the user's loaded extension. Different local
// fixes must be reviewed before either copy is changed.
const installed = process.argv[2];
if (!installed) {
  console.error('Usage: npm run check:installed -- /absolute/path/to/loaded-extension');
  process.exitCode = 1;
} else {
  const source = resolve('extension');
  const target = resolve(installed);
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  const files = [...new Set(['manifest.json', 'content.js', 'compare-engine.js', 'service-worker.js', 'zip-store.js',
    'popup.html', 'popup.css', 'popup.js', ...Object.values(manifest.icons),
    ...['html', 'xlsx', 'zip'].map(format => `previews/${format}-preview@2x.png`)])];
  const differences = [];
  for (const file of files) {
    const expected = await readFile(join(source, file));
    try {
      if (!expected.equals(await readFile(join(target, file)))) differences.push(`${file}: differs`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      differences.push(`${file}: missing`);
    }
  }
  if (differences.length) {
    console.error('Loaded extension differs from source:\n' + differences.join('\n'));
    process.exitCode = 1;
  } else console.log(`All ${files.length} runtime files match: ${target}`);
}
