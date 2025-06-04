
import { Pool } from 'pg'

const pool = new Pool({
    host: 'localhost:26257',
    user: 'root',
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 500,
    database: "dbapp"
});

interface Transaction_Simple {
    id: string;
    bankAccountId: string;
    amount: number;
}

interface Transaction_DB_Row {
    id: string;
    bankAccountId: string;
    amount: number;
    doubleAmount_int_1: number;
}

interface Transaction_Fin {
    id: string;
    bankAccountId: string;
    amount: number;
    doubleAmount: (rand: number) => number;
}

function toTransaction_DB_Row(transaction: Transaction_Simple): Transaction_DB_Row {
    return {
        ...transaction,
        doubleAmount_int_1: transaction.amount * 2
    };
}

function toFinalTransaction(transaction: Transaction_DB_Row): Transaction_Fin {
    const intermediate = transaction.doubleAmount_int_1;
    return {
        id: transaction.id,
        bankAccountId: transaction.bankAccountId,
        amount: transaction.amount,
        doubleAmount: (rand: number) => intermediate + rand
    };
}

export class Transaction {
    static async create(pojo: Transaction_Simple): Promise<Transaction_Fin> {
        if (!pojo.id || !pojo.bankAccountId || typeof pojo.amount !== 'number') {
            throw new Error('Invalid Transaction data');
        }

        let transaction_db_row: Transaction_DB_Row = toTransaction_DB_Row(pojo);

        const res = await pool.query(
            'INSERT INTO "Transaction" ("id", "bankAccountId", "amount", "doubleAmount_int_1") VALUES ($1, $2, $3, $4) RETURNING *',
            [transaction_db_row.id, transaction_db_row.bankAccountId, transaction_db_row.amount, transaction_db_row.doubleAmount_int_1]
        );
        if (res.rowCount === 0) {
            throw new Error('Failed to create Transaction');
        }
        const row = res.rows[0];
        return toFinalTransaction(row);
    }
}

async function main() {
    const res = await Transaction.create({
        id: "123",
        amount: 123,
        bankAccountId: "123",
    });

    console.log(res);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
