/* Grup Scout Parpalló — mode presentació de la Cova.
 *
 * Les 4 primeres escenes es passen com diapositives amb cross-fade dins d'un
 * "escenari" sticky. La 5a (l'escena final "Per això ens diem Parpalló") es
 * queda FORA de la presentació: apareix amb scroll natural després de les
 * diapositives, i el text i el mapa hi entren proporcionalment al scroll,
 * sedosament, en compte de fer un salt binari.
 *
 * Fitxer a banda i càrrega només a cova.html: script.js i styles.css no es
 * toquen. El fade i el layout els fa cova.css; ací només s'orquestren les
 * classes i les variables CSS.
 */
(function () {
  "use strict";
  var seccio = document.querySelector(".cova-immersio");
  if (!seccio) return;

  var totes = [].slice.call(seccio.querySelectorAll(".escena"));
  if (totes.length < 2) return;

  var final = seccio.querySelector(".escena-final");
  var enPres = totes.filter(function (e) { return e !== final; });
  if (enPres.length < 1 || !final) return;

  // Contenidor de scroll de la presentació (altura = 100vh × nombre d'escenes),
  // dins del qual l'escenari es queda sticky mentres van passant les diapositives.
  var wrap = document.createElement("div");
  wrap.className = "pres-wrap";
  var escenari = document.createElement("div");
  escenari.className = "escenari";
  wrap.appendChild(escenari);
  seccio.insertBefore(wrap, enPres[0]);
  enPres.forEach(function (e) { escenari.appendChild(e); });
  // La escena final s'ha quedat com a germana del pres-wrap, en el flux normal.

  // Trau el crumb fora de la primera escena i el pega al escenari, perquè
  // continue visible i clicable durant tota la presentació.
  var crumb = escenari.querySelector(".escena .crumb");
  if (crumb) escenari.insertBefore(crumb, escenari.firstChild);

  seccio.classList.add("pres");

  // ----------------------------------------------------------------
  // Mapa amb "click-to-load" a l'escena final.
  // No es carrega res de Google fins que la persona prem el botó.
  // ----------------------------------------------------------------
  if (!final.querySelector(".mapa")) {
    var mapa = document.createElement("div");
    mapa.className = "mapa";

    var previa = document.createElement("div");
    previa.className = "mapa-prev";
    previa.innerHTML = ''
      + '<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      +   '<path d="M40 130 Q 90 85, 145 115 Q 170 140, 150 165 Q 100 185, 55 168 Z" fill="currentColor" opacity=".1"/>'
      +   '<path d="M280 10 C 285 60, 273 100, 288 140 Q 300 185, 282 210" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>'
      +   '<path d="M235 155 Q 185 120, 130 145 T 68 155" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" opacity=".45"/>'
      +   '<circle cx="235" cy="155" r="3.5" fill="currentColor"/>'
      +   '<circle cx="68" cy="155" r="3.5" fill="currentColor"/>'
      +   '<circle cx="52" cy="180" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/>'
      +   '<path d="M45 173 L59 187 M45 187 L59 173" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '</svg>';

    var boto = document.createElement("button");
    boto.type = "button";
    boto.className = "mapa-carrega";
    boto.innerHTML = '<span class="va">Mostra el mapa</span><span class="es">Mostrar el mapa</span>';

    var avis = document.createElement("p");
    avis.className = "mapa-avis";
    avis.innerHTML = ''
      + '<span class="va">S\'obri en Google Maps. En prémer, es carrega des dels seus servidors i li arriba la teua adreça IP.</span>'
      + '<span class="es">Se abre en Google Maps. Al pulsar, se carga desde sus servidores y le llega tu dirección IP.</span>';

    previa.appendChild(boto);
    previa.appendChild(avis);
    mapa.appendChild(previa);

    boto.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      // Buscar per nom: Google localitza la cova com si algú l'haguera cercada.
      iframe.src = "https://maps.google.com/maps?q=Cova+del+Parpall%C3%B3,+Barx,+Val%C3%A8ncia&t=k&z=16&output=embed";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.title = "Cova del Parpalló, Paratge Natural Parpalló-Borrell, Barx";
      iframe.setAttribute("allowfullscreen", "");
      mapa.innerHTML = "";
      mapa.appendChild(iframe);
      mapa.classList.add("mapa-obert");
    });

    final.appendChild(mapa);
  }

  // ----------------------------------------------------------------
  // Scroll: dos càlculs independents.
  //   1) Progrés dins de la presentació → assigna .on a la escena que toca.
  //   2) Progrés d'entrada de l'escena final → variable CSS --pres per a
  //      esllavissar text i mapa suaument segons baixa el scroll.
  // ----------------------------------------------------------------
  function actualitza() {
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;

    // Presentació
    var rw = wrap.getBoundingClientRect();
    var tramPres = wrap.offsetHeight - vh;
    var progresPres = tramPres > 0 ? Math.max(0, Math.min(1, -rw.top / tramPres)) : 0;
    var actual = Math.min(enPres.length - 1, Math.floor(progresPres * enPres.length));
    enPres.forEach(function (e, i) { e.classList.toggle("on", i === actual); });

    // Escena final: entra proporcionalment mentres el seu top va de 90% a 25% del viewport.
    var rf = final.getBoundingClientRect();
    var start = vh * 0.9;
    var end = vh * 0.25;
    var p = start === end ? 0 : (start - rf.top) / (start - end);
    p = Math.max(0, Math.min(1, p));
    final.style.setProperty("--pres", p.toFixed(3));
  }

  window.addEventListener("scroll", actualitza, { passive: true });
  window.addEventListener("resize", actualitza, { passive: true });
  actualitza();
})();
