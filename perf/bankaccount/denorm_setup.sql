DROP TRIGGER IF EXISTS "Transaction_BankAccount_balance_trigger" ON "Transaction";
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance"();
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance_reducers_forward"("accCur" FLOAT, "newRow" "Transaction");
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance_reducers_inverse"("accNext" FLOAT, "oldRow" "Transaction");
    
DROP TABLE IF EXISTS "BankAccount";
CREATE TABLE "BankAccount" (
    "accountId" FLOAT NOT NULL PRIMARY KEY,
    "balance" FLOAT NOT NULL DEFAULT(0.0)
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
        INSERT INTO "BankAccount" ("accountId", "balance") VALUES (i::FLOAT, 0);

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

CREATE OR REPLACE FUNCTION "Transaction_BankAccount_balance_reducers_forward"("accCur" FLOAT, "newRow" "Transaction")
    RETURNS FLOAT AS $$
    BEGIN
        RETURN ("accCur" + "newRow"."amount");
    END;
    $$ LANGUAGE plpgsql;


    
CREATE OR REPLACE FUNCTION "Transaction_BankAccount_balance_reducers_inverse"("accNext" FLOAT, "oldRow" "Transaction")
    RETURNS FLOAT AS $$
    BEGIN
        RETURN ("accNext" - "oldRow"."amount");
    END;
    $$ LANGUAGE plpgsql;



CREATE OR REPLACE FUNCTION "Transaction_BankAccount_balance"()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT operation
    IF (TG_OP = 'INSERT') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_forward"("BankAccount"."balance", NEW)
        WHERE (NEW."bankAccountId" = "BankAccount"."accountId");
        RETURN NEW;

    -- Handle UPDATE operation
    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_inverse"("BankAccount"."balance", OLD)
        WHERE (OLD."bankAccountId" = "BankAccount"."accountId");

        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_forward"("BankAccount"."balance", NEW)
        WHERE (NEW."bankAccountId" = "BankAccount"."accountId");
        RETURN NEW;

    -- Handle DELETE operation
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_inverse"("BankAccount"."balance", OLD)
        WHERE (OLD."bankAccountId" = "BankAccount"."accountId");
        RETURN OLD;
    END IF;

    -- This part should not be reached, but it's good practice
    RETURN NULL;
END;
    $$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_BankAccount_balance_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION "Transaction_BankAccount_balance"();



UPDATE "BankAccount"
SET "balance" = (SELECT SUM(tx.amount) FROM "Transaction" tx WHERE tx."bankAccountId" = "accountId");

VACUUM;
ANALYZE;
