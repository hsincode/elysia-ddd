# elysia-ddd

Bun + ElysiaJS で DDD をやるためのテンプレート。カタログ・在庫・注文の 3 つの境界づけられたコンテキストを、1 つのプロセス（モジュラーモノリス）で動かす。

- **ドメイン**: 状態遷移表で動く注文の集約、在庫の引当（全部か無しか）を決めるドメインサービス、正規化まで面倒を見る値オブジェクト
- **コンテキスト間**: 同期の問い合わせは腐敗防止層（ACL）越し、非同期はイベント。注文と在庫はコレオグラフィ型の Saga で確定・却下・取消（補償）・期限切れを回す
- **信頼性**: Transactional Outbox（集約ごとの順序保証、購読ごとの配送記録、指数バックオフ、デッドレター）、冪等キー、楽観ロックと悲観ロックの使い分け、デッドロックの読み替え
- **守り**: 依存の向きを `test/architecture.test.ts` が強制し、エッジケースを 102 件のテストが確かめる（うち 2 件は実 PostgreSQL での同時実行）
- **手軽さ**: Docker 無しで `bun run dev` と `bun test` が動く（PGlite = WASM 版 PostgreSQL）。本番は `DATABASE_URL` を渡すと Bun.SQL で PostgreSQL に繋ぐ

設計の解説は [docs/](docs/README.md) にある。図と表を 1 ページにまとめた解説ページ「elysia-ddd 設計図」: https://claude.ai/artifact/Ugk4eEJhwMfPN9omzAeHak

## 動かす

```sh
bun install
bun run dev    # http://localhost:3000 、API ドキュメントは http://localhost:3000/openapi
```

```sh
# 商品を登録して入荷し、注文する
P=$(curl -s -X POST localhost:3000/products -H 'content-type: application/json' \
  -d '{"name":"コーヒー豆","price":1200}' | jq -r .id)
curl -s -X POST localhost:3000/inventory/$P/receipts -H 'content-type: application/json' -d '{"quantity":10}'
O=$(curl -s -X POST localhost:3000/orders -H 'content-type: application/json' -H "idempotency-key: order-$P" \
  -d "{\"customerId\":\"0199a000-0000-7000-8000-000000000001\",\"lines\":[{\"productId\":\"$P\",\"quantity\":2}]}" | jq -r .id)

# 受け付けた直後は placed。在庫を引き当てるイベントが流れると（デフォルトで 500ms ごと）confirmed になる
curl -s localhost:3000/orders/$O | jq .status
sleep 1
curl -s localhost:3000/orders/$O | jq .status
curl -s -X POST localhost:3000/orders/$O/ship -H 'content-type: application/json' \
  -d '{"trackingNumber":"JP1234-5678"}' | jq .status
sleep 1
curl -s localhost:3000/inventory/$P    # onHand 8、reserved 0
```

PostgreSQL で動かすときは `docker compose up -d` のあと `DATABASE_URL=postgres://app:app@localhost:5432/app bun run dev`。

| コマンド | 内容 |
| --- | --- |
| `bun run check` | 型検査（tsc）+ Biome + テスト |
| `bun test` | テスト。`TEST_DATABASE_URL=postgres://…` を付けると実際の PostgreSQL で流し、同時実行のテストも動く |
| `bun run db:generate` | `infrastructure/schema.ts` の変更からマイグレーション SQL を作る |
| `bun run db:migrate` | マイグレーションだけを流す（`MIGRATE_ON_START=false` で運用するとき） |
| `bun run build` | Bun ごと 1 つにした実行ファイル `dist/server` |
| `docker build .` | 上の実行ファイルを distroless に載せたイメージ |

## API

| メソッドとパス | 内容 |
| --- | --- |
| `POST /products`・`GET /products`・`GET /products/:id`・`POST /products/:id/discontinue` | 商品の登録・一覧（`?sort=popular` で販売数順）・取得・販売終了 |
| `GET /inventory/:productId`・`POST /inventory/:productId/receipts` | 在庫を見る・入荷（`Idempotency-Key` 可） |
| `POST /orders`・`GET /orders/:id` | 注文（`Idempotency-Key` 可）・取得。応答の `actions` は「いまできる操作」 |
| `POST /orders/:id/cancel`・`POST /orders/:id/ship` | 取消（出荷前まで）・出荷（確定後だけ） |

エラーは RFC 9457 の Problem Details（`type: urn:problem:<エラー名>`）。

## 構成

```
src/
├── main.ts, bootstrap.ts, config.ts   組み立てと起動。全部を知っているのはここだけ
├── shared/                            どのコンテキストにも属さない土台（Result・Outbox・冪等キー・スケジューラー…）
└── modules/
    ├── catalog/                       商品・販売数（上流。CatalogApi を公開）
    ├── inventory/                     在庫・引当（注文のイベントに反応する）
    └── ordering/                      注文と状態遷移（在庫のイベントに反応する）
        ├── domain/  application/  infrastructure/  presentation/
        ├── contract.ts                他のコンテキストへの公開窓口
        └── module.ts                  コンテキスト内の組み立て
```

依存は presentation / infrastructure → application → domain の一方向。domain と application は Elysia・Drizzle・Bun のどれにも依存せず、時刻と ID もポートから受け取る。詳しくは [docs/architecture.md](docs/architecture.md)。

## 環境変数

| 名前 | デフォルト | 内容 |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DATABASE_URL` | なし | `postgres://…` なら Bun.SQL で PostgreSQL に繋ぐ。無ければ PGlite |
| `PGLITE_DATA_DIR` | `.data/pglite` | `memory://` にするとプロセス終了で消える |
| `MIGRATE_ON_START` | `true` | 複数台で動かすときは `false` にしてデプロイ手順で `bun run db:migrate` |
| `OUTBOX_POLL_MS` | `500` | イベント配送の間隔 |
| `OUTBOX_MAX_ATTEMPTS` | `10` | この回数配送に失敗したらデッドレター |
| `MAX_BODY_BYTES` | `1048576` | リクエスト本文の上限（超えたら 413） |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`（1 行 1 JSON） |

## 入れていないもの

認証（Elysia の `macro` + `resolve` で足す）、CORS、OpenTelemetry（`@elysiajs/opentelemetry`）、一覧のページング、支払い。Saga に参加者が増えたときの形（プロセスマネージャー）は [docs/messaging.md](docs/messaging.md) に書いた。

Elysia は 2.0 がベータなので 1.4 系を使っている。Elysia を import しているのは各 `presentation/` と `shared/presentation/` だけ（あとは `bootstrap.ts` の `.use()`）なので、上げるときに触る範囲はそこに限られる。
