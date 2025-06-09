import { walkDFS } from "./rdt";
import { RDTNode, RDTRoot, RDTTypeDef, RDTTypeUnknown } from "./rdt.types";
import { debugRDTType, getTypeMetadata, replacer } from "./rdt.util";


function rdtIsType(node: RDTNode, type: string): boolean {
    const typeData = getTypeMetadata(node, {returnRawBinding: true});
    return typeData?.type === "RDTTypeIdentifier" && typeData.name === type;
}

function typesAreSameType(node1: RDTTypeDef, node2: RDTTypeDef): boolean {
    if (node1?.type !== node2?.type) return false;
    if (node1?.type === "RDTTypeUnknown") return true;
    if (node1?.type === "RDTTypeIdentifier" && node2?.type === "RDTTypeIdentifier") {
        return node1.name === node2.name;
    }
    if (node1?.type === "RDTObjectTypeDefinition" && node2?.type === "RDTObjectTypeDefinition") {
        // TODO: Implement this
        return true;
    }
    if (node1?.type === "RDTTypeFunctionDefinition" && node2?.type === "RDTTypeFunctionDefinition") {
        return true;
    }

    throw new Error(`Unable to compare types: ${JSON.stringify(node1, replacer, 2)} and ${JSON.stringify(node2, replacer, 2)}`);
}

function rdtIsSameType(node1: RDTNode, node2: RDTNode): boolean {
    const node1TypeData = getTypeMetadata(node1, {returnRawBinding: true});
    const node2TypeData = getTypeMetadata(node2, {returnRawBinding: true});
    if (!node1TypeData || !node2TypeData) {
        return false;
    }
    return typesAreSameType(node1TypeData, node2TypeData);
}

export function rdtIsNotKnown(node: RDTNode): boolean {
    const typeData = getTypeMetadata(node, {returnRawBinding: true});
    return !typeData || typeData.type === "RDTTypeUnknown";
}

