import { IfExprNode } from "./ast.types.js";
import { genRdtId, toRDTExprString, toRDTreeString, walkDFS } from "./rdt.js";
import { RDTComputeNode, RDTConditional, RDTFunction, RDTMath, RDTNode, RDTNumericLiteral, RDTReduce, RDTReference, RDTRoot, RDTSourceRuntime, RDTTypeDef, RDTTypeFunctionDefinition } from "./rdt.types.js";
import { debugRDTNode, debugRDTType, getTypeMetadata, replacer } from "./rdt.util.js";
import { rdtIsNotKnown } from "./rdtTypeSystem.js";
import { TargetStage, transpile } from "./transpiler.js";
import { ComplexKeyMap } from "./util.js";
import fs, { mkdirSync } from "node:fs";

type RDTReduceIntent = {
    id: string;
    type: "RDTReduceIntent";
};

type RDTReduceNode = RDTReduceIntent;

// type BaseReduceResult<TGlobal> = {
//     tGlobal?: TGlobal;
// }

// type InvalidateReduceResult = {
//     invalidate: true;
// }
// type SetReduceResult<TAcc> = {
//     invalidate: false;
//     acc: TAcc;
// }

// type ExReduceResult<TAcc, TGlobal> = (SetReduceResult<TAcc> | InvalidateReduceResult) & BaseReduceResult<TGlobal>;

// const actionMap = ComplexKeyMap.fromEntries([
//     [{ type: "operator", operator: "+", left: "number", rhs: "number" }, {

//     }],
//     [{ type: "operator", operator: "*", left: "number", rhs: "number" }, {

//     }],
//     // Swamps: true's
//     [{ type: "operator", operator: "||", left: "boolean", rhs: "boolean" }, {
//         // Global state on the row for number of true's,
//     }],
// ]);

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

function subForPass<T extends RDTNode>(tree: T, replacement: Record<string, { referenceId: string, name: string }>): T {
    return walkDFS(tree, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTReference" && ctx.node.referenceId in replacement) {
                const match = replacement[ctx.node.referenceId]!;
                return {
                    replacement: {
                        id: genRdtId(),
                        type: "RDTReference",
                        referenceId: match.referenceId,
                        name: match.name,
                        metadata: {}
                    } satisfies RDTReference
                };
            }
        }
    }) as T;
}

function assembleReduceNode(params: {
    forwardPass: RDTComputeNode,
    inversePass: RDTComputeNode,
    onView: RDTComputeNode,
    accType: RDTTypeDef,
    rowType: RDTTypeDef,
    viewType: RDTTypeDef,
    ids: {
        accCurParamId: string,
        accNextParamId: string,
        rowOldParamId: string,
        rowNewParamId: string,
    }

}): RDTReduce {
    return {
        id: genRdtId(),
        type: "RDTReduce",
        forward: {
            id: genRdtId(),
            metadata: {
                ["typeinfo"]: {
                    type: "RDTTypeFunctionDefinition",
                    params: {
                        "accCur": params.accType,
                        "newRow": params.rowType,
                    },
                    returns: params.accType,
                } satisfies RDTTypeFunctionDefinition,
            },
            type: "RDTFunction",
            parameters: [
                {
                    id: params.ids.accCurParamId,
                    type: "RDTSourceRuntime",
                    name: "accCur",
                    metadata: {
                        ["typeinfo"]: params.accType,
                    },
                } satisfies RDTSourceRuntime,
                {
                    id: params.ids.rowNewParamId,
                    type: "RDTSourceRuntime",
                    name: "newRow",
                    metadata: {
                        ["typeinfo"]: params.rowType,
                    },
                } satisfies RDTSourceRuntime,
            ],
            body: params.forwardPass,
            name: "fowardPass",
        } satisfies RDTFunction,
        inverse: {
            id: genRdtId(),
            metadata: {
                ["typeinfo"]: {
                    type: "RDTTypeFunctionDefinition",
                    params: {
                        "accNext": params.accType,
                        "oldRow": params.rowType,
                    },
                    returns: params.accType,
                } satisfies RDTTypeFunctionDefinition,
            },
            type: "RDTFunction",
            parameters: [
                {
                    id: params.ids.accNextParamId,
                    type: "RDTSourceRuntime",
                    name: "accNext",
                    metadata: {
                        ["typeinfo"]: params.accType,
                    },
                } satisfies RDTSourceRuntime,
                {
                    id: params.ids.rowOldParamId,
                    type: "RDTSourceRuntime",
                    name: "oldRow",
                    metadata: {
                        ["typeinfo"]: params.rowType,
                    },
                } satisfies RDTSourceRuntime,
            ],
            body: params.inversePass,
            name: "inversePass",
        } satisfies RDTFunction,
        onView: {
            id: genRdtId(),
            metadata: {
                ["typeinfo"]: {
                    type: "RDTTypeFunctionDefinition",
                    params: {
                        "accCur": params.accType,
                    },
                    returns: params.viewType,
                } satisfies RDTTypeFunctionDefinition,
            },
            type: "RDTFunction",
            parameters: [
                {
                    id: params.ids.accCurParamId,
                    type: "RDTSourceRuntime",
                    name: "accCur",
                    metadata: {
                        ["typeinfo"]: params.accType,
                    },
                } satisfies RDTSourceRuntime,
            ],
            body: params.onView,
            name: "onView",
        } satisfies RDTFunction,
        metadata: {
            ["accTypeInfo"]: params.accType,
        },
    } satisfies RDTReduce;
}

