# ドキュメント

Bun + ElysiaJS で DDD をやるこのテンプレートの設計を、読む順に並べてある。図は mermaid で書いてあり、GitHub や Forgejo ではそのまま描画される。

| 文書 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 層と依存の向き、モジュールの形、リクエストの流れ、トランザクションとエラーの扱い |
| [domain-model.md](domain-model.md) | 3 つのコンテキストとその関係、集約・値オブジェクト・ドメインサービス、状態遷移 |
| [messaging.md](messaging.md) | Transactional Outbox、配送の順序とリトライ、コレオグラフィ型の Saga、定期ジョブ |
| [edge-cases.md](edge-cases.md) | エッジケースの一覧。どこで扱い、どのテストが確かめているか |
| [testing.md](testing.md) | テストの層と、PGlite / 実 PostgreSQL での流し方 |
| [decisions.md](decisions.md) | 設計判断の記録（ADR）。なぜそうしたか、何と引き換えにしたか |

図と表を 1 ページにまとめた解説ページ「elysia-ddd 設計図」: https://claude.ai/artifact/Ugk4eEJhwMfPN9omzAeHak
（ソースは [guide.html](guide.html)。Artifact として公開する前提の断片なので、ブラウザで直接開くより公開版を見る）

## 用語

| 用語 | このリポジトリでの意味 |
| --- | --- |
| コンテキスト | 境界づけられたコンテキスト。`src/modules/<name>/` の 1 つ |
| 集約 | 一緒に保存し、一緒に不変条件を守るオブジェクトのまとまり。ルートのクラスを通してだけ変える |
| 公開窓口（contract） | 他のコンテキストに見せる型と関数。`contract.ts` だけが外から import できる |
| ACL | 腐敗防止層。他のコンテキストの言葉を自分の言葉に訳すアダプター。`infrastructure/` に置く |
| 引当 | 注文のために在庫を押さえること（reserve）。出荷で確定（fulfill）、取消で戻す（release） |
| デッドレター | 決めた回数配送に失敗し、自動では配送しなくなったイベント |
