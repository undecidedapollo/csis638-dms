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
    SELECT *, "isWhale" > 3 AS "isWhaleBool"  FROM "User" WHERE "userId" in (:userid0, :userid1, :userid2, :userid3, :userid4, :userid5, :userid6, :userid7, :userid8, :userid9);
END;