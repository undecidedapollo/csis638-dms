import { Pool } from 'pg';

const pool = new Pool({
    host: 'localhost',
    port: 26257,
    user: 'root',
    database: "dbapp",
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 500,
});


export interface ExampleTable_simple {
    "simpleField": number;

};

export interface ExampleTable_db {
    "simpleField": number;
    "derivedField_int_0": number;
};

export interface ExampleTable_final {
    "simpleField": number;
    "derivedField": (val: number) => number;
};

function ExampleTable_simple_to_db(input: ExampleTable_simple): ExampleTable_db {
    return {
        "simpleField": input["simpleField"],
        "derivedField_int_0": ((input)["simpleField"] * 2),
    } satisfies ExampleTable_db;
}

function ExampleTable_db_to_final(input: ExampleTable_db): ExampleTable_final {
    return {
        "simpleField": input["simpleField"],
        "derivedField": (val: number,) => { return (input["derivedField_int_0"] + val); },
    } satisfies ExampleTable_final;
}

export class ExampleTable {
    static async create(pojo: ExampleTable_simple): Promise<ExampleTable_final> {
        let db_row: ExampleTable_db = ExampleTable_simple_to_db(pojo);

        const res = await pool.query(
            'INSERT INTO "ExampleTable" ("simpleField", "derivedField_int_0") VALUES ($1, $2) RETURNING *',
            [db_row["simpleField"], db_row["derivedField_int_0"]]
        );;
        if (res.rowCount === 0) {
            throw new Error('Failed to create ExampleTable');
        }
        const row = res.rows[0];
        return ExampleTable_db_to_final(row);
    }
}