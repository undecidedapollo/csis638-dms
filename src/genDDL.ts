import { debugRDTNode, getTypeMetadata, replacer } from "./rdt.util";
import { RDTDefinition, RDTNode, RDTTypeDef } from "./rdt.types";
import { rdtIsNotKnown } from "./rdtTypeSystem";

function escapeKey(key: string): string {
    return `"${key}"`;
}

function toSqlType(rdtType: RDTTypeDef): string {
    if (rdtType.type === "RDTTypeIdentifier") {
        if (rdtType.name === "string") {
            return "TEXT";
        } else if (rdtType.name === "number") {
            return "FLOAT";
        } else {
            throw new Error(`Unknown RDTTypeIdentifier name: ${rdtType.name} type: ${JSON.stringify(rdtType, replacer, 2)}`);
        }
    } else {
        throw new Error(`Unknown RDTTypeDef type: ${rdtType.type} def: ${JSON.stringify(rdtType, replacer, 2)}`);
    }
}

function generateDefinition(rdt: RDTDefinition): string {
    const sharedProperties: Record<string, string> = {};
    const variations: {
        dbReprProps: Record<string, string>,
    } = {
        dbReprProps: {},
    };

    for (const prop of rdt.properties) {
        if (prop.type === "SimpleProperty") {
            sharedProperties[prop.node.identifier.value] = toSqlType({
                type:"RDTTypeIdentifier",
                name: prop.typeDef,
            });
        } else if (prop.type === "DerivedProperty" && prop.derivation.type === "RDTRWRoot") {
            const intermediateProps = Object.fromEntries(Object.entries(prop.derivation.write).map(([name, rdt]) => {
                if (rdtIsNotKnown(rdt)) throw new Error(`Unknown type metadata for write intermediate: ${name} as part of node: ${JSON.stringify(prop, replacer, 2)}`);
                const typeMetadata = getTypeMetadata(rdt)!;
                return [name, toSqlType(typeMetadata)];
            }));
            Object.assign(variations.dbReprProps, intermediateProps);
        } else if (prop.type === "DerivedProperty") {
            // ?? This case can happen if all the work required for a derived property is on the write side ??
            throw new Error(`Unimplemented raw DerivedProperty for ${debugRDTNode(prop)}`);
        }
    }

    function fromMapToInterface(map: Record<string, string>) {
        return Object.entries(map).map(([key, type]) => `${escapeKey(key)} ${type} NOT NULL`).join(",\n");
    }

    return `
        CREATE TABLE "${rdt.node.name.value}" (
            ${fromMapToInterface({...sharedProperties, ...variations.dbReprProps})}
        )
    `;
}

export function generateDDL(rdt: RDTNode) {
    if (rdt.type !== "RDTRoot") throw new Error(`Expected RDTRoot to generate the sdk`);

    const definedData: string[] = [];
    for (const definition of rdt.definitions) {
        definedData.push(generateDefinition(definition));
    }

    return definedData.join("\n\n");
}
