import { debugRDTNode } from "./rdt";
import { RDTDefinition, RDTNode } from "./rdt.types";

function generateDefinition(rdt: RDTDefinition): string {
    const sharedProperties: string[] = [];
    const variations: {
        simpleOnly: string[],
        dbRepr: string[],
        liveRepr: string[],
    } = {
        simpleOnly: [],
        dbRepr: [],
        liveRepr: [],
    };

    for (const prop of rdt.properties) {
        if (prop.type === "SimpleProperty") {
            sharedProperties.push(`${prop.node.identifier.value}: ${prop.typeDef};`)
        } else if (prop.type === "DerivedProperty" && prop.derivation.type === "RDTRWRoot") {

        } else if (prop.type === "DerivedProperty") {
            // ?? This case can happen if all the work required for a derived property is on the write side ??
            throw new Error(`Unimplemented raw DerivedProperty for ${debugRDTNode(prop)}`);
        }
    }

    return `
        export interface ${rdt.node.name.value} {
            ${sharedProperties.join("\n")}
        }
    `;
}

export function generateSDK(rdt: RDTNode) {
    if (rdt.type !== "RDTRoot") throw new Error(`Expected RDTRoot to generate the sdk`);

    const definedData : string[] = [];
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