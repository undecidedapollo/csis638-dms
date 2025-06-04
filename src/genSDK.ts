import { debugRDTNode, getTypeMetadata, rdtIsNotKnown, replacer } from "./rdt";
import { RDTComputeNode, RDTDefinition, RDTNode, RDTSourceRuntime, RDTTypeDef } from "./rdt.types";

function escapeKey(key: string): string {
    return `"${key}"`;
}

function toTypescriptType(rdtType: RDTTypeDef): string {
    if (rdtType.type === "RDTTypeIdentifier") {
        if (rdtType.name === "string") {
            return "string";
        } else if (rdtType.name === "number") {
            return "number";
        } else {
            throw new Error(`Unknown RDTTypeIdentifier name: ${rdtType.name} type: ${JSON.stringify(rdtType, replacer, 2)}`);
        }
    } else if (rdtType.type === "RDTObjectTypeDefinition") {
        const mappedKeys = Object.entries(rdtType.properties).map(([key, prop]) => `${escapeKey(key)}: ${toTypescriptType(prop)};`);
        return `{\n${mappedKeys.join("\n")}\n}`;
    } else if (rdtType.type === "RDTTypeFunctionDefinition") {
        // TODO: Escape param names or transform ??
        const params = Object.entries(rdtType.params).map(([paramName, paramType]) => `${paramName}: ${toTypescriptType(paramType)}`).join(",");
        const returnType = toTypescriptType(rdtType.returns);
        return `(${params}) => ${returnType}`
    } else {
        throw new Error(`Unknown RDTTypeDef type: ${rdtType.type} def: ${JSON.stringify(rdtType, replacer, 2)}`);
    }
}

function toTypescriptLogic(rdt: RDTNode): string {
    if (rdt.type === "RDTMath") {
        const lhsLogic = toTypescriptLogic(rdt.lhs);
        const rhsLogic = toTypescriptLogic(rdt.rhs);
        return `(${lhsLogic} ${rdt.operator} ${rhsLogic})`;
    } else if (rdt.type === "RDTSourceContext" && rdt.typeDef.type === "RDTTypeContext" && rdt.typeDef.name === "row") {
        return `input`;
    } else if (rdt.type === "RDTSourceConstant") {
        if (rdt.typeDef.type !== "RDTTypeIdentifier") throw new Error(`Unknown RDTSourceConstant ${JSON.stringify(rdt, replacer, 2)}`);
        if (rdt.typeDef.name === "string") return `"${rdt.value}"`;
        if (rdt.typeDef.name === "number") return `${rdt.value}`;
        throw new Error(`Unknown RDTSourceConstant ${JSON.stringify(rdt, replacer, 2)}`);
    } else if (rdt.type === "RDTPropertyAccess") {
        const sourceLogic = toTypescriptLogic(rdt.source);
        const propertyName = toTypescriptLogic(rdt.propertyName);
        return `(${sourceLogic})[${propertyName}]`;
    } else if (rdt.type === "RDTFunction") {
        const params = rdt.parameters.map((param: RDTSourceRuntime) => `${param.name}: ${toTypescriptType(param.typeDef)},`);
        return `(${params.join(" ")}) => { return ${toTypescriptLogic(rdt.body)}; }`;
    } else if (rdt.type === "RDTSourceRuntime") {
        return `${rdt.name}`;
    } else if (rdt.type === "RDTRWReference") {
        return `input["${rdt.referenceId}"]`;
    } else {
        throw new Error(`Unknown RDT when converting to TS logic ${JSON.stringify(rdt, replacer, 2)}`);
    }
}

