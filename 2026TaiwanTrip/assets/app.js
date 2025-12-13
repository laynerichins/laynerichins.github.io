const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmtLong(d){
  return new Intl.DateTimeFormat(undefined, {weekday:"long", month:"long", day:"numeric", year:"numeric"}).format(d);
}
function fmtShort(d){
  return new Intl.DateTimeFormat(undefined, {weekday:"short", month:"short", day:"numeric"}).format(d);
}
function addDays(date, n){
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}



function resolveUrl(path){
  try {
    return new URL(path, window.location.href).toString();
  } catch(e){
    return path;
  }
}

function imgFallback(imgEl){
  if(!imgEl) return;
  imgEl.addEventListener("error", () => {
    imgEl.style.display = "none";
    const parent = imgEl.parentElement;
    if(parent && !parent.querySelector(".imgFallback")){
      const fb = document.createElement("div");
      fb.className = "imgFallback";
      fb.textContent = "Image unavailable";
      parent.appendChild(fb);
    }
  });
}
async function loadData(){
  const res = await fetch(resolveUrl("./assets/trip.json"));
  return await res.json();
}

function makeWeeks({year, startWed, endWed}){
  const start = new Date(`${startWed}T12:00:00`);
  const end = new Date(`${endWed}T12:00:00`);
  const weeks = [];
  for(let d = new Date(start); d <= end; d = addDays(d, 7)) weeks.push(new Date(d.getTime()));
  return weeks;
}

function safeLink(url){
  if(!url) return "";
  return url;
}

function buildHero(data){
  const hero = $("#heroImg");
  const caption = $("#heroCaption");
  const thumbs = $("#thumbs");

  thumbs.innerHTML = "";
  const imgs = data.heroImages || [];
  let idx = Math.floor(Math.random() * imgs.length);

  function set(i){
    idx = i;
    const it = imgs[idx];
    hero.src = resolveUrl(it.src);
    imgFallback(hero);
    hero.alt = it.alt || "Photo";
    caption.innerHTML = `${it.caption || ""}<span>${it.alt || ""}</span>`;
    $$(".thumbBtn").forEach((b, bi) => b.classList.toggle("active", bi === idx));
  }

  imgs.forEach((it, i) => {
    const btn = document.createElement("button");
    btn.className = "thumbBtn";
    btn.type = "button";
    btn.innerHTML = `<img src="${resolveUrl(it.src)}" alt="${it.alt || "Photo"}" loading="lazy" />`;
    btn.addEventListener("click", () => set(i));
    thumbs.appendChild(btn);
  });

  set(idx);

  // Optional auto-rotate (gentle)
  let timer = setInterval(() => set((idx + 1) % imgs.length), 6500);
  $("#gallery").addEventListener("mouseenter", () => { clearInterval(timer); });
  $("#gallery").addEventListener("mouseleave", () => { timer = setInterval(() => set((idx + 1) % imgs.length), 6500); });
}

function buildWeekSelect(weeks){
  const sel = $("#weekSelect");
  sel.innerHTML = "";
  weeks.forEach(w => {
    const arrive = addDays(w, 2);
    const ret = addDays(w, 9);
    const opt = document.createElement("option");
    opt.value = w.toISOString().slice(0,10);
    opt.textContent = `Depart Wed ${fmtShort(w)} → Return Fri ${fmtShort(ret)} (Arrive Taiwan Fri ${fmtShort(arrive)})`;
    sel.appendChild(opt);
  });
}

