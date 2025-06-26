\set show_id random(1, 10000)

BEGIN;
    DO $$
    DECLARE
        last_season INT;
        last_episode INT;
    BEGIN
        -- RAISE NOTICE 'Showid: %', :show_id;

        SELECT "seasonId" INTO last_season from "Seasons" where "showId" = :show_id ORDER BY "seasonId" DESC LIMIT 1 FOR UPDATE;
        SELECT "episodeId" INTO last_episode from "Episode" where "showId" = :show_id AND "seasonId" = last_season ORDER BY "episodeId" DESC LIMIT 1 FOR UPDATE;
        IF (last_episode IS NULL) THEN
            last_episode = 0;
        END IF;
        -- RAISE NOTICE 'For show %, last season is %, last episode is %', :show_id, last_season, last_episode;

        -- Create a new season with some episodes
        INSERT INTO "Seasons" ("showId", "seasonId") VALUES (:show_id, last_season + 1);
        INSERT INTO "Episode" ("showId", "seasonId", "episodeId") 
            VALUES 
                (:show_id, last_season + 1, 1),
                (:show_id, last_season + 1, 2), 
                (:show_id, last_season + 1, 3);

        -- -- Create some new episodes for the last season
        INSERT INTO "Episode" ("showId", "seasonId", "episodeId") 
            VALUES 
                (:show_id, last_season, last_episode + 1), 
                (:show_id, last_season, last_episode + 2), 
                (:show_id, last_season, last_episode + 3);
    END $$;
END;
