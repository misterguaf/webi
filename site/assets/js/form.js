/* Grup Scout Parpalló — enviament del formulari "Fer-se scout".
 *
 * Millora progressiva: si este fitxer no carrega o el JS està desactivat, el
 * formulari segueix funcionant com un POST normal del navegador cap al mateix
 * endpoint, i el servidor respon una pàgina de confirmació mínima.
 *
 * Amb JS actiu, l'enviament és per fetch per a poder:
 *   - mostrar confirmació o error sense recarregar,
 *   - NO perdre mai el que la família ha escrit si falla res,
 *   - anunciar el resultat als lectors de pantalla.
 *
 * Este fitxer només s'inclou a fersescout.html; no toca res de script.js.
 */
(function () {
  "use strict";

  var form = document.querySelector("form.alta");
  if (!form || !window.fetch) return;

  var html = document.documentElement;
  function lang() {
    return html.getAttribute("data-lang") === "es" ? "es" : "va";
  }
  function t(msg) {
    if (!msg) return "";
    return typeof msg === "string" ? msg : msg[lang()] || msg.va || "";
  }

  var TXT = {
    enviant: { va: "Enviant…", es: "Enviando…" },
    xarxa: {
      va: "No hem pogut connectar. Comprova la connexió i torna a provar; les teues dades segueixen ací.",
      es: "No hemos podido conectar. Comprueba la conexión e inténtalo de nuevo; tus datos siguen aquí.",
    },
  };

  /* Marca de temps de càrrega: el servidor descarta enviaments instantanis,
   * que són de bots. Es posa des de JS a propòsit, no a l'HTML, perquè el
   * valor ha de ser el moment real en què esta persona ha obert la pàgina. */
  var ts = form.querySelector('input[name="_ts"]');
  if (ts) ts.value = String(Date.now());

  var boto = form.querySelector('button[type="submit"]');
  var avis = document.getElementById("alta-avis");

  function netejaErrors() {
    form.querySelectorAll("[data-err]").forEach(function (el) {
      el.remove();
    });
    form.querySelectorAll("[aria-invalid]").forEach(function (el) {
      el.removeAttribute("aria-invalid");
      var d = el.getAttribute("aria-describedby");
      if (d) {
        d = d.replace(/\s*err-[\w-]+/g, "").trim();
        if (d) el.setAttribute("aria-describedby", d);
        else el.removeAttribute("aria-describedby");
      }
    });
  }

  /* Pinta l'error just davall del camp i el lliga amb aria-describedby, que és
   * com el lector de pantalla el llig en enfocar l'input. */
  function mostraErrors(errors) {
    var primer = null;
    Object.keys(errors).forEach(function (camp) {
      var el = form.querySelector('[name="' + camp + '"]');
      if (!el) return;
      el.setAttribute("aria-invalid", "true");
      var id = "err-" + camp;
      var p = document.createElement("p");
      p.className = "field-err";
      p.id = id;
      p.setAttribute("data-err", "");
      p.textContent = t(errors[camp]);
      var contenidor = el.closest(".field") || el.closest(".check") || el.parentNode;
      contenidor.appendChild(p);
      var prev = el.getAttribute("aria-describedby");
      el.setAttribute("aria-describedby", prev ? prev + " " + id : id);
      if (!primer) primer = el;
    });
    return primer;
  }

  function avisa(text, tipus) {
    if (!avis) return;
    avis.textContent = text;
    avis.className = "alta-avis " + tipus;
    avis.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    netejaErrors();

    var fd = new FormData(form);
    var dades = {};
    fd.forEach(function (v, k) {
      dades[k] = v;
    });

    // El botó conté els dos idiomes en spans .va/.es: no se li toca el
    // contingut, o es trencaria el canvi d'idioma. L'estat "enviant" s'anuncia
    // a la zona de missatges, que és on el lector de pantalla ja escolta.
    if (boto) {
      boto.disabled = true;
      boto.setAttribute("aria-busy", "true");
    }
    avisa(t(TXT.enviant), "wait");

    fetch(form.getAttribute("action"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify(dades),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, body: j };
        });
      })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          avisa(t(res.body.message), "ok");
          form.reset();
          if (ts) ts.value = String(Date.now());
          if (avis) {
            avis.setAttribute("tabindex", "-1");
            avis.focus();
          }
          return;
        }
        // Error: no es toca cap valor del formulari. Es marquen els camps i
        // s'enfoca el primer, perquè la família sàpiga on ha de corregir.
        avisa(t(res.body.message), "err");
        var primer = res.body.errors ? mostraErrors(res.body.errors) : null;
        if (primer) primer.focus();
        else if (avis) {
          avis.setAttribute("tabindex", "-1");
          avis.focus();
        }
      })
      .catch(function () {
        avisa(t(TXT.xarxa), "err");
      })
      .finally(function () {
        if (boto) {
          boto.disabled = false;
          boto.removeAttribute("aria-busy");
        }
      });
  });
})();
