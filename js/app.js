/* Шиш-беш — экраны, сессии (локальная/хост/клиент) и игровой стол. */
(function () {
  const SH = window.SH;
  const E = SH.Engine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const SAVE_KEY = 'shishbesh-save-v2';
  const SET_KEY = 'shishbesh-settings-v1';
  const POS_NAMES = ['справа', 'сверху', 'слева', 'снизу'];
  const SEAT_ORDER = [3, 0, 1, 2];
  const KIND_NAMES = { human: 'Человек', bot: 'Бот', remote: 'Сеть' };

  // ---------- настройки ----------
  const Settings = Object.assign(
    { sound: true, speed: 1, autoSingle: true, name: '' },
    (() => {
      try {
        return JSON.parse(localStorage.getItem(SET_KEY)) || {};
      } catch (e) {
        return {};
      }
    })()
  );
  const saveSettings = () => {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(Settings));
    } catch (e) {}
  };
  SH.Sound.enabled = Settings.sound;

  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
  }

  function modal(html, buttons) {
    $('#modal-content').innerHTML = html;
    const box = $('#modal-buttons');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.text;
      el.onclick = () => {
        $('#modal').hidden = true;
        b.action && b.action();
      };
      box.appendChild(el);
    }
    $('#modal').hidden = false;
  }

  function playerLabel(p) {
    if (p.kind === 'bot') return 'Бот · ' + SH.AI.LEVELS[p.level];
    return KIND_NAMES[p.kind] || '';
  }

  // =====================================================================
  //  Игровой стол (общий для хоста, клиента и локальной игры)
  // =====================================================================
  class Table {
    constructor() {
      this.board = new SH.Board($('#board'));
      this.tray = new SH.DiceTray($('#tray'));
      this.queue = Promise.resolve();
      this.pending = 0;
      this.session = null;
      this.shown = null;
      this.lastTurnSeat = null;
      this.autoTimer = null;

      $('#btn-roll').onclick = () => this.rollClick();
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && $('#scr-game').classList.contains('active') && !$('#btn-roll').disabled) {
          e.preventDefault();
          this.rollClick();
        }
      });
      const sp = $('#speed');
      sp.value = Settings.speed;
      sp.oninput = () => {
        Settings.speed = +sp.value;
        this.board.speed = Settings.speed;
        saveSettings();
      };
      this.board.speed = Settings.speed;
      const sb = $('#btn-sound');
      const upd = () => (sb.textContent = Settings.sound ? '🔊' : '🔇');
      upd();
      sb.onclick = () => {
        Settings.sound = !Settings.sound;
        SH.Sound.enabled = Settings.sound;
        saveSettings();
        upd();
      };
      $('#btn-menu').onclick = () => this.menu();
    }

    attach(session, state, mySeats, bottomSeat) {
      this.gen = (this.gen || 0) + 1;
      this.session = session;
      this.mySeats = mySeats;
      this.queue = Promise.resolve();
      this.pending = 0;
      this.shown = state;
      this.lastTurnSeat = null;
      clearTimeout(this.autoTimer);
      $('#log').innerHTML = '';
      this.board.initPieces(state);
      this.board.setRotation(bottomSeat);
      this.board.gLast.innerHTML = '';
      this.tray.show(state.dice[0] ? state.dice : null, state.used);
      this.renderPanel();
      show('game');
      this.log(`Партия началась. Первым ходит <b>${esc(this.cur().name)}</b>.`);
      this.idle();
    }

    cur() {
      return this.shown.players[this.shown.cur];
    }

    enqueue(ev) {
      const gen = this.gen;
      this.pending++;
      this.setRollEnabled(false);
      this.board.clearInteraction();
      this.queue = this.queue
        .then(() => gen === this.gen && this.play(ev))
        .catch((e) => console.error(e))
        .then(() => {
          if (gen !== this.gen) return;
          if (--this.pending === 0) this.idle();
        });
    }

    name(seat) {
      const p = E.playerBySeat(this.shown, seat);
      return `<span class="nm" style="--c:${E.SEATS[seat].color}">${esc(p ? p.name : E.SEATS[seat].name)}</span>`;
    }

    async play(ev) {
      const gen = this.gen;
      if (ev.type === 'roll') {
        this.setStatus(`${this.name(ev.seat)} бросает кости…`);
        await this.tray.roll(ev.dice, Settings.speed);
        if (gen !== this.gen) return;
        const dbl = ev.dice[0] === ev.dice[1] ? ' — <b>дубль!</b>' : '';
        this.log(`${this.name(ev.seat)} выбросил <b>${ev.dice[0]}:${ev.dice[1]}</b>${dbl}`);
        this.shown = ev.state;
        if (ev.noMoves) {
          SH.Sound.nomove();
          this.log(`Ходов нет.`, 'muted');
          this.tray.show(null, [true, true]);
          this.renderPanel();
          await sleep(800 / Settings.speed);
        }
      } else if (ev.type === 'move') {
        const prev = this.shown;
        this.shown = ev.state;
        this.board.setCurrentSeat(null);
        const txt = this.describeMove(ev, prev);
        await this.board.animateMove(ev, ev.state);
        if (gen !== this.gen) return;
        this.log(txt);
        this.tray.show(null, ev.state.phase === 'move' ? ev.state.used : [true, true]);
        if (ev.forfeit) this.log('Второй кубик сгорает — ходить нечем.', 'muted');
      } else if (ev.type === 'info') {
        this.log(esc(ev.text), 'muted');
        if (ev.state) this.shown = ev.state;
      } else if (ev.type === 'sync') {
        this.shown = ev.state;
        this.board.render(ev.state, false);
      }
      if (ev.turnEnd && ev.turnEnd.again && !ev.win) {
        const why = { double: 'Дубль', capture: 'За срубленную фишку', both: 'Дубль и рубка' }[ev.turnEnd.reason] || 'Ещё бросок';
        this.log(`${why} — ${this.name(ev.turnEnd.next)} бросает ещё раз.`, 'muted');
      }
      this.renderPanel();
      if (ev.win) {
        SH.Sound.win();
        this.setStatus(`Победа: ${this.name(ev.seat)}!`);
        this.log(`🏆 ${this.name(ev.seat)} завёл все фишки в домик и победил!`, 'win');
        await sleep(600);
        this.showWinner(ev.seat);
      }
    }

    describeMove(ev, prev) {
      const who = this.name(ev.seat);
      let t;
      if (ev.kind === 'enter') t = `${who} выводит фишку на старт`;
      else if (ev.kind === 'jump') t = `${who} прыгает с угла по ${ev.value === 1 ? 'прямой' : 'диагонали'} (${ev.value})`;
      else if (ev.to >= E.HOME_START && ev.from < E.HOME_START) t = `${who} заводит фишку в домик (${ev.value})`;
      else t = `${who} ходит на ${ev.value}`;
      if (ev.house) t += ' и занимает домик';
      if (ev.captured.length) t += ' и рубит ' + ev.captured.map((c) => this.name(c.seat)).join(', ') + '!';
      void prev;
      return t;
    }

    idle() {
      const s = this.shown;
      if (!s) return;
      if (this.session && this.session.onIdle) this.session.onIdle();
      this.updateInteraction();
    }

    isMine(seat) {
      return this.mySeats.includes(seat) && !(this.session.isBotSeat && this.session.isBotSeat(seat));
    }

    updateInteraction() {
      const s = this.shown;
      clearTimeout(this.autoTimer);
      if (!s || s.phase === 'over' || this.pending) return;
      const p = this.cur();
      this.renderPanel();
      if (!this.isMine(p.seat)) {
        this.setRollEnabled(false);
        this.board.clearInteraction();
        const how = p.kind === 'bot' ? 'думает' : 'ходит';
        this.setStatus(`${this.name(p.seat)} ${s.phase === 'roll' ? 'бросает' : how}…`);
        this.lastTurnSeat = p.seat;
        return;
      }
      if (this.lastTurnSeat !== p.seat && (this.mySeats.length === 1 || this.mySeats.length < s.players.length)) SH.Sound.turn();
      this.lastTurnSeat = p.seat;
      if (s.phase === 'roll') {
        this.board.clearInteraction();
        this.setRollEnabled(true);
        this.setStatus(`Ход: ${this.name(p.seat)} — бросайте кости`);
      } else {
        this.setRollEnabled(false);
        const moves = E.legalMoves(s);
        this.board.setCurrentSeat(p.seat);
        const free = s.dice.filter((d, i) => !s.used[i]).join(' и ');
        this.setStatus(`${this.name(p.seat)}: ходите (${free})`);
        this.board.setInteraction(moves, (m) => this.session.act(p.seat, { type: 'move', move: { piece: m.piece, die: m.die, to: m.to } }));
        const distinct = new Set(moves.map((m) => m.piece + ':' + m.to));
        if (Settings.autoSingle && distinct.size === 1) {
          this.autoTimer = setTimeout(() => {
            if (this.shown === s && !this.pending) {
              this.board.clearInteraction();
              const m = moves[0];
              this.session.act(p.seat, { type: 'move', move: { piece: m.piece, die: m.die, to: m.to } });
            }
          }, 500 / Settings.speed);
        }
      }
    }

    rollClick() {
      const s = this.shown;
      if (!s || s.phase !== 'roll') return;
      SH.Sound.unlock();
      this.setRollEnabled(false);
      this.session.act(this.cur().seat, { type: 'roll' });
    }

    setRollEnabled(on) {
      const b = $('#btn-roll');
      b.disabled = !on;
      b.classList.toggle('pulse', on);
    }

    setStatus(html) {
      $('#status').innerHTML = html;
    }

    log(html, cls = '') {
      const li = document.createElement('li');
      li.innerHTML = html;
      if (cls) li.className = cls;
      const ol = $('#log');
      ol.prepend(li);
      while (ol.children.length > 80) ol.lastChild.remove();
    }

    renderPanel() {
      const s = this.shown;
      const ul = $('#players');
      ul.innerHTML = '';
      const n = s.players.length;
      for (let i = 0; i < n; i++) {
        const p = s.players[i];
        const home = p.pieces.filter((x) => x >= E.HOME_START).length;
        const park = p.pieces.filter((x) => x < 0).length;
        const li = document.createElement('li');
        li.className = 'player' + (i === s.cur && s.phase !== 'over' ? ' active' : '') + (s.winner === p.seat ? ' winner' : '');
        const off = this.session && this.session.isOffline && this.session.isOffline(p.seat);
        const me = this.mySeats && this.mySeats.includes(p.seat) && this.mySeats.length < n ? ' <span class="you">вы</span>' : '';
        li.innerHTML = `<span class="chip" style="--c:${E.SEATS[p.seat].color};--d:${E.SEATS[p.seat].dark}"></span>
          <span class="pinfo"><span class="pname">${esc(p.name)}${me}</span><span class="pkind">${playerLabel(p)}${off ? ' · <b class="off">нет связи (играет бот)</b>' : ''}</span></span>
          <span class="pstat" title="В домике / в парке"><span class="h">🏠 ${home}</span><span class="k">⬤ ${park}</span></span>`;
        ul.appendChild(li);
      }
    }

    showWinner(seat) {
      const p = E.playerBySeat(this.shown, seat);
      const btns = [{ text: 'В меню', action: () => this.leave() }];
      if (this.session.restart) btns.push({ text: 'Сыграть ещё', primary: true, action: () => this.session.restart() });
      modal(
        `<div class="win-box"><div class="win-chip" style="--c:${E.SEATS[seat].color};--d:${E.SEATS[seat].dark}"></div>
         <h2>Победа!</h2><p><b>${esc(p.name)}</b> первым завёл все четыре фишки в домик.</p></div>`,
        btns
      );
    }

    menu() {
      const btns = [
        { text: 'Продолжить', primary: true },
        { text: 'Правила', action: () => showRules(() => this.menu()) },
        { text: 'Выйти в меню', action: () => this.leave() },
      ];
      modal('<h2>Пауза</h2><p>Локальная партия сохраняется автоматически.</p>', btns);
    }

    leave() {
      if (this.session && this.session.close) this.session.close();
      this.gen = (this.gen || 0) + 1;
      this.pending = 0;
      this.session = null;
      this.shown = null;
      clearTimeout(this.autoTimer);
      this.board.clearInteraction();
      refreshMenu();
      show('menu');
    }
  }

  let table = null;
  const getTable = () => (table = table || new Table());

  // =====================================================================
  //  Хост (локальная игра — тот же хост без сети)
  // =====================================================================
  class HostSession {
    constructor(seats, net, savedState) {
      this.seats = seats;
      this.net = net; // {peer, code, slots: Map(seat -> {conn,name,connected})} | null
      this.state = savedState || E.newGame(seats);
      this.botTimer = null;
      this.closed = false;
      if (net) {
        net.session = this;
        for (const pl of this.state.players) {
          const sl = net.slots.get(pl.seat);
          if (sl && sl.name) pl.name = sl.name;
        }
      }
      this.mySeats = this.state.players.filter((p) => p.kind === 'human').map((p) => p.seat);
      const bottom = this.mySeats.length ? this.mySeats[0] : 3;
      if (net) this.broadcastStart();
      getTable().attach(this, this.state, this.mySeats, bottom);
      if (!net) this.save();
    }

    isOffline(seat) {
      if (!this.net) return false;
      const p = E.playerBySeat(this.state, seat);
      if (!p || p.kind !== 'remote') return false;
      const sl = this.net.slots.get(seat);
      return !sl || !sl.connected;
    }

    isBotSeat(seat) {
      const p = E.playerBySeat(this.state, seat);
      return p.kind === 'bot' || this.isOffline(seat);
    }

    broadcastStart() {
      this.net.slots.forEach((sl, seat) => {
        if (sl.conn && sl.connected) sl.conn.send({ t: 'start', state: this.state, seat });
      });
    }

    act(seat, action) {
      if (this.closed) return;
      const s = this.state;
      if (s.phase === 'over' || s.players[s.cur].seat !== seat) return;
      let res = null;
      if (action.type === 'roll') res = E.applyRoll(s, E.rollDice());
      else if (action.type === 'move' && action.move) res = E.applyMove(s, action.move);
      if (!res) return;
      this.state = res.state;
      this.emit(res.event);
    }

    emit(ev) {
      ev.state = this.state;
      if (this.net) this.broadcast({ t: 'ev', ev });
      getTable().enqueue(ev);
      this.save();
    }

    broadcast(msg) {
      this.net.slots.forEach((sl) => {
        if (sl.conn && sl.connected) {
          try {
            sl.conn.send(msg);
          } catch (e) {}
        }
      });
    }

    save() {
      if (this.net) return;
      try {
        if (this.state.phase === 'over') localStorage.removeItem(SAVE_KEY);
        else localStorage.setItem(SAVE_KEY, JSON.stringify({ seats: this.seats, state: this.state }));
      } catch (e) {}
    }

    onIdle() {
      clearTimeout(this.botTimer);
      const s = this.state;
      if (this.closed || s.phase === 'over') return;
      const p = s.players[s.cur];
      if (!this.isBotSeat(p.seat)) return;
      const level = p.kind === 'bot' ? p.level : 2;
      const delay = (s.phase === 'roll' ? 550 : 450) / Settings.speed;
      this.botTimer = setTimeout(() => {
        if (this.state !== s) return;
        if (s.phase === 'roll') this.act(p.seat, { type: 'roll' });
        else {
          const m = SH.AI.chooseMove(s, level);
          if (m) this.act(p.seat, { type: 'move', move: { piece: m.piece, die: m.die, to: m.to } });
        }
      }, delay);
    }

    // сетевые события во время игры
    remoteAction(seat, action) {
      const p = E.playerBySeat(this.state, seat);
      if (!p || p.kind !== 'remote') return;
      this.act(seat, action);
    }

    remoteStatus(seat, connected) {
      const p = E.playerBySeat(this.state, seat);
      if (!p) return;
      this.emit({ type: 'info', text: `${p.name}: ${connected ? 'снова в игре' : 'потерял связь — за него играет бот'}` });
    }

    restart() {
      const seats = this.state.players.map((p) => ({ seat: p.seat, name: p.name, kind: p.kind, level: p.level }));
      this.closed = true;
      clearTimeout(this.botTimer);
      const next = new HostSession(seats, this.net, null);
      void next;
    }

    close() {
      this.closed = true;
      clearTimeout(this.botTimer);
      if (this.net) {
        this.broadcast({ t: 'closed' });
        setTimeout(() => this.net.peer.destroy(), 300);
        hostNet = null;
      }
    }
  }

  // =====================================================================
  //  Клиент
  // =====================================================================
  class ClientSession {
    constructor(link, seat, state) {
      this.link = link;
      this.seat = seat;
      this.state = state;
      this.mySeats = [seat];
      getTable().attach(this, state, [seat], seat);
    }
    act(seat, action) {
      if (seat !== this.seat) return;
      try {
        this.link.conn.send({ t: 'act', action });
      } catch (e) {}
    }
    isOffline() {
      return false;
    }
    close() {
      this.closedByUser = true;
      try {
        this.link.peer.destroy();
      } catch (e) {}
      clientLink = null;
    }
  }

  // =====================================================================
  //  Меню / настройка
  // =====================================================================
  function refreshMenu() {
    let has = false;
    try {
      has = !!localStorage.getItem(SAVE_KEY);
    } catch (e) {}
    $('#btn-continue').hidden = !has;
  }

  function showRules(back) {
    modal($('#rules-tpl').innerHTML, [{ text: 'Понятно', primary: true, action: back }]);
  }

  const setup = {
    seats: {},
    init() {
      const saved = Settings.lastSetup;
      for (const s of SEAT_ORDER) this.seats[s] = { kind: 'off', name: '', level: 2 };
      if (saved) Object.assign(this.seats, saved);
      else this.applyCount(4);
      $$('#count-seg button').forEach((b) => (b.onclick = () => this.applyCount(+b.dataset.n)));
      $('#opt-auto').checked = Settings.autoSingle;
      $('#opt-auto').onchange = (e) => {
        Settings.autoSingle = e.target.checked;
        saveSettings();
      };
      this.render();
    },
    applyCount(n) {
      const active = { 2: [3, 1], 3: [3, 0, 1], 4: [3, 0, 1, 2] }[n];
      const firstHuman = SEAT_ORDER.find((s) => this.seats[s].kind === 'human') ?? 3;
      for (const s of SEAT_ORDER) {
        const on = active.includes(s);
        const cur = this.seats[s];
        if (!on) cur.kind = 'off';
        else if (cur.kind === 'off') cur.kind = s === firstHuman ? 'human' : 'bot';
      }
      if (!active.some((s) => this.seats[s].kind === 'human' || this.seats[s].kind === 'remote')) this.seats[active[0]].kind = 'human';
      this.render();
    },
    render() {
      const box = $('#seat-rows');
      box.innerHTML = '';
      let count = 0;
      for (const s of SEAT_ORDER) {
        const st = this.seats[s];
        if (st.kind !== 'off') count++;
        const row = document.createElement('div');
        row.className = 'seat-row' + (st.kind === 'off' ? ' off' : '');
        row.innerHTML = `
          <span class="chip" style="--c:${E.SEATS[s].color};--d:${E.SEATS[s].dark}"></span>
          <span class="seat-name">${E.SEATS[s].name}<small>${POS_NAMES[s]}</small></span>
          <select class="kind">
            <option value="off">— нет —</option><option value="human">Человек</option>
            <option value="bot">Бот</option><option value="remote">Сеть</option>
          </select>
          <select class="level" ${st.kind === 'bot' ? '' : 'hidden'}>
            <option value="1">Лёгкий</option><option value="2">Средний</option><option value="3">Сложный</option>
          </select>
          <input class="pname" maxlength="16" placeholder="${st.kind === 'remote' ? 'имя задаст игрок' : E.SEATS[s].name}" ${st.kind === 'human' ? '' : 'hidden'}>`;
        const kind = $('.kind', row);
        kind.value = st.kind;
        kind.onchange = () => {
          st.kind = kind.value;
          this.render();
        };
        const lvl = $('.level', row);
        lvl.value = st.level;
        lvl.onchange = () => (st.level = +lvl.value);
        const nm = $('.pname', row);
        nm.value = st.name;
        nm.oninput = () => (st.name = nm.value.trim());
        box.appendChild(row);
      }
      $$('#count-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === count));
      $('#setup-err').textContent = '';
    },
    collect() {
      const seats = [];
      for (const s of SEAT_ORDER) {
        const st = this.seats[s];
        if (st.kind === 'off') continue;
        const name = st.kind === 'bot' ? `${E.SEATS[s].name} бот` : st.name || E.SEATS[s].name;
        seats.push({ seat: s, name, kind: st.kind, level: st.level });
      }
      return seats;
    },
    start() {
      const seats = this.collect();
      const err = $('#setup-err');
      if (seats.length < 2) return (err.textContent = 'Нужно минимум два игрока.');
      Settings.lastSetup = JSON.parse(JSON.stringify(this.seats));
      saveSettings();
      SH.Sound.unlock();
      if (seats.some((s) => s.kind === 'remote')) {
        if (!SH.Net.available()) return (err.textContent = 'Сетевая игра недоступна: не загрузилась библиотека PeerJS (нужен интернет).');
        openLobby(seats);
      } else {
        try {
          localStorage.removeItem(SAVE_KEY);
        } catch (e) {}
        new HostSession(seats, null, null);
      }
    },
  };

  // =====================================================================
  //  Лобби хоста
  // =====================================================================
  let hostNet = null;

  function openLobby(seats) {
    show('lobby');
    $('#lobby-code').textContent = '·····';
    $('#lobby-status').textContent = 'Создаём комнату…';
    $('#btn-lobby-start').disabled = true;
    const net = { peer: null, code: null, seats, slots: new Map(), session: null };
    hostNet = net;
    for (const s of seats) if (s.kind === 'remote') net.slots.set(s.seat, { conn: null, name: '', connected: false });
    renderLobby();

    const drop = (conn) => {
      if (hostNet !== net || conn._seat == null) return;
      const sl = net.slots.get(conn._seat);
      if (!sl || sl.conn !== conn || !sl.connected) return;
      sl.connected = false;
      try {
        conn.close();
      } catch (e) {}
      if (net.session) net.session.remoteStatus(conn._seat, false);
      else {
        sl.conn = null;
        sl.name = '';
        renderLobby();
      }
    };
    // heartbeat: закрытие вкладки клиента PeerJS замечает не всегда
    net.heartbeat = setInterval(() => {
      if (hostNet !== net) return clearInterval(net.heartbeat);
      const now = Date.now();
      net.slots.forEach((sl) => {
        if (!sl.connected) return;
        if (now - sl.lastSeen > 9000) drop(sl.conn);
        else
          try {
            sl.conn.send({ t: 'ping' });
          } catch (e) {}
      });
    }, 2000);

    SH.Net.host({
      onConnect() {},
      onData(conn, msg) {
        if (hostNet !== net || !msg || typeof msg !== 'object') return;
        const sl = conn._seat != null && net.slots.get(conn._seat);
        if (sl && sl.conn === conn) sl.lastSeen = Date.now();
        if (msg.t === 'hello') hostHello(net, conn, msg);
        else if (msg.t === 'bye') drop(conn);
        else if (msg.t === 'act' && net.session && conn._seat != null) net.session.remoteAction(conn._seat, msg.action);
      },
      onClose: drop,
      onError(err) {
        console.warn(err);
      },
    })
      .then(({ peer, code }) => {
        if (hostNet !== net) return peer.destroy();
        net.peer = peer;
        net.code = code;
        $('#lobby-code').textContent = code;
        renderLobby();
      })
      .catch((err) => {
        $('#lobby-status').textContent = 'Не удалось создать комнату: ' + (err.message || err.type || err);
      });
  }

  function hostHello(net, conn, msg) {
    const name = String(msg.name || 'Игрок').slice(0, 16);
    let seat = null;
    // переподключение: сначала место с тем же именем, затем любое свободное
    for (const [s, sl] of net.slots) if (!sl.connected && sl.name === name) seat = s;
    if (seat == null) for (const [s, sl] of net.slots) if (!sl.connected && (!sl.name || net.session)) {
      seat = s;
      break;
    }
    if (seat == null) {
      conn.send({ t: 'full' });
      setTimeout(() => conn.close(), 500);
      return;
    }
    const sl = net.slots.get(seat);
    sl.conn = conn;
    sl.connected = true;
    sl.lastSeen = Date.now();
    if (!net.session) sl.name = name;
    conn._seat = seat;
    conn.send({ t: 'welcome', seat });
    if (net.session) {
      conn.send({ t: 'start', state: net.session.state, seat });
      net.session.remoteStatus(seat, true);
    } else renderLobby();
  }

  function lobbySeatList(seats, slots) {
    return seats
      .map((s) => {
        const sl = slots && slots.get ? slots.get(s.seat) : slots && slots[s.seat];
        let who;
        if (s.kind === 'remote') who = sl && (sl.connected || sl.filled) ? `<b>${esc(sl.name)}</b> · подключён` : '<i>ожидаем игрока…</i>';
        else if (s.kind === 'bot') who = `${esc(s.name)} · бот (${SH.AI.LEVELS[s.level]})`;
        else who = `${esc(s.name)} · за экраном хоста`;
        return `<li><span class="chip" style="--c:${E.SEATS[s.seat].color};--d:${E.SEATS[s.seat].dark}"></span>${who}</li>`;
      })
      .join('');
  }

  function renderLobby() {
    const net = hostNet;
    if (!net) return;
    $('#lobby-seats').innerHTML = lobbySeatList(net.seats, net.slots);
    const waiting = [...net.slots.values()].filter((s) => !s.connected).length;
    $('#btn-lobby-start').disabled = !net.code || waiting > 0;
    if (net.code) $('#lobby-status').textContent = waiting ? `Ждём игроков: ${waiting}` : 'Все на месте — можно начинать!';
    const lobbyMsg = {
      t: 'lobby',
      seats: net.seats.map((s) => {
        const sl = net.slots.get(s.seat);
        return { seat: s.seat, name: sl ? sl.name : s.name, kind: s.kind, level: s.level, filled: sl ? sl.connected : true };
      }),
    };
    net.slots.forEach((sl) => sl.connected && sl.conn.send(lobbyMsg));
  }

  function lobbyStart(fillBots) {
    const net = hostNet;
    if (!net || !net.code) return;
    if (fillBots) {
      net.seats = net.seats.map((s) => {
        const sl = net.slots.get(s.seat);
        if (s.kind === 'remote' && !(sl && sl.connected)) {
          net.slots.delete(s.seat);
          return { seat: s.seat, name: `${E.SEATS[s.seat].name} бот`, kind: 'bot', level: 2 };
        }
        return s;
      });
    }
    const seats = net.seats.map((s) => {
      const sl = net.slots.get(s.seat);
      return sl ? { ...s, name: sl.name } : s;
    });
    new HostSession(seats, net, null);
  }

  // =====================================================================
  //  Присоединение (клиент)
  // =====================================================================
  let clientLink = null;

  function doJoin() {
    const name = $('#join-name').value.trim() || 'Гость';
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 5) return ($('#join-status').textContent = 'Введите код из 5 символов.');
    Settings.name = name;
    Settings.lastCode = code;
    saveSettings();
    SH.Sound.unlock();
    $('#join-status').textContent = 'Подключаемся…';
    $('#btn-join-go').disabled = true;
    let session = null;
    let link = null;
    let lastSeen = Date.now();
    let dead = false;
    let watchdog = null;
    const lost = () => {
      if (dead) return;
      dead = true;
      clearInterval(watchdog);
      try {
        link && link.peer.destroy();
      } catch (e) {}
      if (clientLink === link) clientLink = null;
      if (session && !session.closedByUser) {
        modal('<h2>Связь с хостом потеряна</h2><p>Можно переподключиться — место за вами сохранится (пока за вас ходит бот).</p>', [
          { text: 'В меню', action: () => getTable().leave() },
          {
            text: 'Переподключиться',
            primary: true,
            action: () => {
              getTable().leave();
              show('join');
              doJoin();
            },
          },
        ]);
      } else if (!session) $('#join-status').textContent = 'Соединение закрыто.';
    };
    SH.Net.join(code, {
      onData(msg) {
        if (dead || !msg || typeof msg !== 'object') return;
        lastSeen = Date.now();
        if (msg.t === 'ping') {
          try {
            link.conn.send({ t: 'pong' });
          } catch (e) {}
        } else if (msg.t === 'welcome') $('#join-status').textContent = `Вы в комнате — цвет: ${E.SEATS[msg.seat].name}. Ждём начала игры…`;
        else if (msg.t === 'full') $('#join-status').textContent = 'Свободных мест нет.';
        else if (msg.t === 'lobby') $('#join-seats').innerHTML = lobbySeatList(msg.seats, Object.fromEntries(msg.seats.map((s) => [s.seat, s])));
        else if (msg.t === 'start') {
          $('#modal').hidden = true;
          session = new ClientSession(link, msg.seat, msg.state);
        } else if (msg.t === 'ev' && session) getTable().enqueue(msg.ev);
        else if (msg.t === 'closed') {
          dead = true;
          clearInterval(watchdog);
          if (session) modal('<h2>Хост завершил игру</h2>', [{ text: 'В меню', action: () => getTable().leave() }]);
          else $('#join-status').textContent = 'Хост закрыл комнату.';
        }
      },
      onClose: lost,
    })
      .then((l) => {
        link = l;
        clientLink = l;
        lastSeen = Date.now();
        l.conn.send({ t: 'hello', name });
        $('#btn-join-go').disabled = false;
        watchdog = setInterval(() => {
          if (session && session.closedByUser) return clearInterval(watchdog);
          if (Date.now() - lastSeen > 10000) lost();
        }, 2000);
      })
      .catch((err) => {
        $('#btn-join-go').disabled = false;
        $('#join-status').textContent = err.message || String(err);
      });
  }

  // =====================================================================
  //  Инициализация
  // =====================================================================
  function init() {
    refreshMenu();
    setup.init();
    $('#btn-new').onclick = () => {
      setup.render();
      show('setup');
    };
    $('#btn-continue').onclick = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (saved && saved.state) {
          SH.Sound.unlock();
          new HostSession(saved.seats, null, saved.state);
        }
      } catch (e) {
        localStorage.removeItem(SAVE_KEY);
        refreshMenu();
      }
    };
    $('#btn-join').onclick = () => {
      $('#join-name').value = Settings.name || '';
      $('#join-code').value = Settings.lastCode || '';
      $('#join-status').textContent = '';
      $('#join-seats').innerHTML = '';
      show('join');
    };
    $('#btn-rules').onclick = () => showRules();
    $$('[data-go]').forEach((b) => (b.onclick = () => show(b.dataset.go)));
    $('#btn-start').onclick = () => setup.start();
    $('#btn-lobby-back').onclick = () => {
      if (hostNet && hostNet.peer) hostNet.peer.destroy();
      hostNet = null;
      show('setup');
    };
    $('#btn-lobby-start').onclick = () => lobbyStart(false);
    $('#btn-lobby-bots').onclick = () => lobbyStart(true);
    $('#btn-copy').onclick = () => {
      if (hostNet && hostNet.code && navigator.clipboard) navigator.clipboard.writeText(hostNet.code).catch(() => {});
    };
    $('#btn-join-go').onclick = doJoin;
    $('#btn-join-back').onclick = () => {
      if (clientLink) clientLink.peer.destroy();
      clientLink = null;
      show('menu');
    };
    $('#join-code').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase()));
    window.addEventListener('beforeunload', () => {
      if (hostNet && hostNet.peer) {
        if (hostNet.session) hostNet.session.broadcast({ t: 'closed' });
        hostNet.peer.destroy();
      }
      if (clientLink) {
        try {
          clientLink.conn.send({ t: 'bye' });
        } catch (e) {}
        clientLink.peer.destroy();
      }
    });
  }

  init();
  SH.App = { Settings, getTable };
})();
