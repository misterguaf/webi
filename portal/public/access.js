(function () {
  "use strict";
  var html = document.documentElement;
  var toggleLang = document.getElementById("lang-toggle");
  var form = document.getElementById("login-form");
  var input = document.getElementById("password");
  var show = document.getElementById("toggle-password");
  var submit = document.getElementById("login-submit");
  var alert = document.getElementById("login-alert");

  function lang() { return html.getAttribute("data-lang") === "es" ? "es" : "va"; }
  function apply(l) {
    html.setAttribute("data-lang", l);
    html.setAttribute("lang", l === "es" ? "es" : "ca-ES-valencia");
    toggleLang.querySelector(".lbl").textContent = l === "es" ? "val" : "cas";
    toggleLang.setAttribute("aria-label", l === "es" ? "Cambiar a valenciano" : "Canvia a castellà");
  }
  var saved = "va";
  try { saved = localStorage.getItem("parpallo-lang") === "es" ? "es" : "va"; } catch (_) {}
  apply(saved);
  toggleLang.addEventListener("click", function () {
    var next = lang() === "es" ? "va" : "es";
    apply(next);
    try { localStorage.setItem("parpallo-lang", next); } catch (_) {}
  });

  show.addEventListener("click", function () {
    var visible = input.type === "text";
    input.type = visible ? "password" : "text";
    show.setAttribute("aria-pressed", visible ? "false" : "true");
    show.innerHTML = visible
      ? '<span class="va">Mostrar</span><span class="es">Mostrar</span>'
      : '<span class="va">Amagar</span><span class="es">Ocultar</span>';
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    alert.hidden = true;
    if (!input.value) {
      alert.textContent = lang() === "es" ? "Escribe la contraseña." : "Escriu la contrasenya.";
      alert.hidden = false;
      input.focus();
      return;
    }
    submit.disabled = true;
    fetch("/api/portal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password: input.value }),
    })
      .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
      .then(function (result) {
        if (result.status === 200 && result.body.ok) {
          location.replace("/");
          return;
        }
        var message = result.body && result.body.message;
        alert.textContent = message ? (message[lang()] || message.va) : (lang() === "es" ? "No hemos podido abrir el portal." : "No hem pogut obrir el portal.");
        alert.hidden = false;
        alert.focus();
      })
      .catch(function () {
        alert.textContent = lang() === "es" ? "No hay conexión. Inténtalo de nuevo." : "No hi ha connexió. Torna-ho a provar.";
        alert.hidden = false;
        alert.focus();
      })
      .finally(function () { submit.disabled = false; });
  });
})();
