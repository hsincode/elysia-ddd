# エッジケース

このテンプレートが扱っているエッジケースの一覧。どこで扱い、どのテストが確かめているかを並べる。★はテストを書いている途中で実際に見つかった不具合。

## 入力と値

| 状況 | 放っておくと | 扱い | 場所 | テスト |
| --- | --- | --- | --- | --- |
| 「か」+ 結合用濁点 と「が」 | 見た目が同じ名前が別々に保存される | NFC に正規化してから保存 | `shared/domain/text.ts`、`ProductName`、`CancelReason` | `product.test.ts`、`order.test.ts` |
| 絵文字「👨‍👩‍👧」 | 1 文字なのに 5 文字以上と数えられ、長さ制限が狂う | `Intl.Segmenter` で書記素クラスタを数える | `text.ts` | 同上 |
| 前後の全角空白 | 空白だけの名前や理由が通る | NFC のあと trim（U+3000 も落ちる）。空なら拒否 | `normalizeText` | 同上 |
| NUL・タブ・改行 | ログや画面が崩れる | 制御文字は拒否。取消の理由だけ改行を許す | `hasControlCharacters` | 同上 |
| 全角の追跡番号「ｊｐ１２３４－５６７８」 | 同じ番号が別物になる | NFKC で半角にし、英字を大文字にそろえる | `TrackingNumber` | `order.test.ts`、`ordering.test.ts` |
| 数量 0・小数・NaN・負数 | 在庫や金額が壊れる | 値オブジェクトが拒否（422） | `Quantity`（注文・在庫それぞれ） | `order.test.ts`、`inventory.test.ts` |
| 明細が 1 万行 | カタログに 1 万件問い合わせる | 価格を引く前に `OrderRequest.parse` で 50 行までに絞る。本文の上限（413）も効く | `order.ts`、`http-app.ts` | `place-order.test.ts`、`http.test.ts` |
| 同じ商品の明細が 2 行 | 数量の意味があいまいになる | 注文は `DuplicateOrderLine`。在庫の引当は合算して判断する（上流が変わっても数え間違えない） | `order.ts`、`allocation.ts` | `order.test.ts`、`allocation.test.ts` |
| 合計が上限ちょうど | 境界の扱いがぶれる | ちょうどは可、1 円超えたら `OrderTotalLimitExceeded` | `Order.place` | `order.test.ts` |
| 金額の計算が安全な整数を超える | 黙って丸められる | `Money.add` / `times` が RangeError（上限の確認漏れ＝バグとして止める） | `shared/domain/money.ts` | — |
| 入荷の桁違い | 在庫が非現実的な値になる | 1 商品 100 万個まで（`StockLimitExceeded`） | `StockItem.receive` | `inventory.test.ts` |
| ★ 期限ちょうど（15 分 0 秒） | ドメインは「ちょうどから期限切れ」なのに、検索が `<` で拾わず取り消されない | 検索も境界を含める（`<=`）。名前も `findUnconfirmedPlacedBy` にして含むことを明示 | `order-repository.ts` | `order.test.ts`、`ordering.test.ts` |

## 同時実行

| 状況 | 放っておくと | 扱い | 場所 | テスト |
| --- | --- | --- | --- | --- |
| 同じ注文を 2 か所から同時に取り消す | 両方成功し、イベントが 2 回出る | 楽観ロック（version）。負けた側は読み直し（`retryOnConflict`）、取消済みを見て 409 | `drizzle-order-repository.ts`、`cancel-order.ts` | `ordering.test.ts`、`concurrency.test.ts` |
| 最後の 1 個を 2 件の注文が取り合う | 売り越す | 在庫の行を `FOR UPDATE` でロックし、順番に判断する。1 件は確定、1 件は却下 | `drizzle-stock-repository.ts` | `ordering.test.ts`、`concurrency.test.ts` |
| 商品 A・B を逆の順で含む注文が同時に来る | デッドロック | ロックを常に商品 ID の順に取る | `lockMany` | `concurrency.test.ts`（60 注文 × 2 インスタンス） |
| それでも DB がデッドロック・シリアライゼーション失敗を検出する | 500 になる | SQLSTATE 40P01 / 40001 を `ConcurrencyError` に読み替え、HTTP は 409、配送はリトライ | `transaction.ts` | `unit-of-work.test.ts`（実 PostgreSQL） |
| 初めての入荷が同時に 2 件 | まだ無い行はロックできず、片方の追加が一意制約で失敗する | 追加の衝突を `ConcurrencyError` にして、読み直してやり直す | `drizzle-stock-repository.ts`、`receive-stock.ts` | `inventory.test.ts` |
| 期限切れの処理と、お客様の取消・在庫の確定が同時 | 二重に取り消す | 1 件ずつ別トランザクション。楽観ロックで負けたら飛ばし、次の回にドメインが判断する | `expire-overdue-orders.ts` | — |

`concurrency.test.ts` は、2 つのインスタンス（別々の接続プール）が同じ PostgreSQL で、在庫 30 個の商品への注文 60 件と同時の取消を処理する（`TEST_DATABASE_URL` があるときだけ動く）。確定はちょうど 30 件、同じ注文への同時取消は必ず 1 件だけ成功、デッドロックとデッドレターは 0 件だった。

## HTTP

