\set account_number random(1, 100)

BEGIN;
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
