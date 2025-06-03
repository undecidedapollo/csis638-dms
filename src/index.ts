import { randomUUID } from 'node:crypto';
import { AST, ASTNode, DefinitionFunctionNode, DefinitionNode, DefinitionPropertyNode, IdentifierNode, IdentifiesNode, LambdaExprNode, ObjectLiteralExprNode, ObjectLiteralPropertyNode } from './ast.types';
import parser from './bankaccount.cjs';
const input = `
    Transaction {
        id: uuid,
        bankAccountId: string,
        amount: number,
        doubleAmount: (rand: number) => $row.amount * 2 + rand
    }
`;


// const input = `
//     BankAccount { 
//         accountId: string,
//         balance: $.transactions.reduce((acc, tx) => acc + tx.amount, 0),
//         transactions: Transaction[].filter((tx) => tx.bankAccountId == $.accountId)
//     }

//     Transaction {
//         id: uuid,
//         bankAccountId: string,
//         amount: number
//     }
// `;

// const input = `
//     BankAccount { 
//         accountId: string

//         get(accountId: string) {
//             return BankAccount[].first((b) => b.accountId == accountId)
//         }

//         create(accountId: string) {
//             return BankAccount[].create({
//                 accountId,
//             })
//         }
//     }
// `;

// One of these for direct relationships?
// @relation("bankAccount", BankAccount.accountId)?
// bankAccount: BankAccount[accountId == $.bankAccountId]

// The premise is that the actions taken to the database depend on the current state of the database at the time of applying.
// 
// From where are you coming is important. How to know what was the parent from the developers perspective. Store apply # of the world in the project at time of apply for an environment (keyed of params), the transformed output from that must be stored as well, perhaps in a known name format.
// 
// A deployment is a combination of the following:
// Current state apply # === development apply #

// Step 1, diff AST's
// What changes are possible?
// 
// What changes don't matter?

// Who do changes matter to? Schema design, precompiled code?
// 
//
// Table: ABC
// 40:x:string 41:x:number
//

