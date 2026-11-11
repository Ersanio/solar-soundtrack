// A dependency-free static server for a built copy of the app, on a free port of its own.
// Usage: node scripts/drive/serve.mjs [dist-dir] [--port <n>]
//
// It serves the directory under the `<base href>` its `index.html` declares, so a build made with
// `--base-href=/name/` is reached at `/name/` exactly as the deployed one is. A path with no file
// behind it answers with `index.html` when it has no extension and 404 when it has one, so a
// missing asset stays visible. The port is the operating system's choice unless `--port` names
// one, and the URL is printed on the first line of stdout.
import console from 'node:console';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where `npm run build` writes the app. */
export const DEFAULT_DIST = join(root, 'web', 'dist', 'solar-soundtrack', 'browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  // The driver image, the sample bank and anything else with no type of its own.
  '': 'application/octet-stream',
};

/** The `<base href>` a build's `index.html` declares, with a slash at both ends. */
function baseOf(index) {
  const href = /<base\s+href="([^"]*)"/i.exec(index)?.[1] ?? '/';
  const path = href.startsWith('/') ? href : `/${href}`;
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Starts serving `dir`. Resolves with the URL to open, the base path, and a `close`.
 *
 * Bound to the loopback address only: this is a private server for one driver run.
 */
export function startServer({ dir = DEFAULT_DIST, port = 0 } = {}) {
  const dist = resolve(dir);
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) {
    return Promise.reject(
      new Error(
        `no index.html in ${dist}\n` +
          'Build the app first (in a worktree if a dev server may be running; see ' +
          '.claude/skills/drive-the-app/SKILL.md), or pass the directory that holds index.html.',
      ),
    );
  }

  const base = baseOf(readFileSync(indexPath, 'utf8'));

  const server = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (path === base.slice(0, -1)) {
      response.writeHead(302, { location: base }).end();
      return;
    }

    if (!path.startsWith(base)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`outside ${base}`);
      return;
    }

    const file = normalize(join(dist, path.slice(base.length)));
    if (file !== dist && !file.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }

    let target = file;
    if (!existsSync(target) || !statSync(target).isFile()) {
      if (extname(path) !== '') {
        response.writeHead(404, { 'content-type': 'text/plain' }).end(`no such file: ${path}`);
        return;
      }

      target = indexPath;
    }

    response.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? MIME[''],
      'content-length': statSync(target).size,
      'cache-control': 'no-store',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(target).pipe(response);
  });

  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      done({
        url: `http://127.0.0.1:${bound}${base}`,
        port: bound,
        base,
        dir: dist,
        close: () =>
          new Promise((closed) => {
            server.close(() => closed());
            server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--port');
  const port = at >= 0 ? Number(args.splice(at, 2)[1]) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('usage: serve.mjs [dist-dir] [--port <n>]');
    process.exit(2);
  }

  try {
    const server = await startServer({ dir: args[0] ?? DEFAULT_DIST, port });
    console.log(server.url);
    console.error(`serving ${server.dir} under ${server.base}; Ctrl+C stops it`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
