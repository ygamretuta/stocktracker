// Vercel function: serves every /api/* route through the shared handler (see vercel.json).
// The handler is compiled to dist/api by `npm run build:vercel`.
import { handleApi } from '../dist/api/handler.js';

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://local');
  // The rewrite sends /api/<route> here with the route in ?path=. Rebuild the real path.
  if (url.pathname === '/api/index' || url.pathname === '/api') {
    url.pathname = `/api/${url.searchParams.get('path') ?? ''}`;
  }
  url.searchParams.delete('path');
  return handleApi(req, res, url);
}
