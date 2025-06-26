\set account_number random(1, 100)

BEGIN;
    INSERT INTO "Transaction" ("id", "bankAccountId", "amount")
    VALUES (
        gen_random_uuid()::TEXT,
        :account_number,
        (random() * 1000 - 500)::FLOAT
    );
END;
