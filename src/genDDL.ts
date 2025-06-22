import { debugRDTNode, debugRDTType, getTypeMetadata, replacer } from "./rdt.util";
import { RDTDatasetPipeline, RDTDefinition, RDTFilter, RDTFunction, RDTMath, RDTNode, RDTReduce, RDTTypeDef } from "./rdt.types";
import { rdtIsNotKnown } from "./rdtTypeSystem";
import { walkDFS } from "./rdt";

function escapeKey(key: string): string {
    return `"${key}"`;
}

function toSqlType(rdtType: RDTTypeDef): string {
    if (rdtType.type === "string") {
        return "TEXT";
    } else if (rdtType.type === "number") {
        return "FLOAT";
    } else if (rdtType.type === "boolean") {
        return "BOOLEAN";
    }

    throw new Error(`Unknown RDTTypeDef type: ${debugRDTType}`);
}

const operatorMap : Record<RDTMath["operator"], string> = {
    "==": "=",
    "!=": "<>",
    "&&": "AND",
    "||": "OR",
    "*": "*",
    "+": "+",
    "-": "-",
    "/": "/",
    ">": ">",
    "<": "<"
};

function processFilterPipeline(filter: RDTFilter, ctxRowIdentifier: string): (rowIdentifier: string) => string {
    return (rowIdentifier: string) => {
        const filterFunc = filter.condition;
        if (filterFunc.parameters.length !== 1) throw new Error(`Invalid func definition, param lenght`);
        const triggerRowId = filterFunc.parameters[0].id;
        return walkDFS<RDTNode>(filterFunc.body, {
            onAfter: (ctx) => {
                if (ctx.node.type === "RDTReference") {
                    if (ctx.node.referenceId === triggerRowId) {
                        return {
                            replacement: rowIdentifier as any
                        }
                    }
                    if (!ctx.node.name) throw new Error(`No name for rdt reference`);
                    return {
                        replacement: `"${ctx.node.name}"` as any
                    }
                } else if (ctx.node.type === "RDTSourceContext" && ctx.node.name === "row") {
                    return {
                        replacement: `"${ctxRowIdentifier}"` as any
                    };
                } else if (ctx.node.type === "RDTPropertyAccess") {
                    return {
                        replacement: `${ctx.node.source}.${ctx.node.propertyName}` as any
                    };
                } else if (ctx.node.type === "RDTMath") {
                    const mappedOperator = operatorMap[ctx.node.operator];
                    if (!mappedOperator) throw new Error(`Unknown operator: ${ctx.node.operator}`);
                    return {
                        replacement: `(${ctx.node.lhs} ${mappedOperator} ${ctx.node.rhs})` as any
                    };
                } else if (ctx.node.type === "RDTIdentifier") {
                    return {
                        replacement: `"${ctx.node.value}"` as any
                    }
                } else {
                    throw new Error(`Unknown filter condition type: ${JSON.stringify(ctx.node, replacer, 2)}`);
                }
            },
        }) as any as string;
    };
}