| 状況 | 放っておくと | 扱い | 場所 | テスト |
| --- | --- | --- | --- | --- |
| タイムアウトしたクライアントが同じ注文を再送する | 注文が 2 件できる | `Idempotency-Key`。キーの記録と処理を同じトランザクションで確定し、再送には前回の応答をそのまま返す（`Idempotent-Replayed: true`） | `shared/infrastructure/idempotency/`、`shared/presentation/idempotency.ts` | `ordering.test.ts`、`inventory.test.ts` |
| 同じキーの再送が同時に届く | 両方が実行される | 先にキーの行を作る。後の方は一意制約で待ち、先のコミット後に記録を返す | `idempotency/store.ts` | `ordering.test.ts` |
| 同じキーで違うボディ | 取り違えた応答を返す | ボディのフィンガープリント（キー順をそろえた JSON の SHA-256）が違えば 422 | 同上 | `ordering.test.ts` |
| 処理の途中で落ちる | キーだけ残って二度と実行できない | 例外ならキーの記録ごとロールバックする（次の再送で実行される） | 同上 | — |
| ★ ドメインエラーの項目名が Problem Details の予約名と同じ | 注文の状態 `status: "placed"` が HTTP ステータスを上書きし、応答の検証で落ちる | 項目名を `currentStatus` に変え、予約名（`status`・`title`・`instance`）を持つエラーは型で渡せなくした。標準の項目は後から書いて必ず勝たせる | `shared/presentation/problem.ts` | 型検査 |
| ★ 応答がスキーマに合わない | サーバーのバグなのに「Invalid request（400）」と返る | 応答の検証エラーは 500 にしてログに残す | `error-handler.ts` | — |
| 巨大な本文 | メモリを食う | `MAX_BODY_BYTES` を超えたらパースする前に 413 | `http-app.ts` | `http.test.ts` |
| 形の壊れた入力 | ユースケースまで届く | TypeBox で止めて 400。どの項目が悪いかを `errors` で返す | `error-handler.ts` | `catalog.test.ts` |

## イベントと Saga

| 状況 | 放っておくと | 扱い | 場所 | テスト |
| --- | --- | --- | --- | --- |
| 保存に失敗した操作のイベント | 起きていないことが伝わる | outbox を同じトランザクションで書くので残らない | `publisher.ts` | `outbox-relay.test.ts` |
| 購読の処理が失敗する | 一部だけ書き込まれる | 購読ごとのセーブポイントで戻し、2・4・8…秒（最大 1 時間）あけてリトライ | `relay.ts` | `outbox-relay.test.ts` |
| 1 つのイベントの購読の片方だけが失敗 | 成功した方にもう一度届く | 購読ごとの配送記録（deliveries）で飛ばす | `relay.ts` | `outbox-relay.test.ts` |
| 同じ集約のイベントの追い越し（失敗して後回しになった間に次が届く） | 取消が引当より先に処理される | 同じ集約の古いイベントが配送待ちなら新しいものは待たせる | `relay.ts` | `outbox-relay.test.ts` |
| 何度やっても失敗するイベント | リトライが続き、同じ集約の後続も止まる | `OUTBOX_MAX_ATTEMPTS` 回でデッドレター。後続は流す | `relay.ts` | `outbox-relay.test.ts` |
| 同じイベントが 2 回届く（配送の仕組みを変えたときなど） | 在庫が二重に引き当てられる | 在庫は注文ごとの引当記録があれば何もしない | `reservations.ts` | `reservations.test.ts` |
| 引当より先に取消が届く | あとから来た引当で在庫が戻らなくなる | 取消のときに記録が無ければ voided を残し、あとの引当を断る | `reservations.ts` | `reservations.test.ts` |
| 取消・期限切れのあとに「確保できた」が届く | 取り消した注文が確定する | 注文は遷移表で断って無視する。在庫は取消のイベントで戻る | `stock-outcomes.ts` | `ordering.test.ts` |
| 確保待ちに取り消す | 在庫が引き当てられたまま残る | 同じ注文のイベントは順に届くので、引当のあとに戻す | `relay.ts`、`reservations.ts` | `ordering.test.ts` |
| 在庫の知らせがいつまでも来ない | 注文が確保待ちのまま残る | 15 分で期限切れ（システムの取消） | `expire-overdue-orders.ts` | `ordering.test.ts` |
| 在庫不足で断った注文の取消 | 持っていない在庫を戻す | rejected の記録は何も持たないので何もしない | `Reservation.release` | `reservations.test.ts` |
| 引当の無い注文の出荷の知らせ | 在庫が負になる | 不整合として例外にし、リトライとデッドレターで人が気づけるようにする | `reservations.ts` | `reservations.test.ts` |
| 購読の名前を変える | 過去のイベントがもう一度届く | 名前は運用に乗せたら変えない（文書で約束） | `events.ts` | — |
| outbox と冪等キーが増え続ける | テーブルが太る | 配送済みは 7 日、冪等キーは 24 時間で消す | `bootstrap.ts` の Job | `outbox-relay.test.ts` |
| 複数インスタンスで Job が重なる | 同じ処理が 2 回走る | 配送は SKIP LOCKED、期限切れは楽観ロック。どの Job も並行に動いて壊れないように書く | `scheduler.ts` | `concurrency.test.ts` |

## データ

| 状況 | 放っておくと | 扱い | 場所 |
| --- | --- | --- | --- |
| DB を直接書き換えて、状態と列が食い違う | 読み込んだ集約が壊れる | 状態ごとの必須列と `0 ≤ reserved ≤ on_hand` を CHECK 制約で守る。読み込みで欠けていれば黙って直さずに例外 | 各 `schema.ts`、`drizzle-order-repository.ts` |
| 「出荷済みなのに追跡番号が無い」 | どこかで null を踏む | 状態を判別共用体にして、型の上で作れなくする | `OrderState` |