function getIdentifierName(ast: IdentifiesNode) {
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

class Context {
    symbols: Map<string, { node: ASTNode, child: Context }> = new Map();
    mapping: Map<ASTNode, { name: string, context: Context }> = new Map();

    constructor(private readonly parent?: Context) { }

    public findByName(name: string): { node: ASTNode, context: Context } | null {
        const current = this.symbols.get(name);
        if (!current && this.parent) {
            return this.parent.findByName(name);
        } else if (!current) {
            return null;
        }
        return { node: current.node, context: current.child };
    }

    public findByAST(ast: ASTNode): { name: string, context: Context } | null {
        const current = this.mapping.get(ast);
        if (!current && this.parent) {
            return this.parent.findByAST(ast);
        } else if (!current) {
            return null;
        }
        return { name: current.name, context: current.context };
    }

    private recordASTReference(node: ASTNode, name: string, context: Context) {
        if (this.parent) {
            return this.parent.recordASTReference(node, name, context);
        }

        if (this.mapping.has(node)) throw new Error(`Duplicate ast reference node definition at node (not sure if this is possible or not): ${JSON.stringify(node, null, 2)}`);
        this.mapping.set(node, { name, context });
    }

    public addSymbol(node: IdentifiesNode): { child: Context } {
        const name = getIdentifierName(node);
        if (!name) throw new Error(`No name found for node: ${JSON.stringify(node, null, 2)}`);
        if (this.symbols.has(name)) throw new Error(`Duplicate node definition: "${name}" at node: ${JSON.stringify(node, null, 2)}`);
        const child = this.nested();
        this.symbols.set(name, { node, child });
        this.recordASTReference(node, name, child);
        return { child };
    }

    public addAnonymous(node: ASTNode): { child: Context } {
        const identifier = randomUUID();
        if (this.symbols.has(identifier)) throw new Error(`Duplicate node definition: "${identifier}" at node: ${JSON.stringify(node, null, 2)}`);
        const child = this.nested();
        this.symbols.set(identifier, { node, child });
        this.recordASTReference(node, identifier, child);
        return { child };
    }

    public nested(): Context {
        return new Context(this);
    }

    public tree(): any {
        return Object.fromEntries(Array.from(this.symbols.entries()).map(([key, x]) => [`${key}:${x.node.type}`, x.child.tree()]));
    }
}



// #region walkForContext
function walkDefinition(ast: DefinitionNode, context: Context) {
    const { child } = context.addSymbol(ast);

    for (const prop of ast.properties) {
        walkDefinitionProperty(prop, child);
    }
}

function walkDefinitionFunction(ast: DefinitionFunctionNode, funcContext: Context) {
    for (const param of ast.params) {
        funcContext.addSymbol(param)
    }
    _recordIdentifyingSymbols(ast.body, funcContext);
}

function walkDefinitionProperty(ast: DefinitionPropertyNode | DefinitionFunctionNode, context: Context) {
    const { child } = context.addSymbol(ast);
    if (ast.type === "DefinitionFunction") {
        walkDefinitionFunction(ast, child);
    } else {
        _recordIdentifyingSymbols(ast.definition, child);
    }
}

function walkLambdaExpression(ast: LambdaExprNode, context: Context) {
    const { child } = context.addAnonymous(ast);
    for (const param of ast.params) {
        child.addSymbol(param)
    }
    _recordIdentifyingSymbols(ast.body, child);
}

function walkObjectLiteralExpression(ast: ObjectLiteralExprNode, context: Context) {
    const { child } = context.addAnonymous(ast);
    for (const prop of ast.properties) {
        _recordIdentifyingSymbols(prop, child);
    }
}

function walkObjectLiteralProperty(ast: ObjectLiteralPropertyNode, context: Context) {
    const { child } = context.addSymbol(ast);
}

function _recordIdentifyingSymbols(ast: ASTNode, context: Context) {
    if ("type" in ast) {
        if (ast.type === "Definition") {
            return walkDefinition(ast, context);
        } else if (ast.type === "ObjectLiteralProperty") {
            return walkObjectLiteralProperty(ast, context);
        } else if (ast.type === "ReturnExpr") {
            return _recordIdentifyingSymbols(ast.expr, context);
        } else if (ast.type === "operator") {
            _recordIdentifyingSymbols(ast.lhs, context);
            _recordIdentifyingSymbols(ast.rhs, context);
        } else if (ast.type === "string" || ast.type === "number" || ast.type === "context" || ast.type === "TypeExpr") {

        } else if (ast.type === "LambdaExpr") {
            walkLambdaExpression(ast, context);
        } else if (ast.type === "InvokeExpr") {
            for (const arg of ast.args) {
                _recordIdentifyingSymbols(arg, context);
            }
        } else if (ast.type === "ObjectLiteralExpr") {
            walkObjectLiteralExpression(ast, context);
        } else {
            throw new Error(`Unknown type while walking symbols: ${ast.type} ast: ${JSON.stringify(ast, null, 2)}`);
        }
        return;
    }

    throw new Error(`Unknown ast node while walking symbols: ${JSON.stringify(ast, null, 2)}`);
}

function generateIdentifyingSymbols(ast: AST, context: Context) {
    for (const node of ast) {
        _recordIdentifyingSymbols(node, context);
    }
}

// #endregion

// #region Define The Tree
let id = 0;
class RDTContext {
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

interface RDTDefinition {
    id: string;
    type: "RDTDefinition";
    node: DefinitionNode;
    rdtContext: RDTContext;
    properties: Array<RDTProperty>;
}

interface RDTSimpleProperty {
    id: string;
    type: "SimpleProperty";
    node: DefinitionPropertyNode;
    rdtContext: RDTContext;
    typeDef: string;
}

interface RDTDerivedProperty {
    id: string;
    type: "DerivedProperty";
    node: DefinitionPropertyNode;
    rdtContext: RDTContext;
    derivation: RDTComputeNode | RDTRWRoot;
}

type RDTProperty = RDTSimpleProperty | RDTDerivedProperty;

interface RDTTypeIdentifier {
    type: "RDTTypeIdentifier";
    name: string;
}

interface RDTTypeUnknown {
    type: "RDTTypeUnknown";
}

interface RDTTypeContext {
    type: "RDTTypeContext";
    name?: string;
}

type RDTTypeDef = RDTTypeIdentifier | RDTTypeContext | RDTTypeUnknown;

interface RDTSourceContext {
    id: string;
    type: "RDTSourceContext";
    rdtContext: RDTContext;
    name?: string;
    typeDef: RDTTypeContext;
}

interface RDTSourceConstant {
    id: string;
    type: "RDTSourceConstant";
    rdtContext: RDTContext;
    typeDef: RDTTypeDef;
    value: string;
}

interface RDTPropertyAccess {
    id: string;
    type: "RDTPropertyAccess";
    rdtContext: RDTContext;
    source: RDTComputeNode;
    propertyName: RDTComputeNode;
}

interface RDTMath {
    id: string;
    type: "RDTMath";
    rdtContext: RDTContext;
    operator: "*" | "/" | "+" | "-";
    lhs: RDTComputeNode;
    rhs: RDTComputeNode;
}

interface RDTFunction {
    id: string;
    type: "RDTFunction";
    rdtContext: RDTContext;
    name?: string;
    parameters: RDTComputeNode[];
    body: RDTComputeNode;
}

interface RDTSourceRuntime {
    id: string;
    type: "RDTSourceRuntime";
    rdtContext: RDTContext;
    name: string;
    typeDef: RDTTypeDef;
}

interface RDTInvoke {
    id: string;
    type: "RDTInvoke";
    rdtContext: RDTContext;
    source: RDTComputeNode;
    args: RDTComputeNode[];
}

type RDTComputeNode =
    | RDTSourceContext
    | RDTSourceConstant
    | RDTPropertyAccess
    | RDTMath
    | RDTFunction
    | RDTSourceRuntime
    | RDTInvoke;

interface RDTRoot {
    id: string;
    type: "RDTRoot",
    rdtContext: RDTContext;
    definitions: RDTDefinition[];
}

interface RDTRWReference {
    id: string;
    type: "RDTRWReference";
    rdtContext: RDTContext;
    referenceId: string;
}

interface RDTRWRoot {
    id: string;
    type: "RDTRWRoot",
    rdtContext: RDTContext,
    write: {
        [writeRecordId: string]: RDTNode,
    },
    read: RDTNode,
}

type RDTNode = RDTComputeNode | RDTProperty | RDTDefinition | RDTRoot | RDTRWReference | RDTRWRoot;


// const globals: Array<RDTComputeNode> = [
//     {
//         type: "RDTFunction",
//         name: "testing",
//         parameters: [
//             {
//                 type: "RDTSourceRuntime",
//                 name: "fnc",
//                 typeDef: {
//                     type: "RDTTypeUnknown",
//                 },
//             }
//         ],
//         body: {
//             type: "RDTInvoke",
//             source: {
//                 type: "RDTSourceRuntime",
//                 name: "fnc",
//                 typeDef: {
//                     type: "RDTTypeUnknown",
//                 },
//             },
//             args: [
//                 {
//                     type: "RDTSourceConstant",
//                     value: "2",
//                     typeDef: {
//                         type: "RDTTypeIdentifier",
//                         name: "number"
//                     }
//                 },
//             ],
//         },
//     },
// ];

// What's nexts:
// DO THE FUNCTION AND SOURCE RUNTIME STUFF

function genRdtId() {
    return randomUUID();
}

function rdtDerivedPropertyWalker(ast: ASTNode, ctx: { context: RDTContext }): RDTComputeNode {
    if (ast.type === "operator") {
        if ("+-*/".includes(ast.operator)) {
            const lhs = rdtDerivedPropertyWalker(ast.lhs, ctx);
            const rhs = rdtDerivedPropertyWalker(ast.rhs, ctx);
            return {
                id: genRdtId(),
                type: "RDTMath",
                rdtContext: ctx.context,
                lhs,
                rhs,
                operator: ast.operator as RDTMath["operator"],
            };
        } else if (ast.operator === ".") {
            const source = rdtDerivedPropertyWalker(ast.lhs, ctx);
            const propertyName = rdtDerivedPropertyWalker(ast.rhs, ctx);

            return {
                id: genRdtId(),
                type: "RDTPropertyAccess",
                rdtContext: ctx.context,
                source,
                propertyName,
            };
        }
        else {
            throw new Error(`RDT Operator not supported: ${ast.operator}`);
        }
    } else if (ast.type === "TypeExpr") {
        if (ast.array) throw new Error("Array type expr not support rdt walker");
        return {
            id: genRdtId(),
            type: "RDTSourceConstant",
            rdtContext: ctx.context,
            value: ast.base.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: "string",
            },
        };
    } else if (ast.type === "number" || ast.type === "string") {
        return {
            id: genRdtId(),
            type: "RDTSourceConstant",
            rdtContext: ctx.context,
            value: ast.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: ast.type,
            },
        };
    } else if (ast.type === "context") {
        return {
            id: genRdtId(),
            type: "RDTSourceContext",
            rdtContext: ctx.context,
            typeDef: {
                type: "RDTTypeContext",
                name: ast.value?.value,
            },
        };
    } else if (ast.type === "Param") {
        if (ast.definition?.type === "TypeExpr") {
            if (ast.definition?.array) throw new Error("rdt param type is array");
            const res = {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeIdentifier",
                    name: ast.definition.base.value,
                },
            } satisfies RDTSourceRuntime;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        } else if (ast.definition?.type === "context") {
            const res = {
                id: genRdtId(),
                type: "RDTSourceContext",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeContext",
                    name: ast.definition.value?.value,
                },
            } satisfies RDTSourceContext;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        } else {
            const res = {
                id: genRdtId(),
                type: "RDTSourceRuntime",
                rdtContext: ctx.context,
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeUnknown",
                },
            } satisfies RDTSourceRuntime;
            ctx.context.addNode(res, ast.identifier.value, undefined, true);
            return res;
        }
    } else if (ast.type === "LambdaExpr") {
        const parameters = ast.params.map((param) => rdtDerivedPropertyWalker(param, ctx));
        const childCtx = ctx.context.nested();
        const body = rdtDerivedPropertyWalker(ast.body, { context: childCtx });
        const node = {
            id: genRdtId(),
            type: "RDTFunction",
            rdtContext: ctx.context,
            parameters,
            body,
        } satisfies RDTFunction;
        ctx.context.addNode(node, undefined, childCtx);
        return node;
    } else if (ast.type === "InvokeExpr") {
        const source = rdtDerivedPropertyWalker(ast.lhs, ctx);
        const args = ast.args.map((arg) => rdtDerivedPropertyWalker(arg, ctx));
        return {
            id: genRdtId(),
            type: "RDTInvoke",
            rdtContext: ctx.context,
            source,
            args,
        };
    } else {
        throw new Error(`Unable to rdt walk for ast type: ${ast.type} node: ${JSON.stringify(ast, null, 2)}`);
    }
}


