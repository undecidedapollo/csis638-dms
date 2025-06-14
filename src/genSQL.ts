import { walkDFS } from "./rdt.js";
import { RDTComputeNode, RDTContext, RDTNode, RDTRoot } from "./rdt.types.js";
import { debugRDTNode } from "./rdt.util.js";
import { TargetStage, transpile } from "./transpiler.js";
import fs from "node:fs";

type SQLTable = {
    type: "SQLTable";
    name: string;
    fields: Record<string, string>;
}

type FilterIntent = {
    type: "FilterIntent";
    source: SQLTable;
}

type SQLCondition = {
    type: "SQLCondition";
    operator: "=" | "AND" | "||";
    lhs: SQLCondition | SQLField | SQLStringLiteral;
    rhs: SQLCondition | SQLField | SQLStringLiteral;
}

type SQLField = {
    type: "SQLField";
    table: SQLTable;
    field: string;
}

type SQLStringLiteral = {
    type: "SQLStringLiteral";
    value: string;
}

type SQLFilter = {
    type: "SQLFilter";
    source: SQLTable;
    condition: SQLCondition;
}

type SQLNode = SQLTable | SQLField | SQLCondition | SQLFilter | FilterIntent | SQLStringLiteral;

export function rdtToSqlTree({ tree, root }: { root: RDTRoot, tree: RDTComputeNode }): SQLNode {
    const nodeMap = new Map<string, RDTNode>();

    walkDFS(root, {
        onBefore: (ctx) => {
            if (nodeMap.has(ctx.node.id)) return;
            nodeMap.set(ctx.node.id, ctx.node);
        },
    });
    walkDFS(tree, {
        onBefore: (ctx) => {
            if (nodeMap.has(ctx.node.id)) return;
            nodeMap.set(ctx.node.id, ctx.node);
        },
    });
    const result = walkDFS<SQLNode>(tree, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTPostfix" && ctx.node.operator === "[]" && ctx.node.operand.type === "RDTReference") {
                const referencedNode = nodeMap.get(ctx.node.operand.referenceId);
                if (!referencedNode) throw new Error(`Referenced node not found: ${ctx.node.operand.referenceId}`);
                if (referencedNode.type !== "RDTDefinition") throw new Error(`Expected referenced node to be a definition, got: ${referencedNode.type}`);
                console.log(`Generating SQL for node: ${ctx.node.operand.referenceId} (${referencedNode.name})`);
                return {
                    replacement: {
                        type: "SQLTable",
                        name: referencedNode.name,
                        fields: {},
                    },
                };
            }
            if (ctx.node.type === "RDTPropertyAccess" && (ctx.node.source as unknown as SQLTable).type === "SQLTable") {
                if (ctx.node.propertyName.type === "RDTIdentifier" && ctx.node.propertyName.value === "filter") {
                    return {
                        replacement: {
                            type: "FilterIntent",
                            source: ctx.node.source as unknown as SQLTable,
                        } satisfies FilterIntent,
                    };
                }
                throw new Error(`Unexpected property access: ${debugRDTNode(ctx.node.propertyName)} on ${ctx.node.source.type}`);
            }
            if (ctx.node.type === "RDTInvoke" && (ctx.node.source as unknown as SQLNode).type === "FilterIntent") {
                const filterIntent = ctx.node.source as unknown as FilterIntent;
                if (ctx.node.args.length !== 1) throw new Error(`Expected exactly one argument for filter, got: ${ctx.node.args.length}`);
                if (ctx.node.args[0].type !== "RDTFunction") throw new Error(`Expected argument to be a function, got: ${ctx.node.args[0].type}`);
                const filterFunction = ctx.node.args[0];
                if (filterFunction.parameters.length !== 1) throw new Error(`Expected exactly one parameter for filter function, got: ${filterFunction.parameters.length}`);
                const output = walkDFS<SQLNode>(filterFunction.body, {
                    onAfter: (fCtx) => {
                        if (fCtx.node.type === "RDTReference") {
                            const referencedNode = nodeMap.get(fCtx.node.referenceId);
                            if (!referencedNode) throw new Error(`Referenced node not found: ${fCtx.node.referenceId}`);
                            if (referencedNode.id !== filterFunction.parameters[0].id) {
                                throw new Error(`Expected referenced node to be the filter parameter, got: ${referencedNode.type}`);
                            }
                            return {
                                replacement: filterIntent.source,
                            };
                        }
                        if (fCtx.node.type === "RDTPropertyAccess") {
                            const source = fCtx.node.source as unknown as SQLTable;
                            if (source.type !== "SQLTable") {
                                throw new Error(`Expected source of property access to be SQLTable, got: ${source.type}`);
                            }
                            if (fCtx.node.propertyName.type !== "RDTIdentifier") {
                                throw new Error(`Expected property name to be an identifier, got: ${fCtx.node.propertyName.type}`);
                            }
                            return {
                                replacement: {
                                    type: "SQLField",
                                    table: source,
                                    field: fCtx.node.propertyName.value,
                                } satisfies SQLField,
                            };
                        }

                        if (fCtx.node.type === "RDTMath") {
                            const lhs = fCtx.node.lhs as unknown as SQLNode;
                            const rhs = fCtx.node.rhs as unknown as SQLNode;
                            if (lhs.type !== "SQLField" && lhs.type !== "SQLStringLiteral" && lhs.type !== "SQLCondition") {
                                throw new Error(`Expected source of math operation to be SQLField, SQLStringLiteral or SQLCondition, got: ${lhs.type}`);
                            }
                            if (rhs.type !== "SQLField" && rhs.type !== "SQLStringLiteral" && rhs.type !== "SQLCondition") {
                                throw new Error(`Expected source of math operation to be SQLField, SQLStringLiteral or SQLCondition, got: ${rhs.type}`);
                            }
                            let operator: "=";
                            if (fCtx.node.operator === "==") {
                                operator = "=";
                            } else {
                                throw new Error(`Unsupported operator in filter function: ${fCtx.node.operator}`);
                            }
                            return {
                                replacement: {
                                    type: "SQLCondition",
                                    operator,
                                    lhs: lhs as SQLCondition | SQLField | SQLStringLiteral,
                                    rhs: rhs as SQLCondition | SQLField | SQLStringLiteral,
                                } satisfies SQLCondition,
                            };
                        }
                        if (fCtx.node.type === "RDTStringLiteral") {
                            return {
                                replacement: {
                                    type: "SQLStringLiteral",
                                    value: fCtx.node.value,
                                } satisfies SQLStringLiteral,
                            };
                        }
                    },
                });
                return {
                    replacement: {
                        type: "SQLFilter",
                        source: filterIntent.source,
                        condition: output as SQLCondition,
                    } satisfies SQLFilter,
                };
            }
            if (ctx.node.type === "RDTSideEffect") {
                if ((ctx.node.expr as unknown as SQLFilter).type === "SQLFilter") {
                    if (ctx.node.next.type !== "RDTNull") throw new Error(`Multi-stage side effects are not supported, got: ${ctx.node.next.type}, expected RDTNull`);
                    return {
                        replacement: ctx.node.expr,
                    };
                } else {
                    throw new Error(`Expected side effect expression to be SQLFilter, got: ${ctx.node.expr.type}`);
                }
            }
        },
    });

    return result as SQLNode;
}


