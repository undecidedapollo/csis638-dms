\set user_id random(1, 100000)
BEGIN;
    SELECT *, "isWhale" > 3 AS "isWhaleBool"  FROM "User" WHERE "userId" = :user_id;
END;