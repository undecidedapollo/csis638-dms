import { AST } from './ast.types';
import parser from './bankaccount.cjs';

const inputBefore = `

`;

const inputAfter = `
    BankAccount { 
        accountId: string

        get(accountId: string) {
            return BankAccount[].first((b) => b.accountId == accountId)
        }
        
        create(accountId: string) {
            return BankAccount[].create({
                accountId,
            })
        }
    }
`;

function keyBy(array, keyFn) {
    const result = {};
    for (const item of array) {
        const key = keyFn(item);
        result[key] = item;
    }
    return result;
}

const astBefore: AST = inputBefore.trim() !== "" ? parser.parse(inputBefore) : [];

const astAfter: AST = inputAfter.trim() !== "" ? parser.parse(inputAfter) : [];

function getName(ast) {
    if (ast.type === "Definition") {
        return ast.name.value;
    }
    if (ast.type === "Property") {
        return ast.identifier.value;
    }
}

function getNested(ast) {
    if (ast.type === "Definition") {
        return ast.properties;
    }
    if (ast.type === "Property") {
        return null;
    }
}

function diffAst(astBefore, astAfter) {
    const added: any[] = [];
    const removed: any[] = [];
    // const changed = [];

    const beforeMap = keyBy(astBefore, (x) => getName(x));
    const afterMap = keyBy(astAfter, (x) => getName(x));

    for (const after of astAfter) {
        const matchingBefore = beforeMap[getName(after)];
        if (!matchingBefore) {
            added.push(after);
            continue;
        }

        const beforeNested = getNested(matchingBefore) ?? [];
        const afterNested = getNested(after) ?? [];
        const changes = diffAst(beforeNested, afterNested);

        added.push(...changes.added.map((x) => ({...x, parent: after})));
        removed.push(...changes.removed.map((x) => ({...x, parent: matchingBefore})));
    }

    for (const before of astBefore) {
        const matchingAfter = afterMap[getName(before)];
        if (!matchingAfter) {
            removed.push(before);
        }
    }

    return {
        beforeMap,
        afterMap,
        added,
        removed,
    };
}


function generateAddDDLForType(ast) {
    if (ast.type === "Definition") {
        const concreteProperties = ast.properties.filter((x) => x.type === "DefinitionProperty" && x.definition.base.value === "string");
        const columns = concreteProperties.map((prop) => `"${prop.identifier.value}" TEXT`)
        console.log(concreteProperties);
        return `CREATE TABLE ${ast.name.value} (\n${columns.join(',\n')}\n);`;
    }
    return '';
}

export async function genDDL({
    added,
    removed,
}) {
    const statements: string[] = [];
    for (const item of added) {
        const res = generateAddDDLForType(item);
        console.log(res);
        statements.push(res);
    }

    return statements;
}

// console.log(JSON.stringify(astBefore, null, 2));
// console.log(JSON.stringify(astAfter, null, 2));
const diff = diffAst(astBefore, astAfter);
console.log(JSON.stringify(diff, null, 2));
const result = genDDL(diff);
console.log(JSON.stringify(result, null, 2));