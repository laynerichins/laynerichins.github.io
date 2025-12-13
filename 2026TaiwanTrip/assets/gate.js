(function(){
  const KEY = "taiwanTrip_openedGift_v1";

  function $(s){ return document.querySelector(s); }

  // Confetti (tiny, lightweight)
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  let W=0,H=0, pieces=[], raf=null, endAt=0;

  function resize(){
    W = canvas.width = window.innerWidth * devicePixelRatio;
    H = canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resize);
  resize();

  function rand(a,b){ return a + Math.random()*(b-a); }
  function makePieces(n){
    pieces = Array.from({length:n}, () => ({
      x: rand(0, W),
      y: rand(-H*0.2, -20),
      r: rand(6, 14),
      vx: rand(-1.2, 1.2) * devicePixelRatio,
      vy: rand(2.2, 4.8) * devicePixelRatio,
      rot: rand(0, Math.PI),
      vr: rand(-0.08, 0.08),
      // no explicit colors requested; use default palette but not "theme-y"
      c: ["#2563eb","#7c3aed","#16a34a","#f59e0b","#ef4444"][Math.floor(Math.random()*5)]
    }));
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    for(const p of pieces){
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if(p.y > H + 30){ p.y = rand(-120, -20); p.x = rand(0, W); }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r*0.66);
      ctx.restore();
    }
    if(Date.now() < endAt){
      raf = requestAnimationFrame(draw);
    } else {
      stopConfetti();
    }
  }

  function startConfetti(ms=1600){
    canvas.style.display = "block";
    makePieces(140);
    endAt = Date.now() + ms;
    cancelAnimationFrame(raf);
    draw();
  }
  function stopConfetti(){
    cancelAnimationFrame(raf);
    ctx.clearRect(0,0,W,H);
    canvas.style.display = "none";
  }

  // Gate behavior
  const openBtn = $("#openPresentBtn");
  if(openBtn){
    openBtn.addEventListener("click", () => {
      localStorage.setItem(KEY, "yes");
      startConfetti(1600);
      setTimeout(() => { window.location.href = "./trip.html"; }, 700);
    });
  }

  // If someone tries to open trip.html directly before "opening", send them back
  if(document.body && document.body.dataset && document.body.dataset.page === "trip"){
    const ok = localStorage.getItem(KEY) === "yes";
    if(!ok){
      window.location.replace("./index.html");
    }
  }

  // Optional: allow reset for testing
  const reset = $("#resetGate");
  if(reset){
    reset.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem(KEY);
      alert("Reset complete. Next visit will show the gift gate again.");
    });
  }
})();