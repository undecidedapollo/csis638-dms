import { randomUUID } from "node:crypto";
import { DefinitionNode, DefinitionPropertyNode } from "./ast.types";

let id = 0;
export class RDTContext {
    myId = id++;
    symbols: Map<string, { node: RDTNode, child?: RDTContext }> = new Map();

    constructor(private readonly parent?: RDTContext) { }

    public findByName(name: string): { node: RDTNode, context?: RDTContext } | null {
        const current = this.symbols.get(name);
        if (!current && this.parent) {
            return this.parent.findByName(name);
        } else if (!current) {
            return null;
        }
        return { node: current.node, context: current.child };
    }


    public addNode(node: RDTNode, name?: string, context?: RDTContext, asLeaf?: boolean): { context: RDTContext } {
        const identifier = name ?? randomUUID();
        if (this.symbols.has(identifier)) throw new Error(`Duplicate node definition: "${identifier}" at node: ${JSON.stringify(node, null, 2)}`);
        const child = asLeaf ? undefined : context ?? this.nested();
        this.symbols.set(identifier, { node, child });
        return { context: child ?? this };
    }

    public nested(): RDTContext {
        return new RDTContext(this);
    }

    public tree(): any {
        return Object.fromEntries(Array.from(this.symbols.entries()).map(([key, x]) => [`${key}:${x.node.type}`, x.child?.tree() ?? "leaf"]));
    }
}

interface HasMetadata {
    metadata: {
        [key: string]: any,
    },
}

export interface RDTDefinition extends HasMetadata {
    id: string;
    type: "RDTDefinition";
    node: DefinitionNode;
    rdtContext: RDTContext;
    properties: Array<RDTProperty>;

}

export interface RDTSimpleProperty extends HasMetadata {
    id: string;
    type: "SimpleProperty";
    node: DefinitionPropertyNode;
    rdtContext: RDTContext;
    typeDef: string;
}

export interface RDTDerivedProperty extends HasMetadata {
    id: string;
    type: "DerivedProperty";
    node: DefinitionPropertyNode;
    rdtContext: RDTContext;
    derivation: RDTComputeNode | RDTRWRoot;
}

export type RDTProperty = RDTSimpleProperty | RDTDerivedProperty;

export interface RDTTypeIdentifier {
    type: "RDTTypeIdentifier";
    name: string;
}

export interface RDTTypeUnknown {
    type: "RDTTypeUnknown";
}

export interface RDTTypeContext {
    type: "RDTTypeContext";
    name?: string;
}

export interface RDTObjectTypeDefinition {
    type: "RDTObjectTypeDefinition";
    properties: {
        [key: string]: RDTTypeDef;
    };
}

export interface RDTTypeFunctionDefinition {
    type: "RDTTypeFunctionDefinition";
    params: {
        [key: string]: RDTTypeDef;
    };
    returns: RDTTypeDef;
}

export type RDTTypeDef = RDTTypeIdentifier | RDTTypeContext | RDTTypeUnknown | RDTObjectTypeDefinition | RDTTypeFunctionDefinition;

export interface RDTSourceContext extends HasMetadata {
    id: string;
    type: "RDTSourceContext";
    rdtContext: RDTContext;
    name?: string;
    typeDef: RDTTypeContext;
}

export interface RDTSourceConstant extends HasMetadata {
    id: string;
    type: "RDTSourceConstant";
    rdtContext: RDTContext;
    typeDef: RDTTypeDef;
    value: string;
}

export interface RDTPropertyAccess extends HasMetadata {
    id: string;
    type: "RDTPropertyAccess";
    rdtContext: RDTContext;
    source: RDTComputeNode;
    propertyName: RDTComputeNode;
}

export interface RDTMath extends HasMetadata {
    id: string;
    type: "RDTMath";
    rdtContext: RDTContext;
    operator: "*" | "/" | "+" | "-";
    lhs: RDTComputeNode;
    rhs: RDTComputeNode;
}

export interface RDTFunction extends HasMetadata {
    id: string;
    type: "RDTFunction";
    rdtContext: RDTContext;
    name?: string;
    parameters: RDTComputeNode[];
    body: RDTComputeNode;
}

export interface RDTSourceRuntime extends HasMetadata {
    id: string;
    type: "RDTSourceRuntime";
    rdtContext: RDTContext;
    name: string;
    typeDef: RDTTypeDef;
}

export interface RDTInvoke extends HasMetadata {
    id: string;
    type: "RDTInvoke";
    rdtContext: RDTContext;
    source: RDTComputeNode;
    args: RDTComputeNode[];
}

export type RDTComputeNode =
    | RDTSourceContext
    | RDTSourceConstant
    | RDTPropertyAccess
    | RDTMath
    | RDTFunction
    | RDTSourceRuntime
    | RDTInvoke;

export interface RDTRoot extends HasMetadata {
    id: string;
    type: "RDTRoot",
    rdtContext: RDTContext;
    definitions: RDTDefinition[];
}

export interface RDTRWReference extends HasMetadata {
    id: string;
    type: "RDTRWReference";
    rdtContext: RDTContext;
    referenceId: string;
}

export interface RDTRWRoot extends HasMetadata {
    id: string;
    type: "RDTRWRoot",
    rdtContext: RDTContext,
    write: {
        [writeRecordId: string]: RDTNode,
    },
    read: RDTNode,
}

export type RDTNode = RDTComputeNode | RDTProperty | RDTDefinition | RDTRoot | RDTRWReference | RDTRWRoot;
