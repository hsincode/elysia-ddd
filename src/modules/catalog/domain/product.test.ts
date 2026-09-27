import { describe, expect, test } from "bun:test";
import { unwrap } from "#shared/domain/result";
import { ProductName } from "./product";

describe("ProductName", () => {
  test("NFC に正規化し、前後の空白（全角を含む）を落とす", () => {
    // 「か」+ 結合用濁点 と「が」を同じ名前として扱う
    expect<string>(unwrap(ProductName.of("　がふぇ　"))).toBe("がふぇ");
  });

  test("長さは見た目の文字数で数える（絵文字の家族も 1 文字）", () => {
    expect(ProductName.of("👨‍👩‍👧".repeat(100)).ok).toBe(true);
    expect(ProductName.of("👨‍👩‍👧".repeat(101))).toMatchObject({ ok: false, error: { reason: "too_long" } });
  });

  test("空白だけ・制御文字入りは受け付けない", () => {
    expect(ProductName.of(" 　 ")).toMatchObject({ ok: false, error: { reason: "empty" } });
    expect(ProductName.of("改行\nあり")).toMatchObject({ ok: false, error: { reason: "control_character" } });
    expect(ProductName.of("NUL\u0000")).toMatchObject({ ok: false, error: { reason: "control_character" } });
  });
});
