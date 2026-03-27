// js/location-check.js
// TODO: Replace these coordinates with the exact latitude and longitude of your college.
// You can use Google Maps to find these coordinates (Right-click on your college -> copy coordinates)
// Hide the entire body content and show an access denied screen
const COLLEGE_LAT = 18.995270930366097; // Default Example: 19.0760 (Mumbai)
const COLLEGE_LNG = 72.83223548890648; // Default Example: 72.8777 (Mumbai)
const MAX_RADIUS_METERS = 5000; // Increased to 5000 meters for testing


function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
}

function showAccessDenied(message) {
    // Hide the entire body content and show an access denied screen
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f8f9fa; color: #dc3545; font-family: Arial, sans-serif; text-align: center; padding: 20px;">
            <h1 style="font-size: 3rem; margin-bottom: 10px;">🚫 Access Denied</h1>
            <h2 style="font-size: 1.5rem; color: #333;">Location Restriction</h2>
            <p style="font-size: 1.2rem; color: #666; max-width: 600px; margin-top: 15px;">${message}</p>
            <p style="margin-top: 20px; font-size: 0.9rem; color: #888;">If you believe this is an error, please ensure your device's location services are turned on and you are within the college premises.</p>
        </div>
    `;
}

function verifyLocation() {
    if (!navigator.geolocation) {
        showAccessDenied("Geolocation is not supported by your browser. You cannot access this system.");
        return;
    }

    // Optional: show a loading state while fetching location
    const originalDisplay = document.body.style.display;
    document.body.style.display = 'none';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;



            const distance = calculateDistance(COLLEGE_LAT, COLLEGE_LNG, userLat, userLng);

            console.log("Distance from college:", Math.round(distance), "meters");

            if (distance > MAX_RADIUS_METERS) {
                document.body.style.display = 'block';
                showAccessDenied(`You are approximately ${Math.round(distance)} meters away. Access is restricted to within ${MAX_RADIUS_METERS} meters of the college area.`);
            } else {
                // If within radius, show the page content
                document.body.style.display = originalDisplay || '';
            }
        },
        (error) => {
            document.body.style.display = 'block';
            let errorMsg = "Unable to retrieve your location. Access is denied.";
            if (error.code === error.PERMISSION_DENIED) {
                errorMsg = "You must allow location access in your browser to use this application. Please refresh and allow location permissions.";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMsg = "Location information is unavailable.";
            } else if (error.code === error.TIMEOUT) {
                errorMsg = "The request to get user location timed out.";
            }
            showAccessDenied(errorMsg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Intercept page load and verify location
document.addEventListener('DOMContentLoaded', verifyLocation);
