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


        export interface Transaction_simple {
            "id": string;
"bankAccountId": string;
"amount": number;
            
        };

        export interface Transaction_db {
            "id": string;
"bankAccountId": string;
"amount": number;
            "doubleAmount_int_0": number;
        };

        export interface Transaction_final {
            "id": string;
"bankAccountId": string;
"amount": number;
            "doubleAmount": (rand: number) => number;
        };

        function Transaction_simple_to_db(input: Transaction_simple): Transaction_db {
            return {
                "id": input["id"],
"bankAccountId": input["bankAccountId"],
"amount": input["amount"],
                "doubleAmount_int_0": ((input)["amount"] * 2),
            } satisfies Transaction_db;
        }

        function Transaction_db_to_final(input: Transaction_db): Transaction_final {
            return {
                "id": input["id"],
"bankAccountId": input["bankAccountId"],
"amount": input["amount"],
                "doubleAmount": (rand: number,) => { return (input["doubleAmount_int_0"] + rand); },
            } satisfies Transaction_final;
        }

        export class Transaction {
            static async create(pojo: Transaction_simple): Promise<Transaction_final> {
                let db_row: Transaction_db = Transaction_simple_to_db(pojo);
        
                const res = await pool.query(
            'INSERT INTO "Transaction" ("id", "bankAccountId", "amount", "doubleAmount_int_0") VALUES ($1, $2, $3, $4) RETURNING *',
            [db_row["id"], db_row["bankAccountId"], db_row["amount"], db_row["doubleAmount_int_0"]]
        );;
                if (res.rowCount === 0) {
                    throw new Error('Failed to create Transaction');
                }
                const row = res.rows[0];
                return Transaction_db_to_final(row);
            }
        }