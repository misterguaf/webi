/* Grup Scout Parpalló — moviment de la cérvola de la portada.
 *
 * Al fer scroll cap avall, la cérvola de fons s'aparta suaument fins al
 * mateix costat esquerre del viewport i s'encongix un poc, per a deixar
 * respirar el text i el que ve després. En tornar a dalt torna al seu lloc.
 *
 * Fitxer a banda i càrrega només a index.html: styles.css i script.js no es
 * toquen. Els efectes viuen ací per a no gastar cap classe al CSS global.
 */
(function () {
  "use strict";
  var art = document.querySelector(".portada-art img");
  var text = document.querySelector(".portada-inner");
  var portada = document.querySelector(".portada");
  if (!art || !portada) return;

  // Respecta la preferència del sistema de reduir moviment.
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  art.style.transition = "transform .8s cubic-bezier(.2,.7,.2,1)";
  art.style.willChange = "transform";

  // El scale s'ancora al borde esquerre; així, encongir NO separa la imatge
  // del costat i el translateX que apliquem després dona la posició exacta.
  art.style.transformOrigin = "left center";

  if (text) {
    text.style.transition = "transform .8s cubic-bezier(.2,.7,.2,1)";
    text.style.willChange = "transform";
  }

  var ESCALA = 0.82;
  var UMBRAL = 60;      // píxels de scroll: "un poc al baixar"
  var apartada = false;
  var xBase = 0;        // on està el borde esquerre de la imatge sense transform

  function mesuraBase() {
    var abans = art.style.transform;
    art.style.transform = "";
    xBase = art.getBoundingClientRect().left;
    art.style.transform = abans;
  }

  function actualitza() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var toca = y > UMBRAL;
    if (toca === apartada) return;
    apartada = toca;
    if (toca) {
      // -xBase deixa el borde esquerre visual just al 0 del viewport,
      // tant si la imatge cabia dins com si sobreeixia (xBase negativa).
      art.style.transform = "translateX(" + -xBase + "px) scale(" + ESCALA + ")";
      // El text NO s'apega al borde: només s'aparta un poc, proporcional al
      // viewport (6vw = un pas amb el que respira sense arrimar-se massa).
      if (text) text.style.transform = "translateX(6vw)";
    } else {
      art.style.transform = "";
      if (text) text.style.transform = "";
    }
  }

  mesuraBase();
  window.addEventListener("scroll", actualitza, { passive: true });
  window.addEventListener("resize", function () {
    mesuraBase();
    // Al redimensionar amb la imatge ja apartada, tornem a aplicar-la amb la
    // nova base perquè no quede desalineada del nou borde del viewport.
    if (apartada) {
      art.style.transform = "translateX(" + -xBase + "px) scale(" + ESCALA + ")";
    }
  }, { passive: true });
  actualitza();
})();

/* ---------------------------------------------------------------------------
 * On comença a enfosquir-se el fons.
 *
 * El degradat del cos manté el verd del grup pla fins al quadern del grup i a
 * partir d'ahí baixa cap al verd fosc. El punt de canvi és una posició del
 * document, no una mesura fixa: l'alçària de la pàgina canvia sola quan
 * carreguen els incrustats d'Instagram, que ocupen el que ocupen.
 *
 * Per això es calcula ací i es deixa a la variable CSS --fosc-des. Si este
 * fitxer no s'executa, styles.css ja porta un valor de reserva raonable.
 * ------------------------------------------------------------------------ */
(function () {
  "use strict";
  var quadern = document.getElementById("historia");
  if (!quadern) return;

  function calcula() {
    var alt = document.documentElement.scrollHeight;
    if (!alt) return;
    var dalt = quadern.getBoundingClientRect().top + (window.pageYOffset || 0);
    var pct = (dalt / alt) * 100;
    // Marge de seguretat: ni just al principi ni tan avall que no es note.
    if (pct < 25) pct = 25;
    if (pct > 85) pct = 85;
    document.body.style.setProperty("--fosc-des", pct.toFixed(1) + "%");
  }

  calcula();
  window.addEventListener("resize", calcula, { passive: true });
  window.addEventListener("load", calcula);

  // Els incrustats d'Instagram canvien d'alçària quan acaben de carregar-se;
  // ResizeObserver ho detecta sense haver d'anar preguntant amb un temporitzador.
  if ("ResizeObserver" in window) {
    new ResizeObserver(calcula).observe(document.body);
  } else {
    setTimeout(calcula, 2000);
    setTimeout(calcula, 6000);
  }
})();
