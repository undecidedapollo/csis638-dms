BEGIN;
        SELECT
            b."accountId",
            SUM(t.amount) AS balance
        FROM
            "BankAccount" b
        JOIN
            "Transaction" t ON b."accountId" = t."bankAccountId"
        GROUP BY
            b."accountId"
        ORDER BY "balance" DESC
        LIMIT 10;
END;
