import fs from "node:fs";
import { generateDDL } from './genDDL';
import { transpile } from './transpiler.js';

if (!process.argv[2]) {
    throw new Error(`Expected <filename> to be provided`);
}

let targetStage = process.argv[3] ? parseInt(process.argv[3], 10) : Number.MAX_SAFE_INTEGER;
if (!Number.isSafeInteger(targetStage) || targetStage <= 0) {
    throw new Error(`Expected <targetStage> to be an integer > 0. Received: ${process.argv[3]}`);
}

const input = await fs.promises.readFile(process.argv[2], "utf-8");

async function main() {
    const finalOutput = await transpile({
        input,
        targetStage,
    });
    if (targetStage <= 5) return;
    if (!finalOutput.rdt) {
        throw new Error(`Expected final output to be an RDTRoot, got: ${typeof finalOutput}`);
    }
    const output = generateDDL(finalOutput.rdt);
    await fs.promises.writeFile("./out/ddl.sql", output);
}

main().catch((e) => console.error(e));
