import { Pool } from 'pg';

const pool = new Pool({
    host: 'localhost:26257',
    user: 'root',
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 500,
});


        export interface Transaction {
            id: string;
bankAccountId: string;
amount: number;
        }