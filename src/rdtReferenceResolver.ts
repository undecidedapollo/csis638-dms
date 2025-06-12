import { walkDFS } from "./rdt.js";
import { RDTContext, RDTNode, RDTReference } from "./rdt.types.js";
import { debugRDTNode, replacer } from "./rdt.util.js";

export function resolveRdtReferences(source: RDTNode) {
    const ctxPerNode = new Map<string, RDTContext>();
    const rdtCtx2 = new RDTContext();

    // Generate the reference context
    walkDFS(source, {
        state: rdtCtx2,
        onBefore(ctx) {
            ctxPerNode.set(ctx.node.id, ctx.state);
            if (ctx.node.type === "RDTDefinition") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.name, undefined, false).context,
                };
            } else if (ctx.node.type === "SimpleProperty") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.name, undefined, true).context,
                };
            } else if (ctx.node.type === "DerivedProperty") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.name, undefined, false).context,
                };
            } else if (ctx.node.type === "RDTAssignment") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.name, undefined, false).context,
                };
            } else if (ctx.node.type === "RDTFunction") {
                const { context: childContext } = ctx.state.addNode(ctx.node, ctx.node.name, undefined, false);
                ctx.node.parameters.forEach((param) => {
                    if (param.type !== "RDTSourceRuntime") {
                        throw new Error(`Expected parameter to be RDTSourceRuntime, got: ${param.type}`);
                    }
                    childContext.addNode(param, param.name, undefined, true);
                });
                return {
                    state: childContext,
                };
            } else if (ctx.node.type === "RDTBinding") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.name, undefined, false).context,
                };
            }
        },
    });

    const output = walkDFS(source, {
        state: rdtCtx2,
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTIdentifier") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTPropertyAccess" && parent.propertyName === ctx.node) {
                    return;
                }

                console.log(`Finding thing ${debugRDTNode(ctx.node)}`);
                const matchingRdtCtx = ctxPerNode.get(ctx.node.id);
                if (!matchingRdtCtx) {
                    throw new Error(`Unable to find context for node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                }
                const matchingNode = matchingRdtCtx.findByName(ctx.node.value);
                if (!matchingNode) {
                    throw new Error(`Unable to find expected reference: ${ctx.node.value} for node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                }
                return {
                    replacement: {
                        id: ctx.node.id,
                        type: "RDTReference",
                        referenceId: matchingNode.node.id,
                        name: ctx.node.value,
                        metadata: {},
                    } satisfies RDTReference,
                };
            }
        }
    });

    return {
        rdt: output,
        context: rdtCtx2,
        ctxPerNode,
    };
}