/**
 * Налаштування вхідного квізу для одного курсу.
 * Для нового курсу зазвичай достатньо змінити лише sheetId.
 * Усе інше (назва курсу, тексти результатів, акцентний колір, питання, матеріали)
 * береться з Google-таблиці.
 */
window.QUIZ_CONFIG = {
  // ID таблиці з її адреси: https://docs.google.com/spreadsheets/d/<ОСЬ_ЦЕЙ_ID>/edit
  // Таблиця має бути відкрита: «Усі, хто має посилання — Читач».
  sheetId: "",

  // Назви вкладок у таблиці
  tabs: {
    settings: "settings",
    skills: "skills",
    questions: "questions",
    resources: "resources",
    base: "base",            // загальна база ресурсів r_d (необов'язково; можна підтягнути через IMPORTRANGE)
    courses: "courses",
  },

  // Альтернатива sheetId: прямі CSV-посилання з «Файл → Поділитися → Опублікувати в інтернеті».
  // Якщо заповнені — мають пріоритет над sheetId.
  csvUrls: {
    settings: "",
    skills: "",
    questions: "",
    resources: "",
    base: "",
    courses: "",
  },

  // "live"     — сторінка читає таблицю напряму, а при помилці показує резервну копію з data/
  // "snapshot" — сторінка читає лише data/*.csv (їх оновлює GitHub Action)
  // Анонімна статистика: URL веб-застосунку Google Apps Script (scripts/apps-script/README.md).
  // Порожньо — квіз нічого не надсилає. Потік задається в посиланні: …/?stream=2
  statsUrl: "",

  source: "live",

  snapshot: {
    settings: "data/settings.csv",
    skills: "data/skills.csv",
    questions: "data/questions.csv",
    resources: "data/resources.csv",
    base: "data/base.csv",
    courses: "data/courses.csv",
  },

  // Значення за замовчуванням, якщо в settings чогось немає
  defaults: {
    course_name: "Курс robot_dreams",
    subbrand: "готовність до старту",
    accent: "#4BD86A",
    site_url: "https://robotdreams.cc",
    site_label: "robotdreams.cc",
    intro_title: "Чи підходить вам курс?",
    intro_meta: "",
    start_label: "Пройти квіз",
    threshold_ok: "70",
    threshold_block: "30",
    ready_title: "Можна стартувати 🚀",
    prep_title: "Маленький апгрейд — і стартуємо ⚡",
    basics_title: "Час прокачати базу перед стартом 💡",
    cta_course_label: "Детальніше про курс",
    cta_consult_label: "Поговорити з консультантом",
    courses_title: "Курси robot_dreams для старту",
    retake_label: "Пройти ще раз",
  },
};
