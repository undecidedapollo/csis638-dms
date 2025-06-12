
import { randomUUID } from "node:crypto";
import { AST, ASTNode, ReturnExprNode } from "./ast.types.js";
import { RDTAssignment, RDTBinding, RDTComputeNode, RDTConditional, RDTDefinition, RDTDerivedProperty, RDTFunction, RDTMath, RDTNode, RDTNull, RDTPostfix, RDTProperty, RDTReference, RDTReturn, RDTRoot, RDTSideEffect, RDTSimpleProperty, RDTSourceRuntime, RDTStringLiteral, RDTTypeBoolean, RDTTypeContext, RDTTypeDef, RDTTypeNumber, RDTTypeReference, RDTTypeString } from "./rdt.types.js";
import { debugRDTNode, replacer } from "./rdt.util.js";

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
    } else if (ast.type === "NumericLiteral") {
        return {
            id: genRdtId(),
            type: "RDTNumericLiteral",
            value: ast.value,
            metadata: {},
        };
    } else if (ast.type === "StringLiteral") {
        return {
            id: genRdtId(),
            type: "RDTStringLiteral",
            value: ast.value,
            metadata: {},
        };
    } else if (ast.type === "Identifier") {
        return {
            id: genRdtId(),
            type: "RDTIdentifier",
            value: ast.value,
            metadata: {},
        };
    } else if (ast.type === "ContextLiteral") {
        return {
            id: genRdtId(),
            type: "RDTSourceContext",
            name: ast.value?.value ?? "",
            metadata: {},
        };
    } else if (ast.type === "Param") {
        let typeDef: RDTTypeDef | undefined;
        if (ast.definition?.type === "ContextLiteral") {
            typeDef = {
                type: "RDTTypeContext",
                name: ast.definition.value?.value ?? "",
            } satisfies RDTTypeContext;
        } else if (ast.definition?.type === "Identifier") {
            if (ast.definition.value === "string") {
                typeDef = {
                    type: "string",
                } satisfies RDTTypeString;
            } else if (ast.definition.value === "number") {
                typeDef = {
                    type: "number",
                } satisfies RDTTypeNumber;
            }
            else if (ast.definition.value === "boolean") {
                typeDef = {
                    type: "boolean",
                } satisfies RDTTypeBoolean;
            } else {
                typeDef = {
                    type: "RDTTypeReference",
                    name: ast.definition.value,
                } satisfies RDTTypeReference;
            }
        }

        return {
            id: genRdtId(),
            type: "RDTSourceRuntime",
            name: ast.identifier.value,
            metadata: {
                ["typeAnnotation"]: typeDef,
            },
        } satisfies RDTSourceRuntime;
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
                    throw new Error(`Unsure how to handle RDTBinding with next node: ${JSON.stringify(curr, replacer, 2)}`);
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
                    name: identifier,
                    value: acc,
                    next: next as RDTComputeNode,
                } satisfies RDTBinding;
            } else {
                return {
                    id: genRdtId(),
                    type: "RDTSideEffect",
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
    } else if (ast.type === "PostfixOperator") {
        return {
            id: genRdtId(),
            type: "RDTPostfix",
            operator: ast.operator,
            operand: rdtExpressionWalker(ast.operand),
            metadata: {},
        } satisfies RDTPostfix;
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
            name: ast.name.value,
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
        if (ast.definition.type === "Identifier") {
            let typeDef: RDTTypeDef;
            if (ast.definition.value === "string") {
                typeDef = {
                    type: "string",
                } satisfies RDTTypeString;
            } else if (ast.definition.value === "number") {
                typeDef = {
                    type: "number",
                } satisfies RDTTypeNumber;
            }
            else if (ast.definition.value === "boolean") {
                typeDef = {
                    type: "boolean",
                } satisfies RDTTypeBoolean;
            } else {
                typeDef = {
                    type: "RDTTypeReference",
                    name: ast.definition.value,
                } satisfies RDTTypeReference;
            }
            return {
                id: genRdtId(),
                type: "SimpleProperty",
                name: ast.identifier.value,
                metadata: {
                    ["typeAnnotation"]: typeDef satisfies RDTTypeDef,
                },
            } satisfies RDTSimpleProperty;
        } else if (ast.definition.type === "ContextLiteral") {
            throw new Error(`DefinitionProperty with context type is not supported: ${JSON.stringify(ast, null, 2)}`);
        } else {
            const derivation = rdtExpressionWalker(ast.definition);
            return {
                id: genRdtId(),
                type: "DerivedProperty",
                name: ast.identifier.value,
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
        || defaultReturnNode.type === "RDTStringLiteral"
        || defaultReturnNode.type === "RDTNumericLiteral"
        || defaultReturnNode.type === "RDTIdentifier"
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
    } else if (defaultReturnNode.type === "RDTPostfix") {
        defaultReturnNode = {
            ...defaultReturnNode,
            operand: walkDFS(defaultReturnNode.operand, childOpts) as RDTComputeNode,
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
            if (ctx.node.type === "RDTReference" || ctx.node.type === "RDTStringLiteral" || ctx.node.type === "RDTNumericLiteral" || ctx.node.type === "RDTIdentifier") {
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
