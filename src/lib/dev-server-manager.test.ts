import { describe, it, expect, vi } from "vitest";

// Mock child_process and net for isolation
vi.mock("child_process", () => ({
  spawn: vi.fn(() => { throw new Error("mock spawn"); }),
  execSync: vi.fn(() => { throw new Error("no output"); }),
}));

vi.mock("net", () => ({
  createConnection: vi.fn(() => {
    const ee = {
      on: vi.fn((event: string, cb: () => void) => {
        // Simulate port free (error callback fires)
        if (event === "error") setTimeout(cb, 0);
        return ee;
      }),
      setTimeout: vi.fn(() => ee),
      destroy: vi.fn(),
    };
    return ee;
  }),
}));

import { getServer, getStatus, checkPort, findPidByPort, killByPort, addLogListener } from "./dev-server-manager";

describe("dev-server-manager", () => {
  describe("getServer", () => {
    it("returns undefined for unknown cwd", () => {
      expect(getServer("/nonexistent/path")).toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns stopped for unknown cwd", () => {
      const status = getStatus("/some/unknown/path");
      expect(status.status).toBe("stopped");
      expect(status.port).toBe(0);
      expect(status.url).toBeNull();
      expect(status.error).toBeNull();
      expect(status.pid).toBeNull();
    });
  });

  describe("checkPort", () => {
    it("returns false for free port (mocked)", async () => {
      // Our mock triggers error callback → port is free
      const result = await checkPort(3000);
      expect(result).toBe(false);
    });
  });

  describe("findPidByPort", () => {
    it("returns null when execSync throws", () => {
      // execSync mock throws → no PID
      const pid = findPidByPort(3000);
      expect(pid).toBeNull();
    });
  });

  describe("killByPort", () => {
    it("returns not killed when no PID found", async () => {
      const result = await killByPort(9999);
      expect(result.killed).toBe(false);
    });
  });

  describe("addLogListener", () => {
    it("returns null for unknown cwd", () => {
      expect(addLogListener("/unknown", () => {})).toBeNull();
    });
  });
});