function generateDefinition(rdt: RDTDefinition): string {
    const sharedProperties: Record<string, string> = {};
    const sharedTransforms: string[] = [];
    const variations: {
        simpleOnlyProps: Record<string, string>,
        simpleOnlyTransforms: string[],
        dbReprProps: Record<string, string>,
        dbReprTransforms: string[],
        liveReprProps: Record<string, string>,
        liveReprTransforms: string[],
    } = {
        simpleOnlyProps: {},
        simpleOnlyTransforms: [],
        dbReprProps: {},
        dbReprTransforms: [],
        liveReprProps: {},
        liveReprTransforms: [],
    };

    for (const prop of rdt.properties) {
        if (prop.type === "SimpleProperty") {
            sharedProperties[prop.node.identifier.value] = prop.typeDef;
            // sharedProperties.push(`${escapeKey()}: ${prop.typeDef};`)
            sharedTransforms.push(`${escapeKey(prop.node.identifier.value)}: input[${escapeKey(prop.node.identifier.value)}],`);
        } else if (prop.type === "DerivedProperty" && prop.derivation.type === "RDTRWRoot") {
            const intermediateProps = Object.fromEntries(Object.entries(prop.derivation.write).map(([name, rdt]) => {
                if (rdtIsNotKnown(rdt)) throw new Error(`Unknown type metadata for write intermediate: ${name} as part of node: ${JSON.stringify(prop, replacer, 2)}`);
                const typeMetadata = getTypeMetadata(rdt)!;
                return [name, toTypescriptType(typeMetadata)];
            }));
            const intermediateTransforms = Object.entries(prop.derivation.write).map(([name, rdt]) => {
                return `${escapeKey(name)}: ${toTypescriptLogic(rdt as RDTComputeNode)},`;
            });
            Object.assign(variations.dbReprProps, intermediateProps);
            variations.dbReprTransforms.push(...intermediateTransforms);

            if (rdtIsNotKnown(prop.derivation.read)) throw new Error(`Unknown type metadata for read result as part of node: ${JSON.stringify(prop.derivation.read, replacer, 2)}`);
            const readTypeMetadata = getTypeMetadata(prop.derivation.read)!;
            variations.liveReprProps[prop.node.identifier.value] = toTypescriptType(readTypeMetadata);
            variations.liveReprTransforms.push(`${escapeKey(prop.node.identifier.value)}: ${toTypescriptLogic(prop.derivation.read as RDTComputeNode)},`);
        } else if (prop.type === "DerivedProperty") {
            // ?? This case can happen if all the work required for a derived property is on the write side ??
            throw new Error(`Unimplemented raw DerivedProperty for ${debugRDTNode(prop)}`);
        }
    }

    function writeASql() {
        const fields = Object.keys(sharedProperties).concat(Object.keys(variations.dbReprProps)).map((x) => escapeKey(x));
        const fieldNumbers = fields.map((_, i) => `$${i + 1}`);
        const paramArray = fields.map((propName) => `db_row[${propName}]`);

        return `await pool.query(
            'INSERT INTO "${rdt.node.name.value}" (${fields.join(", ")}) VALUES (${fieldNumbers.join(", ")}) RETURNING *',
            [${paramArray.join(", ")}]
        );`;
    }

    function fromMapToInterface(map: Record<string, string>) {
        return Object.entries(map).map(([key, type]) => `${escapeKey(key)}: ${type};`).join("\n");
    }

    return `
        export interface ${rdt.node.name.value}_simple {
            ${fromMapToInterface(sharedProperties)}
            ${fromMapToInterface(variations.simpleOnlyProps)}
        };

        export interface ${rdt.node.name.value}_db {
            ${fromMapToInterface(sharedProperties)}
            ${fromMapToInterface(variations.dbReprProps)}
        };

        export interface ${rdt.node.name.value}_final {
            ${fromMapToInterface(sharedProperties)}
            ${fromMapToInterface(variations.liveReprProps)}
        };

        function ${rdt.node.name.value}_simple_to_db(input: ${rdt.node.name.value}_simple): ${rdt.node.name.value}_db {
            return {
                ${sharedTransforms.join("\n")}
                ${variations.dbReprTransforms.join("\n")}
            } satisfies ${rdt.node.name.value}_db;
        }

        function ${rdt.node.name.value}_db_to_final(input: ${rdt.node.name.value}_db): ${rdt.node.name.value}_final {
            return {
                ${sharedTransforms.join("\n")}
                ${variations.liveReprTransforms.join("\n")}
            } satisfies ${rdt.node.name.value}_final;
        }

        export class ${rdt.node.name.value} {
            static async create(pojo: ${rdt.node.name.value}_simple): Promise<${rdt.node.name.value}_final> {
                let db_row: ${rdt.node.name.value}_db = ${rdt.node.name.value}_simple_to_db(pojo);
        
                const res = ${writeASql()};
                if (res.rowCount === 0) {
                    throw new Error('Failed to create ${rdt.node.name.value}');
                }
                const row = res.rows[0];
                return ${rdt.node.name.value}_db_to_final(row);
            }
        }
    `;
}

export function generateSDK(rdt: RDTNode) {
    if (rdt.type !== "RDTRoot") throw new Error(`Expected RDTRoot to generate the sdk`);

    const definedData: string[] = [];
    for (const definition of rdt.definitions) {
        definedData.push(generateDefinition(definition));
    }

    return foundationFile(definedData.join("\n\n"));
}

export const foundationFile = (content: string) => `
import { Pool } from 'pg';

const pool = new Pool({
    host: 'localhost',
    port: 26257,
    user: 'root',
    database: "dbapp",
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 500,
});

${content}
`.trim();