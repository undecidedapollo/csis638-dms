import { DefinitionFunctionNode, DefinitionNode, DefinitionPropertyNode, IdentifierNode } from "./ast.types";

function resolveName(ast: IdentifierNode) {
    if (ast.type === "string") {
        return ast.value;
    }

    throw new Error(`Unable to resolve name from node: ${JSON.stringify(ast, null, 2)}`);
}

abstract class MemBaseDefinitionProperty {
    constructor(public name: string) {

    }

    static fromAST(ast: DefinitionPropertyNode | DefinitionFunctionNode) {
        if (ast.type === "DefinitionProperty") {
            return new MemDefinitionProperty(resolveName(ast.identifier));
        } else if (ast.type === "DefinitionFunction") {
            return new MemDefinitionFunctionProperty(resolveName(ast.name));
        }

        throw new Error(`Unable to identify DefinitionProperty`)
    }
}

class MemDefinitionProperty extends MemBaseDefinitionProperty {
    constructor(public name: string) {
        super(name);
    }
}

class MemDefinitionFunctionProperty extends MemBaseDefinitionProperty {
    constructor(public name: string) {
        super(name);
    }
}

class MemDefinition  {
    constructor(public name: string) {

    }

    static fromAST(ast: DefinitionNode) {
        return new MemDefinition(resolveName(ast.name));
    }
}


class SymbolWalker {
    constructor() {}
}
