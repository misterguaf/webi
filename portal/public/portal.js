(function () {
  "use strict";

  var html = document.documentElement;
  var csrf = "";
  var catalog = [];
  var feeConfig = null;
  var MAX_FILE = 4 * 1024 * 1024;
  var FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  var SECTIONS = { EST: "MANADA", TRO: "TROPA", ESC: "ESCOLTA", CLA: "CLAN" };
  var TXT = {
    required: { va: "Este camp fa falta.", es: "Este campo es obligatorio." },
    email: { va: "L'email no és vàlid.", es: "El email no es válido." },
    phone: { va: "El telèfon no és vàlid.", es: "El teléfono no es válido." },
    file: { va: "Adjunta una foto o PDF del comprovant.", es: "Adjunta una foto o PDF del comprobante." },
    fileType: { va: "El comprovant ha de ser JPG, PNG, WEBP o PDF.", es: "El comprobante debe ser JPG, PNG, WEBP o PDF." },
    fileSize: { va: "El comprovant supera el límit de 4 MB.", es: "El comprobante supera el límite de 4 MB." },
    review: { va: "Revisa les dades marcades i torna a provar.", es: "Revisa los datos marcados e inténtalo de nuevo." },
    network: { va: "No hem pogut connectar. Les teues dades segueixen ací.", es: "No hemos podido conectar. Tus datos siguen aquí." },
    sending: { va: "Enviant…", es: "Enviando…" },
    chooseActivity: { va: "Tria una activitat.", es: "Elige una actividad." },
    noActivities: { va: "Ara mateix no hi ha activitats obertes.", es: "Ahora mismo no hay actividades abiertas." },
    chooseSection: { va: "Tria primer la secció.", es: "Elige primero la sección." },
    chooseTransport: { va: "Tria l'opció de transport.", es: "Elige la opción de transporte." },
    noSectionActivities: { va: "No hi ha activitats per a esta secció.", es: "No hay actividades para esta sección." },
    copied: { va: "Referència copiada.", es: "Referencia copiada." },
    unavailable: { va: "Esta activitat ja no està disponible. Recarrega el portal i torna-ho a provar.", es: "Esta actividad ya no está disponible. Recarga el portal e inténtalo de nuevo." }
  };

  function lang() { return html.dataset.lang === "es" ? "es" : "va"; }
  function t(value) { return typeof value === "string" ? value : (value && (value[lang()] || value.va)) || ""; }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2); }
  function money(cents) { return cents % 100 ? (cents / 100).toFixed(2).replace(".", ",") + " €" : cents / 100 + " €"; }
  function dateText(value) { var d = typeof value === "number" ? new Date(value) : new Date(value + "T12:00:00"); return isNaN(d) ? String(value) : new Intl.DateTimeFormat(lang() === "es" ? "es-ES" : "ca-ES", { day: "numeric", month: "long", year: "numeric" }).format(d); }
  function fileBase64(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(String(r.result).split(",")[1] || ""); }; r.onerror = reject; r.readAsDataURL(file); }); }
  function fileError(file) { if (!file) return TXT.file; if (FILE_TYPES.indexOf(file.type) < 0) return TXT.fileType; if (file.size > MAX_FILE) return TXT.fileSize; return null; }
  function validPhone(value) { var digits = value.replace(/\D/g, ""); return digits.length >= 6 && digits.length <= 15; }
  function validEmail(value) { return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value); }

  function applyLang(next) {
    html.dataset.lang = next;
    html.lang = next === "es" ? "es" : "ca-ES-valencia";
    document.querySelector("#lang-toggle .lbl").textContent = next === "es" ? "val" : "cas";
    document.getElementById("lang-toggle").setAttribute("aria-label", next === "es" ? "Cambiar a valenciano" : "Canvia a castellà");
    document.querySelectorAll("option[data-va]").forEach(function (o) { o.textContent = o.dataset[next] || o.dataset.va; });
    paintActivities(); paintActivitySummary(); paintTransport(); paintActivityEvidence(); paintFee(); relabelChildren();
  }

  function clearErrors(form) {
    form.querySelectorAll(".field-error").forEach(function (e) { e.remove(); });
    form.querySelectorAll("[aria-invalid]").forEach(function (e) { e.removeAttribute("aria-invalid"); });
  }
  function fieldError(element, message) {
    if (!element) return null;
    element.setAttribute("aria-invalid", "true");
    var p = document.createElement("p"); p.className = "field-error"; p.textContent = t(message);
    (element.closest(".field") || element.closest(".check") || element.parentNode).appendChild(p);
    return element;
  }
  function alertBox(id, message, type) { var el = document.getElementById(id); el.textContent = t(message); el.className = "alert " + (type || "error"); el.hidden = !message; return el; }
  function serverErrors(form, errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (key) {
      var el = form.elements[key];
      if (!el && key.indexOf("fills.") === 0) {
        var bits = key.split("."); var card = document.querySelectorAll(".child-card")[Number(bits[1])]; el = card && card.querySelector('[data-child="' + bits[2] + '"]');
      }
      var marked = fieldError(el, errors[key]); if (!first) first = marked;
    });
    return first;
  }

  function togglePanel(name, updateHash) {
    ["activitats", "quota"].forEach(function (key) {
      var open = key === name;
      document.getElementById("toggle-" + key).setAttribute("aria-expanded", String(open));
      document.getElementById("panel-" + key).hidden = !open;
    });
    if (updateHash) history.pushState(null, "", name ? "#" + name : location.pathname);
    if (name) setTimeout(function () { var panel = document.getElementById("panel-" + name); panel.scrollIntoView({ block: "start" }); panel.focus({ preventScroll: true }); }, 0);
  }
  ["activitats", "quota"].forEach(function (key) { document.getElementById("toggle-" + key).addEventListener("click", function () { togglePanel(this.getAttribute("aria-expanded") === "true" ? "" : key, true); }); });
  addEventListener("popstate", function () { togglePanel(location.hash === "#quota" ? "quota" : location.hash === "#activitats" ? "activitats" : "", false); });

  var activityForm = document.getElementById("activity-form");
  var section = document.getElementById("activity-section");
  var activity = document.getElementById("activity-id");
  var transport = document.getElementById("activity-transport");
  function closed(a) { return a.registrationDeadline <= Date.now(); }
  function activityName(a) { return a.name; }
  function chosenActivity() { return catalog.find(function (a) { return a.publicCode === activity.value; }); }
  function paintActivities() {
    if (!activity) return;
    var chosen = activity.value; activity.replaceChildren();
    var first = document.createElement("option"); first.value = ""; first.textContent = t(TXT.chooseActivity); activity.appendChild(first);
    var sectionCode = SECTIONS[section.value];
    var list = catalog.filter(function (a) { return a.audience === "GENERAL" || a.sections.indexOf(sectionCode) >= 0; });
    list.forEach(function (a) { var o = document.createElement("option"); o.value = a.publicCode; o.disabled = closed(a); o.textContent = activityName(a) + (o.disabled ? (lang() === "es" ? " — fuera de plazo" : " — fora de termini") : ""); activity.appendChild(o); });
    activity.disabled = !section.value || !list.length;
    if (Array.from(activity.options).some(function (o) { return o.value === chosen && !o.disabled; })) activity.value = chosen;
    document.getElementById("activity-help").textContent = !section.value ? t(TXT.chooseSection) : !list.length ? t(TXT.noSectionActivities) : "";
  }
  function paintActivitySummary() {
    var box = document.getElementById("activity-summary"); var a = chosenActivity(); box.replaceChildren(); box.hidden = !a; if (!a) return;
    [[lang() === "es" ? "Fechas" : "Dates", dateText(a.startsAt) + " – " + dateText(a.endsAt)],
      [lang() === "es" ? "Importe base" : "Import base", money(a.priceCents)],
      [lang() === "es" ? "Inscripción hasta el" : "Inscripció fins al", dateText(a.registrationDeadline)],
      [lang() === "es" ? "Lugar" : "Lloc", a.location]].forEach(function (pair) { var p = document.createElement("p"), b = document.createElement("strong"); b.textContent = pair[0] + ": "; p.append(b, document.createTextNode(pair[1])); box.appendChild(p); });
    if (a.shortDescription) { var description=document.createElement("p"); description.textContent=a.shortDescription; box.appendChild(description); }
    var option=transportOption(a);
    if (!a.transportOptions.length || option) {
      var total=a.priceCents+(option?option.adjustmentCents:0);
      var p=document.createElement("p"),strong=document.createElement("strong");
      strong.textContent=(lang()==="es"?"Total orientativo: ":"Total orientatiu: ");p.append(strong,document.createTextNode(money(total)));box.appendChild(p);
    }
  }
  function transportOption(a) {
    return a && transport.value ? a.transportOptions.find(function (item) { return item.code === transport.value; }) || null : null;
  }
  function paintTransport() {
    var a=chosenActivity(),wrap=document.getElementById("activity-transport-wrap"),chosen=transport.value;
    transport.replaceChildren();
    var first=document.createElement("option");first.value="";first.textContent=lang()==="es"?"Elige una opción":"Tria una opció";transport.appendChild(first);
    if (!a || !a.transportOptions.length) {wrap.hidden=true;transport.required=false;transport.disabled=true;return;}
    a.transportOptions.forEach(function (item) {
      var option=document.createElement("option");option.value=item.code;
      var label=item.code==="GROUP"?(lang()==="es"?"Transporte del grupo":"Transport del grup"):(lang()==="es"?"Transporte familiar":"Transport familiar");
      var total=a.priceCents+item.adjustmentCents;
      option.textContent=label+" ("+(total===0?(lang()==="es"?"gratuito":"gratuït"):money(total))+")";transport.appendChild(option);
    });
    wrap.hidden=false;transport.disabled=false;transport.required=true;
    if (Array.from(transport.options).some(function (option) { return option.value===chosen; })) transport.value=chosen;
  }
  function paintActivityEvidence() {
    var a=chosenActivity(),option=transportOption(a),total=a?a.priceCents+(option?option.adjustmentCents:0):0;
    var required=!!a && total>0,fieldset=document.getElementById("activity-evidence-fieldset"),file=activityForm.elements.comprovant;
    fieldset.hidden=!required;file.required=required;
  }
  section.addEventListener("change", function () { paintActivities(); paintActivitySummary(); paintTransport(); paintActivitySummary(); paintActivityEvidence(); });
  activity.addEventListener("change", function () { paintTransport(); paintActivitySummary(); paintActivityEvidence(); });
  transport.addEventListener("change",function(){paintActivitySummary();paintActivityEvidence();});

  function validateActivity() {
    clearErrors(activityForm); var first = null; function fail(el, msg) { var marked = fieldError(el, msg); if (!first) first = marked; }
    ["participantNom", "participantCognoms", "naixement", "tutor"].forEach(function (n) { if (!activityForm.elements[n].value.trim()) fail(activityForm.elements[n], TXT.required); });
    if (!section.value) fail(section, TXT.required); if (!chosenActivity() || closed(chosenActivity())) fail(activity, TXT.chooseActivity);
    if (chosenActivity() && chosenActivity().transportOptions.length && !transport.value) fail(transport, TXT.chooseTransport);
    if (activityForm.elements.telefon.value.trim() && !validPhone(activityForm.elements.telefon.value)) fail(activityForm.elements.telefon, TXT.phone);
    if (!validEmail(activityForm.elements.email.value)) fail(activityForm.elements.email, TXT.email);
    var a=chosenActivity(),option=transportOption(a),requiresEvidence=!!a && a.priceCents+(option?option.adjustmentCents:0)>0;
    var ferr = requiresEvidence ? fileError(activityForm.elements.comprovant.files[0]) : null; if (ferr) fail(activityForm.elements.comprovant, ferr);
    ["participacio", "privacitat"].forEach(function (n) { if (!activityForm.elements[n].checked) fail(activityForm.elements[n], TXT.required); }); return first;
  }
  activityForm.addEventListener("submit", function (event) {
    event.preventDefault(); alertBox("activity-alert", ""); var first = validateActivity(); if (first) { alertBox("activity-alert", TXT.review); first.focus(); return; }
    var button = document.getElementById("activity-submit"), x = activityForm.elements, file = x.comprovant.files[0]; button.disabled = true; alertBox("activity-alert", TXT.sending, "wait");
    var send=function(base64){return fetch("/api/inscripcio",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","X-CSRF-Token":csrf},body:JSON.stringify({
      participantNom:x.participantNom.value.trim(),participantCognoms:x.participantCognoms.value.trim(),naixement:x.naixement.value,
      seccio:x.seccio.value,activitatId:x.activitatId.value,tutor:x.tutor.value.trim(),telefon:x.telefon.value.trim(),email:x.email.value.trim(),
      transportCode:transport.value||null,participacio:x.participacio.checked,privacitat:x.privacitat.checked,idioma:lang(),
      idempotencyKey:x.idempotencyKey.value,malnom:x.malnom.value,_ts:x._ts.value,
      ...(base64?{comprovant:{nom:file.name,tipus:file.type,base64}}:{})})});};
    (requiresEvidence?fileBase64(file).then(send):Promise.resolve(send(null))).then(parseResponse).then(function (result) {
      if (result.status === 401) return location.reload(); if (result.status === 202 && result.body.ok) { activityForm.hidden = true; document.getElementById("activity-success-name").textContent = activityName(chosenActivity()); document.getElementById("activity-success").hidden = false; document.getElementById("activity-success").focus(); return; }
      if(result.body.code==="activity_unavailable" || result.body.code==="registration_closed") result.body.message=TXT.unavailable;
      clearErrors(activityForm); var marked = serverErrors(activityForm, result.body.errors); alertBox("activity-alert", result.body.message || TXT.review); (marked || document.getElementById("activity-alert")).focus();
    }).catch(function () { alertBox("activity-alert", TXT.network).focus(); }).finally(function () { button.disabled = false; });
  });

  var feeForm = document.getElementById("fee-form"), children = document.getElementById("fee-children");
  function addChild() { if (children.children.length >= 8) return; children.appendChild(document.getElementById("child-template").content.cloneNode(true)); relabelChildren(); paintFee(); }
  function relabelChildren() { Array.from(children.children).forEach(function (card, i) { card.querySelector("h3").textContent = (lang() === "es" ? "Niño o niña " : "Xiquet o xiqueta ") + (i + 1); card.querySelector(".remove-child").hidden = children.children.length === 1; card.querySelectorAll("[data-child]").forEach(function (el) { el.name = "fills." + i + "." + el.dataset.child; el.id = "fee-child-" + i + "-" + el.dataset.child; var label = el.parentNode.querySelector("label"); if (label) label.htmlFor = el.id; }); }); }
  function paintFee() {
    if (!feeConfig || !feeConfig.oberta) return;
    document.getElementById("fee-option-copy").textContent = (lang() === "es" ? "Pago del curso " : "Pagament del curs ") + feeConfig.curs + ".";
    document.getElementById("fee-summary").textContent = (lang() === "es" ? "Cuota base: " : "Quota base: ") + money(feeConfig.baseCents) +
      (lang() === "es" ? ". Desde el tercer hermano, descuento del 50 % cuando Tesorería confirme la agrupación familiar. El importe final se calcula en el servidor."
        : ". Des del tercer germà, descompte del 50 % quan Tresoreria confirme l'agrupació familiar. L'import final es calcula al servidor.");
    document.getElementById("fee-instructions").textContent = (lang() === "es" ? "Titular: " : "Titular: ") + feeConfig.accountHolder +
      "\nIBAN: " + feeConfig.iban + "\n" + (lang() === "es" ? "Concepto: " : "Concepte: ") + feeConfig.conceptTemplate +
      (feeConfig.deadlineAt ? "\n" + (lang() === "es" ? "Fecha orientativa: " : "Data orientativa: ") + dateText(feeConfig.deadlineAt) : "");
  }
  document.getElementById("add-child").addEventListener("click", addChild); children.addEventListener("click", function (event) { var button = event.target.closest(".remove-child"); if (button && children.children.length > 1) { button.closest(".child-card").remove(); relabelChildren(); paintFee(); } });
  function validateFee() {
    clearErrors(feeForm); var first = null; function fail(el, msg) { var marked = fieldError(el, msg); if (!first) first = marked; }
    children.querySelectorAll("[data-child]").forEach(function (el) { if (!el.value.trim()) fail(el, TXT.required); });
    if (!feeForm.elements.tutor.value.trim()) fail(feeForm.elements.tutor, TXT.required); if (feeForm.elements.telefon.value.trim() && !validPhone(feeForm.elements.telefon.value)) fail(feeForm.elements.telefon, TXT.phone); if (!validEmail(feeForm.elements.email.value)) fail(feeForm.elements.email, TXT.email);
    if (feeForm.elements.declaredAmount.value && (!Number.isFinite(Number(feeForm.elements.declaredAmount.value)) || Number(feeForm.elements.declaredAmount.value)<=0)) fail(feeForm.elements.declaredAmount, TXT.review);
    var ferr = fileError(feeForm.elements.comprovant.files[0]); if (ferr) fail(feeForm.elements.comprovant, ferr); if (!feeForm.elements.privacitat.checked) fail(feeForm.elements.privacitat, TXT.required); return first;
  }
  feeForm.addEventListener("submit", function (event) {
    event.preventDefault(); alertBox("fee-alert", ""); var first = validateFee(); if (first) { alertBox("fee-alert", TXT.review); first.focus(); return; }
    var button = document.getElementById("fee-submit"), x = feeForm.elements, file = x.comprovant.files[0]; button.disabled = true; alertBox("fee-alert", TXT.sending, "wait");
    var fills = Array.from(children.children).map(function (card) { return { nom: card.querySelector('[data-child="nom"]').value.trim(), cognoms: card.querySelector('[data-child="cognoms"]').value.trim(), naixement: card.querySelector('[data-child="naixement"]').value, seccio: card.querySelector('[data-child="seccio"]').value }; });
    fileBase64(file).then(function (base64) { return fetch("/api/cuota", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ fills: fills, tutor: x.tutor.value.trim(), telefon: x.telefon.value.trim(), email: x.email.value.trim(), privacitat: x.privacitat.checked, idioma: lang(), roundCode: feeConfig.curs, declaredAmountCents: x.declaredAmount.value ? Math.round(Number(x.declaredAmount.value) * 100) : null, idempotencyKey: x.idempotencyKey.value, malnom: x.malnom.value, _ts: x._ts.value, comprovant: { nom: file.name, tipus: file.type, base64: base64 } }) }); }).then(parseResponse).then(function (result) {
      if (result.status === 401) return location.reload(); if (result.status === 202 && result.body.ok) { feeForm.hidden = true; document.getElementById("fee-reference").textContent = result.body.referencia || ""; document.getElementById("fee-success").hidden = false; document.getElementById("fee-success").focus(); return; }
      clearErrors(feeForm); var marked = serverErrors(feeForm, result.body.errors); alertBox("fee-alert", result.body.message || TXT.review); (marked || document.getElementById("fee-alert")).focus();
    }).catch(function () { alertBox("fee-alert", TXT.network).focus(); }).finally(function () { button.disabled = false; });
  });

  function parseResponse(response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); }
  document.querySelectorAll(".copy-reference").forEach(function (button) { button.addEventListener("click", function () { var value = document.getElementById(button.dataset.target).textContent; if (navigator.clipboard && value) navigator.clipboard.writeText(value).then(function () { button.textContent = t(TXT.copied); }); }); });
  document.getElementById("logout").addEventListener("click", function () { fetch("/api/portal/session", { method: "DELETE", headers: { "X-CSRF-Token": csrf } }).finally(function () { location.replace("/"); }); });
  document.getElementById("lang-toggle").addEventListener("click", function () { var next = lang() === "es" ? "va" : "es"; try { localStorage.setItem("parpallo-lang", next); } catch (_) {} applyLang(next); });
  document.getElementById("year").textContent = new Date().getFullYear();
  addChild();
  try { applyLang(localStorage.getItem("parpallo-lang") === "es" ? "es" : "va"); } catch (_) { applyLang("va"); }
  activityForm.elements._ts.value = feeForm.elements._ts.value = String(Date.now()); activityForm.elements.idempotencyKey.value = uuid(); feeForm.elements.idempotencyKey.value = uuid();
  Promise.all([fetch("/api/portal/session").then(parseResponse), fetch("/api/portal/config").then(parseResponse)]).then(function (responses) {
    if (responses[0].status !== 200 || responses[1].status !== 200) return location.reload(); csrf = responses[0].body.csrf; catalog = responses[1].body.activitats || []; feeConfig = responses[1].body.quota;
    var open = catalog.filter(function (a) { return !closed(a); }); document.getElementById("activities-loading").hidden = open.length > 0; if (!open.length) document.getElementById("activities-loading").textContent = t(TXT.noActivities); activityForm.hidden = open.length === 0; paintActivities();
    document.getElementById("fee-closed").hidden = feeConfig.oberta; feeForm.hidden = !feeConfig.oberta;
    paintFee();
    togglePanel(location.hash === "#quota" ? "quota" : location.hash === "#activitats" ? "activitats" : "", false);
  }).catch(function () { location.reload(); });
})();
