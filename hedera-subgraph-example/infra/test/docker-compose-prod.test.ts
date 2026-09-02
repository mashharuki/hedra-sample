import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const composePath = fileURLToPath(
  new URL("../../deploy/docker-compose.prod.yaml", import.meta.url),
);
const compose = parse(readFileSync(composePath, "utf8")) as {
  name?: string;
  services: Record<string, { ports?: string[]; restart?: string }>;
};

describe("docker-compose.prod.yaml security posture", () => {
  const allPorts = Object.values(compose.services).flatMap((s) => s.ports ?? []);

  it("exposes exactly one port to all interfaces, and it is 8000", () => {
    const worldOpen = allPorts.filter((p) => !p.startsWith("127.0.0.1:"));
    expect(worldOpen).toEqual(["8000:8000"]);
  });

  it("binds every admin port to loopback only", () => {
    const admin = allPorts.filter((p) => p !== "8000:8000");
    expect(admin.length).toBeGreaterThanOrEqual(6);
    for (const p of admin) {
      expect(p.startsWith("127.0.0.1:")).toBe(true);
    }
  });

  it("restarts every service unless explicitly stopped", () => {
    for (const svc of Object.values(compose.services)) {
      expect(svc.restart).toBe("unless-stopped");
    }
  });
});
