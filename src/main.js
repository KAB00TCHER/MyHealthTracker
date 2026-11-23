
import "./style.css";

const tg = window.Telegram?.WebApp;
const app = document.querySelector("#app");

function showError(title, description) {
  app.innerHTML = `
    <div class="screen">
      <div class="icon">!</div>
      <h2>${title}</h2>
      <p>${description}</p>
    </div>
  `;
}

async function startApp() {
  if (!tg || !tg.initData) {
    showError(
      "Открой приложение через Telegram",
      "Дневник работает внутри Telegram Mini App. Открой его через кнопку бота."
    );
    return;
  }

  tg.ready();
  tg.expand();

  app.innerHTML = `
    <div class="screen">
      <div class="spinner"></div>
      <p>Проверяем доступ и подключаем дневник...</p>
    </div>
  `;

  try {
    const response = await fetch("/api/me", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData
      },
      body: "{}"
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Не удалось авторизоваться");
    }

    const name = escapeHTML(result.user.firstName);
    const role = result.user.role;

    app.innerHTML = `
      <main class="dashboard">

        <header>
          <div>
            <div class="eyebrow">ЛИЧНЫЙ ДНЕВНИК</div>
            <h1>Здравствуйте, ${name}</h1>
            <p class="subtitle">Ваше пространство для наблюдения за самочувствием.</p>
          </div>
          <div class="avatar">Л</div>
        </header>

        <section class="welcome">
          <div class="welcome-icon">✦</div>
          <h2>Добро пожаловать</h2>
          <p>
            Здесь будут храниться ежедневные записи,
            изменения состояния и недельные отчёты.
          </p>
        </section>

        <section class="status-card">
          <div class="section-heading">Состояние системы</div>

          <div class="status-row">
            <span>Telegram авторизация</span>
            <span class="status-ok">Работает</span>
          </div>

          <div class="status-row">
            <span>Supabase</span>
            <span class="status-ok">Подключена</span>
          </div>

          <div class="status-row">
            <span>Ваш уровень доступа</span>
            <span class="status-ok">
              ${role === "admin" ? "Администратор" : "Пользователь"}
            </span>
          </div>
        </section>

        <section class="empty-card">
          <div class="empty-icon">♡</div>
          <h3>Дневник готовится</h3>
          <p>
            Скоро здесь появятся ежедневные анкеты,
            быстрые отметки состояния и история наблюдений.
          </p>
        </section>

        <footer>
          Дневник самочувствия · Версия 1.0
        </footer>

      </main>
    `;

  } catch (error) {
    console.error(error);

    showError(
      "Не удалось открыть дневник",
      "Проверь подключение к интернету и повтори запуск. Если проблема сохраняется, сообщи администратору."
    );
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

startApp();
