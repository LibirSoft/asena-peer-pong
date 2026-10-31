import { defineConfig } from '@asenajs/asena-cli';

export default defineConfig({
  sourceFolder: 'src',
  rootFile: 'src/index.ts',
  // Browser code lives OUTSIDE src/ (the IoC scanner imports every file in src/).
  // @FrontendController pages are HTML imports; they must be copied next to the bundle.
  // web/app.ts imports src/game/* (shared with the server) and Bun bundles the page
  // at runtime, so that folder has to ship next to the bundle too.
  include: ['web', 'src/game'],
  buildOptions: {
    outdir: 'dist',
    sourcemap: 'linked',
    // identifiers MUST stay false: Asena registers components by class name.
    minify: { whitespace: true, syntax: true, identifiers: false },
  },
});
