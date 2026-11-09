const socket = io();
const app = document.getElementById('app');

let currentUser = null;
let currentLobby = null;
let currentModal = null;

// ---------- Инициализация ----------
function init() {
  const savedToken = localStorage.getItem('token');
  if (savedToken) {
    socket.emit('login', { token: savedToken }, (res) => {
      if (res.error) {
        localStorage.removeItem('token');
        renderAuth();
      } else {
        currentUser = res.user;
        renderMainMenu();
      }
    });
  } else {
    renderAuth();
  }
}

// ---------- Экран входа ----------
function renderAuth() {
  app.innerHTML = `
    <div class="card auth-screen">
      <h1>🎮 Mini Games</h1>
      <div>
        <label>Логин (уникальный)</label>
        <input id="reg-login" placeholder="Например: pro_player" />
      </div>
      <div>
        <label>Никнейм (отображаемый)</label>
        <input id="reg-nickname" placeholder="Ваше имя" />
      </div>
      <button class="primary" id="reg-btn"><i class="fas fa-user-plus"></i> Создать аккаунт</button>
      <p style="color:var(--text-muted);font-size:13px;text-align:center;">Логин нельзя изменить, никнейм можно сменить в настройках</p>
    </div>
  `;
  document.getElementById('reg-btn').onclick = () => {
    const login = document.getElementById('reg-login').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    if (!login || !nickname) return alert('Заполните все поля');
    socket.emit('register', { login, nickname }, (res) => {
      if (res.error) return alert(res.error);
      localStorage.setItem('token', res.token);
      currentUser = res.user;
      renderMainMenu();
    });
  };
}

// ---------- Главное меню ----------
function renderMainMenu() {
  app.innerHTML = `
    <div class="main-menu">
      <div class="top-bar">
        <div class="avatar">${renderAvatar(currentUser)}</div>
        <div class="info">
          <div class="name">${currentUser.nickname}</div>
          <div class="login">@${currentUser.login}</div>
        </div>
        <div class="elo"><i class="fas fa-trophy"></i> ${currentUser.elo}</div>
      </div>
      <div class="menu-grid">
        <button class="menu-btn secondary" id="btn-search"><i class="fas fa-search"></i> Поиск лобби</button>
        <button class="menu-btn secondary" id="btn-create"><i class="fas fa-plus"></i> Создать лобби</button>
        <button class="menu-btn secondary" id="btn-settings"><i class="fas fa-cog"></i> Настройки</button>
      </div>
    </div>
  `;
  document.getElementById('btn-search').onclick = renderSearchLobby;
  document.getElementById('btn-create').onclick = renderCreateLobby;
  document.getElementById('btn-settings').onclick = renderSettings;
}

// ---------- Поиск лобби ----------
function renderSearchLobby() {
  app.innerHTML = `
    <div class="card">
      <h2><i class="fas fa-search"></i> Поиск лобби</h2>
      <input id="search-input" placeholder="Поиск по имени..." style="margin:16px 0;" />
      <div id="lobby-list" class="lobby-list"></div>
      <button class="secondary" id="back-btn" style="margin-top:16px;"><i class="fas fa-arrow-left"></i> Назад</button>
    </div>
  `;
  document.getElementById('back-btn').onclick = renderMainMenu;
  const listEl = document.getElementById('lobby-list');
  const input = document.getElementById('search-input');

  function loadLobbies() {
    socket.emit('getLobbies', (lobbies) => {
      const filter = input.value.toLowerCase();
      const filtered = lobbies.filter(l => l.name.toLowerCase().includes(filter));
      listEl.innerHTML = filtered.length ? filtered.map(l => `
        <div class="lobby-item" data-id="${l.id}">
          <div>
            <div class="name">${l.name}</div>
            <div class="meta">${l.players}/${l.maxPlayers} игроков ${l.hasChat ? '· 💬' : ''}</div>
          </div>
          <button class="primary" style="padding:8px 16px;">Войти</button>
        </div>
      `).join('') : '<p style="color:var(--text-muted);text-align:center;">Лобби не найдены</p>';

      listEl.querySelectorAll('.lobby-item').forEach(el => {
        el.onclick = () => {
          const lobbyId = el.dataset.id;
          socket.emit('joinLobby', { lobbyId, user: currentUser }, (res) => {
            if (res.error) return alert(res.error);
            currentLobby = res.lobby;
            renderLobby();
          });
        };
      });
    });
  }

  loadLobbies();
  input.oninput = loadLobbies;
  // Обновление в реальном времени
  socket.on('lobbiesUpdated', loadLobbies);
}

