import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

const host = process.env.BETTER_AUTH_HOST ?? "127.0.0.1";
const port = Number(process.env.BETTER_AUTH_PORT ?? 3001);
const authHandler = toNodeHandler(auth.handler);

createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }
  authHandler(request, response);
}).listen(port, host, () => {
  console.log(`Better Auth listening on http://${host}:${port}`);
});