
import { randomUUID } from "node:crypto";
import { AST, ASTNode, IdentifiesNode, ReturnExprNode } from "./ast.types";
import { RDTAssignment, RDTBinding, RDTComputeNode, RDTConditional, RDTContext, RDTDefinition, RDTDerivedProperty, RDTFunction, RDTMath, RDTNode, RDTNull, RDTProperty, RDTReference, RDTReturn, RDTRoot, RDTSideEffect, RDTSimpleProperty, RDTSourceContext, RDTSourceRuntime, RDTTypeContext, RDTTypeDef, RDTTypeIdentifier, RDTTypeUnknown } from "./rdt.types";

export function genRdtId() {
    return randomUUID();
}

let systemIdentifierCounter = 0;
export function genSystemIdentifier() {
    return `$system_${systemIdentifierCounter++}`;
}

export function rdtExpressionWalker(ast: ASTNode): RDTComputeNode {
    if (ast.type === "operator") {
        if (["=="].includes(ast.operator) || "+-*/<>".includes(ast.operator)) {
            const lhs = rdtExpressionWalker(ast.lhs);
            const rhs = rdtExpressionWalker(ast.rhs);
            return {
                id: genRdtId(),
                type: "RDTMath",
                lhs,
                rhs,
                operator: ast.operator as RDTMath["operator"],
                metadata: {},
            };
        } else if (ast.operator === ".") {
            const source = rdtExpressionWalker(ast.lhs);
            const propertyName = rdtExpressionWalker(ast.rhs);

            return {
                id: genRdtId(),
                type: "RDTPropertyAccess",
                source,
                propertyName,
                metadata: {},
            };
        }
        else {
            throw new Error(`RDT Operator not supported: ${ast.operator}`);
        }
    } else if (ast.type === "TypeExpr") {
        if (ast.array) throw new Error("Array type expr not support rdt walker");
        return {
            id: genRdtId(),
            type: "RDTSourceConstant",
            value: ast.base.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: "string",
            },
            metadata: {},
        };
    } else if (ast.type === "number" || ast.type === "string") {
        return {
            id: genRdtId(),
            type: "RDTSourceConstant",
            value: ast.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: ast.type,
            },
            metadata: {},
        };
    } else if (ast.type === "context") {
        return {
            id: genRdtId(),
            type: "RDTSourceContext",
            typeDef: {
                type: "RDTTypeContext",
                name: ast.value?.value,
            },
            metadata: {},
        };
    } else if (ast.type === "Param") {
        if (ast.definition?.type === "TypeExpr") {
            if (ast.definition?.array) throw new Error("rdt param type is array");
            return {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeIdentifier",
                    name: ast.definition.base.value,
                },
                metadata: {},
            } satisfies RDTSourceRuntime;
        } else if (ast.definition?.type === "context") {
            return {
                id: genRdtId(),
                type: "RDTSourceContext",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeContext",
                    name: ast.definition.value?.value,
                },
                metadata: {},
            } satisfies RDTSourceContext;
        } else {
            const res = {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeUnknown",
                },
                metadata: {},
            } satisfies RDTSourceRuntime;
            return res;
        }
    } else if (ast.type === "LambdaExpr") {
        const parameters = ast.params.map((param) => rdtExpressionWalker(param));
        const body = rdtExpressionWalker(ast.body);
        const node = {
            id: genRdtId(),
            type: "RDTFunction",
            parameters,
            body,
            metadata: {},
        } satisfies RDTFunction;
        return node;
    } else if (ast.type === "InvokeExpr") {
        const source = rdtExpressionWalker(ast.lhs);
        const args = ast.args.map((arg) => rdtExpressionWalker(arg));
        return {
            id: genRdtId(),
            type: "RDTInvoke",
            source,
            args,
            metadata: {},
        };
    } else if (ast.type === "OrderedExpressionsBlock") {
        const hasReturn = ast.exprs.findIndex((expr) => expr.type === "ReturnExpr");
        if (hasReturn !== -1 && hasReturn !== ast.exprs.length - 1) {
            throw new Error(`Return expression must be the last expression in an ordered expressions block, found at index ${hasReturn} in: ${JSON.stringify(ast, replacer, 2)}`);
        }
    
        let astExprs = ast.exprs;
        let finalExpr: RDTNode;
        if (hasReturn !== -1) {
            finalExpr = rdtExpressionWalker((astExprs[hasReturn] as ReturnExprNode).expr);
        } else {
            finalExpr = rdtNull();
        }
    
        const exprs = astExprs.slice(0, hasReturn !== -1 ? hasReturn : astExprs.length).map((expr) => rdtExpressionWalker(expr)).reverse();
    
        if (exprs.length === 0) {
            return finalExpr;
        }
    
        return exprs.reduce((acc: RDTComputeNode, curr) => {
            if (curr.type === "RDTBinding") {
                if (curr.next.type !== "RDTNull") {
                    throw new Error(`Unsure how to handle RDTBinding with next node: ${JSON.stringify(curr, replacer2, 2)}`);
                }
                curr.next = acc;
                return curr;
            }
            else if (curr.type === "RDTConditional") {
                if (curr.else.type === "RDTNull") {
                    return {
                        ...curr,
                        else: acc,
                    };
                }
                let referenceId = genRdtId();
                let identifier = genSystemIdentifier();
                const next = walkDFS(curr, {
                    onAfter: (ctx) => {
                        if (ctx.node.type === "RDTConditional" && ctx.node.else.type === "RDTNull") {
                            // If the else branch is null, we can just return the then branch
                            return {
                                replacement: {
                                    ...ctx.node,
                                    else: {
                                        id: genRdtId(),
                                        metadata: {},
                                        type: "RDTReference",
                                        referenceId,
                                        name: identifier,
                                    } satisfies RDTReference,
                                } satisfies RDTConditional,
                            };
                        } else if (ctx.node.type === "RDTSideEffect" && ctx.node.next.type === "RDTNull") {
                            return {
                                replacement: {
                                    ...ctx.node,
                                    next: {
                                        id: genRdtId(),
                                        metadata: {},
                                        type: "RDTReference",
                                        referenceId,
                                        name: identifier,
                                    } satisfies RDTReference,
                                } satisfies RDTSideEffect,
                            };
                        }
                    }
                });
                return {
                    id: referenceId,
                    type: "RDTBinding",
                    metadata: {
                        "systemGenerated": true,
                    },
                    typeDef: {
                        type: "RDTTypeUnknown",
                    },
                    name: identifier,
                    value: acc,
                    next: next as RDTComputeNode,
                } satisfies RDTBinding;
            } else {
                return {
                    id: genRdtId(),
                    type: "RDTSideEffect",
                    typeDef: {
                        type: "RDTTypeUnknown",
                    },
                    expr: curr,
                    next: acc,
                    metadata: {},
                } satisfies RDTSideEffect;
            }
        }, finalExpr);
    } else if (ast.type === "IfExpr") {
        const condition = rdtExpressionWalker(ast.condition);
        const thenExpr = rdtExpressionWalker(ast.then);
        const elseExpr = ast.else ? rdtExpressionWalker(ast.else) : rdtNull();

        return {
            id: genRdtId(),
            type: "RDTConditional",
            condition,
            then: thenExpr,
            else: elseExpr,
            metadata: {},
        };
    } else if (ast.type === "LetExpr") {
        const val = rdtExpressionWalker(ast.value);
        return {
            id: genRdtId(),
            type: "RDTBinding",
            typeDef: {
                // TODO: type not defined currently, add this to ast support
                type: "RDTTypeUnknown",
            },
            name: ast.identifier.value,
            value: val,
            next: rdtNull(),
            metadata: {},
        } satisfies RDTBinding;
    } else if (ast.type === "ReturnExpr") {
        return {
            id: genRdtId(),
            type: "RDTReturn",
            metadata: {},
            value: rdtExpressionWalker((ast as ReturnExprNode).expr),
        } satisfies RDTReturn;
    } else {
        throw new Error(`Unable to rdt walk for ast type: ${ast.type} node: ${JSON.stringify(ast, null, 2)}`);
    }
}




