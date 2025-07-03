# Agent Instructions

## Building

1. Run `npm run gen` to generate the parser.
   - This compiles `dsl.pegjs` and writes the output to `src/dsl.cjs` and `src/dsl.d.ts`.
2. Run `npm run tsc` to compile TypeScript sources.
   - The compiled JavaScript and type declarations are emitted in the `dist/` directory.

## Cleaning build artifacts

- `npm run clean:pegjs` removes `src/dsl.cjs` and `src/dsl.d.ts`.
- `npm run clean:tsc` deletes the `dist/` directory.
- `npm run clean` runs the above two scripts.
- `npm run clean:out` resets the `out/` directory used by runtime scripts.
