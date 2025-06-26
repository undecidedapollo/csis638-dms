\set userid0 random(1, 100)
\set userid1 random(1, 100)
\set userid2 random(1, 100)
\set userid3 random(1, 100)
\set userid4 random(1, 100)
\set userid5 random(1, 100)
\set userid6 random(1, 100)
\set userid7 random(1, 100)
\set userid8 random(1, 100)
\set userid9 random(1, 100)
BEGIN;
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM "Purchase" WHERE "userId" = u."userId" AND returned = false) AS "lifetimeValue",
    (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = u."userId" AND returned = false) AS "numberOfPurchases",
    (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = u."userId" AND returned = true) AS "numberOfReturns",
    (SELECT (SELECT COUNT(1) FROM "Purchase" WHERE "userId" = u."userId" AND amount > 975 AND returned = false) > 3) AS "isWhale"
FROM "User" u
WHERE u."userId" in (:userid0, :userid1, :userid2, :userid3, :userid4, :userid5, :userid6, :userid7, :userid8, :userid9);

END;
