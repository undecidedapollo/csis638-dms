import { AST, ASTNode } from "./ast.types.js";
import { RDTNode, RDTRoot } from "./rdt.types.js";
import fs from "node:fs";
import parser from './dsl.cjs';
import { convertToRDT, toRDTExprString, toRDTreeString } from "./rdt.js";
import { removeRedundentReferences } from "./rdtRemoveRedundentReferences.js";
import { resolveRdtReferences } from "./rdtReferenceResolver.js";
import { replacer } from "./rdt.util.js";
import { resolveTypes } from "./rdtTypeSystem.js";

export enum TargetStage {
    AST = 1,
    RDT = 2,
    RDT_RESOLVED = 3,
    RDT_TYPED = 4,
}

interface TranspilerOptions {
    input: string,
    targetStage?: TargetStage,
    outDir?: string,
};


export const transpile = async function transpile(options: TranspilerOptions):Promise<{ast: AST; rdt: RDTNode | undefined;}> {
    const outDir = `out/traspiler/${options.outDir ?? "default"}`;
    await fs.promises.mkdir(outDir, { recursive: true });
    const targetStage = options.targetStage ?? TargetStage.RDT_TYPED;
    const ast: AST = parser.parse(options.input);
    await fs.promises.writeFile(`${outDir}/ast`, JSON.stringify(ast, null, 2));
    if (targetStage === 1) return {ast, rdt: undefined};
    const rdt = convertToRDT(ast);
    await fs.promises.writeFile(`${outDir}/rdt`, JSON.stringify(rdt, replacer, 2));
    await fs.promises.writeFile(`${outDir}/rdttree`, toRDTreeString(rdt));
    await fs.promises.writeFile(`${outDir}/rdtexpr`, toRDTExprString(rdt));
    if (targetStage === 2) return {ast, rdt};

    const {context: rdtCtx2, rdt: finalOutputTemp, ctxPerNode} = resolveRdtReferences(rdt);
    const {rdt: finalOutput} = removeRedundentReferences(finalOutputTemp);
    await fs.promises.writeFile(`${outDir}/rdt-resolved`, JSON.stringify(finalOutput, replacer, 2));
    await fs.promises.writeFile(`${outDir}/rdt-resolvedctx`, JSON.stringify(rdtCtx2.tree(), null, 2));
    await fs.promises.writeFile(`${outDir}/rdt-resolvedtree`, toRDTreeString(finalOutput));
    await fs.promises.writeFile(`${outDir}/rdt-resolvedexpr`, toRDTExprString(finalOutput));
    if (targetStage === 3) return {ast, rdt: finalOutput};

    resolveTypes(finalOutput as RDTRoot, ctxPerNode);
    await fs.promises.writeFile(`${outDir}/rdt-typed`, JSON.stringify(finalOutput, replacer, 2));
    await fs.promises.writeFile(`${outDir}/rdt-typedtree`, toRDTreeString(finalOutput));
    await fs.promises.writeFile(`${outDir}/rdt-typedexpr`, toRDTExprString(finalOutput));
    if (targetStage === 4) return {ast, rdt: finalOutput};
    return {ast, rdt: finalOutput};
};
