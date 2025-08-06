let map, routingControl, userMarker, accuracyCircle, userPos = [], instructions = [];
let watchId = null;
let lastSpokenInstruction = null;
let nextInstructionIndex = 0;
let isNavigating = false;
let houseData = [];
let roadData = [];
let highlightedHouse = null;

// Updated Devtraco Estate bounding box based on POINTS.json
const estateBounds = {
  minLat: 5.7260,
  maxLat: 5.7400,
  minLon: 0.0390,
  maxLon: 0.0500
};

function show(id) {
  document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
  document.getElementById(id === 'map' ? 'mapPage' : id).classList.add('active');
  document.getElementById('navLinks').style.display = (id === 'map') ? 'none' : 'block';
  if (id === 'map') setTimeout(initMap, 300);
}

function initMap() {
  if (map) return;

  document.getElementById('loadingSpinner').style.display = 'block';

  map = L.map('map').setView([5.7328, 0.0447], 14);

  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri, Maxar, Earthstar Geographics'
  });

  const labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
    attribution: '© CartoDB'
  });

  const baseLayers = {
    "Street": streetLayer,
    "Satellite with Labels": L.layerGroup([satelliteLayer, labelsLayer])
  };

  streetLayer.addTo(map);
  L.control.layers(baseLayers).addTo(map);

  // Load estate GeoJSON (houses)
  fetch('POINTS.json')
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load POINTS.json: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      houseData = data.features;
      console.log('POINTS.json loaded successfully');
    })
    .catch(error => {
      console.error('Error loading POINTS.json:', error);
      alert('Failed to load house data. Using sample data.');
      const sampleHouseData = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { name: "Sample Building", type: "building", HOUSE_NUMB: "A1" },
          geometry: {
            type: "Point",
            coordinates: [0.0447, 5.7328]
          }
        }]
      };
      houseData = sampleHouseData.features;
    });

  // Load road GeoJSON and cache for performance
  fetch('ROAD.json')
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load ROAD.json: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      roadData = data.features;
      console.log('ROAD.json loaded successfully');
    })
    .catch(error => {
      console.error('Error loading ROAD.json:', error);
      alert('Failed to load road data. Using sample data.');
      const sampleRoadData = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Main Estate Road", type: "road", ROAD_ID: "R1" },
            geometry: {
              type: "LineString",
              coordinates: [
                [0.0445, 5.7328],
                [0.0447, 5.7328],
                [0.0449, 5.7327]
              ]
            }
          },
          {
            type: "Feature",
            properties: { name: "Secondary Road", type: "road", ROAD_ID: "R2" },
            geometry: {
              type: "LineString",
              coordinates: [
                [0.0446, 5.7329],
                [0.0448, 5.7329],
                [0.0450, 5.7330]
              ]
            }
          }
        ]
      };
      roadData = sampleRoadData.features;
    });

  // Initialize routing control with enhanced styling
  routingControl = L.Routing.control({
    waypoints: [],
    routeWhileDragging: false,
    collapsible: true,
    show: false,
    createMarker: () => null,
    formatter: new L.Routing.Formatter({
      language: 'en',
      units: 'metric'
    }),
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
      timeout: 5000,
      profile: 'driving'
    }),
    plan: L.Routing.plan([], {
      draggableWaypoints: false,
      addWaypoints: false
    }),
    lineOptions: {
      styles: [
        { className: 'route-line', weight: 5, opacity: 0.8 },
        { className: 'route-line-upcoming', weight: 4, opacity: 0.5 }
      ]
    }
  }).addTo(map);

  // Add loading indicator and error handling for routing
  routingControl.on('routestart', function() {
    document.getElementById('loadingSpinner').style.display = 'block';
  });

  routingControl.on('routesfound', function() {
    document.getElementById('loadingSpinner').style.display = 'none';
  });

  routingControl.on('routingerror', function(e) {
    document.getElementById('loadingSpinner').style.display = 'none';
    speak("Unable to calculate route. Please try a different location or check your connection.");
    alert("Routing error: Unable to find a route. Please try again or check road data.");
  });

  // Pre-warm routing engine
  setTimeout(() => {
    const dummyStart = [5.7328, 0.0447];
    const dummyEnd = [5.7330, 0.0449];
    routingControl.setWaypoints([
      L.latLng(dummyStart[0], dummyStart[1]),
      L.latLng(dummyEnd[0], dummyEnd[1])
    ]);
    setTimeout(() => routingControl.setWaypoints([]), 100);
  }, 500);

  // High-precision geolocation
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    (p) => {
      updateUserPosition(p);
      document.getElementById('loadingSpinner').style.display = 'none';
    },
    (error) => {
      handleLocationError(error);
      document.getElementById('loadingSpinner').style.display = 'none';
    },
    geoOptions
  );

  watchId = navigator.geolocation.watchPosition(
    updateUserPosition,
    handleLocationError,
    geoOptions
  );

  routingControl.on('routesfound', function(e) {
    const routes = e.routes;
    instructions = routes[0].instructions;
    nextInstructionIndex = 0;
    isNavigating = true;
    
    if (instructions.length > 0) {
      speakInstruction(instructions[0]);
      nextInstructionIndex = 1;
    }
    
    const distance = (routes[0].summary.totalDistance / 1000).toFixed(1);
    speak(`Route calculated. Your destination is ${distance} kilometers away.`);
  });

  routingControl.on('routeselected', function(e) {
    const route = e.route;
    instructions = route.instructions;
    nextInstructionIndex = 0;
    isNavigating = true;
  });

  // Search input event listeners
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('search-results');
  
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.trim().toUpperCase();
    searchResults.innerHTML = '';
    
    if (searchTerm.length < 1) {
      searchResults.style.display = 'none';
      return;
    }
    
    const houseMatches = houseData.filter(house => 
      house.properties.HOUSE_NUMB && 
      house.properties.HOUSE_NUMB.toUpperCase().includes(searchTerm)
    ).slice(0, 5);
    
    houseMatches.forEach(house => {
      const resultItem = document.createElement('div');
      resultItem.className = 'search-result';
      resultItem.textContent = house.properties.HOUSE_NUMB;
      resultItem.addEventListener('click', () => {
        selectHouse(house);
        searchResults.style.display = 'none';
        searchInput.value = house.properties.HOUSE_NUMB;
      });
      searchResults.appendChild(resultItem);
    });
    
    if (houseMatches.length > 0) {
      searchResults.style.display = 'block';
    } else {
      searchResults.style.display = 'none';
    }
  });
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-bar')) {
      searchResults.style.display = 'none';
    }
  });
}

