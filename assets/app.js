/* r_d Вхідний квіз — універсальний шаблон.
   Дані: Google Sheets (вкладки settings, skills, questions, resources, courses) → CSV → сторінка.
   Резервна копія: data/*.csv у репозиторії.
   За замовчуванням — для зарахованих студентів перед стартом курсу.
   Режими посилання: ?mode=landing — варіант для лендингу / менеджерів з продажу; ?embed=1 — без шапки (для iframe). */
(function () {
  "use strict";

  var CFG = window.QUIZ_CONFIG || {};
  var DEFAULTS = CFG.defaults || {};
  var KINDS = ["settings", "skills", "questions", "resources", "courses", "base"];
  var OPTIONAL = { base: true }; // загальна база ресурсів r_d — необов'язкова вкладка
  var params = new URLSearchParams(location.search);
  // За замовчуванням — для зарахованих студентів (перед стартом). ?mode=landing — варіант для лендингу / продажу
  var MODE = params.get("mode") === "landing" ? "landing" : "enrolled";

  var S = {}, SKILLS = [], QUESTIONS = [], RESOURCES = [], COURSES = [], BASE = [];
  var state = { i: 0, answers: {} };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Джерела даних ---------- */

  function sheetCsvUrl(sheetId, tab) {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(sheetId) +
      "/gviz/tq?tqx=out:csv&headers=1&sheet=" + encodeURIComponent(tab);
  }
  function liveUrl(kind) {
    var direct = (CFG.csvUrls || {})[kind];
    if (direct) return direct;
    return CFG.sheetId ? sheetCsvUrl(CFG.sheetId, (CFG.tabs || {})[kind] || kind) : "";
  }
  function fetchCsv(url) {
    if (!url) return Promise.reject(new Error("URL не задано"));
    // Google-таблиця — без cookies; власні файли (data/*.csv) — як і сама сторінка
    var external = /^https?:/i.test(url) && url.indexOf(location.origin) !== 0;
    return fetch(url, { cache: "no-store", credentials: external ? "omit" : "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (text) {
      if (/^\s*</.test(text)) throw new Error("Отримано HTML замість CSV — перевірте доступ до таблиці");
      return parseCsv(text);
    });
  }
  function load(kind) {
    // Дані, вбудовані прямо в сторінку (для демо без сервера)
    var inline = (CFG.inline || {})[kind];
    if (inline) return Promise.resolve({ rows: parseCsv(inline), snap: false });
    var live = liveUrl(kind);
    var snap = (CFG.snapshot || {})[kind] || ("data/" + kind + ".csv");
    var fromSnap = function () { return fetchCsv(snap).then(function (rows) { return { rows: rows, snap: true }; }); };
    if (CFG.source === "snapshot" || !live) {
      return fromSnap().catch(function (err) { if (OPTIONAL[kind]) return { rows: [], snap: false }; throw err; });
    }
    return fetchCsv(live).then(function (rows) { return { rows: rows, snap: false }; }, function (err) {
      console.warn("[quiz] " + kind + ": " + err.message + " — беремо копію з репозиторію");
      return fromSnap();
    }).catch(function (err) {
      if (OPTIONAL[kind]) return { rows: [], snap: false };
      throw err;
    });
  }

  /* ---------- CSV ---------- */

  function parseCsv(text) {
    var rows = [], row = [], field = "", q = false, i = 0, c;
    text = text.replace(/^﻿/, "");
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Назви колонок можна писати англійською або українською
  var ALIASES = {
    "ключ": "key", "значення": "value",
    "ід": "id", "навичка": "skill", "тема": "skill", "тип": "type", "питання": "question", "код": "code",
    "варіанти": "options", "пояснення": "explanation", "порядок": "order", "показувати": "active",
    "назва": "name", "опис": "description", "критична": "critical",
    "заголовок": "title", "посилання": "url", "джерело": "source", "формат": "format", "час": "time", "мова": "lang",
    "навички": "skills", "етап": "stage", "теги": "tags",
  };
  function toObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { var k = String(h).trim().toLowerCase(); return ALIASES[k] || k; });
    return rows.slice(1).filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ""; });
    }).map(function (r, idx) {
      var o = { _row: idx };
      head.forEach(function (h, j) { o[h] = r[j] == null ? "" : String(r[j]).trim(); });
      return o;
    });
  }
  function isActive(o) { return !/^(false|ні|0|no)$/i.test(o.active || ""); }
  function isTrue(v) { return /^(true|так|1|yes)$/i.test(v || ""); }
  function byOrder(a, b) {
    var x = parseFloat(a.order), y = parseFloat(b.order);
    if (isNaN(x)) x = 1e6 + a._row; if (isNaN(y)) y = 1e6 + b._row;
    return x - y;
  }

  /* ---------- Налаштування ---------- */

  function readSettings(rows) {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    toObjects(rows).forEach(function (r) {
      var k = String(r.key || "").toLowerCase(), v = String(r.value || "");
      if (k && v) s[k] = v;
    });
    return s;
  }
  // Текст з урахуванням режиму: у ?mode=landing спершу key_landing, потім key
  function t(key) {
    if (MODE === "landing" && S[key + "_landing"]) return S[key + "_landing"];
    return S[key] || "";
  }
  function isHex(v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v || ""); }
  function inkFor(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    var rgb = [0, 2, 4].map(function (i) {
      var c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return (L + 0.05) / 0.0594 >= 1.05 / (L + 0.05) ? "#181919" : "#FFFFFF";
  }
  function safeUrl(u) { u = String(u || "").trim(); return /^(https?:|mailto:|tel:)/i.test(u) ? u : ""; }
  function md(text) {
    var html = window.marked ? window.marked.parseInline(String(text || ""), { breaks: true }) : miniMd(text);
    if (window.DOMPurify) return window.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
    return window.marked ? esc(text) : html; // miniMd уже екранує все сам
  }
  // Запасний варіант, якщо бібліотека Markdown не завантажилася: посилання, жирний, код
  function miniMd(text) {
    return esc(text)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
        var u = safeUrl(url.replace(/&amp;/g, "&"));
        return u ? '<a href="' + esc(u) + '">' + label + "</a>" : label;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function link(href, cls, label) {
    var a = el("a", { class: cls, href: href, target: "_blank", rel: "noopener" });
    a.textContent = label;
    return a;
  }

  function applySettings() {
    var root = document.documentElement;
    if (isHex(S.accent)) {
      root.style.setProperty("--accent", S.accent);
      root.style.setProperty("--accent-ink", inkFor(S.accent));
    }
    document.title = (S.intro_title || "Квіз") + " — " + (S.course_name || "robot_dreams");
    $("subbrand").textContent = t("subbrand");
    var site = safeUrl(S.site_url);
    // Логотип — на сайт robot_dreams, кнопка «Сторінка курсу ↗» — на лендинг курсу (обидва в новій вкладці,
    // щоб квіз лишався відкритим). Якщо course_url порожній — кнопка веде на сайт r_d
    var courseUrl = safeUrl(S.course_url);
    [["brand", site], ["siteLink", courseUrl || site]].forEach(function (pair) {
      var a = $(pair[0]);
      if (pair[1]) { a.href = pair[1]; a.target = "_blank"; a.rel = "noopener"; }
    });
    $("siteLink").textContent = courseUrl ? (t("header_link_label") || "Сторінка курсу") + " ↗" : S.site_label;
    $("brand").setAttribute("aria-label", "robot_dreams");

    var tags = $("heroTags"); tags.innerHTML = "";
    String(S.tags || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
      var p = el("span", { class: "pill pill--paper pill--sm" }); p.textContent = x; tags.appendChild(p);
    });
    $("courseName").textContent = S.course_name;
    $("introTitle").textContent = t("intro_title");
    $("introText").innerHTML = md(t("intro_text"));
    $("introMeta").textContent = t("intro_meta");
    $("introJoke").textContent = t("intro_joke");
    $("introJoke").hidden = !t("intro_joke");
    $("loadingText").textContent = t("loading_text") || "Збираємо вашу рекомендацію…";
    $("nextTitle").textContent = t("next_title") || "Що далі?";
    $("startBtn").textContent = S.start_label;
    $("retakeBtn").textContent = S.retake_label;
    // Якщо статистика підключена — чесно кажемо, що відповіді анонімно потрапляють у статистику
    $("disclaimer").innerHTML = md(statsOn() && t("disclaimer_stats") ? t("disclaimer_stats") : t("disclaimer"));
  }

  /* ---------- Дані квізу ---------- */

  function parseOptions(text) {
    // Кожен рядок: «бали | текст варіанта | коментар (необов'язково)». Без балів — 0.
    // Коментар показується, якщо студент обрав саме цей варіант: чому він неправильний.
    return String(text || "").split(/\n/).map(function (line) {
      line = line.trim();
      if (!line) return null;
      var m = line.match(/^(-?\d+(?:[.,]\d+)?)\s*\|\s*(.+)$/);
      if (!m) return { points: 0, text: line, comment: "" };
      var parts = m[2].split(/\s+\|\s+/);
      return { points: parseFloat(m[1].replace(",", ".")), text: parts[0], comment: parts.slice(1).join(" | ") };
    }).filter(Boolean);
  }

  // Перемішує варіанти питань-перевірок, щоб правильна відповідь не стояла завжди першою.
  // Самооцінки (шкала досвіду) лишаються в порядку з таблиці.
  function shuffleOrder(q) {
    var idx = q.opts.map(function (_, i) { return i; });
    var mode = String(q.shuffle || "").toLowerCase();
    var doShuffle = mode ? /^(true|так|1|yes)$/.test(mode) : q.type === "check";
    if (!doShuffle) return idx;
    for (var i = idx.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    return idx;
  }

  function prepare(data) {
    S = readSettings(data.settings);
    SKILLS = toObjects(data.skills).filter(isActive).sort(byOrder);
    var skillIds = SKILLS.map(function (s) { return s.id; });
    QUESTIONS = toObjects(data.questions).filter(function (q) {
      return isActive(q) && q.question && skillIds.indexOf(q.skill) !== -1;
    }).sort(byOrder).map(function (q) {
      q.opts = parseOptions(q.options);
      q.max = Math.max.apply(null, q.opts.map(function (o) { return o.points; }).concat([0]));
      q.type = /^check|перевірка/i.test(q.type) ? "check" : "self";
      return q;
    }).filter(function (q) { return q.opts.length >= 2; });
    RESOURCES = toObjects(data.resources).filter(function (r) { return isActive(r) && safeUrl(r.url); }).sort(byOrder);
    BASE = readBase(data.base || []);
    COURSES = toObjects(data.courses).filter(function (r) { return isActive(r) && safeUrl(r.url); }).sort(byOrder);
  }

  /* ---------- Екрани ---------- */

  function show(id) {
    ["intro", "quiz", "loading", "result"].forEach(function (s) { $(s).hidden = s !== id; });
    if (!document.documentElement.classList.contains("is-embed")) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderIntro() {
    var list = $("skillsPreview"); list.innerHTML = "";
    SKILLS.forEach(function (s) {
      var li = el("li");
      li.appendChild(el("b", null, esc(s.name)));
      li.appendChild(el("span", null, esc(s.description)));
      list.appendChild(li);
    });
    var b = $("startBtn");
    b.disabled = !QUESTIONS.length;
    b.onclick = function () { startQuiz(); show("quiz"); };
  }

  function startQuiz() {
    state = { i: 0, answers: {}, order: {} };
    QUESTIONS.forEach(function (q) { state.order[q.id] = shuffleOrder(q); });
    renderQuestion();
  }

  function skillStage(id) {
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].id === id) return SKILLS[i].stage || SKILLS[i].name;
    return id;
  }

  // Короткі репліки лише на рубежах: третина, половина, останнє питання
  function progressNote(i, total) {
    if (total < 6) return "";
    if (i === total - 1) return t("progress_last");
    if (i === Math.ceil(total / 2)) return t("progress_half");
    if (i === Math.ceil(total / 3)) return t("progress_third");
    return "";
  }

  function skillName(id) {
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].id === id) return SKILLS[i].name;
    return id;
  }

  function renderQuestion(keepCard) {
    var q = QUESTIONS[state.i], total = QUESTIONS.length;
    var ans = state.answers[q.id];
    // Обраний, але ще не підтверджений варіант (для питань-перевірок)
    state.pending = q.type === "check" ? null : (ans == null ? null : ans);
    $("progressBar").style.width = (state.i / total * 100) + "%";
    $("qSkill").textContent = skillStage(q.skill);
    $("qNote").textContent = progressNote(state.i, total);
    var hint = q.type === "self" ? t("self_hint") : "";
    $("qHint").textContent = hint;
    $("qHint").hidden = !hint;
    var card = document.querySelector(".q-card");
    if (!keepCard) { card.classList.remove("enter"); void card.offsetWidth; card.classList.add("enter"); }
    $("qCount").textContent = (state.i + 1) + " / " + total;
    $("qText").innerHTML = md(q.question);
    var code = $("qCode");
    code.hidden = !q.code;
    code.firstChild.textContent = q.code || "";

    var box = $("qOptions"), fbEl = $("qFeedback");
    if (fbEl.parentNode === box) box.parentNode.appendChild(fbEl);
    box.innerHTML = "";
    var locked = q.type === "check" && ans != null;
    state.order[q.id].forEach(function (idx, pos) {
      var o = q.opts[idx];
      var b = el("button", { type: "button", class: "opt", role: "radio", "aria-checked": ans === idx ? "true" : "false" });
      // У самооцінках третя частина рядка — підпис-пояснення під варіантом
      var sub = q.type === "self" && o.comment ? "<small>" + md(o.comment) + "</small>" : "";
      b.innerHTML = '<span class="opt-key" aria-hidden="true">' + String.fromCharCode(65 + pos) + '</span><span class="opt-text">' + md(o.text) + sub + "</span>";
      if (locked) {
        b.disabled = true;
        // Підсвічуємо лише обраний варіант; правильну відповідь називає пояснення
        if (ans === idx) b.classList.add(o.points === q.max ? "is-right" : "is-wrong");
      }
      b.onclick = function () { choose(idx); };
      box.appendChild(b);
    });
    renderFeedback(q, ans);
    $("backBtn").style.visibility = state.i === 0 ? "hidden" : "visible";
    updateNext();
  }

  // Кнопка: «Відповісти» — поки відповідь на перевірку не підтверджена; далі «Далі» / «Побачити результат»
  function updateNext() {
    var q = QUESTIONS[state.i], next = $("nextBtn");
    var answered = state.answers[q.id] != null;
    if (q.type === "check" && !answered) {
      next.textContent = "Відповісти";
      next.disabled = state.pending == null;
    } else {
      next.textContent = state.i === QUESTIONS.length - 1 ? "Побачити результат" : "Далі";
      next.disabled = !answered;
    }
  }

  function renderFeedback(q, ans) {
    var fb = $("qFeedback");
    if (q.type !== "check" || ans == null) { fb.hidden = true; return; }
    var chosen = q.opts[ans], right = chosen.points === q.max;
    var best = q.opts.filter(function (o) { return o.points === q.max; })[0];
    fb.className = "q-feedback" + (right ? " is-hit" : " is-miss");
    var html = '<b class="q-verdict">' + (right ? "✓ Правильно" : "✕ Неправильно") + "</b>";
    if (!right) {
      if (chosen.comment) html += "<p>" + md(chosen.comment) + "</p>";
      html += "<p>Правильна відповідь — «" + md(best.text) + "».</p>";
    }
    if (q.explanation) html += "<p>" + md(q.explanation) + "</p>";
    fb.innerHTML = html;
    fb.hidden = false;
    // Вердикт — одразу під обраним варіантом
    var pos = state.order[q.id].indexOf(ans), btn = $("qOptions").children[pos];
    if (btn) btn.insertAdjacentElement("afterend", fb);
  }

  // Клік лише обирає варіант; відповідь на перевірку приймається після «Відповісти»
  function choose(idx) {
    var q = QUESTIONS[state.i];
    if (q.type === "check" && state.answers[q.id] != null) return;
    state.pending = idx;
    if (q.type === "self") state.answers[q.id] = idx;
    var buttons = $("qOptions").children;
    state.order[q.id].forEach(function (oi, pos) { buttons[pos].setAttribute("aria-checked", oi === idx ? "true" : "false"); });
    updateNext();
  }

  function confirmAnswer() {
    var q = QUESTIONS[state.i];
    if (state.pending == null) return;
    state.answers[q.id] = state.pending;
    renderQuestion(true);
    $("qFeedback").scrollIntoView({ block: "nearest", behavior: "smooth" });
    $("nextBtn").focus({ preventScroll: true });
  }

  $("nextBtn").onclick = function () {
    var cur = QUESTIONS[state.i];
    if (cur.type === "check" && state.answers[cur.id] == null) { confirmAnswer(); return; }
    if (state.i < QUESTIONS.length - 1) { state.i++; renderQuestion(); window.scrollTo({ top: 0 }); }
    else {
      show("loading");
      setTimeout(renderResult, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100);
    }
  };
  $("backBtn").onclick = function () { if (state.i > 0) { state.i--; renderQuestion(); } };
  document.addEventListener("keydown", function (e) {
    if ($("quiz").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.toUpperCase();
    var n = /^[1-9]$/.test(k) ? +k - 1 : (/^[A-I]$/.test(k) ? k.charCodeAt(0) - 65 : -1);
    var ord = state.order[QUESTIONS[state.i].id];
    if (n >= 0 && n < ord.length) { choose(ord[n]); e.preventDefault(); }
    else if (e.key === "Enter" && !$("nextBtn").disabled && document.activeElement === document.body) $("nextBtn").click();
  });

  /* ---------- Оцінювання ---------- */

  function score() {
    var ok = parseFloat(S.threshold_ok) || 70, block = parseFloat(S.threshold_block) || 30;
    var res = SKILLS.map(function (s) {
      var got = 0, max = 0;
      QUESTIONS.forEach(function (q) {
        if (q.skill !== s.id) return;
        var a = state.answers[q.id];
        max += q.max;
        if (a != null) got += q.opts[a].points;
      });
      var pct = max ? Math.round(got / max * 100) : 100;
      var critical = isTrue(s.critical);
      var level = pct >= ok ? "ok" : (pct < block && critical ? "block" : "partial");
      // «Почніть з основ» — лише для критичних навичок; некритичні прогалини завжди «варто підтягнути»
      return { skill: s, pct: pct, level: level, critical: critical, hasQuestions: max > 0 };
    }).filter(function (r) { return r.hasQuestions; });
    var outcome = "ready";
    if (res.some(function (r) { return r.level === "block"; })) outcome = "basics";
    else if (res.some(function (r) { return r.level !== "ok"; })) outcome = "prep";
    return { skills: res, outcome: outcome };
  }

  var OUTCOME = {
    ready: { img: "assets/img/rocket.webp", tag: "готові до старту" },
    prep: { img: "assets/img/puzzle.webp", tag: "трохи підготовки" },
    basics: { img: "assets/img/cube-lattice.webp", tag: "спершу база" },
  };
  var LEVEL = {
    ok: { label: "на рівні", cls: "status--ok" },
    partial: { label: "варто підтягнути", cls: "status--partial" },
    block: { label: "почніть з основ", cls: "status--block" },
  };

  /* ---------- Ресурси: власні рядки курсу + загальна база r_d за тегами ---------- */

  // Загальна «База ресурсів r_d для вхідного квізу» має свої колонки українською — читаємо її окремо
  var BASE_COLS = {
    "id": "id", "напрям": "area", "тема": "topic", "тег теми (для квізу)": "tag", "рівень": "level",
    "назва ресурсу": "title", "посилання": "url", "хто стоїть за ресурсом": "who", "тип джерела": "kind",
    "мова": "lang", "формат": "format", "доступ": "access", "коли рекомендувати (прогалина)": "when", "статус": "status",
    "статус перевірки": "checked",
  };
  function readBase(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { var k = String(h).trim().toLowerCase(); return BASE_COLS[k] || k; });
    if (head.indexOf("tag") === -1 || head.indexOf("url") === -1) return []; // це не база ресурсів
    return rows.slice(1).map(function (r, idx) {
      var o = { _row: idx };
      head.forEach(function (h, i) { o[h] = r[i] == null ? "" : String(r[i]).trim(); });
      o.level = parseInt(o.level, 10); if (isNaN(o.level)) o.level = 1;
      var rd = /r_d/i.test(o.kind) || /robotdreams\.cc/i.test(o.url);
      o.source = rd ? "robot_dreams" : /dou\.ua/i.test(o.url) ? "DOU" : shortSource(o.who, o.kind);
      o.title = o.title.replace(/^r_d:\s*/i, "");
      return o;
    }).filter(function (o) {
      if (!o.tag || !safeUrl(o.url) || /виключити/i.test(o.status)) return false;
      // За замовчуванням беремо з бази лише ресурси, які вже перевірили (є дата в «Статус перевірки»)
      var onlyChecked = !/^(false|ні|0|no)$/i.test(S.base_verified_only || "");
      return !onlyChecked || /\d{2}\.\d{2}\.\d{4}|так/i.test(o.checked || "");
    });
  }
  // Коротка плашка джерела: назва автора/організації, якщо коротка, інакше — тип джерела
  function shortSource(who, kind) {
    var w = String(who || "").split(/[,(—\/]/)[0].trim();
    if (w && w.length <= 22) return w;
    var k = String(kind || "").toLowerCase();
    if (/документац|довідник|стандарт|стайлгайд/.test(k)) return "офіційна документація";
    if (/державн/.test(k)) return "державний ресурс";
    if (/університет|академ/.test(k)) return "університетський ресурс";
    if (/підручник|книга/.test(k)) return "відкритий підручник";
    if (/інструмент|тренажер|симул/.test(k)) return "інструмент";
    if (/спільнот/.test(k)) return "ІТ-спільнота";
    return "відкрите джерело";
  }
  // Теги навички: «physics.school, math.*» — точний тег або весь напрям через .*
  function tagMatch(tag, list) {
    return list.some(function (p) {
      return p.slice(-2) === ".*" ? tag.indexOf(p.slice(0, -1)) === 0 : tag === p;
    });
  }
  function skillTags(skill) {
    return String(skill.tags || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  // Підбір: спершу robot_dreams, далі українською, далі за рівнем; без повторів; не більше resources_limit
  function resourcesFor(skillId, level) {
    var skill = SKILLS.filter(function (s) { return s.id === skillId; })[0] || {};
    var tags = skillTags(skill);
    var maxLevel = parseInt(S.resources_max_level, 10); if (isNaN(maxLevel)) maxLevel = 1;
    var limit = parseInt(S.resources_limit, 10) || 5;
    var own = RESOURCES.filter(function (r) { return r.skill === skillId; }).map(function (r, i) {
      return { title: r.title, url: r.url, source: r.source, format: r.format, time: r.time, lang: r.lang, level: 0, own: i };
    });
    var fromBase = tags.length ? BASE.filter(function (b) { return tagMatch(b.tag, tags) && b.level <= maxLevel; }) : [];
    var seen = {}, all = [];
    own.concat(fromBase).forEach(function (r) {
      var key = r.url.replace(/\/+$/, "");
      if (!seen[key]) { seen[key] = 1; all.push(r); }
    });
    // Порядок: спершу власні матеріали курсу (як у вкладці resources), далі база: robot_dreams → українською → простіші
    var isOwn = function (r) { return r.own != null ? 0 : 1; };
    var isRd = function (r) { return /robot_dreams|r_d/i.test(r.source || "") ? 0 : 1; };
    var isUa = function (r) { return /^UA/i.test(r.lang || "") ? 0 : 1; };
    all.sort(function (a, b) {
      if (isOwn(a) !== isOwn(b)) return isOwn(a) - isOwn(b);
      if (!isOwn(a)) return a.own - b.own;
      return isRd(a) - isRd(b) || isUa(a) - isUa(b) || a.level - b.level || a._row - b._row;
    });
    return all.slice(0, limit);
  }

  function resourceList(skillId, level) {
    var items = resourcesFor(skillId, level);
    if (!items.length) return null;
    var ul = el("ul", { class: "res-list" });
    items.forEach(function (r) {
      var li = el("li");
      var a = el("a", { href: safeUrl(r.url), target: "_blank", rel: "noopener" });
      var isRd = /robot_dreams|r_d/i.test(r.source || "");
      var meta = [r.format && r.format.toLowerCase(), r.time ? "≈ " + r.time : "", r.lang].filter(Boolean).map(esc).join(" · ");
      a.innerHTML = '<span class="res-title">' + esc(r.title) + "</span>" +
        '<span class="res-meta"><span class="res-tag' + (isRd ? " res-tag--rd" : "") + '">' + esc(r.source || "") + "</span>" + meta + "</span>" +
        '<span class="res-arrow" aria-hidden="true">↗</span>';
      li.appendChild(a); ul.appendChild(li);
    });
    return ul;
  }

  /* ---------- Анонімна статистика ---------- */

  // Квіз надсилає один анонімний рядок у Google-таблицю (через Google Apps Script, див. scripts/apps-script).
  // Жодних імен, пошти чи інших персональних даних. Без statsUrl у config.js нічого не надсилається.
  function statsOn() { return !!safeUrl(CFG.statsUrl); }
  function streamId() {
    return String(params.get("stream") || S.stream || "").replace(/[^\w\-.]/g, "").slice(0, 40) || "без потоку";
  }
  function sendStats(r) {
    if (!statsOn()) return;
    var overall = Math.round(r.skills.reduce(function (a, x) { return a + x.pct; }, 0) / Math.max(r.skills.length, 1));
    var skills = {}, answers = {};
    r.skills.forEach(function (x) { skills[x.skill.id] = x.pct; });
    QUESTIONS.forEach(function (q) {
      var a = state.answers[q.id];
      if (a == null) return;
      // Перевірки: 1 — правильно, 0 — ні. Самооцінки: бали варіанта
      answers[q.id] = q.type === "check" ? (q.opts[a].points === q.max ? 1 : 0) : q.opts[a].points;
    });
    var payload = {
      v: 1, course: S.course_name || "", stream: streamId(), mode: MODE, outcome: r.outcome, overall: overall,
      skills: skills, answers: answers,
      types: QUESTIONS.reduce(function (o, q) { o[q.id] = q.type; return o; }, {}),
      // Назви тем і короткий текст питань — щоб статистику було зручно читати
      labels: SKILLS.reduce(function (o, s) { o[s.id] = s.name; return o; },
        QUESTIONS.reduce(function (o, q) { o[q.id] = String(q.question).replace(/\s+/g, " ").slice(0, 120); return o; }, {})),
    };
    try {
      // text/plain + no-cors: Apps Script приймає без попереднього CORS-запиту; відповідь нам не потрібна
      fetch(CFG.statsUrl, { method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- Збереження результату ---------- */

  // Результат зберігається в браузері студента, тож після оновлення сторінки квіз не треба проходити знову.
  // Нічого не передається на сервер. Ключ — окремий для кожного курсу.
  function storeKey() { return "rd-quiz-result:" + (S.course_name || location.pathname); }
  function fingerprint() { return QUESTIONS.map(function (q) { return q.id + ":" + q.opts.length; }).join("|"); }
  function saveResult() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ v: 1, fp: fingerprint(), at: Date.now(), answers: state.answers }));
    } catch (e) {}
  }
  function loadSaved() {
    try {
      var d = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (!d || d.v !== 1 || d.fp !== fingerprint()) return null; // питання змінилися — старий результат не показуємо
      var complete = QUESTIONS.every(function (q) { return d.answers[q.id] != null && q.opts[d.answers[q.id]]; });
      return complete ? d : null;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(storeKey()); } catch (e) {} }
  function fmtDate(ms) {
    var d = new Date(ms), z = function (n) { return (n < 10 ? "0" : "") + n; };
    return z(d.getDate()) + "." + z(d.getMonth() + 1) + "." + d.getFullYear();
  }

  /* ---------- Підбір курсів robot_dreams ---------- */

  // «Загальна» тема — та, чий конспект є загальним переліком із тегами ([python] …), напр. бекграунд.
  function umbrellaId() {
    var u = SKILLS.filter(function (s) { return /(^|\n)\s*[-•*]?\s*\[[\w-]+\]/.test(String(s.recap || "")); })[0];
    return u ? u.id : null;
  }
  function courseSkills(c) { return String(c.skills || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  // Курси для картки теми skillId. Для загальної теми — лише ті, що закривають інші теми з прогалинами.
  function coursesFor(skillId, r) {
    var U = umbrellaId(), gap = {}, name = {};
    r.skills.forEach(function (x) { name[x.skill.id] = x.skill.name; if (x.level !== "ok") gap[x.skill.id] = true; });
    var pref = (SKILLS.filter(function (s) { return s.id === skillId; })[0] || {}).course || "";
    return COURSES.map(function (c) {
      var ids = courseSkills(c);
      var covers = ids.filter(function (i) { return i !== skillId && i !== U && gap[i]; });
      return { c: c, ok: ids.indexOf(skillId) !== -1 && (skillId !== U || covers.length > 0), covers: covers.map(function (i) { return name[i]; }) };
    }).filter(function (x) { return x.ok; })
      .sort(function (a, b) { return (b.c.title === pref.trim()) - (a.c.title === pref.trim()); })
      .slice(0, 2)
      .map(function (x) { return { title: x.c.title, description: x.c.description, url: x.c.url, covers: x.covers }; });
  }

  function renderResult(savedAt) {
    var r = score(), o = OUTCOME[r.outcome];
    $("progressBar").style.width = "100%";
    if (!savedAt) { saveResult(); sendStats(r); }

    var tags = $("resTags"); tags.innerHTML = "";
    var p = el("span", { class: "pill pill--sm" }); p.textContent = o.tag; tags.appendChild(p);
    var dt = el("span", { class: "pill pill--paper pill--sm" }); dt.textContent = "результат від " + fmtDate(savedAt || Date.now()); tags.appendChild(dt);
    $("resImg").src = o.img;
    $("resCourse").textContent = S.course_name;
    $("resTitle").textContent = S[r.outcome + "_title"] || "";
    $("resText").innerHTML = md(t(r.outcome + "_text"));

    var actions = $("resActions"); actions.innerHTML = "";
    var courseUrl = safeUrl(S.course_url), consultUrl = safeUrl(S.cta_consult_url);
    if (MODE === "landing") {
      if (r.outcome !== "basics" && courseUrl) actions.appendChild(link(courseUrl, "pill pill--accent pill--lg", S.cta_course_label));
      if (consultUrl) actions.appendChild(link(consultUrl, "pill pill--on-hero pill--lg", S.cta_consult_label));
      if (r.outcome === "basics" && courseUrl) actions.appendChild(link(courseUrl, "pill pill--on-hero pill--lg", S.cta_course_label));
    }

    renderDash(r);
    renderNext(r);

    var list = $("skillList"); list.innerHTML = "";
    // Спершу прогалини, потім те, що на рівні
    var order = { block: 0, partial: 1, ok: 2 };
    var sorted = r.skills.slice().sort(function (a, b) { return order[a.level] - order[b.level]; });
    var levelOf = {}, posOf = {};
    sorted.forEach(function (y, i) { levelOf[y.skill.id] = y.level; posOf[y.skill.id] = i; });
    var recapLines = function (s) {
      return String(s.recap || "").split(/\n/).map(function (l) { return l.replace(/^[-•*]\s*/, "").trim(); }).filter(Boolean);
    };
    var isChecklist = function (lines) { return lines.some(function (l) { return /^\[[\w-]+\]/.test(l); }); };

    // Загальні рекомендації: конспект із тегами тем «[python] …» — це загальний перелік для курсу.
    // Показуємо його окремим блоком над розбором, у тій самій послідовності, що й картки тем нижче.
    var general = r.skills.filter(function (x) { return isChecklist(recapLines(x.skill)); })[0];
    var gBlock = $("generalBlock"), gCard = $("generalCard");
    gCard.innerHTML = "";
    gBlock.hidden = !general;
    if (general) {
      if (t("general_title")) $("generalTitle").textContent = t("general_title");
      if (t("general_sub")) $("generalSub").textContent = t("general_sub");
      gCard.appendChild(el("b", { class: "general-name" }, esc(general.skill.recap_title || "Що потрібно знати на старті")));
      var items = recapLines(general.skill).map(function (l, i) {
        var m = l.match(/^\[([\w-]+)\]\s*(.*)$/);
        return { id: m ? m[1] : null, text: m ? m[2] : l, pos: m && m[1] in posOf ? posOf[m[1]] : 100 + i };
      }).sort(function (a, b) { return a.pos - b.pos; });
      var gl = el("ul", { class: "general-list" });
      items.forEach(function (it) {
        var lv = it.id ? levelOf[it.id] : null;
        var li = el("li", { class: lv ? "is-" + (lv === "ok" ? "ok" : "gap") : "is-plain" });
        // Рядок без тегу теми — загальна порада, у квізі окремо не перевіряється
        var badge = el("span", { class: "recap-badge" });
        badge.textContent = lv ? (lv === "ok" ? "✓ у вас на рівні" : "варто підтягнути") : (t("general_plain_label") || "порада для всіх");
        li.appendChild(badge);
        li.appendChild(el("span", { class: "general-text" }, md(it.text)));
        if (lv) {
          var go = el("button", { class: "general-go", type: "button" });
          go.textContent = "до теми ↓";
          go.addEventListener("click", function () {
            var c = document.getElementById("skill-" + it.id);
            if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          li.appendChild(go);
        }
        gl.appendChild(li);
      });
      gCard.appendChild(gl);
    }

    sorted.forEach(function (x) {
      var s = x.skill, lv = LEVEL[x.level];
      var card = el("article", { class: "skill skill--" + x.level, id: "skill-" + s.id });
      var head = el("div", { class: "skill-head" });
      head.appendChild(el("h3", { class: "skill-name" }, esc(s.name)));
      head.appendChild(el("span", { class: "pill pill--sm " + lv.cls }, lv.label));
      card.appendChild(head);
      card.appendChild(el("p", null, md(x.level === "ok" ? s.ok_text : s.gap_text)));
      var note = MODE === "landing" && s.note_landing ? s.note_landing : s.note;
      if (x.level !== "ok" && note) card.appendChild(el("p", { class: "note" }, md(note)));
      // Короткий конспект теми — головне, що треба знати до старту (пише ID, перевіряє лектор).
      // Загальний перелік (з тегами тем) уже показано вище, тут його не дублюємо.
      var recap = recapLines(s);
      if (x.level !== "ok" && recap.length && !isChecklist(recap)) {
        var box = el("div", { class: "recap" });
        box.appendChild(el("b", { class: "recap-title" }, esc(s.recap_title || t("recap_title") || "Коротко про тему")));
        var ul = el("ul");
        recap.forEach(function (l) { ul.appendChild(el("li", null, md(l))); });
        box.appendChild(ul);
        card.appendChild(box);
      }
      // Курси robot_dreams для прогалини (колонка course у skills вмикає підказку в картці).
      // Радимо лише курси, що закривають саме ті теми, які студент не пройшов, — щоб не порадити
      // курс з Python тому, у кого Python на рівні.
      if (x.level !== "ok" && s.course) {
        coursesFor(s.id, r).forEach(function (c) {
          var ca = el("a", { class: "skill-course", href: safeUrl(c.url), target: "_blank", rel: "noopener" });
          var why = c.covers.length ? "Курс robot_dreams, який закриває: " + c.covers.join(", ") : (t("course_hint") || "Курс robot_dreams, з якого варто почати");
          ca.innerHTML = '<span class="skill-course-k">' + esc(why) + "</span>" +
            "<b>" + esc(c.title) + "</b><span>" + esc(c.description) + '</span><span class="res-arrow" aria-hidden="true">↗</span>';
          card.appendChild(ca);
        });
      }
      var res = resourceList(s.id, x.level);
      if (res) {
        if (x.level === "ok") {
          var d = el("details", { class: "more" });
          d.appendChild(el("summary", null, "Матеріали, щоб освіжити"));
          d.appendChild(res);
          card.appendChild(d);
        } else {
          card.appendChild(res);
        }
      }
      list.appendChild(card);
    });

    // Курси для старту — лише для результату «закласти основи»
    var block = $("coursesBlock"), grid = $("courseGrid");
    grid.innerHTML = "";
    var gaps = r.skills.filter(function (x) { return x.level !== "ok"; }).map(function (x) { return x.skill.id; });
    var picks = COURSES.filter(function (c) {
      var ids = String(c.skills || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      return !ids.length || ids.some(function (id) { return gaps.indexOf(id) !== -1; });
    });
    // Блок інших курсів — лише у варіанті для лендингу; зарахованим курс радимо точково в картці теми (skills.course)
    block.hidden = MODE !== "landing" || r.outcome !== "basics" || !picks.length;
    $("coursesTitle").textContent = S.courses_title;
    picks.forEach(function (c) {
      var a = el("a", { class: "course", href: safeUrl(c.url), target: "_blank", rel: "noopener" });
      a.innerHTML = "<b>" + esc(c.title) + "</b><span>" + esc(c.description) + "</span><em>Детальніше ↗</em>";
      grid.appendChild(a);
    });

    show("result");
    $("resTitle").focus({ preventScroll: true });
    if (r.outcome === "ready" && !savedAt) confetti();
  }

  /* ---------- Дашборд результату ---------- */

  function renderDash(r) {
    var ok = parseFloat(S.threshold_ok) || 70;
    var overall = Math.round(r.skills.reduce(function (a, x) { return a + x.pct; }, 0) / Math.max(r.skills.length, 1));
    var checks = QUESTIONS.filter(function (q) { return q.type === "check"; });
    var right = checks.filter(function (q) { var a = state.answers[q.id]; return a != null && q.opts[a].points === q.max; }).length;
    var onLevel = r.skills.filter(function (x) { return x.level === "ok"; }).length;

    $("dashScore").textContent = overall;
    $("dashScoreMeter").style.width = overall + "%";
    $("dashScoreMeter").parentNode.setAttribute("aria-label", "Загальна готовність " + overall + "%");
    $("dashRight").innerHTML = right + "<small> з " + checks.length + "</small>";
    $("dashLevel").innerHTML = onLevel + "<small> з " + r.skills.length + "</small>";

    var list = $("dashList"); list.innerHTML = "";
    list.style.setProperty("--goal", ok + "%");
    r.skills.forEach(function (x) {
      var lv = LEVEL[x.level];
      var row = el("li", { class: "dash-row dash-row--" + x.level, tabindex: "0",
        "aria-label": x.skill.name + ": " + x.pct + "%, " + lv.label });
      row.innerHTML =
        '<span class="dash-name">' + esc(x.skill.name) + "</span>" +
        '<span class="dash-track" aria-hidden="true"><span class="dash-fill" style="width:' + Math.max(x.pct, 2) + '%"></span></span>' +
        '<span class="dash-val">' + x.pct + "%</span>" +
        '<span class="dash-tip" role="tooltip">' + esc(x.skill.name) + " — " + x.pct + "%<br>" + esc(lv.label) + " · рівень старту " + ok + "%</span>";
      list.appendChild(row);
    });
    $("dashGoal").textContent = "рівень старту " + ok + "%";
    $("dashGoal").style.left = ok + "%";
  }

  /* ---------- «Що далі?» ---------- */

  // Кроки беремо з settings: next_ready / next_prep / next_basics — кожен рядок = крок.
  // Підстановки: {gaps} — теми, які варто підтягнути; {course} — перший рекомендований курс robot_dreams;
  // {course_link} — посилання на сторінку курсу.
  function renderNext(r) {
    var block = $("nextBlock"), list = $("nextList");
    list.innerHTML = "";
    // Теми з матеріалами — у тій самій послідовності, що й картки в розборі нижче, не більше трьох
    var rank = { block: 0, partial: 1, ok: 2 };
    var gaps = r.skills.filter(function (x) {
      return x.level !== "ok" && resourcesFor(x.skill.id, x.level).length > 0;
    }).sort(function (a, b) { return rank[a.level] - rank[b.level]; }).slice(0, 3).map(function (x) { return x.skill.name; });
    var gapIds = r.skills.filter(function (x) { return x.level !== "ok"; }).map(function (x) { return x.skill.id; });
    // Курс радимо лише за конкретними прогалинами (загальна тема на кшталт бекграунду сама по собі не рахується)
    var U = umbrellaId();
    var course = COURSES.filter(function (c) {
      return courseSkills(c).some(function (id) { return id !== U && gapIds.indexOf(id) !== -1; });
    })[0] || null;
    var courseUrl = safeUrl(S.course_url);
    var lines = t("next_" + r.outcome).split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    lines.forEach(function (line) {
      // Рядок із тегом теми «[python] …» показуємо лише тоді, коли цю тему варто підтягнути
      var cond = line.match(/^\[([\w-]+)\]\s*(.*)$/);
      if (cond) {
        if (gapIds.indexOf(cond[1]) === -1) return;
        line = cond[2];
      }
      if (/\{course\}/.test(line) && !course) return;
      if (/\{gaps\}/.test(line) && !gaps.length) return;
      if (/\{course_link\}/.test(line) && !courseUrl) return;
      line = line
        .replace(/\{gaps\}/g, gaps.length ? "«" + gaps.join("», «") + "»" : "")
        .replace(/\{course\}/g, course ? "[" + course.title + "](" + safeUrl(course.url) + ")" : "")
        .replace(/\{course_link\}/g, courseUrl);
      var li = el("li");
      li.appendChild(el("div", null, mdLinks(line)));
      list.appendChild(li);
    });
    block.hidden = !list.children.length;
  }
  function mdLinks(text) {
    var html = md(text);
    return html.replace(/<a /g, '<a target="_blank" rel="noopener" ');
  }

  /* ---------- Конфеті для «Можна стартувати» ---------- */

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = $("confetti"), ctx = cv.getContext && cv.getContext("2d");
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4BD86A";
    var colors = [accent, "#181919", "#E5E8EC", accent];
    var parts = [];
    for (var i = 0; i < 110; i++) {
      parts.push({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[i % colors.length] });
    }
    var start = performance.now();
    (function frame(now) {
      var k = (now - start) / 1800;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (k < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(start);
  }

  $("retakeBtn").onclick = function () { clearSaved(); show("intro"); };
  // PDF — через системний діалог друку: «Зберегти як PDF». Для друку є окремі стилі (без кнопок, світла тема)
  // Деякі вбудовані перегляди блокують друк без жодної помилки. Якщо діалог друку не відкрився — пояснюємо, що робити
  var printOpened = false;
  // Перед друком розгортаємо всі згорнуті «Матеріали, щоб освіжити», щоб посилання потрапили в PDF; після — повертаємо як було
  window.addEventListener("beforeprint", function () {
    printOpened = true;
    document.querySelectorAll("details.more:not([open])").forEach(function (d) { d.open = true; d.dataset.autoOpened = "1"; });
  });
  window.addEventListener("afterprint", function () {
    document.querySelectorAll('details.more[data-auto-opened="1"]').forEach(function (d) { d.open = false; delete d.dataset.autoOpened; });
  });
  $("pdfBtn").onclick = function () {
    printOpened = false;
    $("pdfNote").hidden = true;
    try { window.print(); } catch (e) {}
    setTimeout(function () { if (!printOpened) $("pdfNote").hidden = false; }, 800);
  };

  /* ---------- Тема ---------- */

  $("themeBtn").onclick = function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("rd-quiz-theme", root.dataset.theme); } catch (e) {}
  };

  /* ---------- Старт ---------- */

  Promise.all(KINDS.map(load)).then(function (parts) {
    var data = {}, snap = false;
    KINDS.forEach(function (k, i) { data[k] = parts[i].rows; snap = snap || (parts[i].snap && CFG.source !== "snapshot" && !!liveUrl(k)); });
    prepare(data);
    applySettings();
    renderIntro();
    $("sourceNote").hidden = !snap;
    // Якщо студент уже проходив квіз — одразу показуємо збережений результат
    var saved = loadSaved();
    if (saved) {
      state = { i: QUESTIONS.length - 1, answers: saved.answers, order: {} };
      QUESTIONS.forEach(function (q) { state.order[q.id] = shuffleOrder(q); });
      renderResult(saved.at);
    }
  }).catch(function (err) {
    console.error(err);
    $("introText").textContent = "Не вдалося завантажити квіз. Оновіть сторінку трохи згодом.";
    $("startBtn").textContent = "Квіз недоступний";
  });
})();
