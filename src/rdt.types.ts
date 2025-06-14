import { randomUUID } from "node:crypto";

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
    name: string;
    properties: Array<RDTProperty>;
}

export interface RDTSimpleProperty extends HasMetadata {
    id: string;
    type: "SimpleProperty";
    name: string;
}

export interface RDTDerivedProperty extends HasMetadata {
    id: string;
    type: "DerivedProperty";
    name: string;
    derivation: RDTComputeNode | RDTRWRoot;
}

export type RDTProperty = RDTSimpleProperty | RDTDerivedProperty;

export interface RDTTypeReference {
    type: "RDTTypeReference";
    name: string;
}

export interface RDTTypeString {
    type: "string";
}

export interface RDTTypeNumber {
    type: "number";
}

export interface RDTTypeBoolean {
    type: "boolean";
}

export interface RDTTypeNone {
    type: "RDTTypeNone";
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


export interface RDTTypeArrayDefinition {
    type: "RDTTypeArrayDefinition";
    subType: RDTTypeDef;
}

export type RDTTypeDef = RDTTypeNone | RDTTypeReference | RDTTypeString | RDTTypeNumber | RDTTypeBoolean | RDTTypeContext | RDTTypeUnknown | RDTObjectTypeDefinition | RDTTypeFunctionDefinition | RDTTypeBinding | RDTTypeArrayDefinition;

export interface RDTSourceContext extends HasMetadata {
    id: string;
    type: "RDTSourceContext";
    name: string;
}

export interface RDTBooleanLiteral extends HasMetadata {
    id: string;
    type: "RDTBooleanLiteral";
    value: boolean;
}

export interface RDTNumericLiteral extends HasMetadata {
    id: string;
    type: "RDTNumericLiteral";
    value: string;
}

export interface RDTStringLiteral extends HasMetadata {
    id: string;
    type: "RDTStringLiteral";
    value: string;
}

export interface RDTIdentifier extends HasMetadata {
    id: string;
    type: "RDTIdentifier";
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
    operator: "*" | "/" | "+" | "-" | "==" | "&&" | "||";
    lhs: RDTComputeNode;
    rhs: RDTComputeNode;
}

export interface RDTPostfix extends HasMetadata {
    id: string;
    type: "RDTPostfix";
    operator: "[]";
    operand: RDTComputeNode;
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
    name: string;
    value: RDTComputeNode;
    next: RDTComputeNode;
}

export interface RDTSideEffect extends HasMetadata {
    id: string;
    type: "RDTSideEffect";
    expr: RDTComputeNode;
    next: RDTComputeNode;
}

export type RDTComputeNode =
    | RDTOrderedExpressions
    | RDTSourceContext
    | RDTPropertyAccess
    | RDTMath
    | RDTPostfix
    | RDTFunction
    | RDTSourceRuntime
    | RDTInvoke
    | RDTNull
    | RDTConditional
    | RDTBinding
    | RDTSideEffect
    | RDTReference
    | RDTReturn
    | RDTStringLiteral
    | RDTNumericLiteral
    | RDTBooleanLiteral
    | RDTIdentifier;

export interface RDTRoot extends HasMetadata {
    id: string;
    type: "RDTRoot",
    definitions: RDTDefinition[];
    assignments: RDTAssignment[];
    expressions: RDTComputeNode;
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
