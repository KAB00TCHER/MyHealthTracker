import "./style.css";

const tg = window.Telegram?.WebApp;
const app = document.querySelector("#app");
let me = null;
let page = "home";
let daily = {};
let historyData = { entries: [], events: [] };
let events = [];
let medicationsData = { medications: [], logs: [] };


const labels = {
  sleep_depth: "Глубина сна", sleep_quality: "Качество сна",
  sleep_hours: "Продолжительность сна, часы", wakeups: "Пробуждения за ночь",
  morning_state: "Состояние после пробуждения", nightmares: "Кошмары",
  anxiety: "Тревога", anxiety_examples: "Как проявлялась тревога",
  anxiety_pattern: "Характер тревоги", mood: "Настроение",
  mood_changes: "Изменения настроения", appetite: "Аппетит",
  health: "Жалобы на здоровье", irritability: "Раздражительность",
  energy: "Силы и энергия", attention: "Внимание и память",
  sleepiness: "Дневная сонливость", extra: "Дополнительные заметки"
};
const sections = [
  { title: "Сон", items: [
    ["sleep_depth","select",["Поверхностный","Средний","Глубокий"]],
    ["sleep_quality","scale"], ["sleep_hours","number"], ["wakeups","number"],
    ["morning_state","select",["Разбитое состояние","Усталость","Нормальное","Бодрое"]],
    ["nightmares","textarea"]
  ]},
  { title: "Тревога", items: [
    ["anxiety","scale"], ["anxiety_examples","textarea"],
    ["anxiety_pattern","select",["Постоянная","Эпизодическая","Не было"]]
  ]},
  { title: "Настроение", items: [["mood","scale"],["mood_changes","textarea"]] },
  { title: "Аппетит и здоровье", items: [
    ["appetite","select",["Снижен","Обычный","Повышен","Отсутствовал"]],
    ["health","textarea"]
  ]},
  { title: "Общее самочувствие", items: [
    ["irritability","scale"], ["energy","scale"],
    ["attention","select",["Хорошее","Обычное","Сниженное","Сильно затруднено"]],
    ["sleepiness","select",["Нет","Небольшая","Умеренная","Сильная"]],
    ["extra","textarea"]
  ]}
];

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": tg.initData,
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Ошибка запроса");
  return result;
}
function nav() {
  const items = [
    ["home","Главная"],
    ["daily","Анкета"],
    ["events","Отметки"],
    ["history","История"],
    ...(me.role === "user" ? [["medications","Лекарства"]] : []),
    ...(me.role === "admin" ? [["admin","Обзор"]] : [])
  ];

  return `<nav>${items.map(([id,title]) =>
    `<button class="${page === id ? "active" : ""}" data-page="${id}">${title}</button>`
  ).join("")}</nav>`;
}
function shell(content) {
  app.innerHTML = `
    <main class="wrap">
      <header class="top">
        <div><div class="eyebrow">ДНЕВНИК САМОЧУВСТВИЯ</div>
          <h1>${me.role === "admin" ? "Панель наблюдения" : `Здравствуйте, ${escapeHtml(me.firstName)}`}</h1>
          <p class="muted">${new Date().toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"})}</p>
        </div>
        <span class="role">${me.role === "admin" ? "Администратор · просмотр" : "Личный дневник"}</span>
      </header>
      ${nav()}
      <section class="content">${content}</section>
      <footer>Записи помогают отслеживать самочувствие и не являются медицинским диагнозом.</footer>
    </main>`;
  // Навигация работает и для вкладок, и для кнопок/карточек внутри страницы.
  app.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => go(button.dataset.page));
  });
}
async function go(nextPage) {
  page = nextPage;
  try {
    if (nextPage === "daily") {
      const result = await api(`/api/daily?date=${localDate()}`);
      daily = result.entry?.answers || {};
      renderDaily();
    } else if (nextPage === "events") {
      const result = await api("/api/events");
      events = result.events || [];
      renderEvents();
    } else if (nextPage === "history" || nextPage === "admin") {
      const result = await api("/api/history");
      historyData = result;
      renderHistory(nextPage === "admin");
          } else if (nextPage === "medications") {
      const result = await api("/api/medications");
      medicationsData = result;
      renderMedications();
    } else renderHome();
  } catch (error) {
    shell(`<div class="notice error">Не удалось загрузить данные: ${escapeHtml(error.message)}. Проверь настройки и обнови приложение.</div>`);
  }
}
function renderHome() {
  const todayEntry = historyData.entries?.find(e => e.entry_date === localDate());

  shell(`
    <section class="hero">
      <div class="eyebrow">СЕГОДНЯ</div>
      <h2>${new Date().toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}</h2>
      <p>Вечерняя анкета фиксирует общее впечатление о дне. Быстрые отметки сохраняются отдельно и имеют собственное время.</p>
      ${me.role === "user" ? `<button class="primary" data-page="daily">${todayEntry ? "Изменить анкету за сегодня" : "Заполнить анкету"}</button>` : ""}
    </section>

    <div class="cards">
      ${me.role === "user" ? `
        <button class="tile" data-page="events">
          <strong>Быстрая отметка</strong>
          <span>Записать эпизод в течение дня</span>
        </button>

        <button class="tile" data-page="medications">
          <strong>Лекарства</strong>
          <span>Расписание и напоминания о приёме</span>
        </button>
      ` : ""}

      <button class="tile" data-page="history">
        <strong>История</strong>
        <span>Ежедневные анкеты и отдельные события</span>
      </button>
    </div>

    <div class="notice">Можно пропускать любые вопросы. Не нужно подгонять ответы под ожидаемую картину — фиксируй то, что действительно было.</div>

    ${me.role === "admin" ? `<div class="notice">Режим администратора: доступен просмотр записей. Создавать или изменять записи Леры из этого аккаунта нельзя.</div>` : ""}
  `);
}
function renderField([key,type,options]) {
  const value = daily[key] ?? "";
  let input = "";
  if (type === "scale") {
    const n = value === "" ? 5 : Number(value);
    input = `<div class="scale"><span>0</span><input type="range" min="0" max="10" value="${n}" data-key="${key}"><b data-value="${key}">${value === "" ? "Не указано" : `${n}/10`}</b><span>10</span></div>`;
  } else if (type === "select") {
    input = `<select data-key="${key}"><option value="">Не указано</option>${options.map(option =>
      `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`
    ).join("")}</select>`;
  } else if (type === "textarea") {
    input = `<textarea data-key="${key}" rows="3" maxlength="3000" placeholder="Можно оставить пустым">${escapeHtml(value)}</textarea>`;
  } else {
    input = `<input data-key="${key}" type="number" min="0" max="${key === "sleep_hours" ? "24" : "30"}" step="0.5" value="${escapeHtml(value)}">`;
  }
  return `<label class="field"><span>${labels[key]}</span>${input}</label>`;
}
function renderDaily() {
  shell(`
    <div class="pagehead"><h2>Ежедневная анкета</h2><p class="muted">Запись за ${new Date().toLocaleDateString("ru-RU")}. Оценки 0–10 — субъективные, где 0 означает отсутствие/минимальную выраженность, а 10 — максимальную.</p></div>
    ${sections.map(section => `<article class="panel"><h3>${section.title}</h3>${section.items.map(renderField).join("")}</article>`).join("")}
    <button class="primary full" id="saveDaily">Сохранить запись</button><p id="saveMessage" class="muted"></p>
  `);
  app.querySelectorAll("[data-key]").forEach(element => {
    const update = () => {
      daily[element.dataset.key] = element.type === "range" ? Number(element.value) : element.value;
      const output = app.querySelector(`[data-value="${element.dataset.key}"]`);
      if (output) output.textContent = `${element.value}/10`;
    };
    element.addEventListener("input", update);
    element.addEventListener("change", update);
  });
  document.querySelector("#saveDaily").addEventListener("click", async event => {
    const button = event.currentTarget;
    const message = document.querySelector("#saveMessage");
    button.disabled = true;
    message.textContent = "Сохраняем…";
    try {
      await api("/api/daily", { method:"POST", body:JSON.stringify({date:localDate(),answers:daily}) });
      message.textContent = "Запись сохранена. Её можно изменить до конца дня и позже.";
    } catch (error) {
      message.textContent = `Не удалось сохранить: ${error.message}`;
    } finally { button.disabled = false; }
  });
}
function renderEvents() {
  const names = { anxiety:"Тревога", mood:"Настроение", energy:"Энергия", irritability:"Раздражительность", other:"Другое" };
  shell(`
    <div class="pagehead"><h2>Быстрая отметка</h2><p class="muted">Фиксируй отдельные эпизоды по мере необходимости. Это не средняя оценка за день.</p></div>
    ${me.role === "user" ? `<article class="panel">
      <label class="field"><span>Что отмечаем</span><select id="eventType">${Object.entries(names).map(([v,n])=>`<option value="${v}">${n}</option>`).join("")}</select></label>
      <label class="field"><span>Выраженность: <b id="eventValue">5</b>/10</span><input id="eventScale" type="range" min="0" max="10" value="5"></label>
      <label class="field"><span>Комментарий (необязательно)</span><textarea id="eventNote" rows="3" maxlength="2000" placeholder="Контекст, обстоятельства, ощущения"></textarea></label>
      <button class="primary full" id="saveEvent">Сохранить отметку</button><p id="eventMessage" class="muted"></p>
    </article>` : ""}
    <h3>Последние события</h3>
    ${events.length ? events.map(event => `<article class="event"><b>${names[event.event_type] || "Событие"} · ${event.value ?? "—"}/10</b><p>${escapeHtml(event.note)}</p><small>${new Date(event.occurred_at).toLocaleString("ru-RU")}</small></article>`).join("") : `<div class="notice">Отметок пока нет.</div>`}
  `);
  const scale = document.querySelector("#eventScale");
  if (scale) {
    scale.addEventListener("input", () => document.querySelector("#eventValue").textContent = scale.value);
    document.querySelector("#saveEvent").addEventListener("click", async event => {
      const button = event.currentTarget;
      const message = document.querySelector("#eventMessage");
      button.disabled = true;
      try {
        await api("/api/events", { method:"POST", body:JSON.stringify({
          event_type:document.querySelector("#eventType").value,
          value:Number(scale.value),
          note:document.querySelector("#eventNote").value,
          occurred_at:new Date().toISOString()
        })});
        await go("events");
      } catch (error) {
        message.textContent = `Не удалось сохранить: ${error.message}`;
        button.disabled = false;
      }
    });
  }
}
function answerList(answers) {
  return Object.entries(answers || {})
    .filter(([,value]) => value !== "" && value !== null && value !== undefined)
    .map(([key,value]) => `<p><b>${escapeHtml(labels[key] || key)}:</b> ${escapeHtml(value)}</p>`).join("") || "<p>Ответы не заполнены.</p>";
}
function renderHistory(adminMode = false) {
  const entries = historyData.entries || [];
  const eventRows = historyData.events || [];
  shell(`
    <div class="pagehead"><h2>${adminMode ? "Записи Леры" : "История"}</h2><p class="muted">Ежедневные анкеты и внутридневные события показаны раздельно.</p></div>
    <div class="history-section"><h3>Ежедневные анкеты</h3>
      ${entries.length ? entries.map(entry => `<details class="history"><summary><b>${new Date(entry.entry_date+"T12:00:00").toLocaleDateString("ru-RU",{weekday:"short",day:"numeric",month:"long",year:"numeric"})}</b><span>Открыть</span></summary><div class="answers">${answerList(entry.answers)}</div></details>`).join("") : `<div class="notice">Ежедневных записей пока нет.</div>`}
    </div>
    <div class="history-section"><h3>Отметки в течение дня</h3>
      ${eventRows.length ? eventRows.map(event => `<article class="event"><b>${({anxiety:"Тревога",mood:"Настроение",energy:"Энергия",irritability:"Раздражительность",other:"Другое"})[event.event_type] || "Событие"} · ${event.value ?? "—"}/10</b><p>${escapeHtml(event.note)}</p><small>${new Date(event.occurred_at).toLocaleString("ru-RU")}</small></article>`).join("") : `<div class="notice">Внутридневных отметок пока нет.</div>`}
    </div>
    <button class="secondary full" id="printReport">Сформировать недельный отчёт · Печать / PDF</button>
  `);
  document.querySelector("#printReport").addEventListener("click", printWeeklyReport);
}
function printWeeklyReport() {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 6);
  const entries = (historyData.entries || []).filter(e => e.entry_date >= localDate(from) && e.entry_date <= localDate(now)).sort((a,b)=>a.entry_date.localeCompare(b.entry_date));
  const eventsInWeek = (historyData.events || []).filter(e => new Date(e.occurred_at) >= from && new Date(e.occurred_at) <= now);
  const names = { anxiety:"Тревога", mood:"Настроение", energy:"Энергия", irritability:"Раздражительность", other:"Другое" };
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Недельный отчёт</title><style>
    body{font:14px Arial,sans-serif;color:#222;max-width:850px;margin:35px auto;line-height:1.5}
    h1{font-size:24px}h2{font-size:18px;margin-top:26px;border-bottom:1px solid #ddd;padding-bottom:6px}
    .day,.event{border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0;break-inside:avoid}
    .muted{color:#666;font-size:12px}p{margin:5px 0}@media print{button{display:none}body{margin:12mm}}
  </style></head><body><h1>Недельный отчёт о самочувствии</h1>
  <p class="muted">Период: ${localDate(from)} — ${localDate(now)}. Отчёт составлен из записей дневника и не содержит клинических выводов.</p>
  <h2>Ежедневные анкеты (${entries.length})</h2>
  ${entries.length ? entries.map(e=>`<article class="day"><b>${new Date(e.entry_date+"T12:00:00").toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"})}</b>${Object.entries(e.answers||{}).filter(([,v])=>v!==""&&v!==null&&v!==undefined).map(([k,v])=>`<p><b>${escapeHtml(labels[k]||k)}:</b> ${escapeHtml(v)}</p>`).join("")}</article>`).join("") : "<p>За выбранный период ежедневных анкет нет.</p>"}
  <h2>Внутридневные события (${eventsInWeek.length})</h2>
  ${eventsInWeek.length ? eventsInWeek.map(e=>`<article class="event"><b>${names[e.event_type]||"Событие"} · ${e.value??"—"}/10</b><p>${escapeHtml(e.note)}</p><p class="muted">${new Date(e.occurred_at).toLocaleString("ru-RU")}</p></article>`).join("") : "<p>За выбранный период событий нет.</p>"}
  <p class="muted">Оценки и описания приведены в исходном виде. Отметки в течение дня не усреднялись с вечерними ответами.</p>
  <button onclick="window.print()">Печать / Сохранить в PDF</button></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Разреши всплывающее окно для формирования отчёта."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function renderMedications() {
  const medications = medicationsData.medications || [];
  const logs = medicationsData.logs || [];

  const statusNames = {
    pending: "Ожидает отметки",
    taken: "Принято",
    skipped: "Пропущено"
  };

  shell(`
    <div class="pagehead">
      <h2>Лекарства</h2>
      <p class="muted">
        Настрой расписание. Бот будет присылать напоминания
        в Telegram в указанное время.
      </p>
    </div>

    <article class="panel">
      <h3>Добавить лекарство</h3>

      <form id="medForm">
        <label class="field">
          <span>Название препарата</span>
          <input id="medName" maxlength="120"
            placeholder="Название лекарства" required>
        </label>

        <label class="field">
          <span>Инструкция (необязательно)</span>
          <textarea id="medInstructions" maxlength="300"
            rows="2" placeholder="Например, после еды"></textarea>
        </label>

        <label class="field">
          <span>Время приёма</span>
          <input id="medTimes"
            placeholder="09:00, 21:00" required>
          <small class="muted">
            Если приёмов несколько, перечисли время через запятую.
          </small>
        </label>

        <label class="field">
          <span>Часовой пояс</span>
          <select id="medTimezone">
            <option value="Europe/Moscow">Москва</option>
            <option value="Europe/Amsterdam">Амстердам</option>
            <option value="Europe/Berlin">Берлин</option>
            <option value="UTC">UTC</option>
          </select>
        </label>

        <button class="primary full" type="submit">
          Добавить расписание
        </button>
        <p id="medMessage" class="muted"></p>
      </form>
    </article>

    <h3>Мои препараты</h3>

    ${medications.length ? medications.map(m => `
      <article class="panel">
        <div class="medication-head">
          <div>
            <h3>${escapeHtml(m.name)}</h3>
            <p class="muted">
              ${escapeHtml(m.instructions || "Без дополнительных инструкций")}
            </p>
          </div>
          <span class="role">${m.active ? "Активно" : "Отключено"}</span>
        </div>

        <p><b>Время:</b> ${m.times.map(escapeHtml).join(", ")}</p>
        <p class="muted">Часовой пояс: ${escapeHtml(m.timezone)}</p>

        <div class="medication-actions">
          <button class="secondary"
            data-med-toggle="${m.id}"
            data-active="${m.active}">
            ${m.active ? "Отключить" : "Включить"}
          </button>

          <button class="secondary"
            data-med-delete="${m.id}">
            Удалить
          </button>
        </div>
      </article>
    `).join("") : `
      <div class="notice">
        Пока нет добавленных лекарств.
      </div>
    `}

    <h3>История напоминаний</h3>

    ${logs.length ? logs.map(log => `
      <article class="event">
        <b>${statusNames[log.status] || "Неизвестно"}</b>
        <p>${new Date(log.scheduled_for).toLocaleString("ru-RU")}</p>
      </article>
    `).join("") : `
      <div class="notice">
        История приёмов пока пуста.
      </div>
    `}

    <div class="notice">
      Расписание служит напоминанием и не заменяет назначения врача.
      При изменении схемы приёма обновляй расписание вручную.
    </div>
  `);

  document.querySelector("#medForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button[type=submit]");
    const message = document.querySelector("#medMessage");

    const times = document.querySelector("#medTimes").value
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    const payload = {
      name: document.querySelector("#medName").value.trim(),
      instructions: document.querySelector("#medInstructions").value.trim(),
      times,
      timezone: document.querySelector("#medTimezone").value
    };

    button.disabled = true;
    message.textContent = "Сохраняем…";

    try {
      await api("/api/medications", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      await go("medications");
    } catch (error) {
      message.textContent = `Ошибка: ${error.message}`;
      button.disabled = false;
    }
  });

  app.querySelectorAll("[data-med-toggle]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await api("/api/medications", {
          method: "PATCH",
          body: JSON.stringify({
            id: button.dataset.medToggle,
            active: button.dataset.active !== "true"
          })
        });

        await go("medications");
      } catch (error) {
        alert(`Не удалось изменить расписание: ${error.message}`);
        button.disabled = false;
      }
    });
  });

  app.querySelectorAll("[data-med-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Отключить это расписание?")) return;

      button.disabled = true;

      try {
        await api("/api/medications", {
          method: "DELETE",
          body: JSON.stringify({ id: button.dataset.medDelete })
        });

        await go("medications");
      } catch (error) {
        alert(`Ошибка: ${error.message}`);
        button.disabled = false;
      }
    });
  });
}


async function start() {
  if (!tg?.initData) {
    app.innerHTML = `<div class="screen"><h2>Открой дневник через Telegram</h2><p>Авторизация доступна только внутри Telegram Mini App.</p></div>`;
    return;
  }
  tg.ready(); tg.expand();
  app.innerHTML = `<div class="screen"><p>Проверяем доступ…</p></div>`;
  try {
    const response = await fetch("/api/me", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-Telegram-Init-Data":tg.initData},
      body:"{}"
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "AUTHENTICATION_FAILED");
    me = result.user;
    await go("home");
  } catch (error) {
    app.innerHTML = `<div class="screen"><h2>Не удалось открыть дневник</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}
start();
