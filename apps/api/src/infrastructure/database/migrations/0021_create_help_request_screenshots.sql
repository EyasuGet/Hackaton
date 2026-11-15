-- Screenshots a learner attaches to their own help request (T3-048). At most one per
-- request. It lives no longer than the request: the read rule filters on the
-- request's expires_at, deleting the request cascades here, and cancelling the
-- request deletes the screenshot immediately.

CREATE TABLE help_request_screenshots (
  help_request_id uuid PRIMARY KEY REFERENCES help_requests (id) ON DELETE CASCADE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  -- At most 1 MiB, matching the upload limit.
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION delete_screenshot_of_cancelled_help_request() RETURNS trigger AS $$
BEGIN
  DELETE FROM help_request_screenshots WHERE help_request_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER help_requests_cancel_deletes_screenshot
  AFTER UPDATE OF state ON help_requests
  FOR EACH ROW WHEN (NEW.state = 'cancelled')
  EXECUTE FUNCTION delete_screenshot_of_cancelled_help_request();
