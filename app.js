let map, markers = [], latlngs = [], polyline = null;
let actionHistory = [];

// Initialize map
function initMap() {
  map = L.map('map').setView([26.9124, 75.7873], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  map.on('click', (e) => addPoint(e.latlng.lat, e.latlng.lng));

  // Search box functionality
  const searchBox = document.getElementById('searchBox');
  searchBox.addEventListener('keydown', async (e) => {
    if(e.key === 'Enter'){
      const query = searchBox.value.trim();
      if(query === '') return;
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if(data && data.length > 0){
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          map.setView([lat, lon], 15);
          addPoint(lat, lon);
        } else alert('Location not found');
      } catch(err){ alert('Search error'); console.error(err); }
    }
  });
}

// Add a marker
function addPoint(lat, lng) {
  const m = L.marker([lat, lng]).addTo(map);
  markers.push(m);
  latlngs.push([lat, lng]);
  updateList();

  m.on('click', () => removePoint(m));

  actionHistory.push({ type: 'add', marker: m, latlng: [lat, lng] });
}

// Remove marker
function removePoint(marker) {
  const index = markers.indexOf(marker);
  if (index === -1) return;
  map.removeLayer(marker);
  const removedLatLng = latlngs[index];
  markers.splice(index, 1);
  latlngs.splice(index, 1);
  updateList();
  actionHistory.push({ type: 'remove', marker, latlng: removedLatLng });
}

// Clear all
function clearAll() {
  if (markers.length === 0) return;
  markers.forEach(m => map.removeLayer(m));
  actionHistory.push({ type: 'clear', markers: markers.slice(), latlngs: latlngs.slice() });
  markers = [];
  latlngs = [];
  if (polyline) { map.removeLayer(polyline); polyline = null; }
  updateList();
  document.getElementById('routeInfo').innerText = 'No route yet';
}

// Undo last action
function undoAction() {
  if (actionHistory.length === 0) return alert('No action to undo');
  const last = actionHistory.pop();
  if (last.type === 'add') {
    removePoint(last.marker);
    if (actionHistory.length && actionHistory[actionHistory.length-1].type === 'remove') actionHistory.pop();
  } else if (last.type === 'remove') {
    const m = L.marker(last.latlng).addTo(map);
    markers.push(m);
    latlngs.push(last.latlng);
    m.on('click', () => removePoint(m));
    updateList();
  } else if (last.type === 'clear') {
    markers = [];
    latlngs = [];
    last.markers.forEach((m, i) => {
      const newM = L.marker(last.latlngs[i]).addTo(map);
      markers.push(newM);
      latlngs.push(last.latlngs[i]);
      newM.on('click', () => removePoint(newM));
    });
    updateList();
  }
}

// Update point list
function updateList() {
  const ol = document.getElementById('pointsList');
  ol.innerHTML = '';
  latlngs.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `${i}: ${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
    ol.appendChild(li);
  });
}

// Flatten coordinates
function flatCoords() {
  const flat = [];
  latlngs.forEach(p => { flat.push(p[0]); flat.push(p[1]); });
  return flat;
}

// JS Nearest Neighbor + 2-opt
function tspNearestNeighborJS(flat) {
  const n = flat.length / 2;
  if (n === 0) return [];
  const pts = [];
  for (let i=0;i<n;i++) pts.push([flat[2*i], flat[2*i+1]]);
  const used = Array(n).fill(false);
  let cur = 0; used[cur] = true;
  const tour = [0];

  function hav(aLat,aLon,bLat,bLon){
    const R = 6371000, toRad=x=>x*Math.PI/180;
    const dLat = toRad(bLat-aLat), dLon = toRad(bLon-aLon);
    const lat1 = toRad(aLat), lat2 = toRad(bLat);
    const s = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }

  for(let step=1;step<n;step++){
    let best=Infinity,bestj=-1;
    for(let j=0;j<n;j++) if(!used[j]){
      const d = hav(pts[cur][0], pts[cur][1], pts[j][0], pts[j][1]);
      if(d<best){ best=d; bestj=j; }
    }
    if(bestj===-1) break;
    tour.push(bestj);
    used[bestj]=true;
    cur=bestj;
  }
  return tour;
}

// 2-opt improvement
function twoOptJS(route, flat){
  if(route.length<=2) return route.slice();
  function dist(i,j){
    const R=6371000,toRad=x=>x*Math.PI/180;
    const aLat=flat[2*i],aLon=flat[2*i+1],bLat=flat[2*j],bLon=flat[2*j+1];
    const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
    const lat1=toRad(aLat), lat2=toRad(bLat);
    const s = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }
  let improved=true,r=route.slice();
  while(improved){
    improved=false;
    for(let i=1;i+1<r.length-1;i++){
      for(let k=i+1;k<r.length;k++){
        const a=r[i-1],b=r[i],c=r[k],d=(k+1<r.length)?r[k+1]:-1;
        let before=dist(a,b)+(d===-1?0:dist(c,d));
        let after=dist(a,c)+(d===-1?0:dist(b,d));
        if(after+1e-9<before){ 
          r=r.slice(0,i).concat(r.slice(i,k+1).reverse(), r.slice(k+1));
          improved=true;
        }
      }
      if(improved) break;
    }
  }
  return r;
}

// Compute distance
function computeDistanceOrder(order, flat){
  if(!order||order.length===0) return 0;
  const R=6371000,toRad=x=>x*Math.PI/180;
  let sum=0;
  function hav(aLat,aLon,bLat,bLon){
    const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
    const lat1=toRad(aLat), lat2=toRad(bLat);
    const s=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }
  for(let i=0;i<order.length-1;i++){
    sum+=hav(flat[2*order[i]],flat[2*order[i]+1],flat[2*order[i+1]],flat[2*order[i+1]+1]);
  }
  return sum;
}

// Redraw route
function redrawRoute(order){
  if(polyline){ map.removeLayer(polyline); polyline=null; }
  if(!order||order.length===0) return;
  const latlngsOrdered = order.map(i=>latlngs[i]);
  polyline = L.polyline(latlngsOrdered,{color:'blue'}).addTo(map);
  if(latlngsOrdered.length>=2) map.fitBounds(polyline.getBounds().pad(0.2));
}

// Solve JS Route
function solveRouteJS(){
  if(latlngs.length<2) return alert('Add at least 2 points');
  const flat = flatCoords();
  const route = tspNearestNeighborJS(flat);
  const improved = twoOptJS(route, flat);
  const dist = computeDistanceOrder(improved, flat);
  redrawRoute(improved);
  document.getElementById('routeInfo').innerText=`Order: [${improved.join(', ')}]\nDistance (m): ${dist.toFixed(1)}`;
}

// DOM wiring
document.addEventListener('DOMContentLoaded',()=>{
  initMap();
  document.getElementById('btnClear').onclick = clearAll;
  document.getElementById('btnUndo').onclick = undoAction;
  document.getElementById('btnSolveJS').onclick = solveRouteJS;
});
