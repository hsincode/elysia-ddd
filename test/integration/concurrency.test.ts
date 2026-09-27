import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dataOf, startTestSystem } from "#test/support/test-system";

type TestSystem = Awaited<ReturnType<typeof startTestSystem>>;

/*
 * 2 つのインスタンス（別々の接続プール）が同じ PostgreSQL で同時に注文・配送・取消を処理しても、
 * 売り越さず、デッドロックせず、同じ注文への同時取消は 1 件だけ通ることを確かめる。
 * PGlite は接続が 1 本で本当の同時実行にならないので、TEST_DATABASE_URL があるときだけ動かす。
 */
// スキップするときは何も起動しないよう、準備は beforeAll に置く（describe の本体はスキップしても実行される）
describe.skipIf(!Bun.env.TEST_DATABASE_URL)("2 インスタンスの同時実行（実 PostgreSQL）", () => {
  let a: TestSystem;
  let b: TestSystem;
  beforeAll(async () => {
    [a, b] = await Promise.all([startTestSystem(), startTestSystem()]);
  });
  afterAll(() => Promise.all([a.close(), b.close()]));
  const customerId = "01900000-0000-7000-8000-00000000c001";

  const drainBoth = async () => {
    for (;;) {
      const [x, y] = await Promise.all([a.relay.drain(), b.relay.drain()]);
      if (x + y === 0) return;
    }
  };
  const stockOf = async (productId: string) => dataOf(await a.api.inventory({ productId }).get());

  test("在庫 30 個に 60 件の注文が来ても、確定はちょうど 30 件で、取消は 1 回だけ効く", async () => {
    const apis = [a.api, b.api] as const;
    const beans = dataOf(await a.api.products.post({ name: "同時実行の豆", price: 100 }));
    const papers = dataOf(await b.api.products.post({ name: "同時実行の紙", price: 10 }));
    await a.api.inventory({ productId: beans.id }).receipts.post({ quantity: 30 });
    await b.api.inventory({ productId: papers.id }).receipts.post({ quantity: 40 });

    // 半分は 2 商品を逆の順で並べる（ロックを取る順が決まっていなければデッドロックしうる並び）
    const orders = await Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const beansLine = { productId: beans.id, quantity: 1 };
        const papersLine = { productId: papers.id, quantity: 1 };
        const lines = i % 2 === 0 ? [beansLine, papersLine] : [papersLine, beansLine];
        return apis[i % 2]?.orders.post({ customerId, lines }).then(dataOf);
      }),
    );
    await drainBoth();

    const statuses = await Promise.all(
      orders.map(async (order) => (await a.api.orders({ id: order?.id ?? "" }).get()).data?.status),
    );
    expect(statuses.filter((status) => status === "confirmed")).toHaveLength(30);
    expect(statuses.filter((status) => status === "rejected")).toHaveLength(30);
    expect(await stockOf(beans.id)).toMatchObject({ onHand: 30, reserved: 30, available: 0 });
    // 却下された注文は紙も引き当てていない（全部か無しか）
    expect(await stockOf(papers.id)).toMatchObject({ onHand: 40, reserved: 30 });

    // 確定した 10 件を、両方のインスタンスから同時に取り消す
    const confirmed = orders.filter((_, i) => statuses[i] === "confirmed").slice(0, 10);
    const cancels = await Promise.all(
      confirmed.flatMap((order) =>
        apis.map((api) => api.orders({ id: order?.id ?? "" }).cancel.post({ reason: "同時実行" })),
      ),
    );
    expect(cancels.filter((result) => result.status === 200)).toHaveLength(10);
    expect(cancels.filter((result) => result.status === 409)).toHaveLength(10);

    await drainBoth();
    expect(await stockOf(beans.id)).toMatchObject({ reserved: 20, available: 10 });
    expect(await stockOf(papers.id)).toMatchObject({ reserved: 20, available: 20 });
  });
});
