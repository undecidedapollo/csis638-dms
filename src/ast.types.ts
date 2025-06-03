export type AST = DefinitionNode[];

/** -----------------------------
 *  Definition Nodes & Entities
 *  -----------------------------
 */
export interface DefinitionNode {
    type: "Definition";
    name: IdentifierNode;
    properties: Array<DefinitionPropertyNode | DefinitionFunctionNode>;
}

export interface DefinitionPropertyNode {
    type: "DefinitionProperty";
    identifier: IdentifierNode;
    definition: TypeExprNode;
}

export interface DefinitionFunctionNode {
    type: "DefinitionFunction";
    name: IdentifierNode;
    params: ParamNode[];
    body: ReturnExprNode;
}

export interface ParamNode {
    type: "Param";
    identifier: IdentifierNode;
    definition: TypeExprNode | null;
}

/** -----------------------------
 *  Expression Nodes
 *  -----------------------------
 */
export type ExprNode =
    | ReturnExprNode
    | ObjectLiteralExprNode
    | LambdaExprNode
    | OperatorExprNode
    | InvokeExprNode
    | DotExpressionNode
    | TypeExprNode
    | NumericNode
    | IdentifierNode
    | ContextNode
    | ParenthesisNode;

export interface ReturnExprNode {
    type: "ReturnExpr";
    expr: ExprNode;
}

export interface ObjectLiteralExprNode {
    type: "ObjectLiteralExpr";
    properties: Array<
        ObjectLiteralPropertyNode | ObjectLiteralFunctionNode
    >;
}

export interface ObjectLiteralPropertyNode {
    type: "ObjectLiteralProperty";
    identifier: IdentifierNode;
    source: ExprNode | null;
}

export interface ObjectLiteralFunctionNode {
    type: "ObjectLiteralFunction";
    name: IdentifierNode;
    params: ParamNode[];
    body: ExprNode;
}

export interface LambdaExprNode {
    type: "LambdaExpr";
    params: ParamNode[];
    body: ExprNode;
}

export interface OperatorExprNode {
    type: "operator",
    operator:  "==" | "+" | "-" | "*" | "/";
    lhs: ExprNode;
    rhs: ExprNode;
}

export interface InvokeExprNode {
    type: "InvokeExpr";
    lhs: DotExpressionNode;
    args: ExprNode[];
}

export interface DotExpressionNode {
    type: "operator",
    operator: ".";
    lhs: PrimaryExprNode;
    rhs: DotExpressionNode;
}

export type PrimaryExprNode =
    | TypeExprNode
    | NumericNode
    | IdentifierNode
    | ContextNode
    | ParenthesisNode;

export interface TypeExprNode {
    type: "TypeExpr";
    base: IdentifierNode;
    array: boolean;
}

export interface NumericNode {
    type: "number";
    value: string;
}

export interface IdentifierNode {
    type: "string";
    value: string;
}

export interface ContextNode {
    type: "context";
    value: "$";
}

export interface ParenthesisNode {
    type: "Parenthesis";
    val: ExprNode;
}

export type IdentifiesNode = 
| DefinitionNode 
| DefinitionPropertyNode 
| DefinitionFunctionNode
| ObjectLiteralFunctionNode 
| ObjectLiteralPropertyNode 
| ParamNode 
| TypeExprNode

export type ASTNode = 
| DefinitionNode
| DefinitionPropertyNode
| DefinitionFunctionNode
| ObjectLiteralFunctionNode
| ObjectLiteralPropertyNode
| ParamNode
| ExprNode
| PrimaryExprNode