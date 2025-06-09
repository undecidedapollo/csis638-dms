import { randomUUID } from "node:crypto";
import { AST, ASTNode, DefinitionFunctionNode, DefinitionNode, DefinitionPropertyNode, IdentifiesNode, ReturnExprNode } from "./ast.types";
import { RDTAssignment, RDTBinding, RDTComputeNode, RDTConditional, RDTContext, RDTDefinition, RDTDerivedProperty, RDTFunction, RDTMath, RDTNode, RDTNull, RDTProperty, RDTReference, RDTRoot, RDTSideEffect, RDTSimpleProperty, RDTSourceContext, RDTSourceRuntime, RDTTypeContext, RDTTypeDef, RDTTypeIdentifier, RDTTypeUnknown } from "./rdt.types";

export function genRdtId() {
    return randomUUID();
}

let systemIdentifierCounter = 0;
export function genSystemIdentifier() {
    return `$system_${systemIdentifierCounter++}`;
}

export function rdtExpressionWalker(ast: ASTNode, ctx: { context: RDTContext }): RDTComputeNode {
    if (ast.type === "operator") {
        if (["=="].includes(ast.operator) || "+-*/".includes(ast.operator)) {
            const lhs = rdtExpressionWalker(ast.lhs, ctx);
            const rhs = rdtExpressionWalker(ast.rhs, ctx);
            return {
                id: genRdtId(),
                type: "RDTMath",
                rdtContext: ctx.context,
                lhs,
                rhs,
                operator: ast.operator as RDTMath["operator"],
                metadata: {},
            };
        } else if (ast.operator === ".") {
            const source = rdtExpressionWalker(ast.lhs, ctx);
            const propertyName = rdtExpressionWalker(ast.rhs, ctx);

            return {
                id: genRdtId(),
                type: "RDTPropertyAccess",
                rdtContext: ctx.context,
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
            rdtContext: ctx.context,
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
            rdtContext: ctx.context,
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
            rdtContext: ctx.context,
            typeDef: {
                type: "RDTTypeContext",
                name: ast.value?.value,
            },
            metadata: {},
        };
    } else if (ast.type === "Param") {
        if (ast.definition?.type === "TypeExpr") {
            if (ast.definition?.array) throw new Error("rdt param type is array");
            const res = {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeIdentifier",
                    name: ast.definition.base.value,
                },
                metadata: {},
            } satisfies RDTSourceRuntime;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        } else if (ast.definition?.type === "context") {
            const res = {
                id: genRdtId(),
                type: "RDTSourceContext",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeContext",
                    name: ast.definition.value?.value,
                },
                metadata: {},
            } satisfies RDTSourceContext;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        } else {
            const res = {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeUnknown",
                },
                metadata: {},
            } satisfies RDTSourceRuntime;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        }
    } else if (ast.type === "LambdaExpr") {
        const childCtx = ctx.context.nested();
        const parameters = ast.params.map((param) => rdtExpressionWalker(param, { context: childCtx }));
        const body = rdtExpressionWalker(ast.body, { context: childCtx });
        const node = {
            id: genRdtId(),
            type: "RDTFunction",
            rdtContext: ctx.context,
            parameters,
            body,
            metadata: {},
        } satisfies RDTFunction;
        ctx.context.addNode(node, undefined, childCtx);
        return node;
    } else if (ast.type === "InvokeExpr") {
        const source = rdtExpressionWalker(ast.lhs, ctx);
        const args = ast.args.map((arg) => rdtExpressionWalker(arg, ctx));
        return {
            id: genRdtId(),
            type: "RDTInvoke",
            rdtContext: ctx.context,
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
            finalExpr = rdtExpressionWalker((astExprs[hasReturn] as ReturnExprNode).expr, ctx);
        } else {
            finalExpr = rdtNull(ctx.context);
        }

        const exprs = astExprs.slice(0, hasReturn !== -1 ? hasReturn : astExprs.length).map((expr) => rdtExpressionWalker(expr, ctx)).reverse();

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
                                        rdtContext: ctx.node.rdtContext,
                                        type: "RDTReference",
                                        referenceId: identifier,
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
                                        rdtContext: ctx.node.rdtContext,
                                        type: "RDTReference",
                                        referenceId: identifier,
                                    } satisfies RDTReference,
                                } satisfies RDTSideEffect,
                            };
                        }
                    }
                });
                return {
                    id: genRdtId(),
                    type: "RDTBinding",
                    rdtContext: ctx.context,
                    metadata: {},
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
                    rdtContext: ctx.context,
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
        const condition = rdtExpressionWalker(ast.condition, ctx);
        const thenExpr = rdtExpressionWalker(ast.then, ctx);
        const elseExpr = ast.else ? rdtExpressionWalker(ast.else, ctx) : rdtNull(ctx.context);

        return {
            id: genRdtId(),
            type: "RDTConditional",
            rdtContext: ctx.context,
            condition,
            then: thenExpr,
            else: elseExpr,
            metadata: {},
        };
    } else if (ast.type === "LetExpr") {
        const val = rdtExpressionWalker(ast.value, ctx);

        return {
            id: genRdtId(),
            type: "RDTBinding",
            rdtContext: ctx.context,
            typeDef: {
                // TODO: type not defined currently, add this to ast support
                type: "RDTTypeUnknown",
            },
            name: ast.identifier.value,
            value: val,
            next: rdtNull(ctx.context),
            metadata: {},
        };
    } else {
        throw new Error(`Unable to rdt walk for ast type: ${ast.type} node: ${JSON.stringify(ast, null, 2)}`);
    }
}

