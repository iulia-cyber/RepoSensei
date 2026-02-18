CREATE TABLE IF NOT EXISTS rs_repo_file_snapshots (
  repo_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  line_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repo_key, relative_path)
);

CREATE INDEX IF NOT EXISTS rs_repo_file_snapshots_repo_key_idx
  ON rs_repo_file_snapshots (repo_key);

CREATE TABLE IF NOT EXISTS rs_graph_edge_snapshots (
  repo_key TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repo_key, source_path, target_path)
);

CREATE INDEX IF NOT EXISTS rs_graph_edge_snapshots_repo_key_idx
  ON rs_graph_edge_snapshots (repo_key);

CREATE TABLE IF NOT EXISTS rs_chat_history (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
  embed_dim INTEGER;
BEGIN
  embed_dim := COALESCE(
    NULLIF(current_setting('repo_sensei.embed_dimensions', true), '')::INTEGER,
    1536
  );

  EXECUTE format(
    $sql$
      CREATE TABLE IF NOT EXISTS rs_repo_chunks (
        id BIGSERIAL PRIMARY KEY,
        repo_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding vector(%s) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (repo_key, content_hash)
      );
    $sql$,
    embed_dim
  );
END $$;

CREATE INDEX IF NOT EXISTS rs_repo_chunks_repo_key_idx
  ON rs_repo_chunks (repo_key);

CREATE TABLE IF NOT EXISTS rs_repo_chunks_json (
  id BIGSERIAL PRIMARY KEY,
  repo_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_key, content_hash)
);

CREATE INDEX IF NOT EXISTS rs_repo_chunks_json_repo_key_idx
  ON rs_repo_chunks_json (repo_key);
