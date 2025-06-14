import {ExampleTable} from "./gen";

const res = await ExampleTable.create({
    simpleField: 123
});

console.log(res, "double: ", res.derivedField(123));