function rdtNull(): RDTNull {
    return {
        id: genRdtId(),
        type: "RDTNull",
        metadata: {},
    };
}

export function astWalker(ast: ASTNode): RDTNode {
    if (ast.type === "Definition") {
        const def: RDTDefinition = {
            id: genRdtId(),
            type: "RDTDefinition",
            node: ast,
            properties: [],
            metadata: {},
        };
        for (const prop of ast.properties) {
            const propDef = astWalker(prop);
            if (propDef.type !== "SimpleProperty" && propDef.type !== "DerivedProperty") {
                throw new Error(`Expected property to be SimpleProperty or DerivedProperty, got: ${propDef.type} at node: ${JSON.stringify(propDef, null, 2)}`);

            }
            def.properties.push(propDef);
        }
        return def;
    } else if (ast.type === "DefinitionProperty") {
        if (ast.definition.type === "TypeExpr") {
            if (ast.definition.array) throw new Error(`Table aliasing not supported, due to "${ast.definition.base.value}[]"`);
            return {
                id: genRdtId(),
                type: "SimpleProperty",
                node: ast,
                typeDef: ast.definition.base.value,
                metadata: {},
            } satisfies RDTSimpleProperty;
        } else {
            const derivation = rdtExpressionWalker(ast.definition);
            return {
                id: genRdtId(),
                type: "DerivedProperty",
                node: ast,
                derivation,
                metadata: {},
            } satisfies RDTDerivedProperty;
        }
    } else if (ast.type === "Assignment") {
        const value = rdtExpressionWalker(ast.value);
        return {
            id: genRdtId(),
            type: "RDTAssignment",
            name: ast.name.value,
            value,
            metadata: {},
        } satisfies RDTAssignment;
    } else {
        try {
            return rdtExpressionWalker(ast);
        } catch (e) {
            throw new Error(`Error while walking ast: ${ast.type} node: ${JSON.stringify(ast, null, 2)}\n${e instanceof Error ? e.message : e}`);
        }
    }
}


