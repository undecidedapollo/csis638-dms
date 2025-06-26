DROP TABLE IF EXISTS "Show";
CREATE TABLE "Show" (
    "showId" FLOAT NOT NULL,
    PRIMARY KEY ("showId")
);
        


DROP TABLE IF EXISTS "Seasons";
CREATE TABLE "Seasons" (
    "showId" FLOAT NOT NULL,
    "seasonId" FLOAT NOT NULL,
    PRIMARY KEY ("showId", "seasonId")
);
        


DROP TABLE IF EXISTS "Episode";
CREATE TABLE "Episode" (
    "showId" FLOAT NOT NULL,
    "seasonId" FLOAT NOT NULL,
    "episodeId" FLOAT NOT NULL,
    PRIMARY KEY ("showId", "seasonId", "episodeId")
);

DO $$
DECLARE
    -- Configuration variables
    num_shows INT := 10000;
    min_season INT := 1;
    max_season INT := 15;
    min_episode INT := 3;
    max_episode INT := 27;

    num_seasons INT;
    num_episodes INT;
BEGIN
    RAISE NOTICE 'Deleting existing data...';
    DELETE FROM "Show";
    DELETE FROM "Seasons";
    DELETE FROM "Episode";

    RAISE NOTICE 'Generating % shows...', num_shows;

    FOR showid IN 1..num_shows LOOP
        INSERT INTO "Show" ("showId") VALUES (showid::FLOAT);

        num_seasons := floor(random() * (max_season - min_season + 1) + min_season)::INT;

        FOR seasonid IN 1..num_seasons LOOP
            INSERT INTO "Seasons" ("showId", "seasonId")
            VALUES (
                showid::FLOAT,
                seasonid
            );

            num_episodes := floor(random() * (max_episode - min_episode + 1) + min_episode)::INT;

            FOR episodeid IN 1..num_episodes LOOP
                INSERT INTO "Episode" ("showId", "seasonId", "episodeId")
                VALUES (
                    showid::FLOAT,
                    seasonid,
                    episodeid
                );
            END LOOP;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test data generation complete.';
END $$;

VACUUM;
ANALYZE;
