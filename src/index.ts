import { randomUUID } from 'node:crypto';
import { AST } from './ast.types';
import parser from './dsl.cjs';
import { RDTContext, RDTDerivedProperty, RDTNode, RDTRoot, RDTRWRoot } from './rdt.types';
import { convertToRDT, debugRDTNode, genRdtId, replacer, resolveTypes, walkDFS } from './rdt';
import { generateSDK } from './genSDK';
import fs from "node:fs";
import { generateDDL } from './genDDL';

if (!process.argv[2]) {
    throw new Error(`Expected <filename> to be provided`);
} 

const input = await fs.promises.readFile(process.argv[2], "utf-8");

// const input = `
//     Transaction {
//         id: string,
//         bankAccountId: string,
//         amount: number,
//         doubleAmount: (rand: number) => $row.amount * 2 + rand
//     }
// `;

// const input = `
//     BankAccount { 
//         accountId: string,
//         balance: $.transactions.reduce((acc, tx) => acc + tx.amount, 0),
//         transactions: Transaction[].filter((tx) => tx.bankAccountId == $.accountId)
//     }

//     Transaction {
//         id: uuid,
//         bankAccountId: string,
//         amount: number
//     }
// `;

function getIntermediateId(node: RDTDerivedProperty): string {
    if (!node.metadata["intermediateidincr"]) {
        node.metadata["intermediateidincr"] = 0;
    }

    const count = (node.metadata["intermediateidincr"]++).toString();

    return `${node.node.identifier.value}_int_${count}`;
}

try {
    const ast: AST = parser.parse(input);
    console.log(JSON.stringify(ast, null, 2));
    const rdtCtx = new RDTContext();
    const rdt = convertToRDT(ast, rdtCtx);
    console.log(JSON.stringify(rdt, replacer, 2));
    console.log(JSON.stringify(rdtCtx.tree(), null, 2));
    const finalOutput = walkDFS(rdt, {
        onAfter: (ctx) => {
            // console.log(ctx.node.type, ctx.lineage.length, !!ctx.node.rdtContext);
            if (ctx.node.type === "RDTSourceConstant") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTPropertyAccess" && parent.propertyName === ctx.node) {
                    return;
                }
                if (ctx.node.typeDef.type === "RDTTypeIdentifier" && ctx.node.typeDef.name === "string") {
                    const matchingNode = ctx.node.rdtContext.findByName(ctx.node.value);
                    if (!matchingNode) {
                        throw new Error(`Unable to find expected reference: ${ctx.node.value} for node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    }
                    return {
                        replacement: matchingNode.node,
                    };
                }
            }
        }
    });
    console.log(JSON.stringify(finalOutput, replacer, 2));

    resolveTypes(finalOutput as RDTRoot);

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
                console.log("POST_TAINT", tainted);
            }
        }
    });
    // Split the tree
    const rwSeparatedOutput = walkDFS(finalOutput, {
        onAfter: (ctx) => {
            console.log(ctx.node.type, ctx.lineage.length, !!ctx.node.rdtContext);
            // This runs at the bottom every time, doesn't matter if in before or after.
            if (ctx.node.type === "RDTSourceRuntime" || ctx.node.type === "SimpleProperty") {
                // TODO: NOOP ??
            } else if (!tainted.has(ctx.node.id)) {
                const [parent] = ctx.lineage;
                if (tainted.has(parent.id)) {
                    console.log(JSON.stringify(ctx.lineage, replacer, 2));
                    const grandparent = ctx.lineage.find((x) => x.type === "DerivedProperty");
                    if (!grandparent) {
                        console.log(debugRDTNode(ctx.node), debugRDTNode(parent));
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
                            type: "RDTRWReference",
                            rdtContext: ctx.node.rdtContext,
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
                            rdtContext: ctx.node.rdtContext,
                            read: ctx.node.derivation,
                            write: writeAst.get(ctx.node.id)!.write,
                            metadata: {},
                        } satisfies RDTRWRoot,
                    },
                };
            }
        }
    });
    console.log(JSON.stringify(rwSeparatedOutput, replacer, 2));
    const file = generateSDK(rwSeparatedOutput);
    await fs.promises.writeFile("./gen.ts", file);
    const sql = generateDDL(rwSeparatedOutput);
    await fs.promises.writeFile("./gen.sql", sql);
    console.log(file);
    // console.log(JSON.stringify(Array.from(tainted.values()).map((x) => debugRDTNode(x)), replacer, 2));
} catch (e) {
    console.error('Parse error:', e.stack);
}