export function convertToRDT(ast: AST): RDTRoot {
    const definitions: RDTDefinition[] = [];
    const assignments: RDTAssignment[] = [];
    for (const node of ast) {
        const res = astWalker(node);
        if (!res) continue;
        if (res.type === "RDTDefinition") {
            definitions.push(res);
        } else if (res.type === "RDTAssignment") {
            assignments.push(res);
        } else {
            throw new Error(`Expected RDTDefinition or RDTAssignment, got: ${res.type} at node: ${JSON.stringify(res, null, 2)}`);
        }
    }
    return {
        id: genRdtId(),
        type: "RDTRoot",
        definitions,
        assignments,
        metadata: {},
    };
}

export type WalkDFSOnNodeReturn<T> = void | { replacement?: RDTNode, state?: T };

export interface WalkDFSOptions<T> {
    onBefore?: (ctx: { node: RDTNode, lineage: RDTNode[], state: T }) => WalkDFSOnNodeReturn<T>;
    onAfter?: (ctx: { node: RDTNode, lineage: RDTNode[], state: T }) => WalkDFSOnNodeReturn<never>;
    currentLineage?: RDTNode[],
    state?: T;
}

export function walkDFS<T = any>(rdt: RDTNode, options: WalkDFSOptions<T>): RDTNode {
    let defaultReturnNode: RDTNode = rdt;
    let state: unknown = options.state;
    if (options.onBefore) {
        const beforeRes = options.onBefore({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
            state: options.state!,
        });
        if (beforeRes) {
            if ("state" in beforeRes) {
                state = beforeRes.state;
            }
            if ("replacement" in beforeRes) {
                // TODO: What does it mean to replace onBefore? If it is a new node, it should be visited right? like a child? If it is the same node it has already been visited.
                if (beforeRes.replacement!.id !== defaultReturnNode.id) {
                    return walkDFS(beforeRes.replacement!, {
                        ...options,
                        state,
                    });
                } else {
                    defaultReturnNode = beforeRes.replacement!;
                }
            }
        }
    }

    const childOpts = {
        ...options,
        currentLineage: options.currentLineage ? [defaultReturnNode, ...options.currentLineage] : [defaultReturnNode],
        state: state as T,
    };

    if (defaultReturnNode.type === "RDTRoot") {
        defaultReturnNode = {
            ...defaultReturnNode,
            definitions: defaultReturnNode.definitions.map((def) => walkDFS(def, childOpts)) as RDTDefinition[],
            assignments: defaultReturnNode.assignments.map((assign) => walkDFS(assign, childOpts)) as RDTAssignment[],
        };
    } else if (defaultReturnNode.type === "RDTDefinition") {
        defaultReturnNode = {
            ...defaultReturnNode,
            properties: defaultReturnNode.properties.map((prop) => walkDFS(prop, childOpts)) as RDTProperty[],
        };
    } else if (defaultReturnNode.type === 'DerivedProperty') {
        defaultReturnNode = {
            ...defaultReturnNode,
            derivation: walkDFS(defaultReturnNode.derivation, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTFunction") {
        defaultReturnNode = {
            ...defaultReturnNode,
            parameters: defaultReturnNode.parameters.map((param) => walkDFS(param, childOpts)) as RDTComputeNode[],
            body: walkDFS(defaultReturnNode.body, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTMath") {
        defaultReturnNode = {
            ...defaultReturnNode,
            lhs: walkDFS(defaultReturnNode.lhs, childOpts) as RDTComputeNode,
            rhs: walkDFS(defaultReturnNode.rhs, childOpts) as RDTComputeNode,
        }
    } else if (defaultReturnNode.type === "RDTPropertyAccess") {
        defaultReturnNode = {
            ...defaultReturnNode,
            source: walkDFS(defaultReturnNode.source, childOpts) as RDTComputeNode,
            propertyName: walkDFS(defaultReturnNode.propertyName, childOpts) as RDTComputeNode,
        };
    } else if (
        defaultReturnNode.type === 'SimpleProperty'
        || defaultReturnNode.type === "RDTSourceConstant"
        || defaultReturnNode.type === "RDTSourceContext"
        || defaultReturnNode.type === "RDTSourceRuntime"
        || defaultReturnNode.type === "RDTNull"
        || defaultReturnNode.type === "RDTReference"
    ) {

    } else if (defaultReturnNode.type === "RDTAssignment") {
        defaultReturnNode = {
            ...defaultReturnNode,
            value: walkDFS(defaultReturnNode.value, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTConditional") {
        defaultReturnNode = {
            ...defaultReturnNode,
            condition: walkDFS(defaultReturnNode.condition, childOpts) as RDTComputeNode,
            then: walkDFS(defaultReturnNode.then, childOpts) as RDTComputeNode,
            else: walkDFS(defaultReturnNode.else, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTBinding") {
        defaultReturnNode = {
            ...defaultReturnNode,
            value: walkDFS(defaultReturnNode.value, childOpts) as RDTComputeNode,
            next: walkDFS(defaultReturnNode.next, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTSideEffect") {
        defaultReturnNode = {
            ...defaultReturnNode,
            expr: walkDFS(defaultReturnNode.expr, childOpts) as RDTComputeNode,
            next: walkDFS(defaultReturnNode.next, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTInvoke") {
        defaultReturnNode = {
            ...defaultReturnNode,
            source: walkDFS(defaultReturnNode.source, childOpts) as RDTComputeNode,
            args: defaultReturnNode.args.map((arg) => walkDFS(arg, childOpts)) as RDTComputeNode[],
        }
    } else if (defaultReturnNode.type === "RDTOrderedExpressions") {
        defaultReturnNode = {
            ...defaultReturnNode,
            exprs: defaultReturnNode.exprs.map((expr) => walkDFS(expr, childOpts)) as RDTComputeNode[],
        };
    } else if (defaultReturnNode.type === "RDTReturn") {
        defaultReturnNode = {
            ...defaultReturnNode,
            value: walkDFS(defaultReturnNode.value, childOpts) as RDTComputeNode,
        };
    } else {
        throw new Error(`Unable to walk unknown RDT node type: ${defaultReturnNode.type} node: ${JSON.stringify(defaultReturnNode, replacer, 2)}`);
    }

    if (options.onAfter) {
        const afterRes = options.onAfter({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
            state: state as any,
        });
        if (afterRes && ("replacement" in afterRes)) {
            defaultReturnNode = afterRes.replacement!;
        }
    }
    return defaultReturnNode;
}

export function getIdentifierName(ast: IdentifiesNode) {
    if (ast.type === "DefinitionProperty" || ast.type === "Param" || ast.type === "ObjectLiteralProperty") {
        return ast.identifier.value;
    }
    if (ast.type === "Definition" || ast.type === "DefinitionFunction" || ast.type === "ObjectLiteralFunction") {
        return ast.name.value;
    }
    if (ast.type === "TypeExpr") {
        return ast.base.value;
    }
}

export const replacer = (key, value) => {
    if (key === "node") {
        return `${getIdentifierName(value) ?? "unknown"}:${value.type ?? "unknown"}`;
    } else if (key === "rdtContext") {
        return undefined;
    } else {
        return value;
    }
};

export const replacer2 = (key, value) => {
    if (key === "node") {
        return `${getIdentifierName(value) ?? "unknown"}:${value.type ?? "unknown"}`;
    } else if (key === "rdtContext" || key === "metadata" || key === "typeDef") {
        return undefined;
    } else {
        return value;
    }
};

const prettyPrint = (obj: any, depth: number = 0) => {
    if (obj === null) {
        obj = "null";
    } else if (obj === undefined) {
        obj = "undefined";
    }

    if (typeof obj === "string" || typeof obj === "number") {
        if (depth === 0) {
            return obj;
        } else if (depth === 1) {
            return `${'╰───'.repeat(depth)} ${obj}`;
        } else {
            return `${'    '.repeat(depth - 1)}╰──── ${obj}`;
        }
    }

    if (typeof obj === "object" && !Array.isArray(obj)) {
        return Object.entries(obj).map(([key, val]) => {
            return `${'    '.repeat(Math.max(depth - 1, 0))}${depth === 0 ? "" : "╰── "}${key}:\n${prettyPrint(val, depth + 1)}`;
        }).join("\n");
    } else if (Array.isArray(obj)) {
        return obj.map((item, index) => {
            return `${'    '.repeat(Math.max(depth - 1, 0))}╰──[${index}]:\n${prettyPrint(item, depth + 1)}`;
        }).join("\n");
    }
    else {
        return `${'    '.repeat(depth)} Unknown (${JSON.stringify(obj)})`;
    }
}

function removeUnusedRDTFields(node: RDTNode): any {
    const duplicate: Partial<RDTNode> = { ...node };
    delete duplicate.metadata;
    delete duplicate.id;
    delete duplicate.type;
    delete (duplicate as any).typeDef;
    delete (duplicate as any).node;
    return duplicate;
}

export function toRDTreeString(rdt: RDTNode) {
    const output = walkDFS(rdt, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTReference" || ctx.node.type === "RDTSourceConstant") {
                return { replacement: debugRDTNode(ctx.node) as any };
            }
            return {
                replacement: {
                    [debugRDTNode(ctx.node)]: removeUnusedRDTFields(ctx.node),
                } as any,
            };
        }
    }) as RDTNode;
    return prettyPrint(output);
}

export function debugRDTType(type?: RDTTypeDef) {
    if (!type) return "unknown";
    if (type.type === "RDTTypeUnknown") return "unknown";
    if (type.type === "RDTTypeIdentifier") return type.name;
    if (type.type === "RDTObjectTypeDefinition") {
        return `object(${Object.entries(type.properties).map(([key, value]) => `${key}: ${debugRDTType(value)}`).join(", ")})`;
    }
    if (type.type === "RDTTypeContext") {
        return `$${type.name}`;
    }
    if (type.type === "RDTTypeBinding") {
        return `binding(${debugRDTType(type.value)}, ${debugRDTType(type.next)})`;
    }
    if (type.type === "RDTTypeFunctionDefinition") {
        return `(${Object.entries(type.params).map(([key, value]) => `${key}: ${debugRDTType(value)}`).join(", ")}) => ${debugRDTType(type.returns)}`;
    }

    throw new Error(`Unknown RDT type: ${JSON.stringify(type, replacer, 2)}`);
}


export function debugRDTNode(node: RDTNode) {
    let name: string = "unknown";
    if (node.type === "RDTFunction") {
        name = node.name ?? name;
    } else if (node.type === "DerivedProperty") {
        name = node.node.identifier.value;
    } else if (node.type === "RDTDefinition") {
        name = node.node.name.value;
    } else if (node.type === "RDTRoot") {
        name = "root";
    } else if (node.type === "RDTMath") {
        name = node.operator;
    } else if (node.type === "RDTReference") {
        name = node.name ?? node.referenceId;
    } else if (node.type === "RDTSourceConstant") {
        name = node.value;
    }

    return `${name}:${node.type} ${debugRDTType(getTypeMetadata(node, { returnRawBinding: true }))}`;
}

export function getTypeMetadata(node: RDTNode, options?: { returnRawBinding?: boolean}): RDTTypeDef | undefined {
    let res = node.metadata["typeinfo"] as RDTTypeDef;
    if (!res) return undefined;
    if (res.type === "RDTTypeBinding" && !options?.returnRawBinding) {
        return res.next;
    }
    return res;
}

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