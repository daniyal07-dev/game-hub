/* ===== GameHub theme switcher (dark / light) ===== */
(function () {
  var KEY = "gamehubTheme";

  // 1. Read the saved choice. Default is DARK because the neon design is made for dark.
  function getSaved() {
    try {
      var t = localStorage.getItem(KEY);
      return t === "light" ? "light" : "dark";
    } catch (e) {
      return "dark";
    }
  }

  // 2. Apply the theme by setting data-theme on the <html> tag. CSS reacts to it.
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = theme === "light" ? "🌙" : "☀️";
      btn.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
      btn.setAttribute("aria-label", btn.title);
    }
  }

  // Run immediately so the page never flashes the wrong color.
  applyTheme(getSaved());

  // 3. Style for the button (kept here so every page gets it automatically).
  function addButtonStyle() {
    var s = document.createElement("style");
    s.textContent =
      "#theme-toggle{cursor:pointer;font-size:1.1rem;line-height:1;width:38px;height:38px;" +
      "border-radius:50%;border:1px solid #00f0ff;background:rgba(0,240,255,0.08);" +
      "color:inherit;margin-left:22px;vertical-align:middle;transition:transform .2s,box-shadow .2s;}" +
      "#theme-toggle:hover{transform:scale(1.12) rotate(15deg);box-shadow:0 0 14px rgba(0,240,255,0.5);}" +
      "html[data-theme='light'] #theme-toggle{border-color:#0077b6;background:rgba(0,119,182,0.1);}" +
      "html[data-theme='light'] #theme-toggle:hover{box-shadow:0 0 14px rgba(0,119,182,0.4);}" +
      "#theme-toggle.floating{position:fixed;top:14px;right:14px;z-index:50;margin:0;}" +
      "@media(max-width:600px){#theme-toggle{margin-left:12px;width:34px;height:34px;}}";
    document.head.appendChild(s);
  }

  // 4. Build the button and put it in the navbar.
  function addButton() {
    if (document.getElementById("theme-toggle")) return;
    addButtonStyle();

    var btn = document.createElement("button");
    btn.id = "theme-toggle";
    btn.type = "button";

    var target = document.querySelector(".navbar nav") || document.querySelector(".nav-links");
    if (!target) {
      btn.className = "floating";
      document.body.appendChild(btn);
    } else if (target.tagName === "UL") {
      var li = document.createElement("li");
      li.appendChild(btn);
      target.appendChild(li);
    } else {
      target.appendChild(btn);
    }

    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      applyTheme(next);
    });

    applyTheme(getSaved());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addButton);
  } else {
    addButton();
  }
})();