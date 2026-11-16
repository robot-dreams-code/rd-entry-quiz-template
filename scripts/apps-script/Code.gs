/**
 * r_d Вхідний квіз — анонімна статистика проходжень.
 *
 * Скрипт прив'язаний до Google-таблиці квізу (Розширення → Apps Script).
 * Квіз надсилає сюди один анонімний рядок після кожного проходження,
 * скрипт дописує його у вкладку `results`. Вкладку `stats` будує функція setupStats().
 *
 * Персональних даних немає: лише дата, потік, результат і відсотки / бали.
 */

var RESULTS = "results";
var STATS = "stats";
var META = "meta"; // id теми / питання → назва (заповнюється автоматично)
var FIXED = ["Дата", "Потік", "Режим", "Результат", "Готовність, %"];
var OUTCOME_LABEL = { ready: "Можна стартувати", prep: "З підготовкою", basics: "Закласти основи" };

/** Приймає результат із квізу. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var raw = (e && e.postData && e.postData.contents) || "";
    if (raw.length > 20000) return text_("too large");
    var d = JSON.parse(raw);
    if (!d || d.v !== 1 || !OUTCOME_LABEL[d.outcome]) return text_("bad payload");

    var sh = sheet_(RESULTS);
    var head = header_(sh);

    // Колонки тем і питань додаються самі, коли з'являються нові
    var skillCols = Object.keys(d.skills || {}).map(function (id) { return "Тема: " + id; });
    var qCols = Object.keys(d.answers || {}).map(function (id) {
      return (d.types && d.types[id] === "self" ? "Досвід: " : "Питання: ") + id;
    });
    var wanted = FIXED.concat(skillCols, qCols);
    var missing = wanted.filter(function (h) { return head.indexOf(h) === -1; });
    if (missing.length) {
      sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
      head = head.concat(missing);
    }

    var row = head.map(function () { return ""; });
    var put = function (name, value) { var i = head.indexOf(name); if (i !== -1) row[i] = value; };
    put("Дата", new Date());
    put("Потік", String(d.stream || "без потоку").slice(0, 40));
    put("Режим", d.mode === "landing" ? "лендинг" : "після покупки");
    put("Результат", OUTCOME_LABEL[d.outcome]);
    put("Готовність, %", num_(d.overall));
    Object.keys(d.skills || {}).forEach(function (id) { put("Тема: " + id, num_(d.skills[id])); });
    Object.keys(d.answers || {}).forEach(function (id) {
      put((d.types && d.types[id] === "self" ? "Досвід: " : "Питання: ") + id, num_(d.answers[id]));
    });
    sh.appendRow(row);
    saveLabels_(d.labels || {});
    return text_("ok");
  } catch (err) {
    return text_("error");
  } finally {
    lock.releaseLock();
  }
}

/** Перевірка, що застосунок опублікований: відкрийте URL у браузері — побачите «ok». */
function doGet() { return text_("ok"); }

/**
 * Будує вкладку `stats` з формулами. Запустіть один раз після перших проходжень
 * (або після додавання нових питань) — Apps Script → вибрати setupStats → «Виконати».
 */
