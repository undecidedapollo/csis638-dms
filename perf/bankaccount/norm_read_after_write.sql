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
            SUM(t.amount) AS balance
        FROM
            "BankAccount" b
        JOIN
            "Transaction" t ON b."accountId" = t."bankAccountId"
        WHERE
            b."accountId" = :account_number
        GROUP BY
            b."accountId";
END;
