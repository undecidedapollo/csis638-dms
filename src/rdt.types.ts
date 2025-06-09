import { randomUUID } from "node:crypto";
import { DefinitionNode, DefinitionPropertyNode, IdentifierNode } from "./ast.types";

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

export interface RDTAssignment extends HasMetadata {
    id: string;
    type: "RDTAssignment";
    name: string;
    value: RDTComputeNode;
}

export interface RDTDefinition extends HasMetadata {
    id: string;
    type: "RDTDefinition";
    node: DefinitionNode;
    properties: Array<RDTProperty>;
}

export interface RDTSimpleProperty extends HasMetadata {
    id: string;
    type: "SimpleProperty";
    node: DefinitionPropertyNode;
    typeDef: string;
}

export interface RDTDerivedProperty extends HasMetadata {
    id: string;
    type: "DerivedProperty";
    node: DefinitionPropertyNode;
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

export interface RDTTypeBinding {
    type: "RDTTypeBinding";
    value: RDTTypeDef;
    next: RDTTypeDef;
}

export type RDTTypeDef = RDTTypeIdentifier | RDTTypeContext | RDTTypeUnknown | RDTObjectTypeDefinition | RDTTypeFunctionDefinition | RDTTypeBinding;

export interface RDTSourceContext extends HasMetadata {
    id: string;
    type: "RDTSourceContext";
    name?: string;
    typeDef: RDTTypeContext;
}

export interface RDTSourceConstant extends HasMetadata {
    id: string;
    type: "RDTSourceConstant";
    typeDef: RDTTypeDef;
    value: string;
}

export interface RDTPropertyAccess extends HasMetadata {
    id: string;
    type: "RDTPropertyAccess";
    source: RDTComputeNode;
    propertyName: RDTComputeNode;
}

export interface RDTMath extends HasMetadata {
    id: string;
    type: "RDTMath";
    operator: "*" | "/" | "+" | "-" | "==";
    lhs: RDTComputeNode;
    rhs: RDTComputeNode;
}

export interface RDTFunction extends HasMetadata {
    id: string;
    type: "RDTFunction";
    name?: string;
    parameters: RDTComputeNode[];
    body: RDTComputeNode;
}

export interface RDTSourceRuntime extends HasMetadata {
    id: string;
    type: "RDTSourceRuntime";
    name: string;
    typeDef: RDTTypeDef;
}

export interface RDTInvoke extends HasMetadata {
    id: string;
    type: "RDTInvoke";
    source: RDTComputeNode;
    args: RDTComputeNode[];
}

export interface RDTOrderedExpressions extends HasMetadata {
    id: string;
    type: "RDTOrderedExpressions";
    exprs: RDTComputeNode[];
}

export interface RDTReturn extends HasMetadata {
    id: string;
    type: "RDTReturn";
    value: RDTComputeNode;
}

export interface RDTNull extends HasMetadata {
    id: string;
    type: "RDTNull";
}

export interface RDTConditional extends HasMetadata {
    id: string;
    type: "RDTConditional";
    condition: RDTComputeNode;
    then: RDTComputeNode;
    else: RDTComputeNode;
}

export interface RDTBinding extends HasMetadata {
    id: string;
    type: "RDTBinding";
    typeDef: RDTTypeDef;
    name: string;
    value: RDTComputeNode;
    next: RDTComputeNode;
}

export interface RDTSideEffect extends HasMetadata {
    id: string;
    type: "RDTSideEffect";
    typeDef: RDTTypeDef;
    expr: RDTComputeNode;
    next: RDTComputeNode;
}

export type RDTComputeNode =
    | RDTOrderedExpressions
    | RDTSourceContext
    | RDTSourceConstant
    | RDTPropertyAccess
    | RDTMath
    | RDTFunction
    | RDTSourceRuntime
    | RDTInvoke
    | RDTNull
    | RDTConditional
    | RDTBinding
    | RDTSideEffect
    | RDTReference
    | RDTReturn;

export interface RDTRoot extends HasMetadata {
    id: string;
    type: "RDTRoot",
    definitions: RDTDefinition[];
    assignments: RDTAssignment[];
}

export interface RDTReference extends HasMetadata {
    id: string;
    type: "RDTReference";
    referenceId: string;
    name?: string;
}

export interface RDTRWRoot extends HasMetadata {
    id: string;
    type: "RDTRWRoot",
    write: {
        [writeRecordId: string]: RDTNode,
    },
    read: RDTNode,
}



export type RDTNode =
    | RDTComputeNode
    | RDTProperty
    | RDTDefinition
    | RDTRoot
    | RDTReference
    | RDTRWRoot
    | RDTAssignment;