// ---------- Создание лобби ----------
function renderCreateLobby() {
  app.innerHTML = `
    <div class="card" style="max-width:500px;margin:0 auto;">
      <h2><i class="fas fa-plus"></i> Создать лобби</h2>
      <div style="margin-top:16px;">
        <label>Название лобби</label>
        <input id="lobby-name" placeholder="Уникальное имя" />
      </div>
      <div style="margin-top:12px;">
        <label>Макс. игроков (2-8)</label>
        <input id="lobby-max" type="number" min="2" max="8" value="4" />
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
        <input id="lobby-chat" type="checkbox" checked style="width:auto;" />
        <label for="lobby-chat" style="margin:0;">Включить чат</label>
      </div>
      <div style="margin-top:20px;display:flex;gap:12px;">
        <button class="primary" id="create-btn" style="flex:1;">Создать</button>
        <button class="secondary" id="cancel-btn" style="flex:1;">Отмена</button>
      </div>
    </div>
  `;
  document.getElementById('cancel-btn').onclick = renderMainMenu;
  document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('lobby-name').value.trim();
    const maxPlayers = parseInt(document.getElementById('lobby-max').value);
    const hasChat = document.getElementById('lobby-chat').checked;
    if (!name) return alert('Введите название');
    if (maxPlayers < 2 || maxPlayers > 8) return alert('От 2 до 8 игроков');
    socket.emit('createLobby', { name, maxPlayers, hasChat, user: currentUser }, (res) => {
      if (res.error) return alert(res.error);
      currentLobby = res.lobby;
      renderLobby();
    });
  };
}

