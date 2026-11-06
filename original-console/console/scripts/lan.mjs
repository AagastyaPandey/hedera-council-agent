import os from "node:os";

export function getLanIp() {
  const candidates = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push(address.address);
      }
    }
  }

  return (
    process.env.LAN_IP ||
    candidates.find((value) => value.startsWith("192.168.")) ||
    candidates.find((value) => value.startsWith("10.")) ||
    candidates.find((value) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) ||
    candidates[0] ||
    "127.0.0.1"
  );
}
