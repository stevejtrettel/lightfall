# GitHub Pages — outstanding work

This repo builds all its demos into one static site with a shared three.js chunk
(`npm run build:all` → `dist-pages/`), deployed by
`.github/workflows/pages.yml` on every push to `main`.

**Live:** https://stevejtrettel.github.io/lightfall/ (8 demos)

## Lockfile drift makes CI fall back to `npm install`

The workflow runs `npm ci || npm install`. `npm ci` fails here because
`@rolldown/binding-wasm32-wasi` (vite 7's WASM bundler fallback) pulls
`@emnapi/*` optional deps that npm resolves differently on macOS/arm64 than on
the Linux/x64 runner. The lockfile has been resynced, so `npm ci` works locally,
but CI still needs the fallback.

Cost is ~4s of a ~32s run, so this is optional. To fix it properly the lockfile
must be generated on Linux:

```bash
docker run --rm -v "$PWD":/w -w /w node:22 npm install --package-lock-only
git commit -am "Regenerate lockfile on Linux"
```

Then `npm ci || npm install` can be tightened back to `npm ci`.

---

Setup mirrored from `stevejtrettel/threejs-demos`. To re-sync the build script
and workflow after a change there:

```bash
node ../threejs-demos/scripts/add-pages.mjs ../lightfall
```
