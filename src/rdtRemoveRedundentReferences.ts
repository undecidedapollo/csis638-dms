import {  walkDFS } from "./rdt";
import { RDTContext, RDTNode, RDTReference } from "./rdt.types";

export function removeRedundentReferences(source: RDTNode) {
    const referenceMapping = new Map<string, RDTReference>();
    const output = walkDFS(source, {
        onBefore(ctx) {
            if (ctx.node.type === "RDTBinding" && ctx.node.value.type === "RDTReference") {
                referenceMapping.set(ctx.node.id, ctx.node.value);
                return {
                    replacement: ctx.node.next,
                };
            } else if (ctx.node.type === "RDTReference" && referenceMapping.has(ctx.node.referenceId)) {
                const mapping = referenceMapping.get(ctx.node.referenceId)!;
                return {
                    replacement: {
                        ...mapping,
                        id: ctx.node.id, // Keep the old node id. All nodes should be unique in the tree.
                    } satisfies RDTReference,
                };
            }
        },
    });

    return {
        rdt: output,
    };
}