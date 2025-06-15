export type AST = StatementNode[];

export type StatementNode = DefinitionNode | AssignmentNode | ExpressionNode;

export interface DefinitionNode {
    type: "Definition";
    name: IdentifierNode;
    properties: Array<DefinitionPropertyNode | DefinitionFunctionNode>;
}

export interface AssignmentNode {
    type: "Assignment";
    name: IdentifierNode;
    value: ExprNode;
}

export interface ExpressionNode {
    type: "Expression";
    expr: ExprNode;
}

export interface DefinitionPropertyNode {
    type: "DefinitionProperty";
    identifier: IdentifierNode;
    definition: ASTNode;
}

export interface DefinitionFunctionNode {
    type: "DefinitionFunction";
    name: IdentifierNode;
    params: ParamNode[];
    body: ExprNode;
}

export interface ParamNode {
    type: "Param";
    identifier: IdentifierNode;
    definition: IdentifierNode | ContextNode | null;
}


export type ExprNode =
    | ReturnExprNode
    | ObjectLiteralExprNode
    | OrderedExpressionsBlockNode
    | IfExprNode
    | LetExprNode
    | LambdaExprNode
    | OperatorExprNode
    | InvokeExprNode
    | DotExpressionNode
    | PostfixOperator
    | NumericNode
    | IdentifierNode
    | BooleanNode
    | StringNode
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


export interface OrderedExpressionsBlockNode {
    type: "OrderedExpressionsBlock";
    exprs: ExprNode[];
}

export interface IfExprNode {
    type: "IfExpr";
    condition: ExprNode;
    then: ExprNode;
    else: ExprNode | null;
}

export interface LetExprNode {
    type: "LetExpr";
    identifier: IdentifierNode;
    value: ExprNode;
}

export interface LambdaExprNode {
    type: "LambdaExpr";
    params: ParamNode[];
    body: ExprNode;
}

export interface OperatorExprNode {
    type: "operator",
    operator:  "==" | "!=" | "+" | "-" | "*" | "/" | "&&" | "||";
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
    | NumericNode
    | StringNode
    | BooleanNode
    | IdentifierNode
    | ContextNode
    | ParenthesisNode;

export interface BooleanNode {
    type: "BooleanLiteral";
    value: boolean;
}

export interface NumericNode {
    type: "NumericLiteral";
    value: string;
}

export interface StringNode {
    type: "StringLiteral";
    value: string;
}
export interface IdentifierNode {
    type: "Identifier";
    value: string;
}

export interface ContextNode {
    type: "ContextLiteral";
    value: IdentifierNode | null;
}

export interface PostfixOperator {
    type: "PostfixOperator";
    operator: "[]";
    operand: ExprNode;
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

export type ASTNode = 
| StatementNode
| DefinitionPropertyNode
| DefinitionFunctionNode
| ObjectLiteralFunctionNode
| ObjectLiteralPropertyNode
| ParamNode
| ExprNode
| PrimaryExprNode