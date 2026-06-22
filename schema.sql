-- 恋爱点滴 - 数据库初始化脚本
-- 使用方法: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS diaries (
  id SERIAL PRIMARY KEY,
  invite_code VARCHAR(10) UNIQUE NOT NULL,
  title VARCHAR(100) DEFAULT '我们的恋爱点滴',
  anniversary DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  diary_id INTEGER REFERENCES diaries(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  tag VARCHAR(20) DEFAULT '日常',
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  author VARCHAR(50) DEFAULT '匿名小可爱',
  photos JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_diary ON memories(diary_id);
