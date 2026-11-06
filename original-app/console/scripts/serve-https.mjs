import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLanIp } from "./lan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const certsDir = path.join(appRoot, "certs");
const keyFile = path.join(certsDir, "server.key");
const certFile = path.join(certsDir, "server.crt");

if (!existsSync(keyFile) || !existsSync(certFile)) {
  console.error("No HTTPS certificate found.");
  console.error("Run `npm run android:cert` first.");
  process.exit(1);
}

const lan = getLanIp();
const httpsPort = Number(process.env.HTTPS_PORT ?? 3443);
const targetPort = Number(process.env.APP_PORT ?? 3000);

const server = createServer(
  {
    key: readFileSync(keyFile),
    cert: readFileSync(certFile),
  },
  (req, res) => {
    const headers = {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      "x-forwarded-proto": "https",
      "x-forwarded-host": req.headers.host ?? "",
    };

    const proxy = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      }
    );

    proxy.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `Aegis HTTPS proxy could not reach the app on port ${targetPort}.\n` +
          `Start it with: npm start\n\n${error.message}`
      );
    });

    req.pipe(proxy);
  }
);

server.listen(httpsPort, "0.0.0.0", () => {
  console.log(`Aegis HTTPS server listening on 0.0.0.0:${httpsPort}`);
  console.log(`Phone:  https://${lan}:${httpsPort}/trail`);
  console.log(`Local:  https://localhost:${httpsPort}/trail`);
  console.log(`CA:     http://${lan}:${targetPort}/aegis-ca.crt`);
  console.log(`Proxy target: http://127.0.0.1:${targetPort}`);
});
