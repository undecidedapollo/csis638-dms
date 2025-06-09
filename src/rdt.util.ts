import { IdentifiesNode } from "./ast.types";
import { RDTNode, RDTTypeDef } from "./rdt.types";

export function getTypeMetadata(node: RDTNode, options?: { returnRawBinding?: boolean}): RDTTypeDef | undefined {
    let res = node.metadata["typeinfo"] as RDTTypeDef;
    if (!res) return undefined;
    if (res.type === "RDTTypeBinding" && !options?.returnRawBinding) {
        return res.next;
    }
    return res;
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