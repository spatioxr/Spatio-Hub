import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('pdfjs-dist/package.json');
const pdfRoot = dirname(packagePath);
const { version } = require(packagePath);

// PDF.js fetches these resources by their original names. Serve/copy only this
// explicit package inventory, keeping fonts, CMaps and image decoders on our origin.
export function policyPdfAssets() {
  let files;
  const inventory = async () => {
    if (files) return files;
    files = new Map([[`pdf-reader-assets/${version}/LICENSE`, join(pdfRoot, 'LICENSE')]]);
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
      for (const file of await readdir(join(pdfRoot, directory), { withFileTypes: true })) {
        if (file.isFile()) files.set(`pdf-reader-assets/${version}/${directory}/${file.name}`, join(pdfRoot, directory, file.name));
      }
    }
    return files;
  };
  return {
    name: 'policy-pdf-assets',
    async configureServer(server) {
      const resources = await inventory();
      server.middlewares.use(async (request, response, next) => {
        const resource = request.url?.split('?')[0].replace(/^\//, '');
        const path = resources.get(resource);
        if (!path || !['GET', 'HEAD'].includes(request.method)) return next();
        try {
          const data = await readFile(path);
          response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      for (const [fileName, path] of await inventory()) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(path) });
      }
    },
  };
}
