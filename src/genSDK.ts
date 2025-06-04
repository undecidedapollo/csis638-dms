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
    const sharedProperties: string[] = [];
    const sharedTransforms: string[] = [];
    const variations: {
        simpleOnlyProps: string[],
        simpleOnlyTransforms: string[],
        dbReprProps: string[],
        dbReprTransforms: string[],
        liveReprProps: string[],
        liveReprTransforms: string[],
    } = {
        simpleOnlyProps: [],
        simpleOnlyTransforms: [],
        dbReprProps: [],
        dbReprTransforms: [],
        liveReprProps: [],
        liveReprTransforms: [],
    };

    for (const prop of rdt.properties) {
        if (prop.type === "SimpleProperty") {
            sharedProperties.push(`${escapeKey(prop.node.identifier.value)}: ${prop.typeDef};`)
            sharedTransforms.push(`${escapeKey(prop.node.identifier.value)}: input[${escapeKey(prop.node.identifier.value)}],`);
        } else if (prop.type === "DerivedProperty" && prop.derivation.type === "RDTRWRoot") {
            const intermediateFields = Object.entries(prop.derivation.write).map(([name, rdt]) => {
                if (rdtIsNotKnown(rdt)) throw new Error(`Unknown type metadata for write intermediate: ${name} as part of node: ${JSON.stringify(prop, replacer, 2)}`);
                const typeMetadata = getTypeMetadata(rdt)!;
                return `${escapeKey(name)}: ${toTypescriptType(typeMetadata)};`;
            });
            const intermediateTransforms = Object.entries(prop.derivation.write).map(([name, rdt]) => {
                return `${escapeKey(name)}: ${toTypescriptLogic(rdt as RDTComputeNode)},`;
            });
            variations.dbReprProps.push(...intermediateFields);
            variations.dbReprTransforms.push(...intermediateTransforms);

            if (rdtIsNotKnown(prop.derivation.read)) throw new Error(`Unknown type metadata for read result as part of node: ${JSON.stringify(prop.derivation.read, replacer, 2)}`);
            const readTypeMetadata = getTypeMetadata(prop.derivation.read)!;
            variations.liveReprProps.push(`${prop.node.identifier.value}: ${toTypescriptType(readTypeMetadata)}`);
            variations.liveReprTransforms.push(`${escapeKey(prop.node.identifier.value)}: ${toTypescriptLogic(prop.derivation.read as RDTComputeNode)},`);
        } else if (prop.type === "DerivedProperty") {
            // ?? This case can happen if all the work required for a derived property is on the write side ??
            throw new Error(`Unimplemented raw DerivedProperty for ${debugRDTNode(prop)}`);
        }
    }

    return `
        export interface ${rdt.node.name.value}_simple {
            ${sharedProperties.join("\n")}
            ${variations.simpleOnlyProps.join("\n")}
        };

        export interface ${rdt.node.name.value}_db {
            ${sharedProperties.join("\n")}
            ${variations.dbReprProps.join("\n")}
        };

        export interface ${rdt.node.name.value} {
            ${sharedProperties.join("\n")}
            ${variations.liveReprProps.join("\n")}
        };

        function ${rdt.node.name.value}_simple_to_db(input: ${rdt.node.name.value}_simple): ${rdt.node.name.value}_db {
            return {
                ${sharedTransforms.join("\n")}
                ${variations.dbReprTransforms.join("\n")}
            } satisfies ${rdt.node.name.value}_db;
        }

        function ${rdt.node.name.value}_db_to_final(input: ${rdt.node.name.value}_db): ${rdt.node.name.value} {
            return {
                ${sharedTransforms.join("\n")}
                ${variations.liveReprTransforms.join("\n")}
            } satisfies ${rdt.node.name.value};
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
    host: 'localhost:26257',
    user: 'root',
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 500,
});

${content}
`.trim();