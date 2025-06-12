import { AST } from './ast.types.js';
import parser from './dsl.cjs';
import { RDTContext, RDTDerivedProperty, RDTNode, RDTReference, RDTRoot, RDTRWRoot } from './rdt.types.js';
import { convertToRDT, genRdtId, toRDTreeString, walkDFS } from './rdt.js';
import fs from "node:fs";
import { resolveRdtReferences } from './rdtReferenceResolver.js';
import { removeRedundentReferences } from './rdtRemoveRedundentReferences.js';
import { debugRDTNode, replacer } from './rdt.util.js';
// import { generateDDL } from './genDDL';
// import { generateSDK } from './genSDK';
import { resolveTypes } from './rdtTypeSystem.js';

if (!process.argv[2]) {
    throw new Error(`Expected <filename> to be provided`);
}

let targetStage = process.argv[3] ? parseInt(process.argv[3], 10) : Number.MAX_SAFE_INTEGER;
if (!Number.isSafeInteger(targetStage) || targetStage <= 0) {
    throw new Error(`Expected <targetStage> to be an integer > 0. Received: ${process.argv[3]}`);
}

const input = await fs.promises.readFile(process.argv[2], "utf-8");

function getIntermediateId(node: RDTDerivedProperty): string {
    if (!node.metadata["intermediateidincr"]) {
        node.metadata["intermediateidincr"] = 0;
    }

    const count = (node.metadata["intermediateidincr"]++).toString();

    return `${node.name}_int_${count}`;
}

async function main() {
    const ast: AST = parser.parse(input);
    await fs.promises.writeFile("out/ast", JSON.stringify(ast, null, 2));
    if (targetStage === 1) return;
    const rdt = convertToRDT(ast);
    await fs.promises.writeFile("out/rdt", JSON.stringify(rdt, replacer, 2));
    await fs.promises.writeFile("out/rdttree", toRDTreeString(rdt));
    if (targetStage === 2) return;

    const {context: rdtCtx2, rdt: finalOutputTemp, ctxPerNode} = resolveRdtReferences(rdt);
    const {rdt: finalOutput} = removeRedundentReferences(finalOutputTemp);
    await fs.promises.writeFile("out/rdt-resolved", JSON.stringify(finalOutput, replacer, 2));
    await fs.promises.writeFile("out/rdt-resolvedctx", JSON.stringify(rdtCtx2.tree(), null, 2));
    await fs.promises.writeFile("out/rdt-resolvedtree", toRDTreeString(finalOutput));
    if (targetStage === 3) return;

    resolveTypes(finalOutput as RDTRoot, ctxPerNode);
    await fs.promises.writeFile("out/rdt-typed", JSON.stringify(finalOutput, replacer, 2));
    await fs.promises.writeFile("out/rdt-typedtree", toRDTreeString(finalOutput));
    if (targetStage === 4) return;

    // TODO: Move this logic to the optimizer side of things. Everything "could" be queryside if required. This isn't true, timeSince: Time.readTime.since(Time.writeTime, "seconds")

    const tainted = new Set<string>();
    const writeAst = new Map<string, {
        write: {
            [writeRecordId: string]: RDTNode,
        },
    }>();
    // Taint the nodes
    walkDFS(finalOutput, {
        onAfter: (ctx) => {
            // This runs at the bottom every time, doesn't matter if in before or after.
            if (ctx.node.type === "RDTSourceRuntime") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTFunction" && parent.parameters.includes(ctx.node)) {
                    // Don't double record, only record where used.
                    return;
                }
                for (const ancestor of ctx.lineage) {
                    tainted.add(ancestor.id);
                }
            }
        }
    });
    // Split the tree
    const rwSeparatedOutput = walkDFS(finalOutput, {
        onAfter: (ctx) => {
            // This runs at the bottom every time, doesn't matter if in before or after.
            if (ctx.node.type === "RDTSourceRuntime" || ctx.node.type === "SimpleProperty") {
                // TODO: NOOP ??
            } else if (!tainted.has(ctx.node.id)) {
                const [parent] = ctx.lineage;
                if (tainted.has(parent.id)) {
                    const grandparent = ctx.lineage.find((x) => x.type === "DerivedProperty");
                    if (!grandparent) {
                        throw new Error(`Unable to find root for read / write separation`);
                    }
                    const referenceId = getIntermediateId(grandparent);
                    writeAst.set(grandparent.id, {
                        write: {
                            [referenceId]: ctx.node,
                        },
                    });
                    return {
                        replacement: {
                            id: referenceId,
                            type: "RDTReference",
                            referenceId,
                            metadata: {},
                        },
                    };
                }
            } else if (writeAst.has(ctx.node.id)) {
                if (ctx.node.type !== "DerivedProperty") {
                    throw new Error(`Expected derived property as source for write ast: ${debugRDTNode(ctx.node)}`);
                }
                return {
                    replacement: {
                        ...ctx.node,
                        derivation: {
                            id: genRdtId(),
                            type: "RDTRWRoot",
                            read: ctx.node.derivation,
                            write: writeAst.get(ctx.node.id)!.write,
                            metadata: {},
                        } satisfies RDTRWRoot,
                    },
                };
            }
        }
    });
    await fs.promises.writeFile("out/rdt-rwopt", JSON.stringify(rwSeparatedOutput, replacer, 2));
    if (targetStage === 4) return;
    // const file = generateSDK(rwSeparatedOutput);
    // await fs.promises.writeFile("out/gen.ts", file);
    // const sql = generateDDL(rwSeparatedOutput);
    // await fs.promises.writeFile("out/gen.sql", sql);
    if (targetStage === 5) return;
}

main().catch((e) => console.error(e));
