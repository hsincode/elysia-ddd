import { afterAll, describe, expect, test } from "bun:test";
import { startTestSystem } from "#test/support/test-system";

// 本文の上限は Bun のサーバーが受け取る段階で効くので、ここだけは実際にポートを開く
const system = await startTestSystem({ MAX_BODY_BYTES: "4096" });
system.app.listen(0);
const base = system.app.server?.url;
afterAll(async () => {
  await system.app.stop();
  await system.close();
});

describe("HTTP の土台", () => {
  test("上限を超える本文は、パースする前に 413 で断る", async () => {
    const response = await fetch(new URL("/products", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(8192), price: 1 }),
    });
    expect(response.status).toBe(413);
  });

  test("x-request-id は引き継ぎ、無ければ振る", async () => {
    const given = await fetch(new URL("/health", base), { headers: { "x-request-id": "trace-123" } });
    expect(given.headers.get("x-request-id")).toBe("trace-123");
    const assigned = await fetch(new URL("/health", base));
    expect(assigned.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("知らない経路は Problem Details の 404", async () => {
    const response = await fetch(new URL("/nowhere", base));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ type: "about:blank", title: "Not found", status: 404 });
  });
});
