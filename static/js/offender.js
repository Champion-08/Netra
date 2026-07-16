/* ============================================================
   NETRA — Offender Profile Page JS
   ============================================================ */
(function () {
  const CRIME_COLOR = {
    'Theft':'#ffd700','Assault':'#ff8c00','Cyber Crime':'#4dabff',
    'Burglary':'#c084fc','Fraud':'#f472b6','Vandalism':'#a3e635','Drug Offense':'#fb7185'
  };
  const NEON = ['#ff0055','#ff8c00','#ffd700','#c084fc','#4dabff','#a3e635','#f472b6'];

  const nameEl = document.getElementById('offender-name-data');
  if (!nameEl) return;
  const offenderName = nameEl.dataset.name;

  async function init() {
    const res  = await fetch(`/api/offender/${encodeURIComponent(offenderName)}`);
    if (!res.ok) { document.getElementById('offender-shell').innerHTML = '<p style="color:var(--secondary);font-family:var(--font-mono);padding:2rem">Offender not found.</p>'; return; }
    const d = await res.json();

    // Header stats
    document.getElementById('oh-total').textContent  = d.total_crimes;
    document.getElementById('oh-anom').textContent   = d.anomalies;
    document.getElementById('oh-sev').textContent    = d.avg_severity;
    document.getElementById('oh-victims').textContent = d.victims.length;
    document.getElementById('oh-first').textContent  = d.first_seen?.slice(0,10) || '—';
    document.getElementById('oh-last').textContent   = d.last_seen?.slice(0,10)  || '—';

    // Crime type chart
    const ctEl = document.getElementById('chart-ct');
    if (ctEl && Object.keys(d.crime_types).length) {
      new Chart(ctEl, {
        type: 'doughnut',
        data: {
          labels: Object.keys(d.crime_types),
          datasets: [{ data: Object.values(d.crime_types), backgroundColor: Object.keys(d.crime_types).map(ct => CRIME_COLOR[ct] || '#00e5ff'), borderColor:'#05080f', borderWidth:2 }],
        },
        options: { responsive:true, maintainAspectRatio:false, cutout:'60%', plugins: {
          legend: { position:'right', labels: { color:'#c8d6e5', font:{size:9,family:'JetBrains Mono'}, boxWidth:10, padding:6 } },
          title:  { display:true, text:'Crime Types', color:'#00e5ff', font:{family:'Orbitron',size:10} },
        }},
      });
    }

    // MO chart
    const moEl = document.getElementById('chart-mo');
    if (moEl && Object.keys(d.modus_operandi).length) {
      new Chart(moEl, {
        type: 'bar',
        data: {
          labels: Object.keys(d.modus_operandi),
          datasets: [{ label:'Count', data:Object.values(d.modus_operandi), backgroundColor:NEON.map(c=>c+'cc'), borderColor:'#00e5ff', borderWidth:1 }],
        },
        options: { responsive:true, maintainAspectRatio:false, indexAxis:'y',
          plugins: {
            legend: { display:false },
            title: { display:true, text:'Modus Operandi', color:'#00e5ff', font:{family:'Orbitron',size:10} },
          },
          scales: {
            x: { ticks:{color:'#7f95ac',font:{size:8}}, grid:{color:'rgba(0,229,255,0.06)'} },
            y: { ticks:{color:'#c8d6e5',font:{size:8}}, grid:{color:'rgba(0,229,255,0.06)'} },
          }
        },
      });
    }

    // District chart
    const distEl = document.getElementById('chart-districts');
    if (distEl && Object.keys(d.districts).length) {
      new Chart(distEl, {
        type: 'bar',
        data: {
          labels: Object.keys(d.districts),
          datasets: [{ label:'Incidents', data:Object.values(d.districts), backgroundColor: Object.keys(d.districts).map((_,i)=>NEON[i%NEON.length]+'cc'), borderColor:'#00e5ff', borderWidth:1 }],
        },
        options: { responsive:true, maintainAspectRatio:false,
          plugins: { legend:{display:false}, title:{display:true, text:'Districts Operated In', color:'#00e5ff', font:{family:'Orbitron',size:10}} },
          scales: {
            x: { ticks:{color:'#7f95ac',font:{size:8},maxRotation:35}, grid:{color:'rgba(0,229,255,0.06)'} },
            y: { ticks:{color:'#7f95ac',font:{size:8}}, grid:{color:'rgba(0,229,255,0.06)'} },
          }
        },
      });
    }

    // Timeline
    const timeEl = document.getElementById('chart-timeline');
    if (timeEl && d.crimes.length) {
      const months = {};
      d.crimes.forEach(c => {
        const m = c.date.slice(0,7);
        months[m] = (months[m]||0) + 1;
      });
      const sortedMonths = Object.keys(months).sort();
      new Chart(timeEl, {
        type: 'line',
        data: {
          labels: sortedMonths,
          datasets: [{ label:'Crimes/month', data: sortedMonths.map(m=>months[m]), borderColor:'#ff0055', backgroundColor:'rgba(255,0,85,.1)', tension:0.35, borderWidth:2, pointRadius:3, pointBackgroundColor:'#ff0055' }],
        },
        options: { responsive:true, maintainAspectRatio:false,
          plugins: { legend:{display:false}, title:{display:true, text:'Activity Timeline', color:'#00e5ff', font:{family:'Orbitron',size:10}} },
          scales: {
            x: { ticks:{color:'#7f95ac',font:{size:8}}, grid:{color:'rgba(0,229,255,0.06)'} },
            y: { ticks:{color:'#7f95ac',font:{size:8}}, grid:{color:'rgba(0,229,255,0.06)'}, beginAtZero:true },
          }
        },
      });
    }

    // Crime history table
    const tbody = document.getElementById('crime-history-body');
    if (tbody) {
      d.crimes.forEach(c => {
        const tr = document.createElement('tr');
        if (c.anomaly) tr.style.background = 'rgba(255,0,85,.04)';
        const col = CRIME_COLOR[c.crime_type]||'#00e5ff';
        tr.innerHTML = `
          <td><a href="/crime/${c.id}" style="color:var(--primary);text-decoration:none">#${c.id}</a></td>
          <td><span style="color:${col};font-family:var(--font-mono);font-size:.72rem;border:1px solid ${col}44;padding:.1rem .4rem;background:${col}11">${c.crime_type}</span></td>
          <td style="color:var(--text)">${c.district}</td>
          <td style="color:var(--text-dim);font-size:.72rem">${c.date}</td>
          <td style="color:#7bc4ff">${c.victim}</td>
          <td style="color:var(--text-dim);font-size:.7rem">${c.modus_operandi}</td>
          <td style="color:${c.severity>=4?'#ff5a86':'var(--text)'}">${c.severity}/5</td>
          <td>${c.anomaly?'<span style="color:#ff0055">⚠️</span>':''}</td>`;
        tbody.appendChild(tr);
      });
    }

    // Map of all crimes
    const mapEl = document.getElementById('offender-map');
    if (mapEl && d.crimes.length) {
      const oMap = L.map('offender-map', { zoomControl:true, preferCanvas:true }).setView([13.5, 76.5], 7);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains:'abcd', maxZoom:19 }).addTo(oMap);
      // Fetch full crime data for coords
      const crimeRes  = await fetch('/api/crimes');
      const crimeData = await crimeRes.json();
      const myIds = new Set(d.crimes.map(c=>c.id));
      crimeData.features.filter(f=>myIds.has(f.properties.id)).forEach(f => {
        const [lon,lat] = f.geometry.coordinates;
        const p = f.properties;
        const col = p.anomaly ? '#ff0055' : (CRIME_COLOR[p.crime_type]||'#00e5ff');
        L.circleMarker([lat,lon], { radius:7, color:col, weight:1.5, fillColor:col, fillOpacity:.7 })
         .bindPopup(`<b>${p.crime_type}</b><br>${p.district}<br>${p.date}`)
         .addTo(oMap);
      });
    }

    // Victims list
    const vicList = document.getElementById('victim-list');
    if (vicList) {
      vicList.innerHTML = d.victims.map(v => `<div style="padding:.35rem .6rem;border-bottom:1px solid var(--border-3);color:#7bc4ff;font-family:var(--font-mono);font-size:.78rem">${v}</div>`).join('');
    }
  }

  init();
})();
