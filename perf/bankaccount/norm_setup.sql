DROP TABLE IF EXISTS "BankAccount";
CREATE TABLE "BankAccount" (
    "accountId" FLOAT NOT NULL PRIMARY KEY
);

DROP TABLE IF EXISTS "Transaction";
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankAccountId" FLOAT NOT NULL,
    "amount" FLOAT NOT NULL
);

DO $$
DECLARE
    -- Configuration variables
    num_accounts INT := 1000;
    min_transactions_per_account INT := 10;
    max_transactions_per_account INT := 1000;

    -- Loop variables
    num_transactions INT;
BEGIN
    -- Optional: Clear existing data from the tables to start fresh
    -- This makes the script runnable multiple times without creating duplicate data.
    RAISE NOTICE 'Deleting existing data...';
    DELETE FROM "Transaction";
    DELETE FROM "BankAccount";

    RAISE NOTICE 'Generating % bank accounts...', num_accounts;

    -- Loop to create the specified number of bank accounts
    FOR i IN 1..num_accounts LOOP
        INSERT INTO "BankAccount" ("accountId") VALUES (i::FLOAT);

        -- Determine a random number of transactions for the current account
        num_transactions := floor(random() * (max_transactions_per_account - min_transactions_per_account + 1) + min_transactions_per_account)::INT;

        -- Loop to create the transactions for the current account
        FOR j IN 1..num_transactions LOOP
            INSERT INTO "Transaction" ("id", "bankAccountId", "amount")
            VALUES (
                gen_random_uuid()::TEXT,
                i::FLOAT,
                 (((random() * 2000 - 1000) * 100)::INT)::FLOAT / 100.0 -- Convert to int w/ two decimal places in tens and ones place then back to float
            );
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test data generation complete.';
END $$;

CREATE INDEX idx_transaction_bank_account_id ON "Transaction" ("bankAccountId");

VACUUM;
ANALYZE;