function rdtDefinitionProperty(ast: DefinitionPropertyNode | DefinitionFunctionNode, ctx: { context: RDTContext }): RDTProperty {
    if (ast.type === "DefinitionProperty") {
        if (ast.definition.type === "TypeExpr") {
            if (ast.definition.array) throw new Error(`Table aliasing not supported, due to "${ast.definition.base.value}[]"`);
            const node = {
                id: genRdtId(),
                type: "SimpleProperty",
                rdtContext: ctx.context,
                node: ast,
                typeDef: ast.definition.base.value,
            } satisfies RDTProperty;
            ctx.context.addNode(node, ast.identifier.value, undefined, true);
            return node;
        } else {
            const childCtx = ctx.context.nested();
            const derivation = rdtDerivedPropertyWalker(ast.definition, { context: childCtx });
            const node = {
                id: genRdtId(),
                type: "DerivedProperty",
                rdtContext: ctx.context,
                node: ast,
                derivation,
            } satisfies RDTDerivedProperty;
            ctx.context.addNode(node, ast.identifier.value, childCtx);
            return node;
        }
    } else if (ast.type === "DefinitionFunction") {
        throw new Error("Unimplemented exception");
    } else {
        throw new Error("Unimplemented exception");
    }
}

function rdtDefinition(ast: DefinitionNode, context: RDTContext): RDTDefinition {
    const def: RDTDefinition = {
        id: genRdtId(),
        type: "RDTDefinition",
        rdtContext: context,
        node: ast,
        properties: []
    };
    const { context: child } = context.addNode(def, ast.name.value);
    for (const prop of ast.properties) {
        const propDef = rdtDefinitionProperty(prop, { context: child });
        def.properties.push(propDef);
    }
    return def;
}

