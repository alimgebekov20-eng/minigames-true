const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- База данных ----------
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= { users: {}, lobbies: {} };
  await db.write();
}
initDB();

// ---------- Вспомогательные ----------
function generateAvatar() {
  const shapes = ['square', 'circle', 'triangle', 'diamond', 'hexagon', 'star'];
  return shapes[Math.floor(Math.random() * shapes.length)];
}

function generateToken() {
  return uuidv4();
}

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log('Подключён:', socket.id);

  // ---- Регистрация / Вход ----
  socket.on('register', async ({ login, nickname }, callback) => {
    await db.read();
    const existing = Object.values(db.data.users).find(u => u.login === login);
    if (existing) {
      return callback({ error: 'Логин уже занят' });
    }
    const userId = uuidv4();
    const token = generateToken();
    const user = {
      id: userId,
      login,
      nickname,
      elo: 1000,
      avatar: generateAvatar(),
      avatarUrl: null,
      token,
      createdAt: Date.now()
    };
    db.data.users[userId] = user;
    await db.write();
    callback({ success: true, user: { id: userId, login, nickname, elo: user.elo, avatar: user.avatar }, token });
  });

  socket.on('login', async ({ token }, callback) => {
    await db.read();
    const user = Object.values(db.data.users).find(u => u.token === token);
    if (!user) return callback({ error: 'Неверный токен' });
    callback({ success: true, user: { id: user.id, login: user.login, nickname: user.nickname, elo: user.elo, avatar: user.avatar } });
  });

  // ---- Лобби ----
  socket.on('getLobbies', async (callback) => {
    await db.read();
    const lobbies = Object.values(db.data.lobbies).map(l => ({
      id: l.id,
      name: l.name,
      players: l.players.length,
      maxPlayers: l.maxPlayers,
      hasChat: l.hasChat,
      adminId: l.adminId
    }));
    callback(lobbies);
  });

  socket.on('createLobby', async ({ name, maxPlayers, hasChat, user }, callback) => {
    await db.read();
    if (Object.values(db.data.lobbies).some(l => l.name === name)) {
      return callback({ error: 'Лобби с таким именем уже существует' });
    }
    if (maxPlayers < 2 || maxPlayers > 8) {
      return callback({ error: 'Количество игроков: от 2 до 8' });
    }
    const lobbyId = uuidv4();
    const lobby = {
      id: lobbyId,
      name,
      maxPlayers,
      hasChat,
      adminId: user.id,
      players: [user],
      banned: [],
      chat: [],
      createdAt: Date.now()
    };
    db.data.lobbies[lobbyId] = lobby;
    await db.write();

    socket.join(lobbyId);
    socket.lobbyId = lobbyId;
    callback({ success: true, lobby: sanitizeLobby(lobby) });
    io.emit('lobbiesUpdated');
  });

  socket.on('joinLobby', async ({ lobbyId, user }, callback) => {
    await db.read();
    const lobby = db.data.lobbies[lobbyId];
    if (!lobby) return callback({ error: 'Лобби не найдено' });
    if (lobby.banned.includes(user.id)) return callback({ error: 'Вы забанены в этом лобби' });
    if (lobby.players.length >= lobby.maxPlayers) return callback({ error: 'Лобби заполнено' });
    if (lobby.players.find(p => p.id === user.id)) return callback({ error: 'Вы уже в лобби' });

    lobby.players.push(user);
    await db.write();

    socket.join(lobbyId);
    socket.lobbyId = lobbyId;
    callback({ success: true, lobby: sanitizeLobby(lobby) });
    io.to(lobbyId).emit('lobbyUpdated', sanitizeLobby(lobby));
    io.emit('lobbiesUpdated');
  });

  socket.on('leaveLobby', async ({ lobbyId, user }, callback) => {
    await db.read();
    const lobby = db.data.lobbies[lobbyId];
    if (!lobby) return callback({ error: 'Лобби не найдено' });

    lobby.players = lobby.players.filter(p => p.id !== user.id);
    socket.leave(lobbyId);
    socket.lobbyId = null;

    if (lobby.players.length === 0) {
      delete db.data.lobbies[lobbyId];
    } else if (lobby.adminId === user.id) {
      lobby.adminId = lobby.players[Math.floor(Math.random() * lobby.players.length)].id;
    }
    await db.write();

    callback({ success: true });
    if (db.data.lobbies[lobbyId]) {
      io.to(lobbyId).emit('lobbyUpdated', sanitizeLobby(db.data.lobbies[lobbyId]));
    }
    io.emit('lobbiesUpdated');
  });

  // ---- Действия админа ----
  socket.on('adminAction', async ({ lobbyId, targetId, action, adminId }, callback) => {
    await db.read();
    const lobby = db.data.lobbies[lobbyId];
    if (!lobby || lobby.adminId !== adminId) return callback({ error: 'Нет прав' });

    if (action === 'kick') {
      lobby.players = lobby.players.filter(p => p.id !== targetId);
    } else if (action === 'ban') {
      if (!lobby.banned.includes(targetId)) lobby.banned.push(targetId);
      lobby.players = lobby.players.filter(p => p.id !== targetId);
    } else if (action === 'transferAdmin') {
      if (lobby.players.find(p => p.id === targetId)) {
        lobby.adminId = targetId;
      }
    }
    await db.write();
    callback({ success: true });
    io.to(lobbyId).emit('lobbyUpdated', sanitizeLobby(lobby));
  });

  // ---- Чат ----
  socket.on('chatMessage', async ({ lobbyId, user, text }, callback) => {
    await db.read();
    const lobby = db.data.lobbies[lobbyId];
    if (!lobby || !lobby.hasChat) return callback({ error: 'Чат выключен' });

    const msg = { id: uuidv4(), userId: user.id, nickname: user.nickname, text, time: Date.now() };
    lobby.chat.push(msg);
    if (lobby.chat.length > 30) lobby.chat.shift(); // каждое 31-е удаляется
    await db.write();

    io.to(lobbyId).emit('newMessage', msg);
    callback({ success: true });
  });

  // ---- Выход ----
  socket.on('disconnect', () => {
    // Обработка отключения (можно добавить)
  });
});

function sanitizeLobby(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    maxPlayers: lobby.maxPlayers,
    hasChat: lobby.hasChat,
    adminId: lobby.adminId,
    players: lobby.players.map(p => ({ id: p.id, login: p.login, nickname: p.nickname, elo: p.elo, avatar: p.avatar })),
    chat: lobby.chat
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));