\set account_number random(1, 100)

BEGIN;
        SELECT
            b."accountId",
            b."balance"
        FROM
            "BankAccount" b
        WHERE
            b."accountId" = :account_number;
END;
