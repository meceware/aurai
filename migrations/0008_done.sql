-- A photo or video can be marked as done: it moves to the Done group of its tool's history.
-- Empty while it is in progress; starting a new run on it empties it again.
ALTER TABLE image_sessions ADD COLUMN closed_at INTEGER;
ALTER TABLE video_sessions ADD COLUMN closed_at INTEGER;