class ParameterCtx {
    private parameters: any[] = [];

    replaceParameter(node: SQLNode): string {
        if (node.type === "SQLStringLiteral") {
            this.parameters.push(node.value);
        } else {
            throw new Error(`Unsupported node type for parameter: ${node.type}`);
        }

        return `$${this.parameters.length}`;
    }
    
    getParameters(): any[] {
        return this.parameters;
    }
}

export function conditionToSQL(condition: SQLNode, ctx: ParameterCtx): string {
    if (condition.type === "SQLCondition") {
        return `${conditionToSQL(condition.lhs, ctx)} ${condition.operator} ${conditionToSQL(condition.rhs, ctx)}`;
    }
    if (condition.type === "SQLField") {
        return `"${condition.table.name}"."${condition.field}"`;
    }
    if (condition.type === "SQLStringLiteral") {
        return `${ctx.replaceParameter(condition)}`;
    }

    throw new Error(`Unsupported SQL condition type: ${condition.type}`);
}

export function sqlTreeToQuery(tree: SQLNode): {query: string; parameters: any[]} {
    const ctx = new ParameterCtx();
    if (tree.type === "SQLFilter") {
        const tableName = tree.source.name;
        const query =  `SELECT * FROM "${tableName}" WHERE ${conditionToSQL(tree.condition, ctx)}`;
        return {
            query,
            parameters: ctx.getParameters(),
        };
    }
    throw new Error(`Unsupported SQL node type: ${tree.type}`);
}

async function main() {
    const output = await transpile({
        outDir: "sql",
        input: `
TestTable {
    testField: string
}

TestTable[].filter((x: TestTable) => x.testField == "testValue")
        `,
        targetStage: TargetStage.RDT_TYPED,
    });
    if (!output.rdt || !(output.rdt.type === "RDTRoot")) {
        throw new Error(`Expected output to be an RDTRoot, got: ${typeof output.rdt}`);
    }

    const sqlTree = await rdtToSqlTree({ root: output.rdt, tree: output.rdt.expressions });
    await fs.promises.writeFile("out/sqlTree.json", JSON.stringify(sqlTree, null, 2));
    const sqlQuery = sqlTreeToQuery(sqlTree);
    await fs.promises.writeFile("out/sqlQuery.sql", JSON.stringify(sqlQuery, null, 2));
}

if (process.argv[1] === import.meta.filename) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