function _convertToRDT(ast: ASTNode, context: RDTContext) {
    if ("type" in ast) {
        if (ast.type === "Definition") {
            return rdtDefinition(ast, context);
        }
        else {
            throw new Error(`Unknown type while walking symbols: ${ast.type} ast: ${JSON.stringify(ast, null, 2)}`);
        }
        return;
    }

    throw new Error(`Unknown ast node while walking symbols: ${JSON.stringify(ast, null, 2)}`);
}

function convertToRDT(ast: AST, context: RDTContext): RDTRoot {
    const definitions: RDTDefinition[] = [];
    for (const node of ast) {
        const res = _convertToRDT(node, context);
        if (!res) continue;
        definitions.push(res);
    }
    return {
        id: genRdtId(),
        type: "RDTRoot",
        rdtContext: context,
        definitions,
    };
}

type WalkDFSOnNodeReturn = void | { replacement: RDTNode };

interface WalkDFSOptions {
    onBefore?: (ctx: { node: RDTNode, lineage: RDTNode[] }) => WalkDFSOnNodeReturn;
    onAfter?: (ctx: { node: RDTNode, lineage: RDTNode[] }) => WalkDFSOnNodeReturn;
    currentLineage?: RDTNode[],
}

function walkDFS(rdt: RDTNode, options: WalkDFSOptions): RDTNode {
    let defaultReturnNode: RDTNode = rdt;
    if (options.onBefore) {
        const beforeRes = options.onBefore({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
        });
        if (beforeRes && ("replacement" in beforeRes)) {
            defaultReturnNode = beforeRes.replacement;
        }
    }

    const childOpts = {
        ...options,
        currentLineage: options.currentLineage ? [defaultReturnNode, ...options.currentLineage] : [defaultReturnNode],
    };

    if (defaultReturnNode.type === "RDTRoot") {
        defaultReturnNode = {
            ...defaultReturnNode,
            definitions: defaultReturnNode.definitions.map((def) => walkDFS(def, childOpts)) as RDTDefinition[],
        };
    } else if (defaultReturnNode.type === "RDTDefinition") {
        defaultReturnNode = {
            ...defaultReturnNode,
            properties: defaultReturnNode.properties.map((prop) => walkDFS(prop, childOpts)) as RDTProperty[],
        };
    } else if (defaultReturnNode.type === 'DerivedProperty') {
        defaultReturnNode = {
            ...defaultReturnNode,
            derivation: walkDFS(defaultReturnNode.derivation, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTFunction") {
        defaultReturnNode = {
            ...defaultReturnNode,
            parameters: defaultReturnNode.parameters.map((param) => walkDFS(param, childOpts)) as RDTComputeNode[],
            body: walkDFS(defaultReturnNode.body, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === "RDTMath") {
        defaultReturnNode = {
            ...defaultReturnNode,
            lhs: walkDFS(defaultReturnNode.lhs, childOpts) as RDTComputeNode,
            rhs: walkDFS(defaultReturnNode.rhs, childOpts) as RDTComputeNode,
        }
    } else if (defaultReturnNode.type === "RDTPropertyAccess") {
        defaultReturnNode = {
            ...defaultReturnNode,
            source: walkDFS(defaultReturnNode.source, childOpts) as RDTComputeNode,
            propertyName: walkDFS(defaultReturnNode.propertyName, childOpts) as RDTComputeNode,
        };
    } else if (defaultReturnNode.type === 'SimpleProperty' || defaultReturnNode.type === "RDTSourceConstant" || defaultReturnNode.type === "RDTSourceContext" || defaultReturnNode.type === "RDTSourceRuntime") {

    } else {
        throw new Error(`Unable to walk unknown RDT node type: ${defaultReturnNode.type} node: ${JSON.stringify(defaultReturnNode, replacer, 2)}`);
    }

    if (options.onAfter) {
        const afterRes = options.onAfter({
            node: defaultReturnNode,
            lineage: options.currentLineage ?? [],
        });
        if (afterRes && ("replacement" in afterRes)) {
            defaultReturnNode = afterRes.replacement;
        }
    }
    return defaultReturnNode;
}

// #endregion

// [
//     {
//       "node": "Transaction:Definition",
//       "properties": [
//         {
//           "type": "SimpleProperty",
//           "node": "id:DefinitionProperty",
//           "typeDef": "uuid"
//         },
//         {
//           "type": "SimpleProperty",
//           "node": "bankAccountId:DefinitionProperty",
//           "typeDef": "string"
//         },
//         {
//           "type": "SimpleProperty",
//           "node": "amount:DefinitionProperty",
//           "typeDef": "number"
//         },
//         {
//           "type": "DerivedProperty",
//           "node": "doubleAmount:DefinitionProperty",
//           "derivation": {
//             "type": "RDTMath",
//             "lhs": {
//               "type": "RDTPropertyAccess",
//               "source": {
//                 "type": "RDTSourceSelf",
//                 "node": "Transaction:Definition",
//                 "context": {
//                   "symbols": {}
//                 }
//               },
//               "propertyName": {
//                 "type": "RDTSourceConstant",
//                 "value": "amount",
//                 "typeDef": "string"
//               }
//             },
//             "rhs": {
//               "type": "RDTSourceConstant",
//               "value": "2",
//               "typeDef": "number"
//             },
//             "operator": "*"
//           }
//         }
//       ]
//     }
//   ]

//  What dependencies does it have. There are none (?? maybe), write time, and read time. Can we split the two with RDT's?
//  Self vs. others.
//  Build an execution of both? What would that look like?
//  ?? Heuristic: If there are write time dependencies we should store them ??
//  Is a function just an explicit read time dependency? If automatically specified (like current time) it could be provided.
//  Perhaps not (now but Date.currentReadTime vs. Date.currentWriteTime)
//  ?? Heuristic: If the result of the write time dependency graph is a full dataset, perhaps it isn't eagerly computed and instead is a join. Other architectures could optimize accordingly ??
//  
//  Next steps: Split the execution graph

const replacer = (key, value) => {
    if (key === "node") {
        return `${getIdentifierName(value) ?? "unknown"}:${value.type ?? "unknown"}`;
    } else if (key === "rdtContext") {
        return undefined;
    } else {
        return value;
    }
};

function debugRDTNode(node: RDTNode) {
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
    }

    return `${name}:${node.type}`;
}

try {
    const ast: AST = parser.parse(input);
    console.log(JSON.stringify(ast, null, 2));
    const ctx = new Context();
    generateIdentifyingSymbols(ast, ctx);
    console.log(JSON.stringify(ctx.tree(), null, 2));
    const rdtCtx = new RDTContext();
    const rdt = convertToRDT(ast, rdtCtx);
    console.log(JSON.stringify(rdt, replacer, 2));
    console.log(JSON.stringify(rdtCtx.tree(), null, 2));
    const finalOutput = walkDFS(rdt, {
        onAfter: (ctx) => {
            // console.log(ctx.node.type, ctx.lineage.length, !!ctx.node.rdtContext);
            if (ctx.node.type === "RDTSourceConstant") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTPropertyAccess" && parent.propertyName === ctx.node) {
                    return;
                }
                if (ctx.node.typeDef.type === "RDTTypeIdentifier" && ctx.node.typeDef.name === "string") {
                    const matchingNode = ctx.node.rdtContext.findByName(ctx.node.value);
                    if (!matchingNode) {
                        throw new Error(`Unable to find expected reference: ${ctx.node.value} for node: ${JSON.stringify(ctx.node, replacer, 2)}`);
                    }
                    return {
                        replacement: matchingNode.node,
                    };
                }
            }
        }
    });
    const tainted = new Set<string>();
    const writeAst = new Map<string, {
        write: {
            [writeRecordId: string]: RDTNode,
        },
    }>();
    // Taint the nodes
    walkDFS(finalOutput, {
        onAfter: (ctx) => {
            // This runs at the bottom every time, doesn't matter if in before or after.
            if (ctx.node.type === "RDTSourceRuntime") {
                const [parent] = ctx.lineage;
                if (parent.type === "RDTFunction" && parent.parameters.includes(ctx.node)) {
                    // Don't double record, only record where used.
                    return;
                } 
                for (const ancestor of ctx.lineage) {
                    tainted.add(ancestor.id);
                }
                console.log("POST_TAINT", tainted);
            }
        }
    });
    // Split the tree
    const rwSeparatedOutput = walkDFS(finalOutput, {
        onAfter: (ctx) => {
            console.log(ctx.node.type, ctx.lineage.length, !!ctx.node.rdtContext);
            // This runs at the bottom every time, doesn't matter if in before or after.
            if (ctx.node.type === "RDTSourceRuntime" || ctx.node.type === "SimpleProperty") {
            } else if (!tainted.has(ctx.node.id)) {
                const [parent] = ctx.lineage;
                if (tainted.has(parent.id)) {
                    console.log(JSON.stringify(ctx.lineage, replacer, 2));
                    const grandparent = ctx.lineage.find((x) => x.type === "DerivedProperty");
                    if (!grandparent) {
                        console.log(debugRDTNode(ctx.node), debugRDTNode(parent));
                        throw new Error(`Unable to find root for read / write separation`);
                    }
                    const referenceId = genRdtId();
                    writeAst.set(grandparent.id, {
                        write: {
                            [referenceId]: ctx.node,
                        },
                    });
                    return {
                        replacement: {
                            id: referenceId,
                            type: "RDTRWReference",
                            rdtContext: ctx.node.rdtContext,
                            referenceId,
                        },
                    };
                }
            } else if (writeAst.has(ctx.node.id)) {
                if (ctx.node.type !== "DerivedProperty") {
                    throw new Error(`Expected derived property as source for write ast: ${debugRDTNode(ctx.node)}`);
                }
                return {
                    replacement: {
                        ...ctx.node,
                        derivation: {
                            id: genRdtId(),
                            type: "RDTRWRoot",
                            rdtContext: ctx.node.rdtContext,
                            read: ctx.node.derivation,
                            write: writeAst.get(ctx.node.id)!.write,
                        } satisfies RDTRWRoot,
                    },
                };
            }
        }
    });
    console.log(JSON.stringify(finalOutput, replacer, 2));
    console.log(JSON.stringify(rwSeparatedOutput, replacer, 2));
    console.log(writeAst);
    // console.log(JSON.stringify(Array.from(tainted.values()).map((x) => debugRDTNode(x)), replacer, 2));
} catch (e) {
    console.error('Parse error:', e.stack);
}
