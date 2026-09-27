import { describe, expect, test } from "bun:test";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";

/*
 * 依存の向きをテストで強制する。
 *
 *   presentation ─┐
 *                 ├─→ application ─→ domain
 *   infrastructure┘
 *
 * - domain / application はフレームワーク・DB・Bun のどれにも依存しない
 * - 他のコンテキストに触れてよいのは contract.ts だけで、触ってよいのは infrastructure（ACL）と module.ts だけ
 * - shared はどのモジュールにも依存しない。src 直下（コンポジションルート）は何に依存してもよい
 */

const srcDir = resolve(import.meta.dir, "../src");

type Place = { context: string; layer: string };

/** ファイルがどのコンテキストのどの層か。src/modules/<context>/<layer>/… か src/shared/<layer>/… */
function placeOf(file: string): Place {
  const [top, second, third] = relative(srcDir, file).split("/");
  if (top === "shared" && second) return { context: "shared", layer: second };
  if (top === "modules" && second && third) return { context: second, layer: third.replace(/\.ts$/, "") };
  return { context: "root", layer: "root" };
}

/** 各層が依存してよい層（同じコンテキスト内と shared に対して） */
const ALLOWED_LAYERS: Record<string, readonly string[]> = {
  domain: ["domain"],
  application: ["domain", "application", "contract"],
  infrastructure: ["domain", "application", "infrastructure"],
  presentation: ["domain", "application", "presentation"],
  contract: ["domain"],
  module: ["domain", "application", "infrastructure", "presentation", "contract"],
};

/** 各層が import してよい外部パッケージ */
const ALLOWED_PACKAGES: Record<string, (name: string) => boolean> = {
  domain: () => false,
  application: () => false,
  contract: () => false,
  presentation: (name) => name === "elysia" || name.startsWith("@elysiajs/"),
  infrastructure: () => true,
  module: () => true,
};

function packageName(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function resolveInternal(file: string, specifier: string): string | null {
  if (specifier.startsWith("#shared/")) return join(srcDir, "shared", specifier.slice("#shared/".length));
  if (specifier.startsWith("#modules/")) return join(srcDir, "modules", specifier.slice("#modules/".length));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return null;
}

/** file から specifier を import してよいか。だめなら理由を返す */
function checkImport(file: string, specifier: string): string | null {
  const from = placeOf(file);
  if (from.context === "root") return null;
  const target = resolveInternal(file, specifier);
  if (target === null) {
    const name = packageName(specifier);
    return ALLOWED_PACKAGES[from.layer]?.(name) ? null : `${from.layer} は外部パッケージ ${name} に依存できない`;
  }
  const to = placeOf(target);
  if (to.context === "root") return "コンポジションルート（src 直下）には依存できない";
  if (from.context === "shared" && to.context !== "shared") return "shared はモジュールに依存できない";
  if (to.context !== "shared" && to.context !== from.context) {
    if (to.layer !== "contract") return `${to.context} の内部（${to.layer}）には依存できない。contract.ts を使う`;
    if (from.layer !== "infrastructure" && from.layer !== "module") {
      return `${from.layer} から他のコンテキストには依存できない。infrastructure に ACL を置く`;
    }
    return null;
  }
  return ALLOWED_LAYERS[from.layer]?.includes(to.layer) ? null : `${from.layer} は ${to.layer} に依存できない`;
}

const IMPORT =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
/** 純粋であるべき層で、時計・乱数・環境に直接触れていないか（Clock / IdGenerator を通す） */
const IMPURE = /\bDate\.now\(|\bnew Date\(\)|\bMath\.random\(|\bBun\.|\bprocess\./;

const sources = await Promise.all(
  [...new Glob("**/*.ts").scanSync(srcDir)]
    .filter((path) => !path.endsWith(".test.ts"))
    .map(async (path) => ({ file: join(srcDir, path), code: await Bun.file(join(srcDir, path)).text() })),
);

describe("アーキテクチャ", () => {
  test("依存の向きが守られている", () => {
    const violations = sources.flatMap(({ file, code }) =>
      [...code.matchAll(IMPORT)].flatMap((match) => {
        const specifier = match[1] ?? match[2] ?? "";
        const reason = checkImport(file, specifier);
        return reason ? [`${relative(srcDir, file)}: "${specifier}" — ${reason}`] : [];
      }),
    );
    expect(violations).toEqual([]);
  });

  test("domain と application は時計・乱数・実行環境に直接触れない", () => {
    const violations = sources
      .filter(({ file }) => ["domain", "application"].includes(placeOf(file).layer))
      .filter(({ code }) => IMPURE.test(code))
      .map(({ file }) => relative(srcDir, file));
    expect(violations).toEqual([]);
  });

  test("検査そのものが効いている（ルール違反を見逃さない）", () => {
    const at = (path: string) => join(srcDir, path);
    expect(sources.length).toBeGreaterThan(30);
    expect(checkImport(at("modules/ordering/domain/order.ts"), "drizzle-orm")).not.toBeNull();
    expect(checkImport(at("modules/ordering/application/x.ts"), "elysia")).not.toBeNull();
    expect(checkImport(at("modules/ordering/domain/order.ts"), "../infrastructure/schema")).not.toBeNull();
    expect(checkImport(at("modules/ordering/presentation/routes.ts"), "../infrastructure/schema")).not.toBeNull();
    expect(checkImport(at("modules/ordering/infrastructure/x.ts"), "#modules/catalog/domain/product")).not.toBeNull();
    expect(checkImport(at("modules/ordering/application/x.ts"), "#modules/catalog/contract")).not.toBeNull();
    expect(checkImport(at("modules/ordering/infrastructure/x.ts"), "#modules/catalog/contract")).toBeNull();
    expect(checkImport(at("shared/domain/x.ts"), "#modules/catalog/contract")).not.toBeNull();
    expect(checkImport(at("modules/catalog/application/x.ts"), "../module")).not.toBeNull();
  });
});
