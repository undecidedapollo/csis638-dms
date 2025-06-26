BEGIN;
    SELECT "userId", "isWhale" FROM "User" WHERE "isWhale" > 3;
END;
