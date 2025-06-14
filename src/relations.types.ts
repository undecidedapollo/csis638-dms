import { RDTComputeNode, RDTNode } from "./rdt.types";

export type RelNode =
    | RelDatasource
    | RelPipeline
    | RelFilter;

export type RelPipelineOperators = RelFilter;

export interface RelDatasource {
    type: "RelDatasource";
}

export interface RelPipeline {
    type: "RelPipeline";
    source: RelDatasource;
    operations: RelPipelineOperators[];
}

export interface RelFilter {
    type: "RelFilter";
    expr: RDTComputeNode;
}