function isInEstate(lat, lon) {
  return lat >= estateBounds.minLat && lat <= estateBounds.maxLat &&
         lon >= estateBounds.minLon && lon <= estateBounds.maxLon;
}

function findNearestRoadPoint(lat, lon) {
  let minDistance = Infinity;
  let nearestPoint = null;
  let nearestRoadName = '';
  const maxSnapDistance = 50; // Max snapping distance in meters

  roadData.forEach(road => {
    if (road.geometry.type === 'LineString') {
      road.geometry.coordinates.forEach(coord => {
        const distance = map.distance([lat, lon], [coord[1], coord[0]]);
        if (distance < minDistance && distance <= maxSnapDistance) {
          minDistance = distance;
          nearestPoint = [coord[1], coord[0]]; // [lat, lon]
          nearestRoadName = road.properties.name || road.properties.ROAD_ID || 'road';
        }
      });
    }
  });

  return { point: nearestPoint, roadName: nearestRoadName, distance: minDistance };
}

function getRoadWaypoints(startLatLng, endLatLng) {
  const waypoints = [];
  
  // Snap start point to road if in estate
  if (isInEstate(startLatLng[0], startLatLng[1])) {
    const nearestStart = findNearestRoadPoint(startLatLng[0], startLatLng[1]);
    if (nearestStart.point && nearestStart.distance <= 50) {
      waypoints.push(L.latLng(nearestStart.point[0], nearestStart.point[1]));
      speak(`Starting from ${nearestStart.roadName}`);
    } else {
      waypoints.push(L.latLng(startLatLng[0], startLatLng[1]));
      speak("Starting from your current location, no nearby road found.");
    }
  } else {
    waypoints.push(L.latLng(startLatLng[0], startLatLng[1]));
  }

  // Add intermediate waypoints for estate roads if both points are in estate
  if (isInEstate(startLatLng[0], startLatLng[1]) && isInEstate(endLatLng[0], endLatLng[1])) {
    const midRoad = roadData.find(road => road.properties.ROAD_ID === 'R1'); // Example: Use main road
    if (midRoad && midRoad.geometry.type === 'LineString') {
      const midPoint = midRoad.geometry.coordinates[Math.floor(midRoad.geometry.coordinates.length / 2)];
      waypoints.push(L.latLng(midPoint[1], midPoint[0]));
    }
  }

  // Snap end point to road if in estate
  if (isInEstate(endLatLng[0], endLatLng[1])) {
    const nearestEnd = findNearestRoadPoint(endLatLng[0], endLatLng[1]);
    if (nearestEnd.point && nearestEnd.distance <= 50) {
      waypoints.push(L.latLng(nearestEnd.point[0], nearestEnd.point[1]));
      speak(`Heading to ${nearestEnd.roadName}`);
    } else {
      waypoints.push(L.latLng(endLatLng[0], endLatLng[1]));
      speak("Heading to destination, no nearby road found.");
    }
  } else {
    waypoints.push(L.latLng(endLatLng[0], endLatLng[1]));
  }

  return waypoints;
}

