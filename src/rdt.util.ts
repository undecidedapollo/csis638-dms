import { RDTNode, RDTTypeDef } from "./rdt.types.js";

export function getTypeMetadata(node: RDTNode, options?: { returnRawBinding?: boolean}): RDTTypeDef | undefined {
    let res = node.metadata["typeinfo"] as RDTTypeDef;
    if (!res) return undefined;
    if (res.type === "RDTTypeBinding" && !options?.returnRawBinding) {
        return res.next;
    }
    return res;
}

export const replacer = (key, value) => {
    if (key === "rdtContext") {
        return undefined;
    } else {
        return value;
    }
};

export function debugRDTType(type?: RDTTypeDef) {
    if (!type) return "unknown";
    if (type.type === "RDTTypeUnknown") return "unknown";
    if (type.type === "RDTTypeNone") return "none";
    if (type.type === "string") return "string";
    if (type.type === "number") return "number";
    if (type.type === "boolean") return "boolean";
    if (type.type === "RDTTypeReference") return `ref(${type.name})`;
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
    if (type.type === "RDTTypeArrayDefinition") {
        return `array(${debugRDTType(type.subType)})`;
    }

    throw new Error(`Unknown RDT type: ${JSON.stringify(type, replacer, 2)}`);
}


export function debugRDTNode(node: RDTNode) {
    let name: string = "unknown";
    if (node.type === "RDTFunction") {
        name = node.name ?? name;
    } else if (node.type === "DerivedProperty") {
        name = node.name;
    } else if (node.type === "SimpleProperty") {
        name = node.name;
    } else if (node.type === "RDTDefinition") {
        name = node.name;
    } else if (node.type === "RDTRoot") {
        name = "root";
    } else if (node.type === "RDTMath") {
        name = node.operator;
    } else if (node.type === "RDTReference") {
        name = node.name ?? node.referenceId;
    } else if (node.type === "RDTStringLiteral" || node.type === "RDTNumericLiteral" || node.type === "RDTIdentifier") {
        name = node.value;
    } else if (node.type === "RDTSourceContext") {
        name = `$${node.name}`;
    }

    return `${name}:${node.type} ${debugRDTType(getTypeMetadata(node, { returnRawBinding: true }))}`;
}