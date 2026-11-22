// Collects the static site for Vercel into dist/public: the page, its styles, the compiled
// browser code and the two vendor libraries (which the local server reads from node_modules).
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist/public';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/vendor/gridstack`, { recursive: true });
await mkdir(`${out}/vendor/lightweight-charts`, { recursive: true });

await cp('public/index.html', `${out}/index.html`);
await cp('public/app.css', `${out}/app.css`);
await cp('dist/js', `${out}/js`, { recursive: true });

for (const f of ['gridstack.min.css', 'gridstack-extra.min.css', 'gridstack-all.js']) {
  await cp(`node_modules/gridstack/dist/${f}`, `${out}/vendor/gridstack/${f}`);
}
await cp(
  'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js',
  `${out}/vendor/lightweight-charts/lightweight-charts.standalone.production.js`,
);
console.log(`Static site written to ${out}`);
