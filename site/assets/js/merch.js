/* Grup Scout Parpalló — botiga del grup (merchandising.html).
 *
 * Millora progressiva, igual que form.js: sense este fitxer el formulari
 * segueix sent un POST natiu cap a /api/reserva amb els camps qt-*, i el
 * servidor respon una pàgina de confirmació mínima. Amb JS actiu s'afig:
 *   - botons − / + per a les quantitats,
 *   - el total calculat en viu mentres es tria,
 *   - l'enviament per fetch, sense recarregar ni perdre res.
 *
 * IMPORTANT: el total que es pinta ací és orientatiu, per a que la família
 * sàpiga a què atendre's. El total de veritat el calcula el servidor amb els
 * preus de api/_lib/productes.js; este fitxer no és cap font d'autoritat.
 */
(function () {
  "use strict";

  var form = document.querySelector("form.merch-form");
  if (!form) return;

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
      va: "No hem pogut connectar. Comprova la connexió i torna a provar; el que has triat segueix ací.",
      es: "No hemos podido conectar. Comprueba la conexión e inténtalo de nuevo; lo que has elegido sigue aquí.",
    },
    buit: { va: "Encara no has triat res.", es: "Todavía no has elegido nada." },
    article: { va: "article", es: "artículo" },
    articles: { va: "articles", es: "artículos" },
  };

  var MAX = 20;

  var resum = document.getElementById("resum");
  var resumText = document.getElementById("resum-text");
  var llista = document.getElementById("comanda-llista");
  var buit = document.getElementById("comanda-buit");
  var totalCaixa = document.getElementById("comanda-total");
  var totalImport = document.getElementById("comanda-total-imp");
  var avis = document.getElementById("alta-avis");
  var boto = form.querySelector('button[type="submit"]');

  var ts = form.querySelector('input[name="_ts"]');
  if (ts) ts.value = String(Date.now());

  /* Mateix format que preuText() del servidor: 2000 -> "20 €", 150 -> "1,50 €". */
  function preuText(centims) {
    return centims % 100 === 0
      ? centims / 100 + " €"
      : (centims / 100).toFixed(2).replace(".", ",") + " €";
  }

  function linies() {
    var out = [];
    form.querySelectorAll(".prod").forEach(function (card) {
      var input = card.querySelector('input[type="number"]');
      if (!input) return;
      var qt = parseInt(input.value, 10);
      if (!isFinite(qt) || qt <= 0) return;
      var preu = parseInt(card.getAttribute("data-preu"), 10) || 0;
      var titol = card.querySelector("h3");
      // El títol porta els dos idiomes en spans .va/.es; s'agafa el visible.
      var nom = titol ? (titol.querySelector("span." + lang()) || titol).textContent.trim() : "";
      out.push({ nom: nom, qt: qt, preu: preu, subtotal: preu * qt });
    });
    return out;
  }

  function pinta() {
    var ls = linies();
    var total = 0;
    var unitats = 0;
    ls.forEach(function (l) {
      total += l.subtotal;
      unitats += l.qt;
    });

    // Marca visual de les targetes amb unitats triades.
    form.querySelectorAll(".prod").forEach(function (card) {
      var input = card.querySelector('input[type="number"]');
      var qt = input ? parseInt(input.value, 10) : 0;
      card.classList.toggle("te-unitats", isFinite(qt) && qt > 0);
    });

    // Barra flotant.
    if (resum) resum.classList.toggle("buida", ls.length === 0);
    if (resumText) {
      if (ls.length === 0) {
        resumText.textContent = t(TXT.buit);
      } else {
        resumText.innerHTML =
          "<b>" + unitats + "</b> " +
          (unitats === 1 ? t(TXT.article) : t(TXT.articles)) +
          " · <b>" + preuText(total) + "</b>";
      }
    }

    // Resum dins del formulari.
    if (llista) {
      llista.innerHTML = "";
      ls.forEach(function (l) {
        var li = document.createElement("li");
        var esq = document.createElement("span");
        esq.textContent = l.qt + " × " + l.nom;
        var dre = document.createElement("span");
        dre.className = "imp";
        dre.textContent = preuText(l.subtotal);
        li.appendChild(esq);
        li.appendChild(dre);
        llista.appendChild(li);
      });
    }
    if (buit) buit.hidden = ls.length > 0;
    if (totalCaixa) totalCaixa.hidden = ls.length === 0;
    if (totalImport) totalImport.textContent = preuText(total);
  }

  /* --- botons − / + i escriptura directa --- */
  form.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-mes], button[data-menys]");
    if (!b) return;
    var input = b.parentNode.querySelector('input[type="number"]');
    if (!input) return;
    var qt = parseInt(input.value, 10);
    if (!isFinite(qt) || qt < 0) qt = 0;
    qt += b.hasAttribute("data-mes") ? 1 : -1;
    if (qt < 0) qt = 0;
    if (qt > MAX) qt = MAX;
    input.value = String(qt);
    pinta();
  });

  form.addEventListener("input", function (e) {
    if (e.target.type !== "number") return;
    var qt = parseInt(e.target.value, 10);
    // Mentres escriuen es deixa el camp en pau (podrien estar a mig escriure);
    // només es corregix el que ja és impossible.
    if (isFinite(qt) && qt > MAX) e.target.value = String(MAX);
    if (isFinite(qt) && qt < 0) e.target.value = "0";
    pinta();
  });

  /* --- enviament --- */
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

  function mostraErrors(errors) {
    var primer = null;
    Object.keys(errors).forEach(function (camp) {
      // "articles" no és cap camp del formulari: és un error de la comanda
      // sencera i s'anuncia només a la zona de missatges.
      if (camp === "articles") return;
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

  if (!window.fetch) {
    pinta();
    return; // sense fetch, el POST natiu del navegador fa la faena
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    netejaErrors();

    var fd = new FormData(form);
    var dades = {};
    fd.forEach(function (v, k) {
      dades[k] = v;
    });

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
          // El total que s'ensenya és el que ha calculat el servidor.
          var msg = t(res.body.message);
          if (res.body.total) msg += " (" + res.body.total + ")";
          avisa(msg, "ok");
          form.reset();
          pinta();
          if (ts) ts.value = String(Date.now());
          if (avis) {
            avis.setAttribute("tabindex", "-1");
            avis.focus();
          }
          return;
        }
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

  // El canvi d'idioma repinta el resum: els noms dels articles venen del DOM.
  var langBtn = document.getElementById("lang-toggle");
  if (langBtn) langBtn.addEventListener("click", function () { setTimeout(pinta, 0); });

  pinta();
})();
