import { walkDFS } from "./rdt";
import { RDTContext, RDTNode, RDTReference } from "./rdt.types";
import { replacer } from "./rdt.util";

export function resolveRdtReferences(source: RDTNode) {
    const rdtCtx2 = new RDTContext();
    const output = walkDFS(source, {
        state: rdtCtx2,
        onBefore(ctx) {
            if (ctx.node.type === "RDTDefinition") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.node.name.value, undefined, false).context,
                };
            } else if (ctx.node.type === "SimpleProperty") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.node.identifier.value, undefined, true).context,
                };
            } else if (ctx.node.type === "DerivedProperty") {
                return {
                    state: ctx.state.addNode(ctx.node, ctx.node.node.identifier.value, undefined, false).context,
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
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTSourceConstant") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTPropertyAccess" && parent.propertyName === ctx.node) {
                    return;
                }
                if (ctx.node.typeDef.type === "RDTTypeIdentifier" && ctx.node.typeDef.name === "string") {
                    const matchingNode = ctx.state.findByName(ctx.node.value);
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
        }
    });

    return {
        rdt: output,
        context: rdtCtx2,
    };
}