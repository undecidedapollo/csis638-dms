BEGIN;
        SELECT
            b."accountId",
            b."balance"
        FROM
            "BankAccount" b
        ORDER BY "balance" DESC
        LIMIT 10;
END;