function updateUserPosition(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  // Limit accuracy circle to maximum 20 meters radius for visual clarity
  const accuracy = Math.min(position.coords.accuracy, 20); 
  
  userPos = [lat, lon];
  
  const customIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    className: 'blinking'
  });

  if (userMarker) {
    userMarker.setLatLng(userPos);
  } else {
    userMarker = L.marker(userPos, { icon: customIcon }).addTo(map);
  }

  if (accuracyCircle) {
    accuracyCircle.setLatLng(userPos).setRadius(accuracy);
  } else {
    accuracyCircle = L.circle(userPos, {
      radius: accuracy,
      className: 'gps-accuracy'
    }).addTo(map);
  }

  if (isNavigating && instructions.length > 0) {
    checkNextInstruction();
  }
}

function checkNextInstruction() {
  if (!isNavigating || nextInstructionIndex >= instructions.length) return;

  const currentInstruction = instructions[nextInstructionIndex];
  const distanceToNext = map.distance(userPos, currentInstruction.latLng);

  if (distanceToNext < 50) {
    speakInstruction(currentInstruction);
    nextInstructionIndex++;
    
    if (nextInstructionIndex < instructions.length) {
      const nextInstruction = instructions[nextInstructionIndex];
      const nextDistance = map.distance(userPos, nextInstruction.latLng);
      
      if (nextDistance < 150) {
        speak(`After that, ${nextInstruction.text}`);
      }
    }
  } else if (nextInstructionIndex === instructions.length - 1 && distanceToNext < 20) {
    speak("You have arrived at your destination");
    isNavigating = false;
  }
}

function speakInstruction(instruction) {
  let text = instruction.text;
  
  text = text.replace(/Continue/g, "Continue for");
  text = text.replace(/Destination/g, "You have reached your destination");
  text = text.replace(/left/g, "Turn left");
  text = text.replace(/right/g, "Turn right");
  text = text.replace(/sharp left/g, "Take a sharp left");
  text = text.replace(/sharp right/g, "Take a sharp right");
  text = text.replace(/slight left/g, "Bear left");
  text = text.replace(/slight right/g, "Bear right");
  
  if (instruction.distance > 0) {
    const distance = instruction.distance < 1000 ? 
      `${Math.round(instruction.distance)} meters` : 
      `${(instruction.distance / 1000).toFixed(1)} kilometers`;
    text = `In ${distance}, ${text}`;
  }
  
  speak(text);
  lastSpokenInstruction = text;
}

function repeatInstruction() {
  if (lastSpokenInstruction) {
    speak(lastSpokenInstruction);
  } else {
    speak("No instructions available");
  }
}

