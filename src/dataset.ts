import { walkReduce } from "./invert.js";
import { genRdtId, rdtExpressionWalker, walkDFS } from "./rdt.js";
import { RDTDatasetOperators, RDTDatasetPipeline, RDTFilter, RDTNode, RDTReduce, RDTRoot, } from "./rdt.types.js";
import { debugRDTNode } from "./rdt.util.js";

type RDTDatasetIntent = {
    id: string;
    type: "RDTDatasetIntent";
    referenceId: string;
    name: string;
};

type RDTReduceIntent = {
    id: string;
    type: "RDTReduceIntent";
    source: RDTDatasetIntent | RDTDatasetPipeline;
};

type RDTFilterIntent = {
    id: string;
    type: "RDTFilterIntent";
    source: RDTDatasetIntent | RDTDatasetPipeline;
};

type RDTIntentNodes = RDTDatasetIntent | RDTReduceIntent | RDTFilterIntent;

export function processPipelines(root: RDTRoot) {
    const nodeMap = new Map<string, RDTNode | RDTIntentNodes>();

    walkDFS(root, {
        onBefore: (ctx) => {
            if (nodeMap.has(ctx.node.id)) return;
            nodeMap.set(ctx.node.id, ctx.node);
        },
    });

    let reduceExpressionCount = 0;

    return walkDFS<RDTIntentNodes>(root, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTPostfix" && ctx.node.operator === "[]" && ctx.node.operand.type === "RDTReference") {
                const referencedNode = nodeMap.get(ctx.node.operand.referenceId);
                if (!referencedNode) throw new Error(`Referenced node not found: ${ctx.node.operand.referenceId}`);
                if (referencedNode.type !== "RDTDefinition") throw new Error(`Expected referenced node to be a definition, got: ${referencedNode.type}`);

                const node = {
                    id: genRdtId(),
                    type: "RDTDatasetIntent",
                    referenceId: referencedNode.id,
                    name: referencedNode.name,
                } satisfies RDTDatasetIntent;
                return {
                    replacement: node,
                };
            }
            if (ctx.node.type === "RDTPropertyAccess" && (ctx.node.source.type === "RDTDatasetPipeline" || (ctx.node.source as unknown as RDTDatasetIntent).type === "RDTDatasetIntent")) {
                if (ctx.node.propertyName.type === "RDTIdentifier") {
                    if (ctx.node.propertyName.value === "reduce") {
                        const node = {
                            id: genRdtId(),
                            type: "RDTReduceIntent",
                            source: ctx.node.source as any,
                        } satisfies RDTReduceIntent;
                        return {
                            replacement: node,
                        };
                    } else if (ctx.node.propertyName.value === "filter") {
                        const node = {
                            id: genRdtId(),
                            type: "RDTFilterIntent",
                            source: ctx.node.source as any,
                        } satisfies RDTFilterIntent;
                        return {
                            replacement: node,
                        };
                    }
                }
                throw new Error(`Unexpected property access: ${debugRDTNode(ctx.node.propertyName)} on ${ctx.node.source.type}`);
            }

            let rdtDatasetOperator: RDTDatasetOperators;
            let rdtSource: RDTDatasetIntent | RDTDatasetPipeline;
            let isInvokePipeline = false;

            if (ctx.node.type === "RDTInvoke" && (ctx.node.source as unknown as RDTReduceIntent).type === "RDTReduceIntent") {

                const reduceIntent = ctx.node.source as unknown as RDTReduceIntent;
                if (ctx.node.args.length !== 2) throw new Error(`Expected two arguments for reduce, got: ${ctx.node.args.length}`);
                if (ctx.node.args[0].type !== "RDTFunction") throw new Error(`Expected argument to be a function, got: ${ctx.node.args[0].type}`);
                const reduceFunction = ctx.node.args[0];
                isInvokePipeline = true;
                rdtSource = reduceIntent.source;
                rdtDatasetOperator = walkReduce(reduceFunction, { reduceIntent, idx: reduceExpressionCount++ });
            }
            if (ctx.node.type === "RDTInvoke" && (ctx.node.source as unknown as RDTFilterIntent).type === "RDTFilterIntent") {
                const filterIntent = ctx.node.source as unknown as RDTFilterIntent;
                if (ctx.node.args.length !== 1) throw new Error(`Expected one argument for filter, got: ${ctx.node.args.length}`);
                if (ctx.node.args[0].type !== "RDTFunction") throw new Error(`Expected argument to be a function, got: ${ctx.node.args[0].type}`);
                const filterFunction = ctx.node.args[0];
                isInvokePipeline = true;
                rdtSource = filterIntent.source;
                rdtDatasetOperator = {
                    id: genRdtId(),
                    metadata: {},
                    type: "RDTFilter",
                    condition: filterFunction,
                } satisfies RDTFilter;
            }
            if (isInvokePipeline) {
                if (rdtDatasetOperator! === undefined) throw new Error(`Expected dataset operator to be set. This should not happen`);
                if (rdtSource! === undefined) throw new Error(`Expected dataset source to be set. This should not happen.`);
                if (rdtSource.type === "RDTDatasetIntent") {
                    return {
                        replacement: {
                            id: genRdtId(),
                            type: "RDTDatasetPipeline",
                            metadata: {},
                            source: {
                                id: genRdtId(),
                                type: "RDTReference",
                                metadata: {},
                                referenceId: rdtSource.referenceId,
                                name: rdtSource.name,
                            },
                            pipeline: [
                                rdtDatasetOperator,
                            ],
                        } satisfies RDTDatasetPipeline,
                    };
                } else if (rdtSource.type === "RDTDatasetPipeline") {
                    return {
                        replacement: {
                            id: genRdtId(),
                            type: "RDTDatasetPipeline",
                            metadata: {},
                            source: rdtSource.source,
                            pipeline: [
                                ...rdtSource.pipeline,
                                rdtDatasetOperator,
                            ],
                        } satisfies RDTDatasetPipeline,
                    };
                } else {
                    throw new Error(`Unknown dataset operator source: ${debugRDTNode(rdtSource)}`);
                }
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
    }) as RDTNode;
}
