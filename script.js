/* Grup Scout Parpalló — script compartit (totes les pàgines) */
(function(){
  "use strict";
  var html=document.documentElement, KEY="parpallo-lang", btn=document.getElementById("lang-toggle");
  html.classList.add("js");

  // idioma: valencià per defecte, recorda l'elecció entre pàgines
  function apply(l){
    html.setAttribute("data-lang", l);
    html.setAttribute("lang", l==="es" ? "es" : "ca-ES-valencia");
    if(btn){
      btn.setAttribute("aria-label", l==="es" ? "Cambiar a valenciano" : "Canvia a castellà");
      var lbl=btn.querySelector(".lbl"); if(lbl) lbl.textContent = l==="es" ? "val" : "cas";
    }
  }
  var saved=null; try{saved=localStorage.getItem(KEY);}catch(e){}
  apply(saved==="es" ? "es" : "va");
  if(btn) btn.addEventListener("click", function(){
    var cur = html.getAttribute("data-lang")==="es" ? "es" : "va";
    var nx = cur==="es" ? "va" : "es";
    apply(nx); try{localStorage.setItem(KEY, nx);}catch(e){}
  });

  // la cova: escenes que entren en fer scroll (immersió) — només a cova.html
  var escenes=document.querySelectorAll(".cova-immersio .escena");
  if(escenes.length){
    if("IntersectionObserver" in window){
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(e){ if(e.isIntersecting) e.target.classList.add("in"); });
      },{threshold:.35});
      escenes.forEach(function(el){ io.observe(el); });
    } else {
      escenes.forEach(function(el){ el.classList.add("in"); });
    }
  }

  // tally: una ratlla per curs des de 1974 — només on hi ha #tally
  var t=document.getElementById("tally");
  if(t){
    var n=new Date().getFullYear()-1974; if(n<1)n=1; if(n>80)n=80;
    var out="";
    for(var i=1;i<=n;i++){ out+='<i'+(i%5===0?' class="fifth"':'')+'></i>'; }
    t.innerHTML=out;
  }
  var y=document.getElementById("year"); if(y) y.textContent=new Date().getFullYear();

  // història: el quadern del grup (passar pàgines) — només on hi ha .quadern
  var quadern=document.querySelector(".quadern");
  if(quadern){
    var fulls=[].slice.call(quadern.querySelectorAll(".full"));
    var prev=quadern.querySelector(".prev"), next=quadern.querySelector(".next");
    var dotsWrap=quadern.querySelector(".dots"), idx=0;
    fulls.forEach(function(f,i){
      var d=document.createElement("button");
      d.type="button"; d.setAttribute("aria-label","Pàgina "+(i+1));
      d.addEventListener("click",function(){ go(i); });
      dotsWrap.appendChild(d);
    });
    var dots=[].slice.call(dotsWrap.children);
    function go(i){
      idx=Math.max(0,Math.min(fulls.length-1,i));
      fulls.forEach(function(f,j){ f.classList.toggle("on", j===idx); });
      dots.forEach(function(d,j){ d.setAttribute("aria-current", j===idx?"true":"false"); });
      if(prev) prev.disabled=(idx===0);
      if(next) next.disabled=(idx===fulls.length-1);
    }
    if(prev) prev.addEventListener("click",function(){ go(idx-1); });
    if(next) next.addEventListener("click",function(){ go(idx+1); });
    quadern.addEventListener("keydown",function(e){
      if(e.key==="ArrowLeft"){ e.preventDefault(); go(idx-1); }
      else if(e.key==="ArrowRight"){ e.preventDefault(); go(idx+1); }
    });
    quadern.classList.add("js-ready");
    go(0);
  }

  // logo de la federació (ASDE — Scouts Valencians) al peu de cada pàgina
  var footFirst=document.querySelector("footer .foot-grid > div:first-child");
  if(footFirst){
    var fed=new Image();
    fed.className="fed-logo"; fed.alt="ASDE — Scouts Valencians"; fed.loading="lazy";
    fed.onload=function(){ footFirst.appendChild(fed); };
    fed.src="img/asde.webp";
  }

  // enllaços encara sense destí: evita el salt i avisa
  document.querySelectorAll('a[data-pend]').forEach(function(a){
    a.addEventListener("click", function(e){ e.preventDefault(); });
  });

  // ===== experiència premium =====
  // barra de progrés + botó "tornar a dalt" + elevació de la capçalera
  var pbar=document.createElement("div"); pbar.className="progress-bar"; document.body.appendChild(pbar);
  var totop=document.createElement("button"); totop.className="to-top"; totop.type="button";
  totop.setAttribute("aria-label","Torna a dalt"); totop.textContent="↑"; document.body.appendChild(totop);
  totop.addEventListener("click",function(){ window.scrollTo({top:0,behavior:"smooth"}); });
  var hdr=document.querySelector("header.top");

  // cierva caminante al bottom del viewport (si no hi ha prefers-reduced-motion)
  // parche estilo pañoleta scout: verde arriba, roig abajo, cérvola blanca a caballo
  var prefersReducedMotion=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!prefersReducedMotion){
    var deerWalker=document.createElement("div");
    deerWalker.className="deer-walker";
    deerWalker.setAttribute("aria-hidden","true");
    // path del parche: forma irregular tipo insignia bordada
    var patchPath="M20 40 C30 18 70 8 120 12 C160 15 200 20 218 42 C232 60 230 88 214 112 C198 134 155 148 110 148 C68 148 30 138 16 118 C4 100 6 66 20 40 Z";
    // usamos el símbolo #cervola ya definido en el HTML (la cierva original del grupo)
    // rellenado de blanco para que resalte sobre el parche verde/rojo
    deerWalker.innerHTML=''
      +'<svg viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg">'
      +  '<defs><clipPath id="patch-clip"><path d="'+patchPath+'"/></clipPath></defs>'
      +  '<g clip-path="url(#patch-clip)">'
      +    '<rect x="0" y="0" width="240" height="95" fill="#2C4636"/>'
      +    '<rect x="0" y="95" width="240" height="65" fill="#A93A2C"/>'
      +  '</g>'
      +  '<path d="'+patchPath+'" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linejoin="round"/>'
      +  '<g transform="translate(10 -20)" style="color:#FFFFFF">'
      +    '<use href="#cervola" width="220" height="180"/>'
      +  '</g>'
      +'</svg>';
    document.body.appendChild(deerWalker);
  }

  function onScroll(){
    var st=window.pageYOffset||document.documentElement.scrollTop||0;
    var max=document.documentElement.scrollHeight-window.innerHeight;
    pbar.style.width=(max>0?(st/max*100):0)+"%";
    if(hdr) hdr.classList.toggle("scrolled", st>8);
    totop.classList.toggle("show", st>window.innerHeight*0.6);

    // mueve la cierva según el progreso del scroll
    if(!prefersReducedMotion){
      var deerWalker=document.querySelector(".deer-walker");
      if(deerWalker){
        var progress=max>0?(st/max):0;
        var viewportWidth=window.innerWidth;
        var deerWidth=60; // ancho de la cierva (en píxeles)
        var maxLeft=viewportWidth-deerWidth;
        var left=progress*maxLeft;
        deerWalker.style.left=left+"px";
      }
    }
  }
  window.addEventListener("scroll",onScroll,{passive:true});
  window.addEventListener("resize",onScroll,{passive:true});
  onScroll();

  // revelat suau en fer scroll
  if(!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) && "IntersectionObserver" in window){
    var sel=[
      ".intro .wrap > *",
      ".seccions > .wrap > .eyebrow",".seccions > .wrap > h2",".seccions > .wrap > .lede",
      ".seccions > .wrap > .hand",".seccions > .wrap > .selfloc",
      ".seccions .grid > *",
      ".cova-teaser .wrap > *",
      ".historia .wrap > *",
      "#alta > .wrap > *",
      ".sec-hero .wrap > *",".sec-content > p",".sec-facts > *",".sec-switcher > *",".sec-cta .wrap > *"
    ].join(",");
    var rObs=new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); rObs.unobserve(e.target); } });
    },{threshold:.12, rootMargin:"0px 0px -7% 0px"});
    document.querySelectorAll(sel).forEach(function(el){
      el.classList.add("reveal");
      var p=el.parentElement;
      if(p && /(grid|sec-facts|switch-grid)/.test(p.className)){
        var idx=Array.prototype.indexOf.call(p.children, el);
        el.style.transitionDelay=(Math.min(idx,4)*0.07)+"s";
      }
      rObs.observe(el);
    });
  }
})();
