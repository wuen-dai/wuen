/**
 * 💕 恋爱点滴 - 多人在线协作服务器
 *
 * 技术栈: Express + Socket.IO + PostgreSQL/JSON
 * 部署: Railway.app (自动使用 PostgreSQL)
 * 本地: JSON 文件存储 (无需安装数据库)
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for photos
});

const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});
app.use(express.static(__dirname));

// ===== REST API =====

// 创建日记
app.post('/api/diaries', async (req, res) => {
  try {
    const { title } = req.body;
    const diary = await db.createDiary(title);
    res.json({ success: true, diary });
  } catch (e) {
    console.error('创建日记失败:', e.message);
    res.status(500).json({ error: '创建失败' });
  }
});

// 获取日记信息（通过邀请码）
app.get('/api/diaries/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const diary = await db.getDiaryByCode(code);
    if (!diary) {
      return res.status(404).json({ error: '日记不存在，请检查邀请码~' });
    }
    let memories = await db.getMemoriesByCode(code);
    let messages = await db.getMessagesByCode(code);
    // 如果 PG 查询为空但 diary 对象自带数据，使用自带数据
    if (memories.length === 0 && diary.memories && Array.isArray(diary.memories) && diary.memories.length > 0) {
      memories = diary.memories;
    }
    if (messages.length === 0 && diary.messages && Array.isArray(diary.messages) && diary.messages.length > 0) {
      messages = diary.messages;
    }
    res.json({ success: true, diary, memories, messages });
  } catch (e) {
    console.error('获取日记失败:', e.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// 恢复日记（迁移数据用）
app.post('/api/diaries/restore', async (req, res) => {
  try {
    const { inviteCode, diary } = req.body;
    if (!inviteCode || !diary) {
      return res.status(400).json({ error: '缺少参数' });
    }
    const result = await db.restoreDiary(inviteCode, diary);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ success: true, diary: result });
  } catch (e) {
    console.error('恢复日记失败:', e.message);
    res.status(500).json({ error: '恢复失败' });
  }
});

// 更新纪念日
app.put('/api/diaries/:code/anniversary', async (req, res) => {
  try {
    const { code } = req.params;
    const { anniversary } = req.body;
    const diary = await db.updateAnniversary(code, anniversary);
    if (!diary) {
      return res.status(404).json({ error: '日记不存在' });
    }
    io.to(code).emit('anniversary-updated', { anniversary });
    res.json({ success: true, diary });
  } catch (e) {
    console.error('更新纪念日失败:', e.message);
    res.status(500).json({ error: '更新失败' });
  }
});

// 添加回忆
app.post('/api/diaries/:code/memories', async (req, res) => {
  try {
    const { code } = req.params;
    const { date, tag, title, description, author, photos } = req.body;

    if (!date || !title) {
      return res.status(400).json({ error: '日期和标题不能为空' });
    }

    const memory = await db.addMemory(code, { date, tag, title, description, author, photos });
    if (!memory) {
      return res.status(404).json({ error: '日记不存在' });
    }

    io.to(code).emit('memory-added', { memory });
    console.log(`💾 [${code}] 新增回忆: "${title}" by ${author || '?'}`);

    res.json({ success: true, memory });
  } catch (e) {
    console.error('添加回忆失败:', e.message);
    res.status(500).json({ error: '添加失败' });
  }
});

// 更新回忆
app.put('/api/diaries/:code/memories/:id', async (req, res) => {
  try {
    const { code } = req.params;
    const memoryId = parseInt(req.params.id);
    const { date, tag, title, description, author, photos } = req.body;

    const memory = await db.updateMemory(code, memoryId, { date, tag, title, description, author, photos });
    if (!memory) {
      return res.status(404).json({ error: '回忆/日记不存在' });
    }

    io.to(code).emit('memory-updated', { memory });
    res.json({ success: true, memory });
  } catch (e) {
    console.error('更新回忆失败:', e.message);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除回忆
app.delete('/api/diaries/:code/memories/:id', async (req, res) => {
  try {
    const { code } = req.params;
    const memoryId = parseInt(req.params.id);

    const ok = await db.deleteMemory(code, memoryId);
    if (!ok) {
      return res.status(404).json({ error: '日记不存在' });
    }

    io.to(code).emit('memory-deleted', { id: memoryId });
    console.log(`🗑️ [${code}] 删除回忆 #${memoryId}`);

    res.json({ success: true });
  } catch (e) {
    console.error('删除回忆失败:', e.message);
    res.status(500).json({ error: '删除失败' });
  }
});

// 获取留言
app.get('/api/diaries/:code/messages', async (req, res) => {
  try {
    const { code } = req.params;
    const messages = await db.getMessagesByCode(code);
    res.json({ success: true, messages });
  } catch (e) {
    console.error('获取留言失败:', e.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// 添加留言
app.post('/api/diaries/:code/messages', async (req, res) => {
  try {
    const { code } = req.params;
    const { author, content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '留言内容不能为空' });
    }

    const message = await db.addMessage(code, { author, content: content.trim() });
    if (!message) {
      return res.status(404).json({ error: '日记不存在' });
    }

    io.to(code).emit('message-added', { message });
    console.log(`💬 [${code}] 新留言 by ${author || '?'}`);

    res.json({ success: true, message });
  } catch (e) {
    console.error('添加留言失败:', e.message);
    res.status(500).json({ error: '添加失败' });
  }
});

// 删除留言
app.delete('/api/diaries/:code/messages/:id', async (req, res) => {
  try {
    const { code } = req.params;
    const messageId = parseInt(req.params.id);

    const ok = await db.deleteMessage(code, messageId);
    if (!ok) {
      return res.status(404).json({ error: '日记不存在' });
    }

    io.to(code).emit('message-deleted', { id: messageId });
    console.log(`💬 [${code}] 删除留言 #${messageId}`);

    res.json({ success: true });
  } catch (e) {
    console.error('删除留言失败:', e.message);
    res.status(500).json({ error: '删除失败' });
  }
});

// ===== WebSocket =====
io.on('connection', (socket) => {
  console.log(`🔌 新连接: ${socket.id}`);

  socket.on('join-diary', (inviteCode) => {
    socket.join(inviteCode);
    socket.to(inviteCode).emit('partner-joined', { socketId: socket.id });
    const room = io.sockets.adapter.rooms.get(inviteCode);
    const count = room ? room.size : 0;
    socket.emit('room-info', { onlineCount: count });
    console.log(`👤 ${socket.id} 加入日记 [${inviteCode}] (在线: ${count})`);
  });

  socket.on('leave-diary', (inviteCode) => {
    socket.leave(inviteCode);
    socket.to(inviteCode).emit('partner-left', { socketId: socket.id });
    console.log(`👋 ${socket.id} 离开日记 [${inviteCode}]`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 断开连接: ${socket.id}`);
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.to(room).emit('partner-left', { socketId: socket.id });
      }
    });
  });
});

// ===== 启动 =====
async function start() {
  try {
    await db.initDB();

    // 自动种子数据：如果数据库为空且有 seed.json，自动恢复
    const seedPath = path.join(__dirname, 'seed.json');
    if (fs.existsSync(seedPath)) {
      try {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const existing = await db.getDiaryByCode(seed.inviteCode);
        if (!existing) {
          await db.restoreDiary(seed.inviteCode, seed.diary);
          console.log(`🌱 已自动恢复日记: ${seed.inviteCode}`);
        } else {
          // 已有日记，补充缺失的回忆和留言
          const mems = await db.getMemoriesByCode(seed.inviteCode);
          const msgs = await db.getMessagesByCode(seed.inviteCode);
          if (mems.length === 0 && (seed.diary.memories || []).length > 0) {
            for (const m of seed.diary.memories) {
              await db.addMemory(seed.inviteCode, { date: m.date, tag: m.tag, title: m.title, description: m.description || m.desc || '', author: m.author || '匿名小可爱', photos: m.photos || [] });
            }
            console.log(`🌱 已补充恢复 ${seed.diary.memories.length} 条回忆`);
          }
          if (msgs.length === 0 && (seed.diary.messages || []).length > 0) {
            for (const m of seed.diary.messages) {
              await db.addMessage(seed.inviteCode, { author: m.author || '匿名小可爱', content: m.content });
            }
            console.log(`🌱 已补充恢复 ${seed.diary.messages.length} 条留言`);
          }
        }
      } catch (e) { console.warn('⚠️ 种子数据恢复失败:', e.message); }
    }
    server.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('💕 ====================================');
      console.log('   恋爱点滴 - 多人协作服务器已启动！');
      console.log('   ====================================');
      console.log('');
      console.log(`   📡 地址: http://localhost:${PORT}`);
      console.log(`   🔌 WebSocket: 已就绪`);
      console.log('');
      console.log('   💡 使用说明：');
      console.log('      1. 打开浏览器访问上方地址');
      console.log('      2. 创建一本日记 → 复制邀请码发给 TA');
      console.log('      3. TA 输入邀请码 → 两人实时协作 ✨');
      console.log('');
    });
  } catch (e) {
    console.error('启动失败:', e.message);
    process.exit(1);
  }
}

start();