function rdtNull(context: RDTContext): RDTNull {
    return {
        id: genRdtId(),
        type: "RDTNull",
        rdtContext: context,
        metadata: {},
    };
}

export function astWalker(ast: ASTNode, ctx: { context: RDTContext }): RDTNode {
    if (ast.type === "Definition") {
        const def: RDTDefinition = {
            id: genRdtId(),
            type: "RDTDefinition",
            rdtContext: ctx.context,
            node: ast,
            properties: [],
            metadata: {},
        };
        const { context: child } = ctx.context.addNode(def, ast.name.value);
        for (const prop of ast.properties) {
            const propDef = astWalker(prop, { context: child });
            if (propDef.type !== "SimpleProperty" && propDef.type !== "DerivedProperty") {
                throw new Error(`Expected property to be SimpleProperty or DerivedProperty, got: ${propDef.type} at node: ${JSON.stringify(propDef, null, 2)}`);

            }
            def.properties.push(propDef);
        }
        return def;
    } else if (ast.type === "DefinitionProperty") {
        if (ast.definition.type === "TypeExpr") {
            if (ast.definition.array) throw new Error(`Table aliasing not supported, due to "${ast.definition.base.value}[]"`);
            const node = {
                id: genRdtId(),
                type: "SimpleProperty",
                rdtContext: ctx.context,
                node: ast,
                typeDef: ast.definition.base.value,
                metadata: {},
            } satisfies RDTSimpleProperty;
            ctx.context.addNode(node, ast.identifier.value, undefined, true);
            return node;
        } else {
            const childCtx = ctx.context.nested();
            const derivation = rdtExpressionWalker(ast.definition, { context: childCtx });
            const node = {
                id: genRdtId(),
                type: "DerivedProperty",
                rdtContext: ctx.context,
                node: ast,
                derivation,
                metadata: {},
            } satisfies RDTDerivedProperty;
            ctx.context.addNode(node, ast.identifier.value, childCtx);
            return node;
        }
    } else if (ast.type === "Assignment") {
        const value = rdtExpressionWalker(ast.value, ctx);
        const node = {
            id: genRdtId(),
            type: "RDTAssignment",
            rdtContext: ctx.context,
            name: ast.name.value,
            value,
            metadata: {},
        } satisfies RDTAssignment;
        ctx.context.addNode(node, ast.name.value, undefined, true);
        return node;
    } else {
        try {
            return rdtExpressionWalker(ast, { context: ctx.context });
        } catch (e) {
            throw new Error(`Error while walking ast: ${ast.type} node: ${JSON.stringify(ast, null, 2)}\n${e instanceof Error ? e.message : e}`);
        }
    }
}


export function convertToRDT(ast: AST, context: RDTContext): RDTRoot {
    const definitions: RDTDefinition[] = [];
    const assignments: RDTAssignment[] = [];
    for (const node of ast) {
        const res = astWalker(node, { context });
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
        rdtContext: context,
        definitions,
        assignments,
        metadata: {},
    };
}

export type WalkDFSOnNodeReturn = void | { replacement: RDTNode };

export interface WalkDFSOptions {
    onBefore?: (ctx: { node: RDTNode, lineage: RDTNode[] }) => WalkDFSOnNodeReturn;
    onAfter?: (ctx: { node: RDTNode, lineage: RDTNode[] }) => WalkDFSOnNodeReturn;
    currentLineage?: RDTNode[],
}

