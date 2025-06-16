
DROP TRIGGER IF EXISTS "Transaction_BankAccount_balance_trigger" ON "Transaction";
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance"();
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance_reducers_forward"("accCur" FLOAT, "newRow" "Transaction");
DROP FUNCTION IF EXISTS "Transaction_BankAccount_balance_reducers_inverse"("accNext" FLOAT, "oldRow" "Transaction");
DROP TABLE IF EXISTS "BankAccount";
CREATE TABLE "BankAccount" (
    "accountId" TEXT NOT NULL,
    "balance" FLOAT NOT NULL
);

DROP TABLE IF EXISTS "Transaction";
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" FLOAT NOT NULL
);
        
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
    IF (TG_OP = 'INSERT') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_forward"("BankAccount"."balance", NEW)
        WHERE (NEW."bankAccountId" = "BankAccount"."accountId");
        RETURN NEW;

    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_inverse"("BankAccount"."balance", OLD)
        WHERE (OLD."bankAccountId" = "BankAccount"."accountId");

        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_forward"("BankAccount"."balance", NEW)
        WHERE (NEW."bankAccountId" = "BankAccount"."accountId");
        RETURN NEW;

    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE "BankAccount"
        SET "balance" = "Transaction_BankAccount_balance_reducers_inverse"("BankAccount"."balance", OLD)
        WHERE (OLD."bankAccountId" = "BankAccount"."accountId");
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_BankAccount_balance_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION "Transaction_BankAccount_balance"();
