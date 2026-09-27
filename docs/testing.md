# テスト

```sh
bun test                                                   # PGlite（メモリ上の PostgreSQL）で全部
docker compose up -d
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app bun test   # 実際の PostgreSQL で全部（同時実行のテストも動く）
bun run check                                              # 型検査 + Biome + テスト
```

## 層ごとのテスト

| 種類 | 場所 | 使うもの | 確かめること |
| --- | --- | --- | --- |
| ドメイン | `src/modules/*/domain/*.test.ts` | 関数を呼ぶだけ | 不変条件、状態遷移表の全組み合わせ（5 状態 × 5 操作）、時刻の境界、値オブジェクトの正規化 |
| ユースケース | `src/modules/*/application/*.test.ts` | インメモリの fake（`test/support/fakes.ts`） | 依頼の検査の順序、イベントの重複や順序の入れ替わりへの強さ |
| 結合 | `test/integration/` | 実際の DB | UnitOfWork とセーブポイント、Outbox の配送（順序・購読ごとの記録・デッドレター）、デッドロックの読み替え、2 インスタンスの同時実行 |
| API | `test/api/` | 本番と同じ組み立て + Eden Treaty | HTTP の契約、Saga の各経路、冪等キー、本文の上限 |
| アーキテクチャ | `test/architecture.test.ts` | import の走査 | 依存の向き、domain・application が時計・乱数・実行環境に触れていないこと |

実際の PostgreSQL でだけ動くテストが 2 つある（デッドロックの読み替えと、2 インスタンスの同時実行）。PGlite は接続が 1 本で文が順に流れるので、本当の同時実行にならない。

## 書き方

**時間は動かす**。`fixedClock()` は手で進める時計で、テストは `clock.advance(ms)` で時間を進める。期限切れのテストは「15 分の 1 ミリ秒前」と「ちょうど」を両方突く。

**イベントはテストが流す**。テスト用の組み立て（`startTestSystem`）は定期ジョブを動かさない。配送は `relay.drain()`、ジョブは `runJob(name)` をテストが呼ぶので、「配送の前」と「後」をそれぞれ確かめられる。

```ts
const placed = await placeOrder([{ productId: beans.id, quantity: 2 }]);
expect(placed.status).toBe("placed");
await relay.drain(); // OrderPlaced → 引当 → StockReserved → 確定 までが流れる
expect((await orderOf(placed.id)).status).toBe("confirmed");
```

**fake はポートの約束を守らせる**。インメモリのリポジトリも、楽観ロックの衝突を DB と同じように `ConcurrencyError` にする。fake が DB より甘いと、テストが通って本番で落ちる。

**ブランド型は素の値に落として比べる**。`bun:test` の `toBe` / `toEqual` は実際の値の型に縛られるので、`expect<number>(order.total).toBe(2700)` のように型を広げるか、Err の中身を `unknown` にして比べる。

**失敗はイベントの持ち越しを生む**。API のテストは同じ DB を使い回すので、あるテストが配送しないまま落ちると、次のテストの `drain()` の件数がずれる。`ordering.test.ts` は `beforeEach` で配送を済ませてから始める。

## 依存の向きのテスト

`test/architecture.test.ts` は `src/` の全ファイルの import を読み、層の表（[architecture.md](architecture.md)）に照らして違反を並べる。検査そのものが効いているかも、わざと違反する import を渡して確かめている。

```
modules/ordering/domain/order.ts: "drizzle-orm" — domain は外部パッケージ drizzle-orm に依存できない
modules/ordering/infrastructure/x.ts: "#modules/catalog/domain/product" — catalog の内部（domain）には依存できない。contract.ts を使う
```
