import { randomUUID } from 'node:crypto';
import { AST, ASTNode, DefinitionFunctionNode, DefinitionNode, DefinitionPropertyNode, IdentifierNode, IdentifiesNode, LambdaExprNode, ObjectLiteralExprNode, ObjectLiteralPropertyNode } from './ast.types';
import parser from './bankaccount.cjs';
const input = `
    Transaction {
        id: uuid,
        bankAccountId: string,
        amount: number,
        doubleAmount: (row: $row, rand: number) => row.amount * 2 + rand + testing((x) => x * 2)
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
interface RDTDefinition {
    node: DefinitionNode;
    properties: Array<RDTProperty>;
}

interface RDTSimpleProperty {
    type: "SimpleProperty";
    node: DefinitionPropertyNode;
    typeDef: string;
}

interface RDTDerivedProperty {
    type: "DerivedProperty";
    node: DefinitionPropertyNode;
    derivation: RDTComputeNode;
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
    type: "RDTSourceContext";
    name: string;
    typeDef: RDTTypeContext;
}

interface RDTSourceConstant {
    type: "RDTSourceConstant";
    typeDef: RDTTypeDef;
    value: string;
}

interface RDTPropertyAccess {
    type: "RDTPropertyAccess";
    source: RDTComputeNode;
    propertyName: RDTComputeNode;
}

interface RDTMath {
    type: "RDTMath";
    operator: "*" | "/" | "+" | "-";
    lhs: RDTComputeNode;
    rhs: RDTComputeNode;
}

interface RDTFunction {
    type: "RDTFunction";
    name?: string;
    parameters: RDTComputeNode[];
    body: RDTComputeNode;
}

interface RDTSourceRuntime {
    type: "RDTSourceRuntime";
    name: string;
    typeDef: RDTTypeDef;
}

interface RDTInvoke {
    type: "RDTInvoke";
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


const globals: Array<RDTComputeNode> = [
    {
        type: "RDTFunction",
        name: "testing",
        parameters: [
            {
                type: "RDTSourceRuntime",
                name: "fnc",
                typeDef: {
                    type: "RDTTypeUnknown",
                },
            }
        ],
        body: {
            type: "RDTInvoke",
            source: {
                type: "RDTSourceRuntime",
                name: "fnc",
                typeDef: {
                    type: "RDTTypeUnknown",
                },
            },
            args: [
                {
                    type: "RDTSourceConstant",
                    value: "2",
                    typeDef: {
                        type: "RDTTypeIdentifier",
                        name: "number"
                    }
                },
            ],
        },
    },
];

// What's nexts:
// DO THE FUNCTION AND SOURCE RUNTIME STUFF

function rdtDerivedPropertyWalker(ast: ASTNode): RDTComputeNode {
    if (ast.type === "operator") {
        if ("+-*/".includes(ast.operator)) {
            const lhs = rdtDerivedPropertyWalker(ast.lhs);
            const rhs = rdtDerivedPropertyWalker(ast.rhs);
            return {
                type: "RDTMath",
                lhs,
                rhs,
                operator: ast.operator as RDTMath["operator"],
            };
        } else if (ast.operator === ".") {
            const source = rdtDerivedPropertyWalker(ast.lhs);
            const propertyName = rdtDerivedPropertyWalker(ast.rhs);

            return {
                type: "RDTPropertyAccess",
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
            type: "RDTSourceConstant",
            value: ast.base.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: "string",
            },
        };
    } else if (ast.type === "number" || ast.type === "string") {
        return {
            type: "RDTSourceConstant",
            value: ast.value,
            typeDef: {
                type: "RDTTypeIdentifier",
                name: ast.type,
            },
        };
    } else if (ast.type === "Param") {
        if (ast.definition?.type === "TypeExpr") {
            if (ast.definition?.array) throw new Error("rdt param type is array");
            return {
                type: "RDTSourceRuntime",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeIdentifier",
                    name: ast.definition.base.value,
                },
            };
        } else if (ast.definition?.type === "context") {
            return {
                type: "RDTSourceContext",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeContext",
                    name: ast.definition.value?.value,
                },
            };
        } else {
            return {
                type: "RDTSourceRuntime",
                name: ast.identifier.value,
                typeDef: {
                    type: "RDTTypeUnknown",
                },
            };
        }
    }
    else if (ast.type === "LambdaExpr") {
        const parameters = ast.params.map((param) => rdtDerivedPropertyWalker(param));
        const body = rdtDerivedPropertyWalker(ast.body);
        return {
            type: "RDTFunction",
            parameters,
            body,
        };
    }
    else if (ast.type === "InvokeExpr") {
        const source = rdtDerivedPropertyWalker(ast.lhs);
        const args = ast.args.map((arg) => rdtDerivedPropertyWalker(arg));
        return {
            type: "RDTInvoke",
            source,
            args,
        };
    }
    else {
        throw new Error(`Unable to rdt walk for ast type: ${ast.type} node: ${JSON.stringify(ast, null, 2)}`);
    }
}

function rdtDefinitionProperty(ast: DefinitionPropertyNode | DefinitionFunctionNode, ctx: { node: ASTNode, context: Context }): RDTProperty {
    if (ast.type === "DefinitionProperty") {
        if (ast.definition.type === "TypeExpr") {
            if (ast.definition.array) throw new Error(`Table aliasing not supported, due to "${ast.definition.base.value}[]"`);
            return {
                type: "SimpleProperty",
                node: ast,
                typeDef: ast.definition.base.value,
            };
        } else {
            const derivation = rdtDerivedPropertyWalker(ast.definition);
            return {
                type: "DerivedProperty",
                node: ast,
                derivation,
            };
        }
    } else if (ast.type === "DefinitionFunction") {
        throw new Error("Unimplemented exception");
    } else {
        throw new Error("Unimplemented exception");
    }
}

function rdtDefinition(ast: DefinitionNode, context: Context): RDTDefinition {
    const def: RDTDefinition = { node: ast, properties: [] };
    for (const prop of ast.properties) {
        const propDef = rdtDefinitionProperty(prop, { context, node: ast });
        def.properties.push(propDef);
    }
    return def;
}

// {
//     "BankAccount:Definition": {
//       "accountId:DefinitionProperty": {},
//       "balance:DefinitionProperty": {},
//       "transactions:DefinitionProperty": {}
//     },
//     "Transaction:Definition": {
//       "id:DefinitionProperty": {},
//       "bankAccountId:DefinitionProperty": {},
//       "amount:DefinitionProperty": {}
//     }
//  }

function _resolveDependencyTree(ast: ASTNode, context: Context) {
    if ("type" in ast) {
        if (ast.type === "Definition") {
            return rdtDefinition(ast, context);
        }
        // else if (ast.type === "ObjectLiteralProperty") {
        //     return walkObjectLiteralProperty(ast, context);
        // } else if (ast.type === "ReturnExpr") {
        //     return _recordIdentifyingSymbols(ast.expr, context);
        // } else if (ast.type === "operator") {
        //     _recordIdentifyingSymbols(ast.lhs, context);
        //     _recordIdentifyingSymbols(ast.rhs, context);
        // } else if (ast.type === "string" || ast.type === "number" || ast.type === "context" || ast.type === "TypeExpr") {

        // } else if (ast.type === "LambdaExpr") {
        //     walkLambdaExpression(ast, context);
        // } else if (ast.type === "InvokeExpr") {
        //     for(const arg of ast.args) {
        //         _recordIdentifyingSymbols(arg, context);
        //     }
        // } else if (ast.type === "ObjectLiteralExpr") {
        //     walkObjectLiteralExpression(ast, context);
        // } 
        else {
            throw new Error(`Unknown type while walking symbols: ${ast.type} ast: ${JSON.stringify(ast, null, 2)}`);
        }
        return;
    }

    throw new Error(`Unknown ast node while walking symbols: ${JSON.stringify(ast, null, 2)}`);
}

function resolveDependencyTree(ast: AST, context: Context) {
    const output: any[] = [];
    for (const node of ast) {
        output.push(_resolveDependencyTree(node, context));
    }
    return output;
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
//  
//  Next steps: Split the execution graph

try {
    const ast: AST = parser.parse(input);
    console.log(JSON.stringify(ast, null, 2));
    const ctx = new Context();
    generateIdentifyingSymbols(ast, ctx);
    console.log(JSON.stringify(ctx.tree(), null, 2));
    const rdt = resolveDependencyTree(ast, ctx);
    console.log(JSON.stringify(rdt, (key, value) => key === "node" ? `${getIdentifierName(value) ?? "unknown"}:${value.type ?? "unknown"}` : value, 2));
} catch (e) {
    console.error('Parse error:', e.message);
}
