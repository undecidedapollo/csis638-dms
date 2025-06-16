import { processPipelines } from "./dataset";
import { toRDTExprString, toRDTreeString } from "./rdt";
import { replacer } from "./rdt.util";
import { TargetStage, transpile } from "./transpiler";
import fs from "node:fs";

async function main() {
    const output = await transpile({
        outDir: "invert",
        input: `
Transaction {
    amount: number,
    flagged: boolean,
    suspicious: boolean,
    auditRequest: number
}
a = Transaction[].reduce((acc: number, row: Transaction) => acc + row.amount, 0)
b = Transaction[].reduce((acc: number, row: Transaction) => 2 / (5 - acc * 10), 0)
c = Transaction[].reduce((acc: boolean, row: Transaction) => acc || row.flagged || (row.auditRequest > 5 && row.suspicious), false)
        `,
        targetStage: TargetStage.RDT_PIPELINED,
    });
    if (!output.rdt || !(output.rdt.type === "RDTRoot")) {
        throw new Error(`Expected output to be an RDTRoot, got: ${typeof output.rdt}`);
    }

    fs.writeFileSync(`./out/reduce/final.rdt`, JSON.stringify(output.rdt, replacer, 2));
    fs.writeFileSync(`./out/reduce/final-tree.rdt`, toRDTreeString(output.rdt as any));
    fs.writeFileSync(`./out/reduce/final-expr.rdt`, toRDTExprString(output.rdt as any));
}

if (process.argv[1] === import.meta.filename) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
