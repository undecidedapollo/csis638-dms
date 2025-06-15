import { IfExprNode } from "./ast.types.js";
import { genRdtId, toRDTExprString, toRDTreeString, walkDFS } from "./rdt.js";
import { RDTComputeNode, RDTConditional, RDTFunction, RDTMath, RDTNode, RDTNumericLiteral, RDTReference, RDTRoot } from "./rdt.types.js";
import { debugRDTNode, getTypeMetadata, replacer } from "./rdt.util.js";
import { rdtIsNotKnown } from "./rdtTypeSystem.js";
import { TargetStage, transpile } from "./transpiler.js";
import { ComplexKeyMap } from "./util.js";
import fs from "node:fs";

type RDTDataset = {
    id: string;
    type: "RDTDataset";
    name: string;
};
type RDTReduceIntent = {
    id: string;
    type: "RDTReduceIntent";
    source: RDTDataset;
};

type RDTAdditionIntent = {
    id: string;
    type: "RDTReduceIntent";
    source: RDTDataset;
};

type RDTReduce = {
    id: string;
    type: "RDTReduce";
    insert: RDTFunction;
    delete: RDTFunction;
};

type RDTReduceContext = {
    type: "RDTReduceContext";
    insert: RDTFunction;
    delete: RDTFunction;
};

type RDTReduceNode = RDTDataset | RDTReduceIntent | RDTReduce | RDTReduceContext;

type BaseReduceResult<TGlobal, TRow> = {
    tGlobal?: TGlobal;
    tRow?: TRow;
}

type InvalidateReduceResult<TAcc> = {
    invalidate: true;
}
type SetReduceResult<TAcc> = {
    invalidate: false;
    acc: TAcc;
}

type ExReduceResult<TAcc, TGlobal, TRow> = (SetReduceResult<TAcc> | InvalidateReduceResult<TAcc>) & BaseReduceResult<TGlobal, TRow>;

const actionMap = ComplexKeyMap.fromEntries([
    [{ type: "operator", operator: "+", left: "number", rhs: "number" }, {

    }],
    [{ type: "operator", operator: "*", left: "number", rhs: "number" }, {

    }],
    // Swamps: true's
    [{ type: "operator", operator: "||", left: "boolean", rhs: "boolean" }, {
        // Global state on the row for number of true's,
    }],
]);

enum OperatorSide {
    Left = 1,
    Right = 2,
};

const operatorInverse = {
    "+": "-",
    "-": "+",
    "*": "/",
    "/": "*",
};