function setupStats() {
  var res = sheet_(RESULTS);
  var head = header_(res);
  if (head.length <= FIXED.length) throw new Error("Спершу має бути хоча б одне проходження у вкладці results");

  var st = sheet_(STATS);
  st.clear();
  var col = function (name) { return letter_(head.indexOf(name) + 1); };
  var R = "'" + RESULTS + "'!";
  var lastCol = letter_(head.length);
  var all = R + "A1:" + lastCol;
  var y = 1;

  var title = function (text) {
    st.getRange(y, 1).setValue(text).setFontWeight("bold").setFontSize(12);
    y += 1;
  };

  title("Загалом");
  // Формули ставимо через setFormulas: так синтаксис з комами працює за будь-якої мови таблиці
  st.getRange(y, 1, 3, 1).setValues([["Проходжень"], ["Середня готовність, %"], ["Можна стартувати, %"]]);
  st.getRange(y, 2, 3, 1).setFormulas([
    ["=COUNTA(" + R + "A2:A)"],
    ["=IFERROR(ROUND(AVERAGE(" + R + col("Готовність, %") + "2:" + col("Готовність, %") + "),0),\"—\")"],
    ["=IFERROR(ROUND(COUNTIF(" + R + col("Результат") + "2:" + col("Результат") + ",\"Можна стартувати\")/COUNTA(" + R + "A2:A)*100,0),\"—\")"],
  ]);
  y += 4;

  title("Проходження і результати за потоками");
  st.getRange(y, 1).setFormula(
    "=QUERY(" + all + ",\"select " + col("Потік") + ", count(" + col("Дата") + "), avg(" + col("Готовність, %") + ") where " +
    col("Дата") + " is not null group by " + col("Потік") + " label count(" + col("Дата") + ") 'Проходжень', avg(" +
    col("Готовність, %") + ") 'Середня готовність, %'\",1)");
  y += 12;

  title("Розподіл результатів за потоками");
  st.getRange(y, 1).setFormula(
    "=QUERY(" + all + ",\"select " + col("Потік") + ", count(" + col("Дата") + ") where " + col("Дата") +
    " is not null group by " + col("Потік") + " pivot " + col("Результат") + "\",1)");
  y += 12;

  var L = labels_();
  var skillCols = head.filter(function (h) { return h.indexOf("Тема: ") === 0; });
  title("Середній результат за темами (за потоками), %");
  st.getRange(y, 1).setFormula(
    "=QUERY(" + all + ",\"select " + col("Потік") + ", " +
    skillCols.map(function (h) { return "avg(" + col(h) + ")"; }).join(", ") +
    " where " + col("Дата") + " is not null group by " + col("Потік") + " label " +
    skillCols.map(function (h) { var id = h.replace("Тема: ", ""); return "avg(" + col(h) + ") '" + safeLabel_(L[id] || id) + "'"; }).join(", ") + "\",1)");
  y += 12;

  var qCols = head.filter(function (h) { return h.indexOf("Питання: ") === 0; });
  title("Питання: частка правильних відповідей, % (найскладніші — найменший відсоток)");
  st.getRange(y, 1, 1, 3).setValues([["Питання", "Правильно, %", "Текст питання"]]).setFontWeight("bold");
  y += 1;
  st.getRange(y, 1, qCols.length, 1).setValues(qCols.map(function (h) { return [h.replace("Питання: ", "")]; }));
  st.getRange(y, 3, qCols.length, 1).setValues(qCols.map(function (h) { return [L[h.replace("Питання: ", "")] || ""]; }));
  st.getRange(y, 2, qCols.length, 1).setFormulas(qCols.map(function (h) {
    var c = col(h);
    return ["=IFERROR(ROUND(AVERAGE(" + R + c + "2:" + c + ")*100,0),\"—\")"];
  }));
  y += qCols.length + 2;

  st.getRange(y, 1).setValue("Цифри оновлюються автоматично з кожним новим проходженням. " +
    "Після додавання нових тем чи питань запустіть setupStats ще раз.").setFontColor("#666666");
  st.setColumnWidth(1, 260);
  SpreadsheetApp.getActive().setActiveSheet(st);
}

/* ---------- допоміжне ---------- */
function saveLabels_(labels) {
  var m = sheet_(META);
  if (m.getLastRow() === 0) m.getRange(1, 1, 1, 2).setValues([["id", "Назва"]]);
  var have = {};
  m.getRange(1, 1, m.getLastRow(), 2).getValues().forEach(function (r) { have[r[0]] = r[1]; });
  Object.keys(labels).forEach(function (id) {
    var v = String(labels[id] || "").slice(0, 150);
    if (!(id in have)) { m.appendRow([id, v]); have[id] = v; }
  });
}
function labels_() {
  var m = SpreadsheetApp.getActive().getSheetByName(META), out = {};
  if (m && m.getLastRow()) m.getRange(1, 1, m.getLastRow(), 2).getValues().forEach(function (r) { out[r[0]] = r[1]; });
  return out;
}
function safeLabel_(s) { return String(s).replace(/['"]/g, "’").slice(0, 60); }
function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function header_(sh) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, FIXED.length).setValues([FIXED]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}
function num_(v) { var n = Number(v); return isFinite(n) ? n : ""; }
function letter_(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