function handleLocationError(error) {
  let errorMsg = "Error getting your location: ";
  switch(error.code) {
    case error.PERMISSION_DENIED:
      errorMsg += "Location permission denied. Please enable it in your browser settings.";
      break;
    case error.POSITION_UNAVAILABLE:
      errorMsg += "Location information unavailable.";
      break;
    case error.TIMEOUT:
      errorMsg += "Location request timed out. Please try again.";
      break;
    case error.UNKNOWN_ERROR:
      errorMsg += "An unknown error occurred.";
      break;
  }
  console.error(errorMsg);
  
  userPos = [5.7328, 0.0447];
  if (userMarker) {
    userMarker.setLatLng(userPos);
  } else {
    const customIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      className: 'blinking'
    });
    userMarker = L.marker(userPos, { icon: customIcon }).addTo(map);
  }
  map.setView(userPos, 15);
}

function recenterMap() {
  if (userPos.length) {
    map.setView(userPos, 15);
  }
}

function doSearch() {
  const q = document.getElementById('searchInput').value;
  if (!q || !userPos.length) {
    speak("Please enter a search term and ensure location services are enabled.");
    return;
  }
  
  const houseMatch = houseData.find(house => 
    house.properties.HOUSE_NUMB && 
    house.properties.HOUSE_NUMB.toUpperCase() === q.toUpperCase()
  );
  
  if (houseMatch) {
    selectHouse(houseMatch);
    return;
  }
  
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ' Ghana')}`, {
    headers: { 'User-Agent': 'DevtracoNavigation/1.0' }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.length) {
        speak("Location not found. Please try another search term.");
        return alert('Location not found');
      }
      const dest = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      
      if (isInEstate(dest[0], dest[1])) {
        const waypoints = getRoadWaypoints(userPos, dest);
        routingControl.setWaypoints(waypoints);
        map.setView(dest, 15);
        speak(`Routing to ${q} via estate roads`);
      } else {
        routingControl.setWaypoints([L.latLng(userPos[0], userPos[1]), L.latLng(dest[0], dest[1])]);
        map.setView(dest, 15);
        speak(`Routing to ${q}`);
      }
    })
    .catch(err => {
      console.error('Search error:', err);
      speak("Error searching for location. Please try again.");
      alert('Error searching for location');
    });
}

function selectHouse(house) {
  if (highlightedHouse) {
    map.removeLayer(highlightedHouse);
  }
  
  const houseCoords = house.geometry.coordinates;
  const houseLatLng = [houseCoords[1], houseCoords[0]];

  map.flyTo(houseLatLng, 18);

  const houseIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    shadowSize: [41, 41]
  });
  highlightedHouse = L.marker(houseLatLng, { icon: houseIcon })
    .addTo(map)
    .bindPopup(`<b>House:</b> ${house.properties.HOUSE_NUMB}`)
    .openPopup();

  if (userPos.length) {
    if (routingControl) {
      map.removeControl(routingControl);
    }

    const waypoints = getRoadWaypoints(userPos, houseLatLng);

    routingControl = L.Routing.control({
      waypoints: waypoints,
      routeWhileDragging: false,
      showAlternatives: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: true,
      lineOptions: {
        styles: [
          { className: 'route-line', weight: 5, opacity: 0.8 },
          { className: 'route-line-upcoming', weight: 4, opacity: 0.5 }
        ]
      },
      createMarker: function() { return null; }
    }).addTo(map);
    
    speak(`Routing to house ${house.properties.HOUSE_NUMB} via estate roads`);
  } else {
    speak("Please enable location services to get directions.");
    alert("Please enable location services to get directions.");
  }
}

function speak(text) {
  if (!window.speechSynthesis) {
    console.warn("Speech synthesis not supported");
    return;
  }
  
  window.speechSynthesis.cancel();
  
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 0.9;
  utter.pitch = 1.1;
  
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    utter.rate = 1.0;
    utter.volume = 1.5;
  }
  
  window.speechSynthesis.speak(utter);
}

window.addEventListener('beforeunload', () => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
  }
  window.speechSynthesis.cancel();
});