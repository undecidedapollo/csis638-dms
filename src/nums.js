import assert from "node:assert";

{
    const o1 = 123;
    const f1 = o1 + 10;
    const i1 = f1 - 10;
    assert.equal(o1, i1);
}

{
    const o1 = 123;
    const f1 = o1 + 10 * 2;
    const i1 = f1 - 10 * 2;
    assert.equal(o1, i1);
}

{
    const acc = 123;
    const next = 2 / (5 - acc * 10);
    const accInv = (5 - 2 / next) / 10;
    assert.equal(acc, accInv);
}

{
    const acc = 123;
    const next = (5 - acc * 10) / 2;
    const accInv = (5 - (next * 2)) / 10;
    assert.equal(acc, accInv);
}

