const API_URL = '/api';

// Helper to get token
function getToken() {
    return localStorage.getItem('token');
}

// Helper for authenticated fetch
async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['x-auth-token'] = token;
    }

    const response = await fetch(`${API_URL}${url}`, {
        ...options,
        headers
    });

    return response;
}

// Dark Mode Toggle Logic
function initDarkMode() {
    const isDark = localStorage.getItem('darkMode') === 'true';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (isDark || (localStorage.getItem('darkMode') === null && prefersDark)) {
        document.body.classList.add('dark-mode');
    }

    // Auto-inject toggle button if nav exists
    const nav = document.querySelector('.nav-links');
    if (nav && !document.getElementById('darkModeToggle')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'darkModeToggle';
        toggleBtn.className = 'dark-mode-toggle';
        toggleBtn.innerHTML = '🌓';
        toggleBtn.title = 'Toggle Dark Mode';
        toggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
        });
        nav.appendChild(toggleBtn);
    }
}

// Run on load
document.addEventListener('DOMContentLoaded', initDarkMode);
