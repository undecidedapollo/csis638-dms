\set user_id random(1, 100000)

BEGIN;
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM "Purchase" WHERE "userId" = :user_id AND returned = false) AS "lifetimeValue",
    (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = :user_id AND returned = false) AS "numberOfPurchases",
    (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = :user_id AND returned = true) AS "numberOfReturns",
    (SELECT (SELECT COUNT(1) FROM "Purchase" WHERE "userId" = :user_id AND amount > 975 AND returned = false) > 3) AS "isWhale";

END;