export function walkReduce(reduceFunction: RDTFunction, ctx: { reduceIntent: RDTReduceIntent, idx: number }): RDTReduce {
    fs.mkdirSync(`./out/reduce/${ctx.idx}`, { recursive: true });
    if (reduceFunction.parameters.length !== 2) throw new Error(`Expected two parameters for reduce function, got: ${reduceFunction.parameters.length}`);
    const [accParameter, rowParameter] = reduceFunction.parameters;
    const accParameterType = getTypeMetadata(accParameter, { returnRawBinding: false });
    const rowParameterType = getTypeMetadata(rowParameter, { returnRawBinding: false });
    if (!accParameterType || accParameterType.type === "RDTTypeUnknown") throw new Error(`Accumulator type is unknown in reducer`);
    if (!rowParameterType || rowParameterType.type === "RDTTypeUnknown") throw new Error(`Row type is uknown in reducer`);

    let numberOfAccsFound = 0;
    let lineage: { node: RDTMath, accSide: OperatorSide }[];
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
    const x = getTypeMetadata(reduceFunction, { returnRawBinding: false })!
    if (x.type !== "RDTTypeFunctionDefinition") throw new Error(`Unexpected reduce function type`);
    if (x.returns.type === "number") {
        lineage.reverse(); // mutating
        const forwardPass = subForPass(reduceFunction.body, {
            [rowParameter.id]: { name: "newRow", referenceId: rowNewParamId },
            [accParameter.id]: { name: "accCur", referenceId: accCurParamId },
        });
        const inversePass = subForPass(lineage.reduce((acc, next): RDTComputeNode => {
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
        } satisfies RDTReference), {
            [rowParameter.id]: { name: "oldRow", referenceId: rowOldParamId },
            // No need to sub acc references since this is done automatically as part of the reduce.
        });

        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward.rdt`, JSON.stringify(forwardPass, replacer, 2));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward-tree.rdt`, toRDTreeString(forwardPass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward-expr.rdt`, toRDTExprString(forwardPass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse.rdt`, JSON.stringify(inversePass, replacer, 2));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse-tree.rdt`, toRDTreeString(inversePass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse-expr.rdt`, toRDTExprString(inversePass));
        return assembleReduceNode({
            ids: {
                accCurParamId,
                accNextParamId,
                rowNewParamId,
                rowOldParamId,
            },
            forwardPass,
            inversePass,
            onView: {
                id: genRdtId(),
                type: "RDTReference",
                metadata: {},
                referenceId: accCurParamId,
                name: "accCur",
            },
            accType: {
                type: "number",
            },
            viewType: {
                type: "number",
            },
            rowType: rowParameterType,
        });
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
            condition: walkDFS(subForPass(rootOperation.node, {
                [rowParameter.id]: { name: "newRow", referenceId: rowNewParamId },
                [accParameter.id]: { name: "accCur", referenceId: accCurParamId },
            }), {
                onAfter: (ctx) => {
                    // TODO: Not sure if we should always do this. Let's try to refute at some point
                    if (ctx.node.type === "RDTMath") {
                        if (ctx.node.lhs.type === "RDTReference" && ctx.node.lhs.referenceId === accCurParamId) {
                            return {
                                replacement: ctx.node.rhs,
                            };
                        }
                        if (ctx.node.rhs.type === "RDTReference" && ctx.node.rhs.referenceId === accCurParamId) {
                            return {
                                replacement: ctx.node.lhs,
                            };
                        }
                    }
                },
            }) as RDTComputeNode,
            then: keepTrackOfTrueCount ? {
                id: genRdtId(),
                type: "RDTMath",
                metadata: {},
                operator: "+",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accCurParamId,
                    name: "accCur",
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: "1"
                } satisfies RDTNumericLiteral
            } satisfies RDTMath : {
                id: genRdtId(),
                metadata: {},
                type: "RDTReference",
                referenceId: accCurParamId,
                name: "accCur",
            } satisfies RDTReference,
            else: !keepTrackOfTrueCount ? {
                id: genRdtId(),
                type: "RDTMath",
                metadata: {},
                operator: "+",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accCurParamId,
                    name: "accCur",
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: "1"
                } satisfies RDTNumericLiteral
            } : {
                id: genRdtId(),
                metadata: {},
                type: "RDTReference",
                referenceId: accCurParamId,
                name: "accCur",
            } satisfies RDTReference
        } satisfies RDTConditional;

        const inversePass = {
            id: genRdtId(),
            type: "RDTConditional",
            metadata: {},
            condition: walkDFS(subForPass(rootOperation.node, {
                [rowParameter.id]: { name: "oldRow", referenceId: rowOldParamId },
                [accParameter.id]: { name: "accNext", referenceId: accNextParamId },
            }), {
                onAfter: (ctx) => {
                    if (ctx.node.type === "RDTMath") {
                        if (ctx.node.lhs.type === "RDTReference" && ctx.node.lhs.referenceId === accNextParamId) {
                            return {
                                replacement: ctx.node.rhs,
                            };
                        }
                        if (ctx.node.rhs.type === "RDTReference" && ctx.node.rhs.referenceId === accNextParamId) {
                            return {
                                replacement: ctx.node.lhs,
                            };
                        }
                    }
                },
            }) as RDTComputeNode,
            then: keepTrackOfTrueCount ? {
                id: genRdtId(),
                type: "RDTMath",
                metadata: {},
                operator: "-",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accNextParamId,
                    name: "accNext",
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: "1",
                } satisfies RDTNumericLiteral
            } satisfies RDTMath : {
                id: genRdtId(),
                metadata: {},
                type: "RDTReference",
                referenceId: accNextParamId,
                name: "accNext",
            } satisfies RDTReference,
            else: !keepTrackOfTrueCount ? {
                id: genRdtId(),
                type: "RDTMath",
                metadata: {},
                operator: "-",
                lhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTReference",
                    referenceId: accNextParamId,
                    name: "accNext",
                } satisfies RDTReference,
                rhs: {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTNumericLiteral",
                    value: "1",
                } satisfies RDTNumericLiteral
            }: {
                id: genRdtId(),
                metadata: {},
                type: "RDTReference",
                referenceId: accNextParamId,
                name: "accNext",
            } satisfies RDTReference
        } satisfies RDTConditional;

        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward.rdt`, JSON.stringify(forwardPass, replacer, 2));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward-tree.rdt`, toRDTreeString(forwardPass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/foward-expr.rdt`, toRDTExprString(forwardPass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse.rdt`, JSON.stringify(inversePass, replacer, 2));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse-tree.rdt`, toRDTreeString(inversePass));
        fs.writeFileSync(`./out/reduce/${ctx.idx}/inverse-expr.rdt`, toRDTExprString(inversePass));

        const returnTypeIfAccIsZero = keepTrackOfTrueCount ? false : true;

        return assembleReduceNode({
            ids: {
                accCurParamId,
                accNextParamId,
                rowNewParamId,
                rowOldParamId,
            },
            forwardPass,
            inversePass,
            onView: {
                id: genRdtId(),
                type: "RDTConditional",
                metadata: {},
                condition: {
                    id: genRdtId(),
                    type: "RDTMath",
                    operator: "==",
                    metadata: {},
                    lhs: {
                        id: genRdtId(),
                        type: "RDTReference",
                        metadata: {},
                        referenceId: accCurParamId,
                        name: "accCur",
                    },
                    rhs: {
                        id: genRdtId(),
                        type: "RDTNumericLiteral",
                        metadata: {},
                        value: "0",
                    },
                },
                then: {
                    id: genRdtId(),
                    type: "RDTBooleanLiteral",
                    metadata: {},
                    value: returnTypeIfAccIsZero
                },
                else: {
                    id: genRdtId(),
                    type: "RDTBooleanLiteral",
                    metadata: {},
                    value: !returnTypeIfAccIsZero,
                },
            },
            accType: {
                type: "number",
            },
            viewType: {
                type: "boolean",
            },
            rowType: rowParameterType,
        });
    }

    throw new Error(`Unable to handle return type for single acc root reducer: ${debugRDTType(x.returns)}`);
}