export function resolveTypes(root: RDTRoot): RDTRoot {
    let wasUpdated = false;
    function setTypeMetadata(node: RDTNode, typeInfo: RDTTypeDef): void {
        wasUpdated = true;
        node.metadata["typeinfo"] = typeInfo;
    }

    function copyTypeMetadataIfKnown(source: RDTNode, dest: RDTNode): void {
        let meta = getTypeMetadata(source, {returnRawBinding: true});
        if (!meta || meta.type === "RDTTypeUnknown") return;
        if (meta.type === "RDTTypeBinding") {
            if (dest.type === "RDTReference") {
                setTypeMetadata(dest, meta.value);
            } else {
                setTypeMetadata(dest, meta.next);
            }
        } else {
            setTypeMetadata(dest, meta);
        }
    }

    let numIterations = 0;
    do {
        wasUpdated = false;
        root = walkDFS(root, {
            state: new Map<string, RDTNode>(),
            onBefore: (ctx) => {
                ctx.state.set(ctx.node.id, ctx.node);
            },
            onAfter: (ctx) => {
                if (ctx.node.type === "RDTSourceConstant") {
                    setTypeMetadata(ctx.node, ctx.node.typeDef);
                } else if (ctx.node.type === "RDTMath") {
                    if (rdtIsNotKnown(ctx.node.lhs) || rdtIsNotKnown(ctx.node.rhs)) return;
                    if (!rdtIsSameType(ctx.node.lhs, ctx.node.rhs)) throw new Error(`RDTMath lhs and rhs types do not match: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    if (["==", "<", ">"].includes(ctx.node.operator)) {
                        setTypeMetadata(ctx.node, { type: "RDTTypeIdentifier", name: "boolean" });
                    } else if (["+", "-", "*", "/"].includes(ctx.node.operator)) {
                        setTypeMetadata(ctx.node, { type: "RDTTypeIdentifier", name: "number" });
                    } else {
                        throw new Error(`Unknown RDTMath operator: ${ctx.node.operator} at node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    }
                } else if (ctx.node.type === "RDTFunction") {
                    const params = Object.fromEntries(ctx.node.parameters.map((param) => {
                        if (param.type !== "RDTSourceRuntime") throw new Error(`Unknown parameter RDT type: ${param.type} ${JSON.stringify(param, replacer, 2)}`);
                        const propMeta = rdtIsNotKnown(param) ? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown : getTypeMetadata(param)!;
                        return [param.name, propMeta];
                    }));

                    setTypeMetadata(ctx.node, {
                        type: "RDTTypeFunctionDefinition",
                        params,
                        returns: rdtIsNotKnown(ctx.node.body) ? { type: "RDTTypeUnknown" } : getTypeMetadata(ctx.node.body)!,
                    });
                } else if (ctx.node.type === "RDTSourceContext") {
                    if (ctx.node.typeDef.name === "row") {
                        const definitionAsParent = ctx.lineage.find((x) => x.type === "RDTDefinition");
                        if (!definitionAsParent) throw new Error(`Unable to find parent row definition`);
                        copyTypeMetadataIfKnown(definitionAsParent, ctx.node);
                    } else {
                        throw new Error(`Unknown contextual value $${ctx.node.name}`);
                    }
                    return;
                } else if (ctx.node.type === "DerivedProperty") {
                    copyTypeMetadataIfKnown(ctx.node.derivation, ctx.node);
                } else if (ctx.node.type === "SimpleProperty") {
                    setTypeMetadata(ctx.node, { type: "RDTTypeIdentifier", name: ctx.node.typeDef });
                } else if (ctx.node.type === "RDTDefinition") {
                    const props = Object.fromEntries(ctx.node.properties.map((prop) => {
                        const propMeta = rdtIsNotKnown(prop) ? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown : getTypeMetadata(prop)!;
                        return [prop.node.identifier.value, propMeta];
                    }));

                    setTypeMetadata(ctx.node, {
                        type: "RDTObjectTypeDefinition",
                        properties: props,
                    });
                } else if (ctx.node.type === "RDTPropertyAccess") {
                    if (rdtIsNotKnown(ctx.node.source)) return;
                    const typeMeta = getTypeMetadata(ctx.node.source)!
                    if (typeMeta.type !== "RDTObjectTypeDefinition") throw new Error(`Unable to RDTPropertyAccess type ${typeMeta.type}`);
                    if (ctx.node.propertyName.type !== "RDTSourceConstant") throw new Error(`Expected property access to be compile time constant: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    const propDef = typeMeta.properties[ctx.node.propertyName.value];
                    if (!propDef) throw new Error(`Property "${ctx.node.propertyName.value}" does not exist at node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    setTypeMetadata(ctx.node, propDef);
                } else if (ctx.node.type === "RDTSourceRuntime") {
                    setTypeMetadata(ctx.node, ctx.node.typeDef);
                } else if (ctx.node.type === "RDTRoot") {
                    // NOOP
                } else if (ctx.node.type === "RDTReference") {
                    const referencedNode = ctx.state.get(ctx.node.referenceId);
                    if (referencedNode) {
                        copyTypeMetadataIfKnown(referencedNode, ctx.node);
                    }
                } else if (ctx.node.type === "RDTConditional") {
                    if (rdtIsNotKnown(ctx.node.condition)) return;
                    if (!rdtIsType(ctx.node.condition, "boolean")) throw new Error(`Expected condition to be a boolean: ${JSON.stringify(ctx.node.condition, replacer, 2)}`);
                    if (rdtIsNotKnown(ctx.node.then) || rdtIsNotKnown(ctx.node.else)) return;
                    if (!rdtIsSameType(ctx.node.then, ctx.node.else)) {
                        throw new Error(`RDTConditional then and else types do not match: ${JSON.stringify(ctx.node, replacer, 2)} `);
                    }
                    copyTypeMetadataIfKnown(ctx.node.then, ctx.node);
                } else if (ctx.node.type === "RDTBinding") {
                    setTypeMetadata(ctx.node, {
                        type: "RDTTypeBinding",
                        value: getTypeMetadata(ctx.node.value) ?? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown,
                        next: getTypeMetadata(ctx.node.next) ?? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown,
                    });
                } else if (ctx.node.type === "RDTAssignment") {
                    if (rdtIsNotKnown(ctx.node.value)) return;
                    setTypeMetadata(ctx.node, getTypeMetadata(ctx.node.value)!);
                } else if (ctx.node.type === "RDTSideEffect") {
                    copyTypeMetadataIfKnown(ctx.node.next, ctx.node);
                } else if (ctx.node.type === "RDTInvoke") {
                    if (rdtIsNotKnown(ctx.node.source)) return;
                    if (ctx.node.args.some((arg) => rdtIsNotKnown(arg))) return;
                    const funcTypeMeta = getTypeMetadata(ctx.node.source)!;
                    if (funcTypeMeta.type !== "RDTTypeFunctionDefinition") {
                        throw new Error(`Expected RDTInvoke source to be a function definition, got: ${JSON.stringify(funcTypeMeta, replacer, 2)}`);
                    }
                    if (Object.keys(funcTypeMeta.params).length !== ctx.node.args.length) {
                        throw new Error(`Expected ${Object.keys(funcTypeMeta.params).length} arguments, got ${ctx.node.args.length} at node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    }
                    for (let i = 0; i < ctx.node.args.length; i++) {
                        const arg = ctx.node.args[i];
                        if (rdtIsNotKnown(arg)) return;
                        const ar = getTypeMetadata(arg, {returnRawBinding: true});
                        const paramName = Object.keys(funcTypeMeta.params)[i];
                        const paramType = funcTypeMeta.params[paramName];
                        if (rdtIsNotKnown(arg)) return;
                        if (!typesAreSameType(ar!, paramType)) {
                            throw new Error(`Expected argument ${i} to be of type ${debugRDTType(paramType)}, got ${debugRDTType(getTypeMetadata(arg, {returnRawBinding: true}))} at node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                        }
                    }
                    setTypeMetadata(ctx.node, funcTypeMeta.returns);
                } else {
                    throw new Error(`Unknown RDT node type: ${ctx.node.type} node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                }
            },
        }) as RDTRoot
        numIterations++;
    } while (wasUpdated && numIterations < 10);

    // if (numIterations === 10) {
    //     throw new Error(`!! Types did not resolve in time !!`);
    // }

    return root;
}