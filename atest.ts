import {Transaction} from "./a";




const res = await Transaction.create({
    id: "123",
    amount: 123,
    bankAccountId: "456"
});

console.log(res, "double: ", res.doubleAmount(123));
