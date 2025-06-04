import { Pool } from 'pg';

const pool = new Pool({
    host: 'localhost:26257',
    user: 'root',
    max: 5,
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
    "20e61a19-bcb4-4ce9-9376-c1058eeb9fd2": number;
};

export interface Transaction {
    "id": string;
    "bankAccountId": string;
    "amount": number;
    doubleAmount: (rand: number) => number
};

function Transaction_simple_to_db(input: Transaction_simple): Transaction_db {
    return {
        "id": input["id"],
        "bankAccountId": input["bankAccountId"],
        "amount": input["amount"],
        "20e61a19-bcb4-4ce9-9376-c1058eeb9fd2": ((input)["amount"] * 2),
    } satisfies Transaction_db;
}

function Transaction_db_to_final(input: Transaction_db): Transaction {
    return {
        "id": input["id"],
        "bankAccountId": input["bankAccountId"],
        "amount": input["amount"],
        "doubleAmount": (rand: number,) => { return (input["20e61a19-bcb4-4ce9-9376-c1058eeb9fd2"] + rand); },
    } satisfies Transaction;
}

