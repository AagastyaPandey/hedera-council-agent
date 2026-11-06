import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLanIp } from "./lan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const certsDir = path.join(appRoot, "certs");
const publicDir = path.join(appRoot, "public");
const lan = getLanIp();
const force = process.argv.includes("--force");

const caKey = path.join(certsDir, "ca.key");
const caCrt = path.join(certsDir, "ca.crt");
const serverKey = path.join(certsDir, "server.key");
const serverCrt = path.join(certsDir, "server.crt");
const serverCsr = path.join(certsDir, "server.csr");
const config = path.join(certsDir, "openssl.cnf");
const lanFile = path.join(certsDir, "lan.txt");

function findOpenSSL() {
  const candidates = [
    process.env.OPENSSL_BIN,
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "openssl",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "OpenSSL not found. Set OPENSSL_BIN to the openssl executable (Git for Windows includes one)."
  );
}

const openssl = findOpenSSL();

function run(args) {
  try {
    execFileSync(openssl, args, { cwd: certsDir, stdio: "pipe" });
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : "";
    throw new Error(`openssl ${args[0]} failed\n${stderr}`);
  }
}

mkdirSync(certsDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const existingLan = existsSync(lanFile) ? readFileSync(lanFile, "utf8").trim() : null;
const complete = [caKey, caCrt, serverKey, serverCrt].every((file) => existsSync(file));

if (complete && !force && existingLan === lan) {
  copyFileSync(caCrt, path.join(publicDir, "aegis-ca.crt"));
  console.log(`Certificates already exist for ${lan}.`);
  console.log(`Phone CA: http://${lan}:3000/aegis-ca.crt`);
  console.log(`App:      https://${lan}:3443/trail`);
  console.log("Use --force to regenerate after changing networks.");
  process.exit(0);
}

if (complete && existingLan !== lan) {
  console.log(
    `Network changed from ${existingLan ?? "unknown"} to ${lan}; regenerating the local CA.`
  );
  console.log("Reinstall the new CA on the phone before opening the HTTPS app.");
}

writeFileSync(
  config,
  `[req]
distinguished_name=dn
req_extensions=req_ext
prompt=no

[dn]
CN=AEGIS Local

[req_ext]
subjectAltName=@alt

[v3_req]
subjectAltName=@alt
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth

[alt]
DNS.1=localhost
IP.1=127.0.0.1
IP.2=${lan}
`,
  "utf8"
);

run([
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  caKey,
  "-out",
  caCrt,
  "-days",
  "3650",
  "-subj",
  "/CN=AEGIS-Local-CA",
  "-addext",
  "basicConstraints=critical,CA:TRUE",
  "-addext",
  "keyUsage=critical,keyCertSign,cRLSign",
]);

run([
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  serverKey,
  "-out",
  serverCsr,
  "-config",
  config,
]);

run([
  "x509",
  "-req",
  "-in",
  serverCsr,
  "-CA",
  caCrt,
  "-CAkey",
  caKey,
  "-CAcreateserial",
  "-out",
  serverCrt,
  "-days",
  "825",
  "-extfile",
  config,
  "-extensions",
  "v3_req",
]);

rmSync(serverCsr, { force: true });
writeFileSync(lanFile, `${lan}\n`, "utf8");
copyFileSync(caCrt, path.join(publicDir, "aegis-ca.crt"));

console.log(`Local CA and server certificate created for ${lan}.`);
console.log(`Phone CA:   http://${lan}:3000/aegis-ca.crt`);
console.log(`HTTPS app:  https://${lan}:3443/trail`);
console.log("The CA private key stays in console/certs and is not committed.");
