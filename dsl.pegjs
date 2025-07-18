Start
  = (_? def:Statement _? { return def; })+

Statement 
  = DefinitionStatement
  / AssignmentStatement
  / ExpressionStatement

AssignmentStatement
  = name:Identifier _? "=" _? value:Expr {
      return { type: "Assignment", name, value };
    }

DefinitionStatement
  = name:Identifier _? "{" _ props:DefinitionBodyList? _ "}" {
      return { type: "Definition", name, properties: props || [] };
    }

ExpressionStatement
  = expr:Expr {
      return { type: "Expression", expr };
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

Identifier
  = str:$([a-zA-Z_][a-zA-Z0-9_]*) { return {type: "Identifier", value: str}; }

Numeric
  = val:$([0-9]+([.][0-9])?) {return {type: "NumericLiteral", value: val};}

Boolean
  = "true" { return {type: "BooleanLiteral", value: true}; }
  / "false" { return {type: "BooleanLiteral", value: false}; }

Context
  = [$] ident:Identifier? { return {type: "ContextLiteral", value: ident};}

Expr
  = ReturnExpr
  / OrderedExpressionsBlock
  / ObjectLiteralExpr
  / LetExpr
  / IfExpr
  / LambdaExpr

ReturnExpr
  = "$return" _? expr:Expr { return {type: "ReturnExpr", expr}; }

OrderedExpressionsBlock
  = "{" _? head:Expr tail:(_spaces? [;\n]+ _? @Expr)* _? ";"? _? "}" {
      return {type: "OrderedExpressionsBlock", exprs: [head].concat(tail)};
  }

ObjectLiteralExpr
  = "{" _? props:ObjectLiteralBodyList? _? "}" {
    return { type: "ObjectLiteralExpr", properties: props || [] };
  }

LetExpr
  = "$let" _? identifier:Identifier _? "=" _? value:Expr {
      return { type: "LetExpr", identifier, value };
    }

IfExpr
  = "$if" _? "(" _? condition:Expr _? ")" _? thenExpr:OrderedExpressionsBlock elseExpr:(_? @(ElseIfExpr/ElseExpr))? {
      return { type: "IfExpr", condition, then: thenExpr, else: elseExpr || null };
    }
  / "$if" _? "(" _? condition:Expr _? ")" _? thenExpr:Expr elseExpr:(_? @(ElseIfExpr/ElseExpr))? {
      return { type: "IfExpr", condition, then: thenExpr, else: elseExpr || null };
    }

ElseIfExpr
  = "$elif" _? "(" _? condition:Expr _? ")" _? thenExpr:OrderedExpressionsBlock elseExpr:(_? @ElseIfExpr)? {
      return { type: "IfExpr", condition, then: thenExpr, else: elseExpr || null };
    }
  / "$elif" _? "(" _? condition:Expr _? ")" _? thenExpr:Expr elseExpr:(_? @ElseIfExpr)? {
      return { type: "IfExpr", condition, then: thenExpr, else: elseExpr || null };
    }

// No need to make this part of the ast since it is only the ever the else case of an if statement.
ElseExpr
  = "$else" _? expr:OrderedExpressionsBlock { return expr; }
  / "$else" _? expr:Expr { return expr; }

LambdaExpr
  = "(" params:ParamList? ")" _ "=>" _ body:Expr { return {type: "LambdaExpr", params, body}; }
  / LogicalOrExpr

LogicalOrExpr
  = head:LogicalAndExpr tail:(_? "||" _? LogicalAndExpr)* {
      return tail.reduce((left, right) => {
        // 'right' is an array from the tail match: [whitespace, operator, whitespace, expression]
        return { type: "operator", operator: right[1], lhs: left, rhs: right[3] };
      }, head);
    }

LogicalAndExpr
  = head:EqualityExpr tail:(_? "&&" _? EqualityExpr)* {
      return tail.reduce((left, right) => {
        // 'right' is an array from the tail match: [whitespace, operator, whitespace, expression]
        return { type: "operator", operator: right[1], lhs: left, rhs: right[3] };
      }, head);
    }

EqualityExpr
  = head:AdditiveExpr tail:(_? ("=="/"!="/"<"/">") _? AdditiveExpr)* {
      return tail.reduce((left, right) => {
        // 'right' is an array from the tail match: [whitespace, operator, whitespace, expression]
        return { type: "operator", operator: right[1], lhs: left, rhs: right[3] };
      }, head);
    }

AdditiveExpr
  = head:MultiplicativeExpr tail:(_? [+-] _? MultiplicativeExpr)* {
      return tail.reduce((left, right) => {
        return { type: "operator", operator: right[1], lhs: left, rhs: right[3] };
      }, head);
    }

MultiplicativeExpr
  = head:MemberExpr tail:(_? [*/] _? MemberExpr)* {
      return tail.reduce((left, right) => {
        return { type: "operator", operator: right[1], lhs: left, rhs: right[3] };
      }, head);
    }

MemberExpr
  = head:PrimaryExpr tail:(_? @MemberSuffix)* {
      return tail.reduce((left, suffix) => {
        if (suffix.type === 'Invoke') {
          return { type: 'InvokeExpr', lhs: left, args: suffix.args };
        }
        if (suffix.type === 'Property') {
          return { type: 'operator', operator: '.', lhs: left, rhs: suffix.property };
        }
        if (suffix.type === 'Property') {
          return { type: 'operator', operator: '.', lhs: left, rhs: suffix.property };
        }
        if (suffix.type === 'PostfixOperator') {
          return { type: 'PostfixOperator', operator: suffix.operator, operand: left };
        }
        
        throw new Error(`Unknown suffix type: ${JSON.stringify(suffix)}`);
      }, head);
    }

MemberSuffix
  = "." _? prop:Identifier { return { type: 'Property', property: prop }; }
  / "(" _? args:ArgList? _? ")" { return { type: 'Invoke', args: args || [] }; }
  / "[]" { return { type: 'PostfixOperator', operator: "[]" }; }
  

PrimaryExpr
  = Numeric
  / StringLiteral
  / Boolean
  / Identifier
  / Context
  / "(" _ val:Expr _ ")" { return {type: "Parenthesis", val}; }

_
  = ([ \t\n\r] / Comment)*

_spaces
  = ([ \t] / Comment)*

Comment
  = "//" [^\n\r]*

StringLiteral
  = '"' chars:DoubleStringCharacters '"' { return {type: "StringLiteral", value: chars.join("")}; }
  / "'" chars:SingleStringCharacters "'" { return {type: "StringLiteral", value: chars.join("")}; }

DoubleStringCharacters
  = DoubleStringCharacter*

DoubleStringCharacter
  = !('"' / '\\') .  { return text(); }
  / '\\' escape:EscapeSequence { return escape; }

SingleStringCharacters
  = SingleStringCharacter*

SingleStringCharacter
  = !("'" / '\\') . { return text(); }
  / '\\' escape:EscapeSequence { return escape; }

EscapeSequence
  = 'n'  { return '\n'; }
  / 'r'  { return '\r'; }
  / 't'  { return '\t'; }
  / 'b'  { return '\b'; }
  / 'f'  { return '\f'; }
  / 'v'  { return '\v'; }
  / '\\' { return '\\'; }
  / "'"  { return "'"; }
  / '"'  { return '"'; }
  / '0'  { return '\0'; }
  / 'x' h1:HexDigit h2:HexDigit {
      return String.fromCharCode(parseInt(h1 + h2, 16));
    }
  / 'u' code:UnicodeEscape { return code; }

UnicodeEscape
  = '{' hex:HexDigits '}' {
      return String.fromCodePoint(parseInt(hex, 16));
    }
  / h1:HexDigit h2:HexDigit h3:HexDigit h4:HexDigit {
      return String.fromCharCode(parseInt(h1 + h2 + h3 + h4, 16));
    }

HexDigit
  = [0-9a-fA-F]

HexDigits
  = [0-9a-fA-F]+