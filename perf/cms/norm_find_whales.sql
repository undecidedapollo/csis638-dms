BEGIN;
    SELECT "userId", COUNT(*) FROM "Purchase" WHERE amount > 975 and returned = false GROUP BY "userId" HAVING COUNT(*) > 3;
END;