export function walkDFS(rdt: RDTNode, options: WalkDFSOptions): RDTNode {
    let defaultReturnNode: RDTNode = rdt;
    if (options.onBefore) {
        const beforeRes = options.onBefore({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
        });
        if (beforeRes && ("replacement" in beforeRes)) {
            defaultReturnNode = beforeRes.replacement;
        }
    }

    const childOpts = {
        ...options,
        currentLineage: options.currentLineage ? [defaultReturnNode, ...options.currentLineage] : [defaultReturnNode],
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
    } else {
        throw new Error(`Unable to walk unknown RDT node type: ${defaultReturnNode.type} node: ${JSON.stringify(defaultReturnNode, replacer, 2)}`);
    }

    if (options.onAfter) {
        const afterRes = options.onAfter({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
        });
        if (afterRes && ("replacement" in afterRes)) {
            defaultReturnNode = afterRes.replacement;
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
        return  Object.entries(obj).map(([key, val]) => {
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
    delete duplicate.rdtContext;
    delete duplicate.id;
    delete duplicate.type;
    delete (duplicate as any).typeDef;
    delete (duplicate as any).node;
    return duplicate;
}

export function toRDTreeString(rdt: RDTNode) {
    const output = walkDFS(rdt, {
        onAfter: (ctx) => {
            return {
                replacement: {
                    [debugRDTNode(ctx.node)]: removeUnusedRDTFields(ctx.node),
                } as any,
            };
        }
    }) as RDTNode;
    return prettyPrint(output);
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
    }

    return `${name}:${node.type}`;
}

export function getTypeMetadata(node: RDTNode, createIfNotExists?: boolean): RDTTypeDef | undefined {
    let res = node.metadata["typeinfo"];
    if (res || !createIfNotExists) return res;
    res = {};
    node.metadata["typeinfo"] = {};
    return res;
}

function rdtIsNumber(node: RDTNode): boolean {
    const typeData = getTypeMetadata(node);
    return typeData?.type === "RDTTypeIdentifier" && typeData.name === "number";
}

export function rdtIsNotKnown(node: RDTNode): boolean {
    const typeData = getTypeMetadata(node);
    return !typeData || typeData.type === "RDTTypeUnknown";
}

export function resolveTypes(root: RDTRoot): RDTRoot {
    let wasUpdated = false;
    function setTypeMetadata(node: RDTNode, typeInfo: RDTTypeDef): void {
        wasUpdated = true;
        node.metadata["typeinfo"] = typeInfo;
    }

    function copyTypeMetadataIfKnown(source: RDTNode, dest: RDTNode): void {
        const meta = getTypeMetadata(source, false);
        if (!meta || meta.type === "RDTTypeUnknown") return;
        setTypeMetadata(dest, meta);
    }

    let numIterations = 0;
    do {
        wasUpdated = false;
        root = walkDFS(root, {
            onAfter: (ctx) => {
                if (ctx.node.type === "RDTSourceConstant") {
                    setTypeMetadata(ctx.node, ctx.node.typeDef);
                } else if (ctx.node.type === "RDTMath") {
                    if (rdtIsNotKnown(ctx.node.lhs) || rdtIsNotKnown(ctx.node.rhs)) return;
                    if (!rdtIsNumber(ctx.node.lhs)) throw new Error(`Excepted lhs to be a number: ${JSON.stringify(ctx.node.lhs, replacer, 2)}`);
                    if (!rdtIsNumber(ctx.node.rhs)) throw new Error(`Excepted rhs to be a number: ${JSON.stringify(ctx.node.rhs, replacer, 2)}`);
                    setTypeMetadata(ctx.node, { type: "RDTTypeIdentifier", name: "number" });
                } else if (ctx.node.type === "RDTFunction") {
                    const params = Object.fromEntries(ctx.node.parameters.map((param) => {
                        if (param.type !== "RDTSourceRuntime") throw new Error(`Unknown parameter RDT type: ${param.type} ${JSON.stringify(param, replacer, 2)}`);
                        const propMeta = rdtIsNotKnown(param) ? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown : getTypeMetadata(param, false)!;
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
                        const propMeta = rdtIsNotKnown(prop) ? { type: "RDTTypeUnknown" } satisfies RDTTypeUnknown : getTypeMetadata(prop, false)!;
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