function buildDaySelect(days, startDate){
  const sel = $("#daySelect");
  sel.innerHTML = "";
  days.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${d.title} • ${fmtShort(addDays(startDate, i))}`;
    sel.appendChild(opt);
  });
}

function renderStays(stays){
  const grid = $("#staysGrid");
  grid.innerHTML = "";
  stays.forEach(s => {
    const el = document.createElement("div");
    el.className = "stay";
    const secondary = s.secondary ? `<a class="linkBtn" href="${s.secondary}" target="_blank" rel="noopener noreferrer">🏰 Manor site</a>` : "";
    el.innerHTML = `
      ${s.image ? `<img src="${resolveUrl(s.image)}" alt="${s.name}" loading="lazy" />` : ``}
      <div class="stayBody">
        <h3>${s.name} <span class="muted">• ${s.brand}</span></h3>
        <p>${s.why}</p>
        <div class="linkRow">
          <a class="linkBtn" href="${s.site}" target="_blank" rel="noopener noreferrer">🌐 Website</a>
          ${secondary}
          ${s.photos ? `<a class="linkBtn" href="${s.photos}" target="_blank" rel="noopener noreferrer">📷 Photos</a>` : ""}
          <a class="linkBtn" href="${s.map}" target="_blank" rel="noopener noreferrer">🗺️ Map</a>
        </div>
      </div>
    `;
    imgFallback(el.querySelector('img'));
    grid.appendChild(el);
  });
}

function renderQuickLinks(links){
  const wrap = $("#quickLinks");
  wrap.innerHTML = "";
  links.forEach(l => {
    const el = document.createElement("div");
    el.className = "pairLinks";
    el.innerHTML = `
      <a class="smallLink" href="${l.site}" target="_blank" rel="noopener noreferrer">🌐 ${l.label}</a>
      <a class="smallLink" href="${l.map}" target="_blank" rel="noopener noreferrer">🗺️ Map</a>
    `;
    wrap.appendChild(el);
  });
}

function renderExtras(extras){
  const packing = $("#packingList");
  const reserv = $("#reservationsList");
  const romance = $("#romanceList");

  packing.innerHTML = extras.packing.map(x => `<li>${x}</li>`).join("");
  reserv.innerHTML = extras.reservations.map(x => `<li>${x}</li>`).join("");
  romance.innerHTML = extras.romanticMoments.map(x => `<li>${x}</li>`).join("");
}

function renderDay(day, date){
  $("#dayTitle").textContent = day.title;
  $("#dayDate").textContent = fmtLong(date);
  const stayLine = document.getElementById("stayLine");
  if(stayLine){ stayLine.textContent = day.staySummary ? `Stay: ${day.staySummary}` : ""; }
  const agendaLine = document.getElementById("agendaLine");
  if(agendaLine){ agendaLine.textContent = day.agenda ? `Agenda: ${day.agenda}` : ""; }

  // Tags
  const tags = $("#tags");
  tags.innerHTML = "";
  (day.tags || []).forEach(t => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = t;
    tags.appendChild(el);
  });
  const pace = document.createElement("span");
  pace.className = "tag ok";
  pace.textContent = `Pace: ${day.pace || "—"}`;
  tags.appendChild(pace);

  // Sections (accordion)
  const acc = $("#accordion");
  acc.innerHTML = "";
  (day.sections || []).forEach((sec, i) => {
    const item = document.createElement("div");
    item.className = "accItem";
    const id = `acc_${i}`;

    const listItems = (sec.items || []).map(it => {
      const website = it.site && !it.site.startsWith("#") ? `<a class="smallLink" href="${it.site}" target="_blank" rel="noopener noreferrer">🌐 Site</a>` :
                      it.site && it.site.startsWith("#") ? `<a class="smallLink" href="${it.site}">🏨 Stays</a>` : "";
      const map = it.map ? `<a class="smallLink" href="${it.map}" target="_blank" rel="noopener noreferrer">🗺️ Map</a>` : "";
      const links = (website || map) ? `<div class="pairLinks">${website}${map}</div>` : "";
      return `<li><b>${it.name}</b>${links}</li>`;
    }).join("");

    item.innerHTML = `
      <button class="accBtn" type="button" aria-expanded="${i===0}">
        <div>${sec.when}</div>
        <span>tap to ${i===0 ? "collapse" : "expand"}</span>
      </button>
      <div class="accPanel ${i===0 ? "open" : ""}" id="${id}">
        <ul class="itemList">${listItems}</ul>
      </div>
    `;

    const btn = item.querySelector(".accBtn");
    const panel = item.querySelector(".accPanel");

    btn.addEventListener("click", () => {
      const open = panel.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.querySelector("span").textContent = open ? "tap to collapse" : "tap to expand";
    });

    acc.appendChild(item);
  });

  // Thoughtfulness callouts
  const callouts = $("#callouts");
  callouts.innerHTML = "";
  const pieces = [];
  if(day.proTip) pieces.push({title:"Pro tip", body: day.proTip});
  if(day.thoughtfulness && day.thoughtfulness.length) pieces.push({title:"Why this plan works", body: day.thoughtfulness.map(x => `• ${x}`).join("<br/>")});
  if(day.backupPlan) pieces.push({title:"Backup plan", body: day.backupPlan});

  pieces.forEach(p => {
    const el = document.createElement("div");
    el.className = "callout";
    el.innerHTML = `<b>${p.title}:</b> <span>${p.body}</span>`;
    callouts.appendChild(el);
  });

  $("#transportNote").textContent = day.transport ? `Transportation / pace note: ${day.transport}` : "";
}

function scrollToId(id){
  document.querySelector(id).scrollIntoView({behavior:"smooth", block:"start"});
}

(async function init(){
  const data = await loadData();

  document.title = data.title || document.title;
  $("#title").textContent = data.title;
  $("#subtitle").textContent = data.subtitle;

  buildHero(data);

  const weeks = makeWeeks(data.weeks);
  buildWeekSelect(weeks);

  let currentWeek = weeks[3] || weeks[0];
  $("#weekSelect").value = currentWeek.toISOString().slice(0,10);

  renderStays(data.stays || []);
  renderQuickLinks(data.quickLinks || []);
  renderExtras(data.extras || {packing:[], reservations:[], romanticMoments:[]});

  buildDaySelect(data.itinerary || [], currentWeek);
  $("#daySelect").value = "2";

  function refresh(){
    const dayIndex = Number($("#daySelect").value);
    const day = data.itinerary[dayIndex];
    const date = addDays(currentWeek, dayIndex);
    renderDay(day, date);
  }

  $("#weekSelect").addEventListener("change", (e) => {
    currentWeek = new Date(`${e.target.value}T12:00:00`);
    buildDaySelect(data.itinerary || [], currentWeek);
    $("#daySelect").value = "2";
    refresh();
  });

  $("#daySelect").addEventListener("change", () => {
    refresh();
    scrollToId("#itinerary");
  });

  $("#search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if(!q){
      $("#searchResults").innerHTML = "";
      return;
    }
    const matches = [];
    (data.itinerary || []).forEach((d, i) => {
      const hay = JSON.stringify(d).toLowerCase();
      if(hay.includes(q)) matches.push({i, title:d.title});
    });
    $("#searchResults").innerHTML = matches.slice(0,8).map(m => 
      `<a class="smallLink" href="javascript:void(0)" data-day="${m.i}">🗓️ ${m.title}</a>`
    ).join(" ");
    $$("#searchResults a").forEach(a => {
      a.addEventListener("click", () => {
        $("#daySelect").value = a.dataset.day;
        refresh();
        scrollToId("#itinerary");
        $("#searchResults").innerHTML = "";
        $("#search").value = "";
      });
    });
  });

  $("#openPlan").addEventListener("click", () => { scrollToId("#controls"); });
  $("#openStays").addEventListener("click", () => { scrollToId("#stays"); });
  $("#openExtras").addEventListener("click", () => { scrollToId("#extras"); });


  // Next/Previous day navigation
  const prevBtn = document.getElementById("prevDay");
  const nextBtn = document.getElementById("nextDay");
  function clampDay(i){
    const max = (data.itinerary || []).length - 1;
    return Math.max(0, Math.min(max, i));
  }
  function goDay(delta){
    const cur = Number(document.getElementById("daySelect").value);
    const next = clampDay(cur + delta);
    document.getElementById("daySelect").value = String(next);
    refresh();
    scrollToId("#itinerary");
  }
  if(prevBtn) prevBtn.addEventListener("click", () => goDay(-1));
  if(nextBtn) nextBtn.addEventListener("click", () => goDay(1));

  refresh();
})();