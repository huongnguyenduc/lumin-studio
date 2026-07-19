ALTER TABLE groups DROP CONSTRAINT groups_pkey;
ALTER TABLE groups DROP COLUMN event_slug;
ALTER TABLE groups ADD PRIMARY KEY (name);

ALTER TABLE guests DROP COLUMN event_slug;

DROP TABLE events;
