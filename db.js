/**
 * 数据库适配层
 *
 * - 生产模式 (DATABASE_URL 存在): 使用 PostgreSQL
 * - 本地开发 (DATABASE_URL 不存在): 使用 JSON 文件存储
 *
 * 自动切换，无需手动配置
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const USE_POSTGRES = !!process.env.DATABASE_URL;

let pool = null;

// ===== PostgreSQL 模式 =====
if (USE_POSTGRES) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

async function initDB() {
  if (USE_POSTGRES) {
    const client = await pool.connect();
    try {
      await client.query(`
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
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          diary_id INTEGER REFERENCES diaries(id) ON DELETE CASCADE,
          author VARCHAR(50) DEFAULT '匿名小可爱',
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_messages_diary ON messages(diary_id);
      `);
      console.log('✅ 数据库: PostgreSQL');
    } finally {
      client.release();
    }
  } else {
    // JSON 文件模式 - 自动迁移旧格式
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      // 检测是否为旧格式 (v1: { anniversary, memories })
      if (!raw.diaries && Array.isArray(raw.memories)) {
        console.log('🔄 检测到旧格式数据，正在迁移...');
        const migrated = {
          diaries: {
            'LEGACY-01': {
              id: 1,
              invite_code: 'LEGACY-01',
              title: '我们的恋爱点滴',
              anniversary: raw.anniversary || null,
              created_at: new Date().toISOString(),
              memories: raw.memories || [],
              messages: [],
            },
          },
          diarySeq: 1,
          memorySeq: (raw.memories || []).length,
          messageSeq: 0,
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(migrated, null, 2), 'utf-8');
        console.log('✅ 数据迁移完成！邀请码: LEGACY-01');
      }
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ diaries: {}, diarySeq: 0, memorySeq: 0, messageSeq: 0 }), 'utf-8');
    }
    console.log('✅ 数据库: JSON 文件模式 (本地开发)');
    console.log(`   📂 ${DATA_FILE}`);
  }
}

// ===== 通用数据操作 =====

function readStore() {
  if (USE_POSTGRES) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { diaries: {}, diarySeq: 0, memorySeq: 0 };
  }
}

function writeStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 生成邀请码
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return 'LOVE-' + code;
}

// ===== 日记操作 =====

async function createDiary(title) {
  if (USE_POSTGRES) {
    let code;
    for (let i = 0; i < 10; i++) {
      code = generateInviteCode();
      const exists = await pool.query('SELECT 1 FROM diaries WHERE invite_code = $1', [code]);
      if (exists.rows.length === 0) break;
    }
    const result = await pool.query(
      'INSERT INTO diaries (invite_code, title) VALUES ($1, $2) RETURNING *',
      [code, title || '我们的恋爱点滴']
    );
    return result.rows[0];
  } else {
    const store = readStore();
    let code;
    for (let i = 0; i < 10; i++) {
      code = generateInviteCode();
      if (!store.diaries[code]) break;
    }
    store.diarySeq++;
    const diary = {
      id: store.diarySeq,
      invite_code: code,
      title: title || '我们的恋爱点滴',
      anniversary: null,
      created_at: new Date().toISOString(),
      memories: [],
      messages: [],
    };
    store.diaries[code] = diary;
    writeStore(store);
    return diary;
  }
}

async function restoreDiary(inviteCode, { title, anniversary, memories, messages }) {
  if (USE_POSTGRES) {
    const exists = await pool.query('SELECT 1 FROM diaries WHERE invite_code = $1', [inviteCode]);
    if (exists.rows.length > 0) {
      return { error: '邀请码已存在' };
    }
    const d = await pool.query(
      'INSERT INTO diaries (invite_code, title, anniversary) VALUES ($1, $2, $3) RETURNING *',
      [inviteCode, title || '我们的恋爱点滴', anniversary || null]
    );
    const diary = d.rows[0];
    // Restore memories
    for (const m of (memories || [])) {
      await pool.query(
        `INSERT INTO memories (diary_id, date, tag, title, description, author, photos, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [diary.id, m.date, m.tag||'日常', m.title, m.description||m.desc||'', m.author||'匿名小可爱', JSON.stringify(m.photos||[]), m.created_at||m.createdAt||new Date().toISOString()]
      );
    }
    // Restore messages
    for (const m of (messages || [])) {
      await pool.query(
        'INSERT INTO messages (diary_id, author, content, created_at) VALUES ($1,$2,$3,$4)',
        [diary.id, m.author||'匿名小可爱', m.content, m.created_at||new Date().toISOString()]
      );
    }
    return diary;
  } else {
    const store = readStore();
    if (store.diaries[inviteCode]) return { error: '邀请码已存在' };
    store.diarySeq = Math.max(store.diarySeq, 1);
    store.memorySeq = Math.max(store.memorySeq || 0, (memories||[]).length);
    store.messageSeq = Math.max(store.messageSeq || 0, (messages||[]).length);
    const diary = {
      id: store.diarySeq,
      invite_code: inviteCode,
      title: title || '我们的恋爱点滴',
      anniversary: anniversary || null,
      created_at: new Date().toISOString(),
      memories: (memories||[]).map(m => ({...m, description: m.description||m.desc||'', author: m.author||'匿名小可爱', photos: m.photos||[], tag: m.tag||'日常'})),
      messages: messages || [],
    };
    store.diaries[inviteCode] = diary;
    writeStore(store);
    return diary;
  }
}

async function getDiaryByCode(code) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM diaries WHERE invite_code = $1', [code]);
    return result.rows[0] || null;
  } else {
    const store = readStore();
    return store.diaries[code] || null;
  }
}

async function updateAnniversary(code, anniversary) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      'UPDATE diaries SET anniversary = $1 WHERE invite_code = $2 RETURNING *',
      [anniversary, code]
    );
    return result.rows[0] || null;
  } else {
    const store = readStore();
    if (store.diaries[code]) {
      store.diaries[code].anniversary = anniversary;
      writeStore(store);
      return store.diaries[code];
    }
    return null;
  }
}

// ===== 记忆操作 =====

async function getMemoriesByCode(code) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return [];
    const result = await pool.query(
      'SELECT * FROM memories WHERE diary_id = $1 ORDER BY date DESC, created_at DESC',
      [diary.id]
    );
    return result.rows;
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return [];
    return [...(diary.memories || [])].sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
      if (d !== 0) return d;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }
}

async function addMemory(code, { date, tag, title, description, author, photos }) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return null;
    const result = await pool.query(
      `INSERT INTO memories (diary_id, date, tag, title, description, author, photos)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [diary.id, date, tag || '日常', title, description || '', author || '匿名小可爱', JSON.stringify(photos || [])]
    );
    return result.rows[0];
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return null;
    store.memorySeq++;
    const memory = {
      id: store.memorySeq,
      date, tag: tag || '日常', title,
      description: description || '',
      author: author || '匿名小可爱',
      photos: photos || [],
      created_at: new Date().toISOString(),
    };
    diary.memories.push(memory);
    writeStore(store);
    return memory;
  }
}

async function updateMemory(code, memoryId, { date, tag, title, description, author, photos }) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return null;
    const result = await pool.query(
      `UPDATE memories SET date=$1, tag=$2, title=$3, description=$4, author=$5, photos=$6
       WHERE id=$7 AND diary_id=$8 RETURNING *`,
      [date, tag, title, description, author, JSON.stringify(photos || []), memoryId, diary.id]
    );
    return result.rows[0] || null;
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return null;
    const idx = diary.memories.findIndex(m => m.id === memoryId);
    if (idx < 0) return null;
    diary.memories[idx] = { ...diary.memories[idx], date, tag, title, description, author, photos };
    writeStore(store);
    return diary.memories[idx];
  }
}

async function deleteMemory(code, memoryId) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return false;
    await pool.query('DELETE FROM memories WHERE id=$1 AND diary_id=$2', [memoryId, diary.id]);
    return true;
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return false;
    diary.memories = diary.memories.filter(m => m.id !== memoryId);
    writeStore(store);
    return true;
  }
}

// ===== 留言操作 =====

async function getMessagesByCode(code) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return [];
    const result = await pool.query(
      'SELECT * FROM messages WHERE diary_id = $1 ORDER BY created_at ASC',
      [diary.id]
    );
    return result.rows;
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return [];
    return [...(diary.messages || [])].sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    );
  }
}

async function addMessage(code, { author, content }) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return null;
    const result = await pool.query(
      'INSERT INTO messages (diary_id, author, content) VALUES ($1, $2, $3) RETURNING *',
      [diary.id, author || '匿名小可爱', content]
    );
    return result.rows[0];
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return null;
    if (!diary.messages) diary.messages = [];
    store.messageSeq = (store.messageSeq || 0) + 1;
    const message = {
      id: store.messageSeq,
      author: author || '匿名小可爱',
      content,
      created_at: new Date().toISOString(),
    };
    diary.messages.push(message);
    writeStore(store);
    return message;
  }
}

async function deleteMessage(code, messageId) {
  if (USE_POSTGRES) {
    const diary = await getDiaryByCode(code);
    if (!diary) return false;
    await pool.query('DELETE FROM messages WHERE id=$1 AND diary_id=$2', [messageId, diary.id]);
    return true;
  } else {
    const store = readStore();
    const diary = store.diaries[code];
    if (!diary) return false;
    if (!diary.messages) return false;
    diary.messages = diary.messages.filter(m => m.id !== messageId);
    writeStore(store);
    return true;
  }
}

module.exports = { initDB, createDiary, restoreDiary, getDiaryByCode, updateAnniversary, getMemoriesByCode, addMemory, updateMemory, deleteMemory, getMessagesByCode, addMessage, deleteMessage };