function walkReduce(reduceFunction: RDTFunction, ctx: { reduceIntent: RDTReduceIntent, nodeMap: Map<string, RDTNode | RDTReduceNode> }): RDTReduce {
    if (reduceFunction.parameters.length !== 2) throw new Error(`Expected two parameters for reduce function, got: ${reduceFunction.parameters.length}`);
    const [accParameter, rowParameter] = reduceFunction.parameters;
    const output1 = {
        id: genRdtId(),
        type: "RDTReduce",
    } satisfies Partial<RDTReduce>;
    let numberOfAccsFound = 0;

    let lineage : {node: RDTMath, accSide: OperatorSide}[];
    let accRoot: RDTReference;
    walkDFS<RDTReduceNode>(reduceFunction.body, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTReference" && ctx.node.referenceId === accParameter.id) {
                numberOfAccsFound++;
                accRoot = ctx.node;
                const tempLineage = [...ctx.lineage];
                let prevId = accRoot.id;
                lineage = tempLineage.map((lin) => {
                    if (lin.type !== "RDTMath") throw new Error(`Only math expressions are allowed atm. Found: ${debugRDTNode(lin)}`);
                    if (lin.lhs.id === prevId) {
                        prevId = lin.id;
                        return {
                            node: lin,
                            accSide: OperatorSide.Left,
                        };
                    } else if (lin.rhs.id === prevId) {
                        prevId = lin.id;
                        return {
                            node: lin,
                            accSide: OperatorSide.Right,
                        };
                    } else {
                        throw new Error(`Unknown situation, expected prev to be on left or right side for node: ${debugRDTNode(lin)}`);
                    }
                });
            }
        },
    });
    // Previous ACC is not referenced, this is all constants, with the last value replacing it, undo doesn't have to do anything and can be a no-op
    // For updates we could ignore the undo step and just process the next step, delete would need to invalidate.
    if (numberOfAccsFound === 0) {
        throw new Error(`Reduce function does not reference the accumulator and is information reducing, currently unsupported.`);
    }
    if (numberOfAccsFound !== 1) {
        throw new Error(`Reduce function references accumulator multiple times, currently unsupported.`);
    }
    if (lineage! === undefined) throw new Error(`Lineage isn't set, this shouldn't happen.`);
    if (accRoot! === undefined) throw new Error(`accRoot isn't set, this shouldn't happen.`);

    // I'll take a Dave's Single, no ketchup, no mayo
    let accCurParamId = genRdtId();
    let accNextParamId = genRdtId();
    let rowOldParamId = genRdtId();
    let rowNewParamId = genRdtId();
    
    if (rdtIsNotKnown(reduceFunction)) throw new Error(`Expected to know type of reduce function`);
    const x = getTypeMetadata(reduceFunction, {returnRawBinding: false})!
    if (x.type !== "RDTTypeFunctionDefinition") throw new Error(`Unexpected reduce function type`);
    if (x.returns.type === "number") {
        lineage.reverse(); // mutating
        const inverseRDT = lineage.reduce((acc, next): RDTComputeNode => {
            if (next.accSide === OperatorSide.Right) {
                return {
                    ...next.node,
                    rhs: acc,
                } satisfies RDTMath;
            } else if (next.accSide === OperatorSide.Left) {
                const inverse = operatorInverse[next.node.operator];
                if (!inverse) throw new Error(`No inverse found for operator: ${next.node.operator} node: ${debugRDTNode(next.node)}`);
                return {
                    ...next.node,
                    lhs: acc,
                    operator: inverse,
                };
            } else {
                throw new Error(`Unknown operator side. This should not happen`);
            }
        }, {
            type: "RDTReference",
            id: genRdtId(),
            metadata: {},
            referenceId: accNextParamId,
            name: "accNext",
        } satisfies RDTReference);
    
        fs.writeFileSync("./out/inverse.rdt", JSON.stringify(inverseRDT, replacer, 2));
        throw new Error("Nothing for you!");
    }
    if (x.returns.type === "boolean") {
        const rootOperation = lineage[lineage.length - 1];
        let keepTrackOfTrueCount: boolean;
        if (rootOperation.node.operator === "||") {
            keepTrackOfTrueCount = true;
        } else if (rootOperation.node.operator === "&&") {
            keepTrackOfTrueCount = false;
        } else {
            throw new Error(`Unsupported boolean symbol for reduce inversion: ${debugRDTNode(rootOperation.node)}`);
        }

        const forwardPass = {
            id: genRdtId(),
            type: "RDTConditional",
            metadata: {},
            condition: walkDFS(rootOperation.node, {
                onAfter: (ctx) => {
                    if (ctx.node.type === "RDTReference" && ctx.node.referenceId === rowParameter.id) {
                        return {
                            replacement: {
                                id: genRdtId(),
                                type: "RDTReference",
                                referenceId: rowNewParamId,
                                name: "newRow",
                                metadata: {}
                            } satisfies RDTReference
                        };
                    }
                    if (ctx.node.type === "RDTReference" && ctx.node.referenceId === accParameter.id) {
                        return {
                            replacement: {
                                id: genRdtId(),
                                type: "RDTReference",
                                referenceId: accCurParamId,
                                name: "accCur",
                                metadata: {}
                            } satisfies RDTReference
                        };
                    }
                }
            }) as RDTComputeNode,
            then: {
                id: genRdtId(),
                type:"RDTMath",
                metadata: {},
                operator: "+",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accParameter.id,
                    name: accRoot.name,
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: keepTrackOfTrueCount ? "1" : "0"
                } satisfies RDTNumericLiteral
            } satisfies RDTMath,
            else: {
                id: genRdtId(),
                type:"RDTMath",
                metadata: {},
                operator: "+",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accParameter.id,
                    name: accRoot.name,
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: keepTrackOfTrueCount ? "0" : "1"
                } satisfies RDTNumericLiteral
            }
        } satisfies RDTConditional;

        const inversePass = {
            id: genRdtId(),
            type: "RDTConditional",
            metadata: {},
            condition: walkDFS(rootOperation.node, {
                onAfter: (ctx) => {
                    if (ctx.node.type === "RDTReference" && ctx.node.referenceId === rowParameter.id) {
                        return {
                            replacement: {
                                id: genRdtId(),
                                type: "RDTReference",
                                referenceId: rowOldParamId,
                                name: "oldRow",
                                metadata: {}
                            } satisfies RDTReference
                        };
                    }
                    if (ctx.node.type === "RDTReference" && ctx.node.referenceId === accParameter.id) {
                        return {
                            replacement: {
                                id: genRdtId(),
                                type: "RDTReference",
                                referenceId: accNextParamId,
                                name: "accNext",
                                metadata: {}
                            } satisfies RDTReference
                        };
                    }
                }
            }) as RDTComputeNode,
            then: {
                id: genRdtId(),
                type:"RDTMath",
                metadata: {},
                operator: "-",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accParameter.id,
                    name: accRoot.name,
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: keepTrackOfTrueCount ? "1" : "0",

                    
                } satisfies RDTNumericLiteral
            } satisfies RDTMath,
            else: {
                id: genRdtId(),
                type:"RDTMath",
                metadata: {},
                operator: "-",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accParameter.id,
                    name: accRoot.name,
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: keepTrackOfTrueCount ? "0" : "1",
                } satisfies RDTNumericLiteral
            }
        } satisfies RDTConditional;
    
        console.log({
            keepTrackOfTrueCount,
            accCurParamId,
            accNextParamId,
            rowOldParamId,
            rowNewParamId,
        });
        fs.writeFileSync("./out/foward.rdt", JSON.stringify(forwardPass, replacer, 2));
        fs.writeFileSync("./out/foward-tree.rdt", toRDTreeString(forwardPass));
        fs.writeFileSync("./out/foward-expr.rdt", toRDTExprString(forwardPass));
        fs.writeFileSync("./out/inverse.rdt", JSON.stringify(inversePass, replacer, 2));
        fs.writeFileSync("./out/inverse-tree.rdt", toRDTreeString(inversePass));
        fs.writeFileSync("./out/inverse-expr.rdt", toRDTExprString(inversePass));

        throw new Error("A boolean for you!");
    }

    throw new Error("Some shit happened");

}