function funcToSql(funcDefinition: RDTFunction, ctx: {funcName: string, paramTypes: string[]; returnType: string}): {sql: string; preSql: string} {
    if (funcDefinition.parameters.length !== ctx.paramTypes.length) throw new Error(`Invalid param mapping`);
    const args = funcDefinition.parameters.map((param, i) => {
        if (param.type !== "RDTSourceRuntime") throw new Error("Unknown param type");
        const mappedType = ctx.paramTypes[i];
        return `"${param.name}" ${mappedType}`;
    });

    const body = walkDFS<RDTNode>(funcDefinition.body, {
        onAfter: (ctx) => {
            if (ctx.node.type === "RDTReference") {
                if (!ctx.node.name) throw new Error(`No name for rdt reference`);
                return {
                    replacement: `"${ctx.node.name}"` as any
                }
            } else if (ctx.node.type === "RDTPropertyAccess") {
                return {
                    replacement: `${ctx.node.source}.${ctx.node.propertyName}` as any
                };
            } else if (ctx.node.type === "RDTIdentifier") {
                return {
                    replacement: `"${ctx.node.value}"` as any
                }
            } else if (ctx.node.type === "RDTNumericLiteral") {
                return {
                    replacement: ctx.node.value as any
                }
            } else if (ctx.node.type === "RDTMath") {
                const mappedOperator = operatorMap[ctx.node.operator];
                if (!mappedOperator) throw new Error(`Unknown operator: ${ctx.node.operator}`);
                return {
                    replacement: `(${ctx.node.lhs} ${mappedOperator} ${ctx.node.rhs})` as any
                };
            } else if (ctx.node.type === "RDTConditional") {
                return {
                    replacement: `
                        case (${ctx.node.condition})
                        when true then
                            ${ctx.node.then}
                        ${ctx.node.else ? `else ${ctx.node.else}`: ""}
                        END case
                    ` as any
                };
            } else {
                throw new Error(`Unknown reduce condition type: ${JSON.stringify(ctx.node, replacer, 2)}`);
            }
        },
    }) as any as string;

    const preSql = `DROP FUNCTION IF EXISTS "${ctx.funcName}"(${args.join(", ")});`;
    const sql = `
    CREATE OR REPLACE FUNCTION "${ctx.funcName}"(${args.join(", ")})
        RETURNS ${ctx.returnType} AS $$
        BEGIN
            RETURN ${body};
        END;
        $$ LANGUAGE plpgsql;
    `;
    return {
        preSql,
        sql,
    };
}

function generateReduceFunctions(reduce: RDTReduce, reducePrefix: string, rowTableName: string) {
    const forwardFuncName = `${reducePrefix}_forward`;
    const inverseFuncName = `${reducePrefix}_inverse`;
    const forwardType = getTypeMetadata(reduce.forward)!;
    if (forwardType.type !== "RDTTypeFunctionDefinition") throw new Error(`Unknown forward pass type`);
    const reduceType = toSqlType(forwardType.returns);
    const forwardSql = funcToSql(reduce.forward, {
        funcName: forwardFuncName,
        paramTypes: [reduceType, `"${rowTableName}"`],
        returnType: reduceType,
    });
    const inverseSql = funcToSql(reduce.inverse, {
        funcName: inverseFuncName,
        paramTypes: [reduceType, `"${rowTableName}"`],
        returnType: reduceType,
    });
    const sql = `
        ${forwardSql.sql}

        ${inverseSql.sql}
    `;

    return {
        preSql: [forwardSql.preSql, inverseSql.preSql],
        sql,
        forwardFuncName,
        inverseFuncName,
        accType: reduceType,
    };
}

