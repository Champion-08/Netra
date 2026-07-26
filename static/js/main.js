/* ============================================================
   NETRA v2.0 — Dashboard main.js
   Full 5-section sidebar dashboard
   ============================================================ */
(function () {
  'use strict';
  const API = (p) => p;
  const $  = (s, ctx) => (ctx || document).querySelector(s);
  const $$ = (s, ctx) => [...(ctx || document).querySelectorAll(s)];

  // ── State ───────────────────────────────────────────────────
  let map, crimeLayer, forecastLayer, heatLayer, clusterLayer;
  let mapView = 'crimes';
  let cy;
  let trendChart, distChart, pieCrimeChart, radarChart;
  let allCrimes = [];
  let currentSection = 'map';
  let tableState = { page: 1, sort: 'date', order: 'desc', search: '', total: 0, pages: 1 };
  let pendingChat = false;

  // ── I18N ────────────────────────────────────────────────────
  const I18N = {
    en: { s_map:'Map Intelligence', s_net:'Link Analysis', s_analytics:'Analytics', s_intel:'Intelligence', s_reports:'Reports' },
    kn: { s_map:'ನಕ್ಷೆ ಬುದ್ಧಿಮತ್ತೆ', s_net:'ಸಂಬಂಧ ವಿಶ್ಲೇಷಣೆ', s_analytics:'ವಿಶ್ಲೇಷಣೆ', s_intel:'ಬುದ್ಧಿಮತ್ತೆ', s_reports:'ವರದಿಗಳು' },
    hi: { s_map:'मानचित्र इंटेलिजेंस', s_net:'लिंक विश्लेषण', s_analytics:'विश्लेषण', s_intel:'इंटेलिजेंस', s_reports:'रिपोर्ट' },
  };

  // ── Toasts ──────────────────────────────────────────────────
  function toast(msg, kind = 'success') {
    const host = $('#toast-host');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.style.opacity = '0', 3500);
    setTimeout(() => t.remove(), 4000);
  }

  // ── Counter ─────────────────────────────────────────────────
  function setCounter(el, value) {
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    const dur = 700; const t0 = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(start + (value - start) * p);
      if (p < 1) requestAnimationFrame(tick);
      else { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    })(performance.now());
  }

  // ── Crime color map ─────────────────────────────────────────
  const CRIME_COLOR = {
    'Theft':'#ffd700','Assault':'#ff8c00','Cyber Crime':'#4dabff',
    'Burglary':'#c084fc','Fraud':'#f472b6','Vandalism':'#a3e635','Drug Offense':'#fb7185'
  };
  const NEON = ['#00e5ff','#ff0055','#ff8c00','#a3e635','#c084fc','#4dabff','#f472b6','#ffd700'];

  // ── MAP ─────────────────────────────────────────────────────
  function initMap() {
    map = L.map('map-main', { zoomControl: true, preferCanvas: true }).setView([13.5, 76.5], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    }).addTo(map);
    crimeLayer   = L.layerGroup().addTo(map);
    forecastLayer = L.layerGroup();
    clusterLayer = L.layerGroup();

    // Leaflet.heat CDN — try loading dynamically if not present
    if (typeof L.heatLayer !== 'undefined') {
      heatLayer = L.heatLayer([], { radius: 28, blur: 22, maxZoom: 12, gradient: { 0.3: '#4dabff', 0.6: '#ff8c00', 1.0: '#ff0055' } });
    }
  }

  function renderCrimes(features) {
    crimeLayer.clearLayers();
    features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      const col = p.anomaly ? '#ff0055' : (p.color || CRIME_COLOR[p.crime_type] || '#00e5ff');
      const marker = L.circleMarker([lat, lon], {
        radius: p.anomaly ? 9 : 5 + p.severity * 0.8,
        color: col, weight: 1.5, fillColor: col, fillOpacity: 0.72,
        className: 'crime-marker' + (p.anomaly ? ' anom' : ''),
      });
      marker.bindPopup(
        `<b>${p.crime_type}${p.anomaly ? ' ⚠️ ANOMALY' : ''}</b><br>
         <b>District:</b> ${p.district}<br><b>Date:</b> ${p.date}<br>
         <b>Suspect:</b> ${p.suspect}<br><b>Victim:</b> ${p.victim}<br>
         <b>MO:</b> ${p.modus_operandi}<br><b>Severity:</b> ${p.severity}/5<br>
         <a href="/crime/${p.id}" style="color:var(--primary)">→ Full Details</a>`
      );
      marker.addTo(crimeLayer);
    });
  }

  function renderForecast(features) {
    forecastLayer.clearLayers();
    features.forEach((f) => {
      const coords = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
      const p = f.properties;
      L.polygon(coords, { color: p.color, weight: 1.2, fillColor: p.color, fillOpacity: 0.22 })
       .bindPopup(`<b>${p.district}</b><br>Risk: <b style="color:${p.color}">${p.risk}</b><br>Recent: ${p.recent_count} (60d)<br>Score: ${p.score}`)
       .addTo(forecastLayer);
    });
  }

  function renderClusters(clusters) {
    clusterLayer.clearLayers();
    clusters.forEach((c) => {
      const radius = 14 + c.count * 2.5;
      const marker = L.circleMarker([c.lat, c.lon], {
        radius: Math.min(radius, 45), color: '#ff8c00', weight: 2,
        fillColor: '#ff8c00', fillOpacity: 0.3,
      });
      const topCrime = Object.entries(c.crime_types).sort((a,b)=>b[1]-a[1])[0];
      marker.bindPopup(
        `<b>Hotspot Cluster #${c.id}</b><br>District: ${c.district}<br>Incidents: ${c.count}<br>
         Top crime: ${topCrime ? topCrime[0] : '?'}<br>Anomalies: ${c.anomalies}<br>Avg severity: ${c.avg_severity}`
      );
      marker.addTo(clusterLayer);
    });
  }

  async function loadCrimes() {
    const dist  = $('#filter-district')?.value || '';
    const crime = $('#filter-crime')?.value || '';
    const url   = `/api/crimes?district=${encodeURIComponent(dist)}&crime=${encodeURIComponent(crime)}`;
    const res   = await fetch(url);
    if (!res.ok) return toast('Failed to load crimes', 'error');
    const data  = await res.json();
    allCrimes   = data.features;

    renderCrimes(data.features);
    setCounter($('#stat-total'), data.meta.total);
    setCounter($('#stat-anom'),  data.meta.anomalies);

    // Populate filters
    const fd = $('#filter-district');
    if (fd && fd.options.length <= 1) data.meta.districts.forEach((d) => fd.add(new Option(d, d)));
    const fc = $('#filter-crime');
    if (fc && fc.options.length <= 1) data.meta.crime_types.forEach((c) => fc.add(new Option(c, c)));
  }

  async function loadHeatmap() {
    const dist  = $('#filter-district')?.value || '';
    const crime = $('#filter-crime')?.value || '';
    const res   = await fetch(`/api/heatmap?district=${encodeURIComponent(dist)}&crime=${encodeURIComponent(crime)}`);
    const data  = await res.json();
    if (heatLayer) {
      heatLayer.setLatLngs(data.points);
      heatLayer.addTo(map);
    }
  }

  async function loadForecast() {
    const res  = await fetch('/api/predict');
    const data = await res.json();
    renderForecast(data.features);
  }

  async function loadClusters() {
    const res  = await fetch('/api/cluster');
    const data = await res.json();
    renderClusters(data.clusters);
    const el = $('#cluster-count');
    if (el) el.textContent = `${data.clusters.length} clusters`;
  }

  // ── MAP TOGGLE ──────────────────────────────────────────────
  $$('.tg[data-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      $$('.tg[data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mapView = btn.dataset.view;

      crimeLayer.remove?.call ? crimeLayer.remove() : map.removeLayer(crimeLayer);
      forecastLayer.remove?.call ? forecastLayer.remove() : map.removeLayer(forecastLayer);
      clusterLayer.remove?.call ? clusterLayer.remove() : map.removeLayer(clusterLayer);
      if (heatLayer) try { map.removeLayer(heatLayer); } catch(e) {}

      const riskLeg = $('#risk-legend');

      if (mapView === 'crimes') {
        crimeLayer.addTo(map);
        if (riskLeg) riskLeg.classList.add('hidden');
      } else if (mapView === 'forecast') {
        await loadForecast();
        forecastLayer.addTo(map);
        if (riskLeg) riskLeg.classList.remove('hidden');
      } else if (mapView === 'heat') {
        await loadHeatmap();
        if (riskLeg) riskLeg.classList.add('hidden');
      } else if (mapView === 'cluster') {
        await loadClusters();
        clusterLayer.addTo(map);
        if (riskLeg) riskLeg.classList.add('hidden');
      }
    });
  });

  // ── NETWORK ─────────────────────────────────────────────────
  let isSelectPopulated = false;
  let pulseAnimationId = null;

  async function loadNetwork(suspectName) {
    const url = suspectName ? `/api/network?suspect=${encodeURIComponent(suspectName)}` : '/api/network';
    const res = await fetch(url);
    const data = await res.json();
    const cyEl = document.getElementById('cy');
    if (!cyEl) return;

    // Handle dropdown population and selecting the primary suspect
    const targetSelect = document.getElementById('select-target-suspect');
    const primary = data.primary_suspect;

    // Populate dropdown if not already populated
    if (targetSelect && !isSelectPopulated) {
      try {
        const crimesRes = await fetch('/api/crimes');
        const crimesData = await crimesRes.json();
        const suspects = new Set();
        crimesData.features.forEach(f => {
          const s = f.properties.suspect;
          if (s && s !== 'Unknown') suspects.add(s);
        });
        
        targetSelect.innerHTML = '';
        const sortedSuspects = Array.from(suspects).sort();
        sortedSuspects.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          targetSelect.appendChild(opt);
        });
        
        // Listen to change event on suspect select dropdown
        targetSelect.addEventListener('change', (e) => {
          loadNetwork(e.target.value);
        });
        
        isSelectPopulated = true;
      } catch (e) {
        console.error("Failed to populate target select", e);
      }
    }

    if (targetSelect && primary) {
      targetSelect.value = primary;
    }

    cy = cytoscape({
      container: cyEl,
      elements: [...data.nodes, ...data.edges],
      style: [
        { selector: 'node', style: {
          'label': 'data(label)',
          'color': '#e8fdff',
          'font-size': '11px',
          'font-family': 'JetBrains Mono, monospace',
          'text-outline-color': '#05080f',
          'text-outline-width': 2,
          'width': 28,
          'height': 28,
          'border-width': 1.5,
          'border-color': '#00e5ff',
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'text-background-opacity': 0.75,
          'text-background-color': '#05080f',
          'text-background-padding': '3px',
          'text-background-shape': 'roundrectangle'
        }},
        // 🔴 Suspect: glowing, larger, red border/fill
        { selector: 'node[type = "suspect"]', style: {
          'width': 44,
          'height': 44,
          'background-color': '#ff0055',
          'border-color': '#ff5aa4',
          'border-width': 3.5,
          'shadow-blur': 18,
          'shadow-color': '#ff0055',
          'shadow-opacity': 0.85,
          'shadow-offset-x': 0,
          'shadow-offset-y': 0
        }},
        // 🔵 Associate: accomplice
        { selector: 'node[type = "associate"]', style: {
          'background-color': '#0088ff',
          'border-color': '#00e5ff',
          'width': 32,
          'height': 32
        }},
        // 🟡 Crime: crime incident
        { selector: 'node[type = "crime"]', style: {
          'background-color': '#ffd54a',
          'border-color': '#ffe38a',
          'shape': 'hexagon',
          'width': 28,
          'height': 28
        }},
        // 🟢 Victim: victim node
        { selector: 'node[type = "victim"]', style: {
          'background-color': '#2ed573',
          'border-color': '#20bf6b',
          'width': 28,
          'height': 28
        }},
        // 🟣 Location: district
        { selector: 'node[type = "location"]', style: {
          'background-color': '#a855f7',
          'border-color': '#c084fc',
          'shape': 'diamond',
          'width': 30,
          'height': 30
        }},
        // 🟠 Evidence: Phone, Vehicle, Bank Account
        { selector: 'node[type = "evidence"]', style: {
          'background-color': '#ff8c00',
          'border-color': '#ffb04c',
          'shape': 'round-rectangle',
          'width': 26,
          'height': 26
        }},
        // Edges styling
        { selector: 'edge', style: {
          'width': 2,
          'line-color': 'rgba(0,229,255,0.4)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': 'rgba(0,229,255,0.6)',
          'arrow-scale': 1.1,
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#7f95ac',
          'text-rotation': 'autorotate',
          'text-background-opacity': 0.8,
          'text-background-color': '#05080f',
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle'
        }},
        { selector: ':selected', style: {
          'border-width': 3,
          'border-color': '#fff',
          'border-opacity': 0.9
        }},
      ],
      layout: {
        name: 'cose',
        animate: true,
        idealEdgeLength: 140,
        nodeRepulsion: 150000,
        gravity: 0.25,
        numIter: 1000,
        refresh: 20
      },
      wheelSensitivity: 0.2,
    });

    // Hover tooltip events
    const tooltip = document.getElementById('cy-tooltip');
    
    cy.on('mouseover', 'node', (evt) => {
      document.body.style.cursor = 'pointer';
      const node = evt.target;
      const d = node.data();
      
      if (tooltip) {
        let riskClass = 'low';
        if (d.risk_score >= 75) riskClass = 'high';
        else if (d.risk_score >= 40) riskClass = 'medium';
        
        tooltip.innerHTML = `
          <div class="tooltip-title">${d.label}</div>
          <div class="tooltip-row"><span>Role:</span> <span>${d.role || d.type}</span></div>
          <div class="tooltip-row"><span>Risk Score:</span> <span class="risk-val ${riskClass}">${d.risk_score || 'N/A'}%</span></div>
          <div class="tooltip-row"><span>Linked Crimes:</span> <span>${d.crimes_count || 0}</span></div>
        `;
        tooltip.style.display = 'block';
      }
    });

    cy.on('mousemove', 'node', (evt) => {
      if (tooltip) {
        const renderedPos = evt.renderedPosition;
        tooltip.style.left = (renderedPos.x + 15) + 'px';
        tooltip.style.top = (renderedPos.y - 15) + 'px';
      }
    });

    cy.on('mouseout', 'node', () => {
      document.body.style.cursor = '';
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    });

    // Click suspect or associate -> open profile page
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const type = node.data('type');
      if (type === 'suspect' || type === 'associate') {
        const name = node.data('label');
        window.open(`/offender/${encodeURIComponent(name)}`, '_blank');
      }
    });

    // Gentle pulsing animation
    startPulsingAnimation(cy);

    // Populate top offenders list
    loadTopOffenders();
  }

  // Animation step helper
  function startPulsingAnimation(cyInstance) {
    if (pulseAnimationId) {
      cancelAnimationFrame(pulseAnimationId);
    }
    let time = 0;
    function pulse() {
      time += 0.04;
      const scale = 1 + Math.sin(time) * 0.08;
      
      cyInstance.nodes('[type = "suspect"]').forEach(node => {
        node.style({
          'width': 44 * scale,
          'height': 44 * scale,
          'border-width': 3.5 + Math.sin(time) * 1.2,
          'shadow-blur': 18 + Math.sin(time) * 5
        });
      });

      cyInstance.nodes('[type = "associate"]').forEach(node => {
        const scaleAcc = 1 + Math.sin(time + 1.5) * 0.05;
        node.style({
          'width': 32 * scaleAcc,
          'height': 32 * scaleAcc
        });
      });

      pulseAnimationId = requestAnimationFrame(pulse);
    }
    pulseAnimationId = requestAnimationFrame(pulse);
  }

  async function loadTopOffenders() {
    const res  = await fetch('/api/crimes');
    const data = await res.json();
    const counts = {};
    data.features.forEach((f) => {
      const s = f.properties.suspect;
      counts[s] = (counts[s] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, 8);
    const container = $('#offender-list');
    if (!container) return;
    container.innerHTML = '';
    top.forEach(([name, cnt]) => {
      const chip = document.createElement('div');
      chip.className = 'offender-chip';
      chip.style.display = 'flex';
      chip.style.alignItems = 'center';
      chip.style.justifyContent = 'space-between';
      chip.style.width = '100%';
      chip.style.cursor = 'pointer';
      
      chip.innerHTML = `
        <div class="oc-info" style="display:flex; flex-direction:column; gap:2px">
          <span class="oc-name">${name}</span>
          <span class="oc-cnt" style="font-size:0.65rem; color:var(--text-dim)">${cnt} crimes</span>
        </div>
        <a href="/offender/${encodeURIComponent(name)}" target="_blank" class="btn-profile-link" style="color:var(--primary); font-size:0.75rem; text-decoration:none; padding:4px 6px; border-radius:3px; background:rgba(0,229,255,0.08); border:1px solid rgba(0,229,255,0.2); transition:all 0.2s">PROFILE ↗</a>
      `;
      
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-profile-link')) return;
        const targetSelect = document.getElementById('select-target-suspect');
        if (targetSelect) {
          targetSelect.value = name;
        }
        loadNetwork(name);
      });
      
      container.appendChild(chip);
    });
  }

  // ── CHARTS ──────────────────────────────────────────────────
  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#c8d6e5', font: { size: 9, family: 'JetBrains Mono' }, boxWidth: 10 } } },
    scales: {
      x: { ticks: { color: '#7f95ac', font: { size: 9 } }, grid: { color: 'rgba(0,229,255,0.06)' } },
      y: { ticks: { color: '#7f95ac', font: { size: 9 } }, grid: { color: 'rgba(0,229,255,0.06)' } },
    },
  };

  async function loadCharts() {
    const res = await fetch('/api/stats');
    const s   = await res.json();

    // Trend line
    const trendDatasets = Object.keys(s.trends).map((k, i) => ({
      label: k, data: s.trends[k], borderColor: NEON[i % NEON.length],
      backgroundColor: NEON[i % NEON.length] + '18',
      tension: 0.38, borderWidth: 1.8, pointRadius: 2, pointHoverRadius: 4,
    }));
    const trendEl = $('#chart-trend');
    if (trendEl) {
      if (trendChart) trendChart.destroy();
      trendChart = new Chart(trendEl, {
        type: 'line',
        data: { labels: s.months, datasets: trendDatasets },
        options: { ...chartDefaults, plugins: { ...chartDefaults.plugins,
          title: { display: true, text: 'Monthly Crime Trend', color: '#00e5ff', font: { family: 'Orbitron', size: 11, weight: '600' } },
        }},
      });
    }

    // Bar — districts
    const distEl = $('#chart-district');
    if (distEl) {
      if (distChart) distChart.destroy();
      distChart = new Chart(distEl, {
        type: 'bar',
        data: {
          labels: s.districts,
          datasets: [{ label: 'Incidents', data: s.district_counts, backgroundColor: s.districts.map((_,i) => NEON[i%NEON.length]+'cc'), borderColor: '#00e5ff', borderWidth: 1 }],
        },
        options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false },
          title: { display: true, text: 'Top Districts by Incidents', color: '#00e5ff', font: { family: 'Orbitron', size: 11, weight: '600' } },
        }, scales: { ...chartDefaults.scales, x: { ...chartDefaults.scales.x, ticks: { ...chartDefaults.scales.x.ticks, maxRotation: 35 } } } },
      });
    }

    // Doughnut — crime types
    const pieEl = $('#chart-crime-pie');
    if (pieEl) {
      if (pieCrimeChart) pieCrimeChart.destroy();
      pieCrimeChart = new Chart(pieEl, {
        type: 'doughnut',
        data: {
          labels: s.crime_types,
          datasets: [{ data: s.crime_counts, backgroundColor: s.crime_types.map(ct => CRIME_COLOR[ct] || NEON[0]), borderColor: '#05080f', borderWidth: 2 }],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
          plugins: {
            legend: { position: 'right', labels: { color: '#c8d6e5', font: { size: 9, family: 'JetBrains Mono' }, boxWidth: 12, padding: 8 } },
            title: { display: true, text: 'Crime Type Distribution', color: '#00e5ff', font: { family: 'Orbitron', size: 11, weight: '600' } },
          }
        },
      });
    }
  }

  // ── INTELLIGENCE ─────────────────────────────────────────────
  async function loadIntelligence() {
    loadTrendSpikes();
    loadSocioEconomic();
    loadModus();
    loadClusterCards();
  }

  async function loadTrendSpikes() {
    const res  = await fetch('/api/trend_spikes');
    const data = await res.json();
    const container = $('#spike-list');
    if (!container) return;
    container.innerHTML = '';
    if (!data.spikes.length) {
      container.innerHTML = '<div style="padding:.8rem;color:var(--text-dim);font-family:var(--font-mono);font-size:.78rem;">No significant spikes detected.</div>';
      return;
    }
    data.spikes.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'spike-item';
      div.innerHTML = `
        <span class="spike-pct">+${s.change_pct}%</span>
        <span class="spike-name">${s.crime_type}</span>
        <span class="spike-month">${s.month}</span>
        <span style="font-size:.65rem;color:var(--text-dim)">${s.prev_count}→${s.curr_count}</span>`;
      container.appendChild(div);
    });
  }

  async function loadSocioEconomic() {
    const res  = await fetch('/api/socioeconomic');
    const data = await res.json();
    const table = $('#socio-table-body');
    if (!table) return;
    table.innerHTML = '';
    const maxRate = Math.max(...data.map(d => d.crime_rate));
    data.sort((a,b) => b.crime_rate - a.crime_rate).forEach((d) => {
      const barW = Math.round(d.crime_rate / maxRate * 80);
      const riskClass = d.crime_rate > 10 ? 'risk-high' : d.crime_rate > 5 ? 'risk-medium' : 'risk-low';
      const riskText  = d.crime_rate > 10 ? 'HIGH' : d.crime_rate > 5 ? 'MED' : 'LOW';
      table.innerHTML += `<tr>
        <td>${d.district}</td>
        <td>${d.crime_count}</td>
        <td><div class="socio-bar"><div class="socio-bar-inner" style="width:${barW}%"></div><span>${d.crime_rate}</span></div></td>
        <td>${d.unemployment}%</td>
        <td>${d.literacy}%</td>
        <td><span class="risk-pill ${riskClass}">${riskText}</span></td>
      </tr>`;
    });
  }

  async function loadModus() {
    const res  = await fetch('/api/modus');
    const data = await res.json();
    const container = $('#modus-list');
    if (!container) return;
    container.innerHTML = '';
    const max = Math.max(...Object.values(data.top_mo));
    Object.entries(data.top_mo).slice(0,8).forEach(([mo, cnt]) => {
      const pct = Math.round(cnt / max * 100);
      container.innerHTML += `
        <div style="margin-bottom:.5rem">
          <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:.72rem;margin-bottom:.2rem">
            <span style="color:var(--text)">${mo}</span><span style="color:var(--primary)">${cnt}</span>
          </div>
          <div style="height:3px;background:rgba(0,229,255,.12);border-radius:2px">
            <div style="width:${pct}%;height:100%;background:var(--primary);border-radius:2px"></div>
          </div>
        </div>`;
    });
  }

  async function loadClusterCards() {
    const res  = await fetch('/api/cluster');
    const data = await res.json();
    const container = $('#cluster-cards');
    if (!container) return;
    container.innerHTML = '';
    if (!data.clusters.length) {
      container.innerHTML = '<div style="padding:.8rem;color:var(--text-dim);font-family:var(--font-mono);font-size:.78rem;">No clusters detected with current settings.</div>';
      return;
    }
    data.clusters.forEach((c) => {
      const topCrime = Object.entries(c.crime_types).sort((a,b)=>b[1]-a[1])[0];
      const col = topCrime ? (CRIME_COLOR[topCrime[0]] || '#00e5ff') : '#00e5ff';
      const card = document.createElement('div');
      card.className = 'cluster-card';
      card.style.setProperty('--c', col);
      card.innerHTML = `
        <div class="cc-id">CLUSTER #${String(c.id).padStart(2,'0')}</div>
        <div class="cc-dist">${c.district}</div>
        <div class="cc-count">${c.count} <span class="cc-label">incidents</span></div>
        <div style="font-family:var(--font-mono);font-size:.68rem;color:var(--text-dim);margin-top:.3rem">${topCrime ? topCrime[0] : '?'} dominant</div>
        <div class="cc-anom">⚠️ ${c.anomalies} anomalies · Sev: ${c.avg_severity}</div>`;
      container.appendChild(card);
    });
  }

  // ── REPORTS TABLE ────────────────────────────────────────────
  function crimeTypeBadge(ct) {
    const col = CRIME_COLOR[ct] || '#00e5ff';
    return `<span class="ct-badge" style="color:${col};border-color:${col}44;background:${col}11">${ct}</span>`;
  }

  function sevPips(s) {
    let h = '<div class="sev-bar">';
    for (let i = 1; i <= 5; i++) {
      const col = i <= 2 ? '#4dabff' : i <= 3 ? '#ff8c00' : '#ff0055';
      h += `<div class="sev-pip ${i <= s ? 'filled' : ''}" style="--c:${col}"></div>`;
    }
    return h + '</div>';
  }

  async function loadTable() {
    const dist  = $('#filter-district')?.value || '';
    const crime = $('#filter-crime')?.value || '';
    const ts    = tableState;
    const params = new URLSearchParams({
      district: dist, crime, sort: ts.sort, order: ts.order,
      page: ts.page, per_page: 20, search: ts.search,
    });
    const res  = await fetch(`/api/crimes/table?${params}`);
    const data = await res.json();
    ts.total = data.total; ts.pages = data.pages;

    const tbody = $('#crime-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.anomaly) tr.classList.add('anom-row');
      tr.innerHTML = `
        <td style="color:var(--text-dim)">#${r.id}</td>
        <td>${crimeTypeBadge(r.crime_type)}</td>
        <td style="color:var(--text)">${r.district}</td>
        <td style="color:var(--text-dim);font-size:.72rem">${r.date}</td>
        <td style="color:#ff9ab6">${r.suspect}</td>
        <td style="color:#7bc4ff">${r.victim}</td>
        <td style="color:var(--text-dim);font-size:.7rem">${r.modus_operandi}</td>
        <td>${sevPips(r.severity)}</td>
        <td>${r.anomaly ? '<span class="anom-flag">⚠️</span>' : ''}</td>`;
      tr.addEventListener('click', () => window.open(`/crime/${r.id}`, '_blank'));
      tbody.appendChild(tr);
    });

    // Pagination
    const pgContainer = $('#table-pages');
    if (!pgContainer) return;
    pgContainer.innerHTML = '';
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `${data.total} records · Page ${data.page}/${data.pages}`;
    pgContainer.appendChild(info);

    [['‹', ts.page - 1], ['›', ts.page + 1]].forEach(([label, p]) => {
      if (p < 1 || p > data.pages) return;
      const btn = document.createElement('button');
      btn.className = 'page-btn';
      btn.textContent = label;
      btn.onclick = () => { ts.page = p; loadTable(); };
      pgContainer.appendChild(btn);
    });

    const countEl = $('#table-count');
    if (countEl) countEl.textContent = `${data.total} records`;
  }

  // Sort columns
  $$('[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (tableState.sort === col) {
        tableState.order = tableState.order === 'desc' ? 'asc' : 'desc';
      } else {
        tableState.sort = col; tableState.order = 'desc';
      }
      tableState.page = 1;
      $$('[data-sort]').forEach((t) => t.classList.remove('sort-asc','sort-desc'));
      th.classList.add(tableState.order === 'asc' ? 'sort-asc' : 'sort-desc');
      loadTable();
    });
  });

  // Search
  const searchInput = $('#table-search');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        tableState.search = searchInput.value.trim();
        tableState.page = 1;
        loadTable();
      }, 350);
    });
  }

  // Anomaly filter toggle
  const anomBtn = $('#btn-anom-only');
  if (anomBtn) {
    anomBtn.addEventListener('click', () => {
      const active = anomBtn.dataset.active === '1';
      anomBtn.dataset.active = active ? '0' : '1';
      anomBtn.classList.toggle('btn-danger', !active);
      tableState.page = 1;
      loadTable();
    });
  }

  // Export CSV
  const exportBtn = $('#btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const dist  = $('#filter-district')?.value || '';
      const crime = $('#filter-crime')?.value || '';
      window.location.href = `/api/export/csv?district=${encodeURIComponent(dist)}&crime=${encodeURIComponent(crime)}`;
    });
  }

  // ── SIDEBAR NAV ──────────────────────────────────────────────
  $$('.nav-item[data-section]').forEach((item) => {
    item.addEventListener('click', () => switchSection(item.dataset.section));
  });

  function switchSection(name) {
    currentSection = name;
    $$('.nav-item[data-section]').forEach((i) => i.classList.toggle('active', i.dataset.section === name));
    $$('.section-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));

    const titleEl = $('#section-title');
    const titles = { map:'Map Intelligence', net:'Link Analysis', analytics:'Analytics Matrix', intel:'Intelligence Hub', reports:'Crime Reports' };
    if (titleEl) titleEl.textContent = titles[name] || 'NETRA';

    // Lazy-load section data
    if (name === 'net' && !cy) loadNetwork();
    if (name === 'analytics' && !trendChart) loadCharts();
    if (name === 'intel') loadIntelligence();
    if (name === 'reports') loadTable();

    // Invalidate map size when switching back
    if (name === 'map' && map) setTimeout(() => map.invalidateSize(), 100);
    if (name === 'net' && cy) setTimeout(() => cy.resize(), 100);
  }

  // ── GLOBAL FILTERS ────────────────────────────────────────────
  $('#filter-district')?.addEventListener('change', () => {
    loadCrimes(); loadTable();
  });
  $('#filter-crime')?.addEventListener('change', () => {
    loadCrimes(); loadTable();
  });

  // Scan button
  $('#scan-btn')?.addEventListener('click', async () => {
    toast('Scanning database…', 'success');
    await loadCrimes();
    if (mapView === 'forecast') await loadForecast();
    if (currentSection === 'analytics') await loadCharts();
    if (currentSection === 'intel') await loadIntelligence();
    if (currentSection === 'reports') await loadTable();
  });

  // ── TICKER ───────────────────────────────────────────────────
  function seedTicker() {
    const track = $('#ticker-track');
    if (!track) return;
    function addAlert() {
      if (!allCrimes.length) return;
      const p    = allCrimes[Math.floor(Math.random() * allCrimes.length)].properties;
      const time = new Date().toLocaleTimeString('en-GB');
      const span = document.createElement('span');
      if (p.anomaly) span.className = 'anom';
      span.textContent = `[${time}] ${p.anomaly ? '⚠ ANOMALY · ' : ''}${p.crime_type} · ${p.district} · Suspect: ${p.suspect}`;
      track.appendChild(span);
      if (track.children.length > 50) track.removeChild(track.firstChild);
    }
    for (let i = 0; i < 8; i++) setTimeout(addAlert, i * 400);
    setInterval(addAlert, 7000);
  }

  // ── CHAT ─────────────────────────────────────────────────────
  function chatAppend(text, who = 'bot') {
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = `chat-msg ${who}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function chatTyping() {
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = 'chat-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  $('#chat-toggle')?.addEventListener('click', () => {
    const box = $('#chat-box');
    box.classList.toggle('hidden');
    if (!box.dataset.greeted) {
      chatAppend('NETRA AI Analyst v2 online.\nTry: "total crimes", "anomalies", "top districts", "bengaluru urban", "cyber crime", "trend spikes", "recent 10", or "help".', 'bot');
      box.dataset.greeted = '1';
    }
  });
  $('#chat-close')?.addEventListener('click', () => $('#chat-box').classList.add('hidden'));
  $('#chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pendingChat) return;
    const input = $('#chat-input');
    const q = input.value.trim();
    if (!q) return;
    chatAppend(q, 'user');
    input.value = '';
    pendingChat = true;
    const typingEl = chatTyping();
    try {
      const res  = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({query:q}) });
      const data = await res.json();
      typingEl.remove();
      chatAppend(data.reply || '…', 'bot');
    } catch {
      typingEl.remove();
      chatAppend('Network error. Retry.', 'bot');
    }
    pendingChat = false;
  });

  // ── I18N ─────────────────────────────────────────────────────
  $('#lang-switcher')?.addEventListener('change', (e) => {
    const lang = e.target.value;
    $$('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (I18N[lang]?.[k]) el.textContent = I18N[lang][k];
    });
  });

  // ── CSV UPLOAD ────────────────────────────────────────────────
  const uploadInput = document.getElementById('csv-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      const res  = await fetch('/api/upload', { method:'POST', body:fd });
      const data = await res.json();
      if (data.ok) { toast(`CSV uploaded: ${data.rows} rows.`, 'success'); loadCrimes(); loadCharts(); loadNetwork(); }
      else toast(data.error || 'Upload failed', 'error');
      e.target.value = '';
    });
  }

  // ── CLOCK ─────────────────────────────────────────────────────
  const clockEl = $('#dash-clock');
  if (clockEl) {
    const updateClock = () => clockEl.textContent = new Date().toLocaleTimeString('en-GB') + ' IST';
    updateClock(); setInterval(updateClock, 1000);
  }

  // ── INIT ─────────────────────────────────────────────────────
  initMap();
  (async () => {
    await loadCrimes();
    seedTicker();
    // Pre-load charts silently
    loadCharts();
  })();

  // Auto-refresh every 90s
  setInterval(() => {
    loadCrimes();
    if (currentSection === 'analytics') loadCharts();
    if (currentSection === 'reports')   loadTable();
  }, 90000);

  // Start on map section
  switchSection('map');

})();