function processTree(root: RDTRoot) {
    const nodeMap = new Map<string, RDTNode | RDTReduceNode>();

    walkDFS(root, {
        onBefore: (ctx) => {
            if (nodeMap.has(ctx.node.id)) return;
            nodeMap.set(ctx.node.id, ctx.node);
        },
    });

    const result = walkDFS<RDTReduceNode>(root, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTPostfix" && ctx.node.operator === "[]" && ctx.node.operand.type === "RDTReference") {
                const referencedNode = nodeMap.get(ctx.node.operand.referenceId);
                if (!referencedNode) throw new Error(`Referenced node not found: ${ctx.node.operand.referenceId}`);
                if (referencedNode.type !== "RDTDefinition") throw new Error(`Expected referenced node to be a definition, got: ${referencedNode.type}`);
                console.log(`Generating SQL for node: ${ctx.node.operand.referenceId} (${referencedNode.name})`);
                const node = {
                    id: genRdtId(),
                    type: "RDTDataset",
                    name: referencedNode.name,
                } satisfies RDTDataset;
                nodeMap.set(node.id, node);
                return {
                    replacement: node,
                };
            }
            if (ctx.node.type === "RDTPropertyAccess" && (ctx.node.source as unknown as RDTDataset).type === "RDTDataset") {
                if (ctx.node.propertyName.type === "RDTIdentifier" && ctx.node.propertyName.value === "reduce") {
                    const node = {
                        id: genRdtId(),
                        type: "RDTReduceIntent",
                        source: ctx.node.source as unknown as RDTDataset,
                    } satisfies RDTReduceIntent;
                    nodeMap.set(node.id, node);
                    return {
                        replacement: node,
                    };
                }
                throw new Error(`Unexpected property access: ${debugRDTNode(ctx.node.propertyName)} on ${ctx.node.source.type}`);
            }
            if (ctx.node.type === "RDTInvoke" && (ctx.node.source as unknown as RDTReduceNode).type === "RDTReduceIntent") {
                const reduceIntent = ctx.node.source as unknown as RDTReduceIntent;
                if (ctx.node.args.length !== 2) throw new Error(`Expected two arguments for reduce, got: ${ctx.node.args.length}`);
                if (ctx.node.args[0].type !== "RDTFunction") throw new Error(`Expected argument to be a function, got: ${ctx.node.args[0].type}`);
                const reduceFunction = ctx.node.args[0];

                const output = walkReduce(reduceFunction, { reduceIntent, nodeMap });
                nodeMap.set(output.id, output);
                return {
                    replacement: output,
                };
            }
            if (ctx.node.type === "RDTSideEffect") {
                if ((ctx.node.expr as unknown as RDTReduce).type === "RDTReduce") {
                    if (ctx.node.next.type !== "RDTNull") throw new Error(`Multi-stage side effects are not supported, got: ${ctx.node.next.type}, expected RDTNull`);
                    return {
                        replacement: ctx.node.expr,
                    };
                } else {
                    throw new Error(`Expected side effect expression to be RDTReduce, got: ${ctx.node.expr.type}`);
                }
            }
        },
    });
}

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

Transaction[].reduce((acc: boolean, row: Transaction) => acc || row.flagged || (row.auditRequest > 5 && row.suspicious), false)
        `,
        // Transaction[].reduce((acc: number, row: Transaction) => acc + row.amount, 0)
        // Transaction[].reduce((acc: number, row: Transaction) => 2 / (5 - acc * 10), 0)
        // (5 - (2 / y)) / 10
        targetStage: TargetStage.RDT_TYPED,
    });
    if (!output.rdt || !(output.rdt.type === "RDTRoot")) {
        throw new Error(`Expected output to be an RDTRoot, got: ${typeof output.rdt}`);
    }
    processTree(output.rdt);
}

if (process.argv[1] === import.meta.filename) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