// ---------- Экран лобби ----------
function renderLobby() {
  const isAdmin = currentLobby.adminId === currentUser.id;
  const adminClass = isAdmin ? 'admin' : '';

  app.innerHTML = `
    <div class="card lobby-screen ${adminClass}">
      <div class="lobby-header">
        <h2><i class="fas fa-users"></i> ${currentLobby.name}</h2>
        <span style="color:var(--text-muted);">${currentLobby.players.length}/${currentLobby.maxPlayers}</span>
      </div>
      <div class="lobby-body">
        <div class="players-panel">
          <div class="player-list" id="player-list">
            ${renderPlayerList()}
          </div>
        </div>
        ${currentLobby.hasChat ? `
        <div class="chat-panel">
          <h3 style="margin-bottom:12px;"><i class="fas fa-comments"></i> Чат</h3>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input">
            <input id="chat-input" placeholder="Сообщение..." />
            <button class="primary" id="chat-send"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>` : ''}
      </div>
      <div class="bottom-bar">
        <button class="secondary leave-btn" id="leave-btn"><i class="fas fa-sign-out-alt"></i> Выйти</button>
        ${isAdmin ? `<button class="primary start-btn" id="start-btn" disabled><i class="fas fa-play"></i> Начать</button>` : ''}
      </div>
    </div>
  `;

  document.getElementById('leave-btn').onclick = () => {
    socket.emit('leaveLobby', { lobbyId: currentLobby.id, user: currentUser }, (res) => {
      if (res.error) return alert(res.error);
      currentLobby = null;
      renderMainMenu();
    });
  };

  if (isAdmin) {
    const startBtn = document.getElementById('start-btn');
    startBtn.onclick = () => alert('Мини-игра пока не реализована');
  }

  // Клик по игрокам (только админ)
  if (isAdmin) {
    document.querySelectorAll('.player-item').forEach(el => {
      el.onclick = () => {
        const targetId = el.dataset.id;
        if (targetId === currentUser.id) return; // на себя не действуем
        openPlayerModal(targetId);
      };
    });
  }

  // Чат
  if (currentLobby.hasChat) {
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');

    function renderMessages() {
      chatMessages.innerHTML = currentLobby.chat.map(m => `
        <div class="chat-msg"><span class="author">${m.nickname}:</span>${m.text}</div>
      `).join('');
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    renderMessages();

    function sendMessage() {
      const text = chatInput.value.trim();
      if (!text) return;
      socket.emit('chatMessage', { lobbyId: currentLobby.id, user: currentUser, text }, (res) => {
        if (res.error) return alert(res.error);
        chatInput.value = '';
      });
    }
    chatSend.onclick = sendMessage;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

    socket.off('newMessage');
    socket.on('newMessage', (msg) => {
      currentLobby.chat.push(msg);
      if (currentLobby.chat.length > 30) currentLobby.chat.shift();
      renderMessages();
    });
  }

  // Обновление лобби
  socket.off('lobbyUpdated');
  socket.on('lobbyUpdated', (lobby) => {
    currentLobby = lobby;
    renderLobby();
  });
}

function renderPlayerList() {
  return currentLobby.players.map(p => `
    <div class="player-item" data-id="${p.id}">
      <div class="avatar">${renderAvatar(p)}</div>
      <div class="info">
        <div class="nick">${p.nickname} ${p.id === currentLobby.adminId ? '👑' : ''}</div>
        <div class="login">@${p.login}</div>
      </div>
      <div class="elo"><i class="fas fa-trophy"></i> ${p.elo}</div>
    </div>
  `).join('');
}

function renderAvatar(user) {
  if (user.avatarUrl) return `<img src="${user.avatarUrl}" alt="avatar" />`;
  return `<i class="shape-${user.avatar}" style="font-style:normal;"></i>`;
}

// ---------- Модалка игрока (для админа) ----------
function openPlayerModal(targetId) {
  const target = currentLobby.players.find(p => p.id === targetId);
  if (!target) return;

  // Закрываем предыдущую модалку, если есть
  if (currentModal) currentModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <button class="close-btn"><i class="fas fa-arrow-left"></i></button>
      <h3><i class="fas fa-user"></i> Информация</h3>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        <div class="avatar" style="width:64px;height:64px;font-size:28px;">${renderAvatar(target)}</div>
        <div>
          <div style="font-size:20px;font-weight:700;">${target.nickname}</div>
          <div style="color:var(--text-muted);">@${target.login}</div>
          <div style="color:var(--primary);font-weight:700;"><i class="fas fa-trophy"></i> ${target.elo}</div>
        </div>
      </div>
      <div class="actions">
        <button class="danger" data-action="kick"><i class="fas fa-user-minus"></i> Кик</button>
        <button class="danger" data-action="ban"><i class="fas fa-ban"></i> Бан</button>
        <button class="primary" data-action="admin"><i class="fas fa-crown"></i> Админ</button>
      </div>
    </div>
  `;

  overlay.querySelector('.close-btn').onclick = () => {
    overlay.remove();
    currentModal = null;
  };

  overlay.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      const labels = { kick: 'кикнуть', ban: 'забанить', admin: 'передать админку' };
      if (confirm(`Вы уверены, что хотите ${labels[action]} игрока ${target.nickname}?`)) {
        socket.emit('adminAction', {
          lobbyId: currentLobby.id,
          targetId: target.id,
          action: action === 'admin' ? 'transferAdmin' : action,
          adminId: currentUser.id
        }, (res) => {
          if (res.error) alert(res.error);
          overlay.remove();
          currentModal = null;
        });
      }
    };
  });

  document.body.appendChild(overlay);
  currentModal = overlay;
}

// ---------- Настройки ----------
function renderSettings() {
  app.innerHTML = `
    <div class="card" style="max-width:500px;margin:0 auto;">
      <h2><i class="fas fa-cog"></i> Настройки</h2>
      <div style="margin-top:16px;">
        <label>Никнейм</label>
        <input id="setting-nickname" value="${currentUser.nickname}" />
        <button class="primary" id="save-nickname" style="margin-top:8px;width:100%;">Сохранить</button>
      </div>
      <div style="margin-top:16px;">
        <label>Тема</label>
        <select id="setting-theme">
          <option value="dark">Тёмная</option>
          <option value="light">Светлая</option>
        </select>
      </div>
      <div style="margin-top:16px;">
        <label>Звук</label>
        <select id="setting-sound">
          <option value="on">Включён</option>
          <option value="off">Выключен</option>
        </select>
      </div>
      <button class="secondary" id="back-btn" style="margin-top:20px;width:100%;"><i class="fas fa-arrow-left"></i> Назад</button>
    </div>
  `;
  document.getElementById('back-btn').onclick = renderMainMenu;
  document.getElementById('save-nickname').onclick = () => {
    const newNick = document.getElementById('setting-nickname').value.trim();
    if (!newNick) return alert('Введите никнейм');
    // TODO: отправить на сервер обновление никнейма
    currentUser.nickname = newNick;
    alert('Никнейм обновлён (локально)');
  };
}

// ---------- Запуск ----------
init();