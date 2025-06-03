import { randomUUID } from 'node:crypto';
import { AST, ASTNode, DefinitionFunctionNode, DefinitionNode, DefinitionPropertyNode, IdentifierNode, IdentifiesNode, LambdaExprNode, ObjectLiteralExprNode, ObjectLiteralPropertyNode } from './ast.types';
import parser from './bankaccount.cjs';
const input = `
    Transaction {
        id: uuid,
        bankAccountId: string,
        amount: number,
        doubleAmount: $.amount * 2
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
    symbols: Map<string, {node: ASTNode, child: Context}> = new Map();

    constructor(private readonly parent?: Context) {}

    public findSymbol(name: string): boolean {
        const current = this.symbols.get(name);
        if (!current && this.parent) {
            return this.parent.findSymbol(name);
        }
        return !!current;
    }

    public addSymbol(node: IdentifiesNode): {child: Context} {
        const name = getIdentifierName(node);
        if (!name) throw new Error(`No name found for node: ${JSON.stringify(node, null, 2)}`);
        if (this.symbols.has(name)) throw new Error(`Duplicate node definition: "${name}" at node: ${JSON.stringify(node, null, 2)}`);
        const child = this.nested();
        this.symbols.set(name, {node, child});
        return {child};
    }

    public addAnonymous(node: ASTNode): {child: Context} {
        const identifier = randomUUID();
        if (this.symbols.has(identifier)) throw new Error(`Duplicate node definition: "${identifier}" at node: ${JSON.stringify(node, null, 2)}`);
        const child = this.nested();
        this.symbols.set(identifier, {node, child});
        return {child};
    }

    public nested(): Context {
        return new Context(this);
    }

    public tree() : any {
        return Object.fromEntries(Array.from(this.symbols.entries()).map(([key, x]) => [`${key}:${x.node.type}`, x.child.tree()]));
    }
}

// #region walkForContext
function walkDefinition(ast: DefinitionNode, context: Context) {
    const { child } = context.addSymbol(ast);

    for(const prop of ast.properties) {
        walkDefinitionProperty(prop, child);
    }
}

function walkDefinitionFunction(ast: DefinitionFunctionNode, funcContext: Context) {
    for(const param of ast.params) {
        funcContext.addSymbol(param)
    }
    _recordIdentifyingSymbols(ast.body, funcContext);
}

function walkDefinitionProperty(ast: DefinitionPropertyNode | DefinitionFunctionNode, context: Context) {
    const { child } = context.addSymbol(ast);
    if (ast.type === "DefinitionFunction") {
        walkDefinitionFunction(ast, child);
    }
}

function walkLambdaExpression(ast: LambdaExprNode, context: Context) {
    const { child } = context.addAnonymous(ast);
    for(const param of ast.params) {
        child.addSymbol(param)
    }
    _recordIdentifyingSymbols(ast.body, child);
}

function walkObjectLiteralExpression(ast: ObjectLiteralExprNode, context: Context) {
    const { child } = context.addAnonymous(ast);
    for(const prop of ast.properties) {
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
            for(const arg of ast.args) {
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
    for(const node of ast) {
        _recordIdentifyingSymbols(node, context);
    }
}

// #endregion

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
}

type RDTProperty = RDTSimpleProperty | RDTDerivedProperty;

interface RDTSourceSelf {
    type: "RDTSourceSelf";
    node: ASTNode; // Later convert to RDT node at a final resolver phase?
}

interface RDTSourceConstant {
    type: "RDTSourceConstant";
    value: string;
}

// #region Define The Tree

function rdtDefinitionProperty(ast: DefinitionPropertyNode | DefinitionFunctionNode, context: Context): RDTProperty {
    if (ast.type === "DefinitionProperty") {
        return {
            type: "SimpleProperty",
            node: ast,
            typeDef: "string",
        };
    } else if (ast.type === "DefinitionFunction") {
        throw new Error("Unimplemented exception");
    } else {
        throw new Error("Unimplemented exception");
    }
}

function rdtDefinition(ast: DefinitionNode, context: Context): RDTDefinition {
    const def : RDTDefinition = {node: ast, properties: []};
    for (const prop of ast.properties) {
        const propDef = rdtDefinitionProperty(prop, context);
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
