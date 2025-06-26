\set account_number random(1, 100)

BEGIN;
        INSERT INTO "Transaction" ("id", "bankAccountId", "amount")
        VALUES (
            gen_random_uuid()::TEXT,
            :account_number,
            (random() * 1000 - 500)::FLOAT
        );

        SELECT
            b."accountId",
            b."balance"
        FROM
            "BankAccount" b
        WHERE
            b."accountId" = :account_number;
END;
