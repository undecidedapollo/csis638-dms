Start
  = (_ def:Definition _ { return def; })+

Definition
  = name:Identifier _ "{" _ props:DefinitionBodyList? _ "}" {
      return { type: "Definition", name, properties: props || [] };
    }

DefinitionBodyList
  = head:DefintionEntity tail:(_spaces? [,\n]+ _? @DefintionEntity)* {
      return [head].concat(tail);
    }

DefintionEntity
  = DefinitionProperty
  / DefinitionFunction

DefinitionFunction
  = name:Identifier "(" params:ParamList? ")" _? "{" _? body:Expr _? "}" { return {type: "DefinitionFunction", name, params, body}; }

DefinitionProperty
  = name:Identifier _ ":" _ type:Expr {
      return { type: "DefinitionProperty", identifier: name, definition: type };
    }

ObjectLiteralBodyList
  = head:ObjectLiteralEntity? tail:(_spaces? [,\n]+ _? @ObjectLiteralEntity)* _? ","? {
      return head ? [head].concat(tail ?? []) : [];
    }

ObjectLiteralEntity
  = ObjectLiteralProperty
  / ObjectLiteralFunction

ObjectLiteralFunction
  = name:Identifier "(" params:ParamList? ")" _? "{" _? body:Expr _? "}" { return {type: "ObjectLiteralFunction", name, params, body}; }

ObjectLiteralProperty
  = identifier:Identifier source:(_ ":" _ @Expr)? {
      return { type: "ObjectLiteralProperty", identifier, source };
    }

ArgList
  = head:Expr tail:(_ "," _ @Expr)* {
      return [head].concat(tail);
    }

ParamList
  = head:Param tail:(_ "," _ @Param)* {
      return [head].concat(tail);
    }
Param
  = name:Identifier type:(_? ":" _? @Expr)? {
      return { type: "Param", identifier: name, definition: type };
    }

TypeExpr
  = base:Identifier arr:Array? {
      return { type: "TypeExpr", base, array: !!arr };
    }

Array
  = "[]"

Identifier
  = str:$([a-zA-Z_][a-zA-Z0-9_]*) { return {type: "string", value: str}; }

Numeric
  = val:$([0-9]+([.][0-9])?) {return {type: "number", value: val};}

Context
  = [$] { return {type: "context", value: "$"};}

Expr
  = ReturnExpr
  / ObjectLiteralExpr

ReturnExpr
  = "return" _? expr:LambdaExpr { return {type: "ReturnExpr", expr}; }

ObjectLiteralExpr
  = "{" _? props:ObjectLiteralBodyList? _? "}" {
    return { type: "ObjectLiteralExpr", properties: props || [] };
  }
  / LambdaExpr

LambdaExpr
  = "(" params:ParamList? ")" _ "=>" _ body:Expr { return {type: "LambdaExpr", params, body}; }
  / EqualityExpr

EqualityExpr
  = lhs:AdditiveExpr _ operator:"==" _ rhs:EqualityExpr { return {type: "operator", operator, lhs, rhs}; }
  / AdditiveExpr

AdditiveExpr
  = lhs:MultiplicativeExpr _ operator:[+-] _ rhs:AdditiveExpr { return {type: "operator", operator, lhs, rhs}; }
  / MultiplicativeExpr

MultiplicativeExpr
  = lhs:InvokeExpr _ operator:[*/] _ rhs:MultiplicativeExpr { return {type: "operator", operator, lhs, rhs}; }
  / InvokeExpr

InvokeExpr
  = lhs:DotExpression _? "(" args: ArgList? ")" { return {type: "InvokeExpr", lhs, args: args ?? []}; }
  / DotExpression

DotExpression
  = lhs:PrimaryExpr _? [.] _? rhs:DotExpression { return { type: "operator", operator: ".", lhs, rhs}; }
  / PrimaryExpr

PrimaryExpr
  = TypeExpr
  / Numeric
  / Identifier
  / Context
  / "(" _ val:ObjectLiteralExpr _ ")" { return {type: "Parenthesis", val}; }
  



_ = [ \t\n\r]*
_spaces = [ \t]*
