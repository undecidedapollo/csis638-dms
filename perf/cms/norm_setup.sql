DROP TABLE IF EXISTS "User";
CREATE TABLE "User" (
    "userId" FLOAT NOT NULL,
    PRIMARY KEY("userId")
);


DROP TABLE IF EXISTS "Purchase";
CREATE TABLE "Purchase" (
    "userId" FLOAT NOT NULL,
    "purchaseId" FLOAT NOT NULL,
    "amount" FLOAT NOT NULL,
    "returned" BOOLEAN NOT NULL,
    PRIMARY KEY("userId", "purchaseId")
);

DO $$
DECLARE
    -- Configuration variables
    num_users INT := 10000;
    min_purchases INT := 1;
    max_purchases INT := 200;

    num_purchases INT;
BEGIN
    DELETE FROM "User";
    DELETE FROM "Purchase";

    RAISE NOTICE 'Generating % users...', num_users;

    FOR userid IN 1..num_users LOOP
        INSERT INTO "User" ("userId") VALUES (userid::FLOAT);

        num_purchases := GREATEST(1, floor(random() * (max_purchases - min_purchases + 1) + min_purchases)::INT - 125);

        FOR purchaseid IN 1..num_purchases LOOP
            INSERT INTO "Purchase" ("purchaseId", "userId", "amount", "returned")
            VALUES (
                purchaseid::FLOAT,
                userid::FLOAT,
                (((random() * 1000) * 100)::INT)::FLOAT / 100.0, -- Convert to int w/ two decimal places in tens and ones place then back to float
                random() > 0.95
            );
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test data generation complete.';
END $$;

VACUUM;
ANALYZE;