function generateDerivedPipeline(pipeline: RDTDatasetPipeline, ctx: {targetTable: string; targetProp: string;}) {
    if (!pipeline.source.name) throw new Error(`Unable to generate pipeline for unknown source`);
    const functionName = `${pipeline.source.name}_${ctx.targetTable}_${ctx.targetProp}`;
    const triggerName = `${pipeline.source.name}_${ctx.targetTable}_${ctx.targetProp}_trigger`;

    let reduceFunction = pipeline.pipeline[pipeline.pipeline.length - 1];
    let filterFunctions = pipeline.pipeline.slice(0, pipeline.pipeline.length - 1);

    if (reduceFunction.type !== "RDTReduce") throw new Error(`Unknown pipeline translation: reduce`);
    if (filterFunctions.some((ff) =>  ff.type !== "RDTFilter")) throw new Error(`Unknown pipeline translation: filter`);


    let sourceConditions : ((rowIdentifier: string) => string)[] = [];

    let reduceFunctionSQL = generateReduceFunctions(reduceFunction, `${functionName}_reducers`, pipeline.source.name);

    for (const stage of filterFunctions) {
        if (stage.type === "RDTFilter") {
            sourceConditions.push(processFilterPipeline(stage, ctx.targetTable));
        }
    }

    function generateConditions(rowIdentifier: string) {
        if (!sourceConditions.length) return "";
        let sourceCondition = sourceConditions.map((x) => x(rowIdentifier)).join(" AND ");
        
        return `WHERE ${sourceCondition}`;
    }

    const oldConditions = generateConditions("OLD");
    const newConditions = generateConditions("NEW");

    const preSql = `
            DROP TRIGGER IF EXISTS "${triggerName}" ON "${pipeline.source.name}";
            DROP FUNCTION IF EXISTS "${functionName}"();
            ${reduceFunctionSQL.preSql.join("\n")}
    `;

    const sql = `
        ${reduceFunctionSQL.sql}

        CREATE OR REPLACE FUNCTION "${functionName}"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "${ctx.targetTable}"
                SET "${ctx.targetProp}" = "${reduceFunctionSQL.forwardFuncName}"("${ctx.targetTable}"."${ctx.targetProp}", NEW)
                ${newConditions};
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "${ctx.targetTable}"
                SET "${ctx.targetProp}" = "${reduceFunctionSQL.inverseFuncName}"("${ctx.targetTable}"."${ctx.targetProp}", OLD)
                ${oldConditions};

                UPDATE "${ctx.targetTable}"
                SET "${ctx.targetProp}" = "${reduceFunctionSQL.forwardFuncName}"("${ctx.targetTable}"."${ctx.targetProp}", NEW)
                ${newConditions};
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "${ctx.targetTable}"
                SET "${ctx.targetProp}" = "${reduceFunctionSQL.inverseFuncName}"("${ctx.targetTable}"."${ctx.targetProp}", OLD)
                ${oldConditions};
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "${triggerName}"
        AFTER INSERT OR UPDATE OR DELETE ON "${pipeline.source.name}"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `;

    return {preSql, sql, accType: reduceFunctionSQL.accType};
}

function generateDefinition(rdt: RDTDefinition): {table: string; postSql: string[]; preSql: string[]} {
    const sharedProperties: Record<string, string> = {};
    const variations: {
        dbReprProps: Record<string, string>,
    } = {
        dbReprProps: {},
    };

    const preSql : string[] = [];
    const postSql : string[] = [];

    for (const prop of rdt.properties) {
        const typeMetadata = getTypeMetadata(prop, {returnRawBinding: false});
        if (!typeMetadata) throw new Error(`Unknown type metadata for property: ${debugRDTNode(prop)}`);
        if (prop.type === "SimpleProperty") {
            sharedProperties[prop.name] = toSqlType(typeMetadata);
        } else if (prop.type === "DerivedProperty") {
            sharedProperties[prop.name] = toSqlType(typeMetadata);
            if (prop.derivation.type !== "RDTDatasetPipeline") throw new Error(`Unknown derivation type`);
            const res = generateDerivedPipeline(prop.derivation, {
                targetTable: rdt.name,
                targetProp: prop.name,
            });
            sharedProperties[prop.name] = res.accType;
            preSql.push(res.preSql);
            postSql.push(res.sql);
            // ?? This case can happen if all the work required for a derived property is on the write side ??
            // throw new Error(`Unimplemented raw DerivedProperty for ${debugRDTNode(prop)}`);
        } else {
            throw new Error(`Unknown property type: ${(prop as any).type}`);
        }
    }

    function fromMapToInterface(map: Record<string, string>) {
        return Object.entries(map).map(([key, type]) => `${escapeKey(key)} ${type} NOT NULL`).join(",\n");
    }

    return {
        table: `
            DROP TABLE IF EXISTS "${rdt.name}";
            CREATE TABLE "${rdt.name}" (
                ${fromMapToInterface({...sharedProperties, ...variations.dbReprProps})}
            );
        `,
        preSql,
        postSql,
    };
}

export function generateDDL(rdt: RDTNode) {
    if (rdt.type !== "RDTRoot") throw new Error(`Expected RDTRoot to generate the sdk`);

    const definedData: string[] = [];
    const postSql: string[] = [];
    const preSql: string[] = [];
    for (const definition of rdt.definitions) {
        const res = generateDefinition(definition);
        definedData.push(res.table);
        preSql.push(...res.preSql);
        postSql.push(...res.postSql);
    }

    return preSql.join("\n\n") + definedData.join("\n\n") + postSql.join("\n\n");
}
