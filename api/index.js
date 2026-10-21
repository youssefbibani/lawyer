// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The server is compiled to dist-server/ during the build (`npm run build:vercel`), then imported from here.
export { default } from "../dist-server/server/vercel-handler.js";
