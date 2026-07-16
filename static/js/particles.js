// Neon particle field with mouse reactivity + connecting lines
(function () {
  const cvs = document.getElementById('particles');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  let w, h, particles = [], mouse = { x: -9999, y: -9999 };

  function size() {
    w = cvs.width = window.innerWidth;
    h = cvs.height = window.innerHeight;
  }
  size();
  window.addEventListener('resize', size);
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

  const N = Math.min(90, Math.floor((w * h) / 22000));
  for (let i = 0; i < N; i++) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.4,
      a: Math.random() * 0.55 + 0.2,
    });
  }

  function step() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // mouse attraction
      const dx = mouse.x - p.x, dy = mouse.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 22500) {
        p.vx += dx * 0.00003;
        p.vy += dy * 0.00003;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      p.vx *= 0.995; p.vy *= 0.995;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 229, 255, ${p.a})`;
      ctx.shadowBlur = 8; ctx.shadowColor = '#00e5ff';
      ctx.fill();

      // link close pairs
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dxx = p.x - q.x, dyy = p.y - q.y;
        const dd = dxx * dxx + dyy * dyy;
        if (dd < 14400) {
          const alpha = 0.18 * (1 - dd / 14400);
          ctx.beginPath();
          ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
          ctx.lineWidth = 0.6; ctx.shadowBlur = 0;
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
    requestAnimationFrame(step);
  }
  step();
})();
